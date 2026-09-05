"""Validate and merge a read-only cluster geography export, preserving local user data.

Dry run by default. --apply requires a new backup file. Geographic rows use
source identities; enrichments map bench IDs rather than database row numbers.
"""
import argparse
import base64
import gzip
import json
import sqlite3
from collections import Counter
from pathlib import Path

TABLES = {"environment_features", "land_cover_features", "bench_enrichments", "official_context_sources"}


def records(path):
    with gzip.open(path, "rt") as stream:
        for line in stream:
            yield json.loads(line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--database", type=Path, default=Path("data/benchly.sqlite"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    if args.apply and (not args.backup or args.backup.exists() or args.backup.resolve() == args.database.resolve()):
        parser.error("--apply requires a new, distinct --backup file")
    counts, footer = Counter(), None
    # Read the entire gzip first, including its checksum and completion sentinel.
    # A failed transfer must never become a partly imported official source.
    for index, record in enumerate(records(args.input)):
        if index == 0:
            if record.get("format") != "benchly-geography-v1":
                raise ValueError("Unsupported export")
        elif "table" in record:
            if footer or record["table"] not in TABLES:
                raise ValueError("Unexpected export record")
            counts[record["table"]] += 1
        elif record.get("complete"):
            if footer:
                raise ValueError("Duplicate footer")
            footer = record
    if not footer or dict(counts) != footer["counts"]:
        raise ValueError("Incomplete export")
    print(json.dumps({"validated": dict(counts), "apply": args.apply}), flush=True)
    if not args.apply:
        return
    db = sqlite3.connect(f"file:{args.database.resolve()}?mode=rw", uri=True)
    db.execute("PRAGMA busy_timeout=15000")
    with sqlite3.connect(args.backup) as backup:
        db.backup(backup)
    print(f"Backup: {args.backup}", flush=True)
    bench_ids = dict(db.execute("SELECT id,row_id FROM benches"))
    local_analyses = {row[0] for row in db.execute("SELECT bench_row_id FROM bench_enrichments")}
    refreshed_analyses = set()
    columns = {table: {row[1] for row in db.execute(f"PRAGMA table_info({table})")} for table in TABLES}
    statements, imported, skipped = {}, Counter(), Counter()
    # One transaction keeps source metadata and its geometry atomic. No DDL,
    # deletions, user tables, bench positions, or source tags are involved.
    with db:
        for record in records(args.input):
            if "table" not in record:
                continue
            table, row = record["table"], record["row"]
            row.pop("row_id", None)
            if table == "bench_enrichments":
                bench_id = row.pop("bench_id")
                if bench_id not in bench_ids:
                    skipped["unmatched_bench"] += 1
                    continue
                row["bench_row_id"] = bench_ids[bench_id]
                # Preserve a locally newer completed analysis, but invalidate it
                # below so it sees the newly available shoreline geometry.
                existing = db.execute("SELECT computed_at FROM bench_enrichments WHERE bench_row_id=?", (row["bench_row_id"],)).fetchone()
                if existing and (existing[0] or "") > (row.get("computed_at") or ""):
                    skipped["newer_local_enrichment"] += 1
                    continue
            if row.get("geometry_wkb"):
                row["geometry_wkb"] = base64.b64decode(row["geometry_wkb"], validate=True)
            if set(row) - columns[table]:
                raise ValueError(f"Schema mismatch: {table}")
            keys = tuple(row)
            statement_key = (table, keys)
            if statement_key not in statements:
                conflict = {"environment_features": "source,source_id,kind", "land_cover_features": "source,source_id,class",
                            "bench_enrichments": "bench_row_id", "official_context_sources": "source"}[table]
                assignments = ",".join(f"{key}=excluded.{key}" for key in keys if key not in conflict.split(","))
                statements[statement_key] = f"INSERT INTO {table}({','.join(keys)}) VALUES({','.join('?' for _ in keys)}) ON CONFLICT({conflict}) DO UPDATE SET {assignments}"
            db.execute(statements[statement_key], tuple(row.values()))
            if table == "bench_enrichments":
                refreshed_analyses.add(row["bench_row_id"])
            imported[table] += 1
            if imported[table] % 100000 == 0:
                print(f"{table}: {imported[table]}", flush=True)
        # Invalidate only local analyses not refreshed by this export, keeping
        # their terrain, seasonal sun values and user-visible metadata intact.
        db.executemany("UPDATE bench_enrichments SET environment_computed_at=NULL WHERE bench_row_id=?",
                       [(row_id,) for row_id in local_analyses - refreshed_analyses])
    print(json.dumps({"imported": dict(imported), "skipped": dict(skipped)}), flush=True)
    db.close()


if __name__ == "__main__":
    main()
