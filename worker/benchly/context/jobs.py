"""Bounded imports of official geographic context."""

from __future__ import annotations

import hashlib
import json
import tempfile
from argparse import Namespace
from datetime import datetime
from pathlib import Path

from benchly.benches.repository import invalidate_enrichment
from benchly.context.importer import (
    finalize_swisstlm_import,
    import_swissbuildings_gdb,
    import_swisstlm_geopackage,
)
from benchly.context.sources import (
    discover_swissbuildings_assets,
    discover_swisstlm_asset,
    download_file,
    safe_extract_zip,
)
from benchly.context.repository import upsert_building_asset, upsert_building_cell, upsert_official_source
from benchly.db import connect_database
from benchly.enrichment.service import expand_bounds
from benchly.runs.repository import begin_run, finish_run, set_source_version
from benchly.runtime import now_iso, sha256_file
from benchly.settings import PROVIDERS


def _skip_outside_first_sunday(args: Namespace, connection, run_id: int) -> bool:
    if not args.first_sunday_only or datetime.now().day <= 7:
        return False
    finish_run(connection, run_id, "skipped", {"reason": "not the first Sunday of the month"})
    print(json.dumps({"status": "skipped", "reason": "not the first Sunday"}, indent=2))
    return True


def import_official_context_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-swisstlm-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    run_id = begin_run(connection, "import-official-context")
    stats: dict[str, object] = {}
    try:
        if _skip_outside_first_sunday(args, connection, run_id):
            return
        if args.archive:
            archive = Path(args.archive).resolve()
            source_version = args.source_version or sha256_file(archive)
            asset_url = archive.as_uri()
        else:
            source_version, asset_url = discover_swisstlm_asset()
            existing = connection.execute(
                "SELECT version FROM official_context_sources WHERE source='swissTLM3D'"
            ).fetchone()
            if existing and existing["version"] == source_version and not args.force:
                finish_run(connection, run_id, "skipped", {"reason": "source version unchanged", "version": source_version})
                print(json.dumps({"status": "up-to-date", "version": source_version}, indent=2))
                return
            archive = work_dir / "swisstlm3d.zip"
            download_file(asset_url, archive)

        extract_dir = work_dir / "extracted"
        safe_extract_zip(archive, extract_dir)
        geopackages = sorted(extract_dir.rglob("*.gpkg"))
        if not geopackages:
            raise RuntimeError("swissTLM3D archive contains no GeoPackage")
        import_generation = now_iso()
        for geopackage in geopackages:
            imported = import_swisstlm_geopackage(
                connection,
                geopackage,
                source_version,
                imported_at=import_generation,
                finalize=False,
            )
            for key, value in imported.items():
                stats[key] = int(stats.get(key, 0)) + value
        finalize_swisstlm_import(connection, import_generation)
        upsert_official_source(
            connection,
            {
                "source": "swissTLM3D",
                "version": source_version,
                "asset_url": asset_url,
                "asset_checksum": sha256_file(archive),
                "imported_at": now_iso(),
                "stats": json.dumps(stats, separators=(",", ":")),
            },
        )
        set_source_version(connection, run_id, source_version)
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error), **stats})
        raise
    finally:
        connection.close()
        if temporary_context:
            temporary_context.cleanup()


def _pending_building_cells(connection, cell_degrees: float, maximum: int, force: bool):
    existing_cells = {
        row["cell_key"] for row in connection.execute("SELECT cell_key FROM building_import_cells")
    }
    rows = connection.execute(
        """
        SELECT CAST(longitude/? AS INTEGER) cell_x, CAST(latitude/? AS INTEGER) cell_y, count(*) count
        FROM benches WHERE active=1 GROUP BY cell_x,cell_y ORDER BY count DESC
        """,
        (cell_degrees, cell_degrees),
    ).fetchall()
    cells: list[tuple[str, tuple[float, float, float, float]]] = []
    for row in rows:
        key = f"{cell_degrees:.4f}:{row['cell_x']}:{row['cell_y']}"
        if key in existing_cells and not force:
            continue
        cells.append(
            (
                key,
                (
                    row["cell_x"] * cell_degrees,
                    row["cell_y"] * cell_degrees,
                    (row["cell_x"] + 1) * cell_degrees,
                    (row["cell_y"] + 1) * cell_degrees,
                ),
            )
        )
        if len(cells) >= maximum:
            break
    return cells


def _import_building_archive(connection, archive: Path, work_dir: Path, source_version: str) -> dict[str, int]:
    extract_dir = work_dir / "archive"
    safe_extract_zip(archive, extract_dir)
    geodatabases = sorted(path for path in extract_dir.rglob("*.gdb") if path.is_dir())
    if not geodatabases:
        raise RuntimeError("swissBUILDINGS3D archive contains no FileGDB")
    stats = {"building": 0, "skipped": 0}
    generation = now_iso()
    for geodatabase in geodatabases:
        imported = import_swissbuildings_gdb(connection, geodatabase, source_version, generation)
        for key, value in imported.items():
            stats[key] += value
    invalidate_enrichment(connection, environment=True)
    return stats


def _import_building_cells(connection, args: Namespace, work_dir: Path) -> tuple[dict[str, int], str]:
    cells = _pending_building_cells(connection, args.cell_degrees, args.max_cells, args.force)
    if not cells:
        return {"cells": 0, "assets": 0, "building": 0, "skipped": 0}, ""

    stats = {"cells": 0, "assets": 0, "building": 0, "skipped": 0}
    imported_versions: list[str] = []
    for cell_key, bounds in cells:
        assets = discover_swissbuildings_assets(expand_bounds(bounds, 150))
        cell_stats = {"assets": len(assets), "building": 0}
        for asset in assets:
            imported_versions.append(asset["version"])
            existing = connection.execute(
                "SELECT source_version FROM building_source_assets WHERE asset_id=?",
                (asset["id"],),
            ).fetchone()
            if existing and existing["source_version"] == asset["version"] and not args.force:
                continue
            asset_directory = work_dir / hashlib.sha256(asset["id"].encode()).hexdigest()[:16]
            asset_directory.mkdir(parents=True, exist_ok=True)
            archive = asset_directory / "buildings.gdb.zip"
            download_file(asset["url"], archive)
            extract_dir = asset_directory / "extracted"
            safe_extract_zip(archive, extract_dir)
            geodatabases = sorted(path for path in extract_dir.rglob("*.gdb") if path.is_dir())
            if not geodatabases:
                raise RuntimeError(f"swissBUILDINGS3D asset {asset['id']} contains no FileGDB")
            asset_stats = {"building": 0, "skipped": 0}
            for geodatabase in geodatabases:
                imported = import_swissbuildings_gdb(
                    connection,
                    geodatabase,
                    asset["version"],
                    now_iso(),
                    source_prefix=asset["id"],
                )
                for key, value in imported.items():
                    asset_stats[key] += value
            upsert_building_asset(
                connection,
                {
                    "asset_id": asset["id"],
                    "source_version": asset["version"],
                    "asset_url": asset["url"],
                    "imported_at": now_iso(),
                    "stats": json.dumps(asset_stats, separators=(",", ":")),
                },
            )
            stats["assets"] += 1
            stats["building"] += asset_stats["building"]
            stats["skipped"] += asset_stats["skipped"]
            cell_stats["building"] += asset_stats["building"]
        upsert_building_cell(
            connection,
            {
                "cell_key": cell_key,
                "bounds": json.dumps(bounds),
                "imported_at": now_iso(),
                "stats": json.dumps(cell_stats, separators=(",", ":")),
            },
        )
        invalidate_enrichment(connection, environment=True, bounds=bounds)
        stats["cells"] += 1
        connection.commit()
    return stats, f"progressive:{max(imported_versions, default=now_iso())}"


def import_swissbuildings_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-buildings-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    run_id = begin_run(connection, "import-swissbuildings3d")
    stats: dict[str, object] = {"cells": 0, "assets": 0, "building": 0, "skipped": 0}
    try:
        if _skip_outside_first_sunday(args, connection, run_id):
            return
        if args.archive:
            archive = Path(args.archive).resolve()
            source_version = args.source_version or sha256_file(archive)
            asset_url = archive.as_uri()
            archive_stats = _import_building_archive(connection, archive, work_dir, source_version)
            stats.update(archive_stats)
            checksum = sha256_file(archive)
        else:
            stats, source_version = _import_building_cells(connection, args, work_dir)
            if not source_version:
                finish_run(connection, run_id, "skipped", {"reason": "all spatial cells imported"})
                print(json.dumps({"status": "up-to-date"}, indent=2))
                return
            asset_url = str(PROVIDERS.swissBuildingsItemsUrl)
            checksum = "progressive-spatial-import"

        upsert_official_source(
            connection,
            {
                "source": "swissBUILDINGS3D",
                "version": source_version,
                "asset_url": asset_url,
                "asset_checksum": checksum,
                "imported_at": now_iso(),
                "stats": json.dumps(stats, separators=(",", ":")),
            },
        )
        set_source_version(connection, run_id, source_version)
        connection.commit()
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error), **stats})
        raise
    finally:
        connection.close()
        if temporary_context:
            temporary_context.cleanup()
