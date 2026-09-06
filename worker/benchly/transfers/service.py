from __future__ import annotations

import base64
import gzip
import json
import sqlite3
from collections import Counter
from collections.abc import Iterator
from pathlib import Path

from benchly.benches.models import BenchEnrichment
from benchly.benches.repository import invalidate_environment_for_benches, upsert_enrichment
from benchly.context.models import EnvironmentFeature, LandCoverFeature, OfficialContextSource
from benchly.context.repository import upsert_environment_features, upsert_land_cover, upsert_official_source
from benchly.transfers.models import TransferFooter, TransferHeader, TransferResult, TransferRow


def _records(path: Path) -> Iterator[dict[str, object]]:
    with gzip.open(path, "rt") as stream:
        for line in stream:
            yield json.loads(line)


def validate_export(path: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    footer: TransferFooter | None = None
    for index, raw in enumerate(_records(path)):
        if index == 0:
            TransferHeader.model_validate(raw)
        elif "table" in raw:
            if footer:
                raise ValueError("Rows found after export footer")
            record = TransferRow.model_validate(raw)
            counts[record.table] += 1
        elif raw.get("complete"):
            if footer:
                raise ValueError("Duplicate export footer")
            footer = TransferFooter.model_validate(raw)
        else:
            raise ValueError("Unexpected export record")
    if not footer or dict(counts) != footer.counts:
        raise ValueError("Incomplete export")
    return counts


def _decode_geometry(row: dict[str, object]) -> dict[str, object]:
    result = dict(row)
    encoded = result.get("geometry_wkb")
    if encoded:
        result["geometry_wkb"] = base64.b64decode(str(encoded), validate=True)
    return result


def _typed_row(table: str, row: dict[str, object]) -> dict[str, object]:
    row = _decode_geometry(row)
    row.pop("row_id", None)
    if table == "land_cover_features" and "class" in row:
        row["cover_class"] = row.pop("class")
    model = {
        "environment_features": EnvironmentFeature,
        "land_cover_features": LandCoverFeature,
        "bench_enrichments": BenchEnrichment,
        "official_context_sources": OfficialContextSource,
    }[table]
    validated = model.model_validate(row)
    return {field: getattr(validated, field) for field in row if field != "row_id"}


def import_export(database_path: Path, export_path: Path, backup_path: Path) -> TransferResult:
    if backup_path.exists() or backup_path.resolve() == database_path.resolve():
        raise ValueError("Apply requires a new, distinct backup file")
    connection = sqlite3.connect(f"file:{database_path.resolve()}?mode=rw", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=15000")
    with sqlite3.connect(backup_path) as backup:
        connection.backup(backup)

    bench_ids = dict(connection.execute("SELECT id,row_id FROM benches"))
    local_analyses = {int(row[0]) for row in connection.execute("SELECT bench_row_id FROM bench_enrichments")}
    refreshed_analyses: set[int] = set()
    imported: Counter[str] = Counter()
    skipped: Counter[str] = Counter()
    try:
        with connection:
            for raw in _records(export_path):
                if "table" not in raw:
                    continue
                record = TransferRow.model_validate(raw)
                row = dict(record.row)
                if record.table == "bench_enrichments":
                    bench_id = str(row.pop("bench_id"))
                    bench_row_id = bench_ids.get(bench_id)
                    if bench_row_id is None:
                        skipped["unmatched_bench"] += 1
                        continue
                    row["bench_row_id"] = bench_row_id
                    existing = connection.execute(
                        "SELECT computed_at FROM bench_enrichments WHERE bench_row_id=?", (bench_row_id,),
                    ).fetchone()
                    if existing and (existing[0] or "") > (row.get("computed_at") or ""):
                        skipped["newer_local_enrichment"] += 1
                        continue
                values = _typed_row(record.table, row)
                if record.table == "environment_features":
                    upsert_environment_features(connection, [values])
                elif record.table == "land_cover_features":
                    upsert_land_cover(connection, [values])
                elif record.table == "bench_enrichments":
                    upsert_enrichment(connection, values)
                    refreshed_analyses.add(int(values["bench_row_id"]))
                else:
                    upsert_official_source(connection, values)
                imported[record.table] += 1
            invalidate_environment_for_benches(connection, local_analyses - refreshed_analyses)
    finally:
        connection.close()
    return TransferResult(imported=dict(imported), skipped=dict(skipped))


def run_import_geography(args) -> None:
    counts = validate_export(args.input)
    print(json.dumps({"validated": dict(counts), "apply": args.apply}), flush=True)
    if not args.apply:
        return
    if not args.backup:
        raise ValueError("--apply requires --backup")
    result = import_export(args.database.resolve(), args.input.resolve(), args.backup.resolve())
    print(f"Backup: {args.backup}", flush=True)
    print(result.model_dump_json(indent=2), flush=True)
