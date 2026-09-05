#!/usr/bin/env python3
"""Benchly's resumable OSM import and terrain-enrichment worker.

The web app never imports this module. Heavy GIS packages stay in the worker image;
the only shared artifact is the SQLite file on the persistent volume.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional, Sequence

from benchly.context.geometry import deterministic_environment
from visual_pipeline import analyze_scenes, audit_environment, benchmark_models, discover_open_images, reconcile_environment
from weather_pipeline import refresh_weather
from benchly.catalog import load_catalog
from benchly.db import connect_database
from benchly.runs.repository import begin_run, finish_run, set_source_version
from benchly.benches.domain import CONTEXT_TAGS, KEEP_TAGS, context_kind, parse_bool, parse_direction, parse_height, score_view
from benchly.runtime import exclusive_worker_lock, now_iso, sha256_file
from benchly.benches.importer import import_osm
from benchly.benches.media import commons_metadata
from benchly.benches.repository import invalidate_enrichment, upsert_enrichment
from benchly.context.repository import (
    upsert_building_asset,
    upsert_building_cell,
    upsert_official_source,
)
from benchly.context.importer import (
    _safe_extract_zip,
    discover_swissbuildings_assets,
    discover_swisstlm_asset,
    download_file,
    download_stac_tiles,
    finalize_swisstlm_import,
    import_swissbuildings_gdb,
    import_swisstlm_geopackage,
)
from benchly.context.evidence import (
    feature_distance,
    has_official_context,
    nearby_context,
    nearby_land_cover,
    official_context_version,
    preferred_environment_context,
    preferred_exact_features,
)
from benchly.enrichment.service import (
    enrich_terrain,
    expand_bounds,
    next_enrichment_bounds,
    reconcile_deterministic_context,
    spatial_cell_bounds,
)
from benchly.terrain import (
    classify_view,
    direct_sun_minutes,
    fetch_terrain_horizon,
    merge_near_obstructions,
    terrain_horizon_from_profile,
    terrain_profile_coordinates,
    wgs84_to_lv95,
)

DATA_CATALOG = load_catalog()
DEFAULT_PBF = str(DATA_CATALOG.runtime.osmPbfUrl)
PIPELINE_VERSION = DATA_CATALOG.runtime.pipelineVersion
PROFILE_PIPELINE_VERSION = DATA_CATALOG.runtime.profilePipelineVersion
PROVIDERS = DATA_CATALOG.providers

def run_import_osm(args) -> None:
    database = Path(args.database).resolve()
    connection = connect_database(database)
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-osm-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    pbf = Path(args.pbf).resolve() if args.pbf else work_dir / "switzerland-latest.osm.pbf"
    run_id = begin_run(connection, "import-osm")
    stats: dict[str, object] = {}
    try:
        source_version = "local" if args.pbf else download_file(args.pbf_url, pbf)
        stats["imported"], stats["context_features"] = import_osm(connection, pbf, source_version)
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


def run_import_official_context(args) -> None:
    database = Path(args.database).resolve()
    connection = connect_database(database)
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-swisstlm-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    run_id = begin_run(connection, "import-official-context")
    stats: dict[str, object] = {}
    try:
        if args.first_sunday_only and datetime.now().day > 7:
            finish_run(connection, run_id, "skipped", {"reason": "not the first Sunday of the month"})
            print(json.dumps({"status": "skipped", "reason": "not the first Sunday"}, indent=2))
            return
        if args.archive:
            archive = Path(args.archive).resolve()
            source_version = args.source_version or sha256_file(archive)
            asset_url = archive.as_uri()
        else:
            source_version, asset_url = discover_swisstlm_asset()
            existing = connection.execute("SELECT version FROM official_context_sources WHERE source='swissTLM3D'").fetchone()
            if existing and existing["version"] == source_version and not args.force:
                finish_run(connection, run_id, "skipped", {"reason": "source version unchanged", "version": source_version})
                print(json.dumps({"status": "up-to-date", "version": source_version}, indent=2))
                return
            archive = work_dir / "swisstlm3d.zip"
            download_file(asset_url, archive)
        extract_dir = work_dir / "extracted"
        _safe_extract_zip(archive, extract_dir)
        geopackages = sorted(extract_dir.rglob("*.gpkg"))
        if not geopackages:
            raise RuntimeError("swissTLM3D archive contains no GeoPackage")
        import_generation = now_iso()
        for geopackage in geopackages:
            imported = import_swisstlm_geopackage(
                connection, geopackage, source_version, imported_at=import_generation, finalize=False,
            )
            for key, value in imported.items():
                stats[key] = int(stats.get(key, 0)) + value
        finalize_swisstlm_import(connection, import_generation)
        checksum = sha256_file(archive)
        upsert_official_source(connection, {
            "source": "swissTLM3D",
            "version": source_version,
            "asset_url": asset_url,
            "asset_checksum": checksum,
            "imported_at": now_iso(),
            "stats": json.dumps(stats, separators=(",", ":")),
        })
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


def run_import_swissbuildings(args) -> None:
    database = Path(args.database).resolve()
    connection = connect_database(database)
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-buildings-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    run_id = begin_run(connection, "import-swissbuildings3d")
    stats: dict[str, object] = {"cells": 0, "assets": 0, "building": 0, "skipped": 0}
    try:
        if args.first_sunday_only and datetime.now().day > 7:
            finish_run(connection, run_id, "skipped", {"reason": "not the first Sunday of the month"})
            print(json.dumps({"status": "skipped", "reason": "not the first Sunday"}, indent=2))
            return
        if args.archive:
            archive = Path(args.archive).resolve()
            source_version = args.source_version or sha256_file(archive)
            asset_url = archive.as_uri()
            extract_dir = work_dir / "archive"
            _safe_extract_zip(archive, extract_dir)
            geodatabases = sorted(path for path in extract_dir.rglob("*.gdb") if path.is_dir())
            if not geodatabases:
                raise RuntimeError("swissBUILDINGS3D archive contains no FileGDB")
            generation = now_iso()
            for geodatabase in geodatabases:
                imported = import_swissbuildings_gdb(connection, geodatabase, source_version, generation)
                for key, value in imported.items():
                    stats[key] = int(stats.get(key, 0)) + value
            invalidate_enrichment(connection, environment=True)
            checksum = sha256_file(archive)
        else:
            existing_cells = {row["cell_key"] for row in connection.execute("SELECT cell_key FROM building_import_cells")}
            grouped = connection.execute("""
              SELECT CAST(longitude/? AS INTEGER) cell_x,CAST(latitude/? AS INTEGER) cell_y,count(*) count
              FROM benches WHERE active=1 GROUP BY cell_x,cell_y ORDER BY count DESC
            """, (args.cell_degrees, args.cell_degrees)).fetchall()
            cells: list[tuple[str, tuple[float, float, float, float]]] = []
            for row in grouped:
                key = f"{args.cell_degrees:.4f}:{row['cell_x']}:{row['cell_y']}"
                if key in existing_cells and not args.force:
                    continue
                bounds = (row["cell_x"] * args.cell_degrees, row["cell_y"] * args.cell_degrees,
                          (row["cell_x"] + 1) * args.cell_degrees, (row["cell_y"] + 1) * args.cell_degrees)
                cells.append((key, bounds))
                if len(cells) >= args.max_cells:
                    break
            if not cells:
                finish_run(connection, run_id, "skipped", {"reason": "all spatial cells imported"})
                print(json.dumps({"status": "up-to-date"}, indent=2))
                return
            imported_versions: list[str] = []
            for cell_key, bounds in cells:
                assets = discover_swissbuildings_assets(expand_bounds(bounds, 150))
                cell_stats = {"assets": len(assets), "building": 0}
                for asset in assets:
                    imported_versions.append(asset["version"])
                    existing = connection.execute(
                        "SELECT source_version FROM building_source_assets WHERE asset_id=?", (asset["id"],),
                    ).fetchone()
                    if existing and existing["source_version"] == asset["version"] and not args.force:
                        continue
                    asset_directory = work_dir / hashlib.sha256(asset["id"].encode()).hexdigest()[:16]
                    asset_directory.mkdir(parents=True, exist_ok=True)
                    archive = asset_directory / "buildings.gdb.zip"
                    download_file(asset["url"], archive)
                    extract_dir = asset_directory / "extracted"
                    _safe_extract_zip(archive, extract_dir)
                    geodatabases = sorted(path for path in extract_dir.rglob("*.gdb") if path.is_dir())
                    if not geodatabases:
                        raise RuntimeError(f"swissBUILDINGS3D asset {asset['id']} contains no FileGDB")
                    asset_stats = {"building": 0, "skipped": 0}
                    for geodatabase in geodatabases:
                        imported = import_swissbuildings_gdb(
                            connection, geodatabase, asset["version"], now_iso(), source_prefix=asset["id"],
                        )
                        for key, value in imported.items():
                            asset_stats[key] += value
                    upsert_building_asset(connection, {
                        "asset_id": asset["id"],
                        "source_version": asset["version"],
                        "asset_url": asset["url"],
                        "imported_at": now_iso(),
                        "stats": json.dumps(asset_stats, separators=(",", ":")),
                    })
                    stats["assets"] = int(stats["assets"]) + 1
                    stats["building"] = int(stats["building"]) + asset_stats["building"]
                    stats["skipped"] = int(stats["skipped"]) + asset_stats["skipped"]
                    cell_stats["building"] += asset_stats["building"]
                upsert_building_cell(connection, {
                    "cell_key": cell_key,
                    "bounds": json.dumps(bounds),
                    "imported_at": now_iso(),
                    "stats": json.dumps(cell_stats, separators=(",", ":")),
                })
                invalidate_enrichment(connection, environment=True, bounds=bounds)
                stats["cells"] = int(stats["cells"]) + 1
                connection.commit()
            source_version = f"progressive:{max(imported_versions, default=now_iso())}"
            asset_url = str(PROVIDERS.swissBuildingsItemsUrl)
            checksum = "progressive-spatial-import"
        upsert_official_source(connection, {
            "source": "swissBUILDINGS3D",
            "version": source_version,
            "asset_url": asset_url,
            "asset_checksum": checksum,
            "imported_at": now_iso(),
            "stats": json.dumps(stats, separators=(",", ":")),
        })
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


def run_refresh_weather(args) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "refresh-weather", "MeteoSwiss ICON-CH1 + PRECIP")
    try:
        stats = refresh_weather(connection, icon=not args.radar_only, radar=not args.icon_only)
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def run_discover_open_images(args) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "discover-open-images")
    try:
        stats = discover_open_images(
            connection, args.max_cells, args.cell_degrees, args.requests_per_second,
            tuple(args.bounds) if args.bounds else None, args.include_resolved,
        )
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def run_analyze_scenes(args) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "analyze-scenes", os.environ.get("BENCHLY_VISION_MODEL", "benchly-vision"))
    try:
        used_seconds = float(connection.execute("""
          SELECT coalesce(sum((julianday(finished_at)-julianday(started_at))*86400),0)
          FROM pipeline_runs WHERE kind='analyze-scenes' AND status IN ('completed','failed')
            AND finished_at IS NOT NULL AND date(started_at)=date('now')
        """).fetchone()[0])
        remaining_seconds = max(0.0, min(args.max_runtime_hours * 3600, 7200 - used_seconds))
        deadline = time.monotonic() + remaining_seconds
        stats = analyze_scenes(
            connection, args.limit, deadline, args.requests_per_second,
            tuple(args.bounds) if args.bounds else None,
        )
        stats["daily_runtime_remaining_seconds"] = round(remaining_seconds)
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def run_reconcile_environment(args) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "reconcile-environment")
    try:
        bounds = tuple(args.bounds) if args.bounds else None
        stats = reconcile_deterministic_context(connection, args.limit, bounds)
        stats.update({
            f"visual_{key}": value
            for key, value in reconcile_environment(connection, args.limit, bounds, args.max_total).items()
        })
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def run_audit_environment(args) -> None:
    connection = connect_database(Path(args.database).resolve())
    try:
        result = audit_environment(connection)
        print(json.dumps(result, indent=2))
        if args.require_production and (
            result["sqlite_quick_check"] != "ok"
            or int(result["active_benches"]) < 100_000
            or int(result["raw_image_columns"]) != 0
            or int(result["image_files_on_data_volume"]) != 0
            or int(result["likely_rows_without_provenance"]) != 0
        ):
            raise RuntimeError("production data audit failed")
    finally:
        connection.close()


def run_benchmark_vision(args) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "vision-benchmark")
    try:
        result = benchmark_models(Path(args.dataset), args.models, args.allow_small, args.requests_per_second)
        finish_run(connection, run_id, "completed", result)
        print(json.dumps(result, separators=(",", ":")))
        if result["recommended"] is None and not args.report_only:
            raise RuntimeError("No vision model met the acceptance thresholds")
    except Exception as error:
        current = connection.execute("SELECT status FROM pipeline_runs WHERE id=?", (run_id,)).fetchone()
        if current and current["status"] == "running":
            finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def run_enrich_batch(args) -> None:
    database = Path(args.database).resolve()
    connection = connect_database(database)
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-enrich-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    run_id = begin_run(connection, "enrich-batch")
    stats: dict[str, object] = {}
    try:
        bounds = next_enrichment_bounds(connection, args.cell_degrees)
        if bounds is None:
            finish_run(connection, run_id, "skipped", {"reason": "all benches use the current pipeline version"})
            print(json.dumps({"enriched": 0, "status": "up-to-date"}, indent=2))
            return
        terrain_dir = work_dir / "swissalti3d"
        surface_dir = work_dir / "swisssurface3d"
        per_collection_bytes = int(args.max_download_gib * 1024 ** 3 / 2)
        stats["cell_bounds"] = bounds
        stats["terrain_tiles"] = download_stac_tiles(
            connection,
            PROVIDERS.swissAltiCollection,
            terrain_dir,
            args.max_geodata_tiles,
            expand_bounds(bounds, 20_500),
            per_collection_bytes,
        )
        stats["surface_tiles"] = download_stac_tiles(
            connection,
            PROVIDERS.swissSurfaceCollection,
            surface_dir,
            args.max_geodata_tiles,
            expand_bounds(bounds, 500),
            per_collection_bytes,
        )
        deadline = time.monotonic() + args.max_runtime_hours * 3600
        stats["enriched"] = enrich_terrain(
            connection,
            terrain_dir,
            surface_dir,
            args.limit,
            args.recompute,
            bounds,
            deadline,
        )
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error), **stats})
        raise
    finally:
        connection.close()
        if temporary_context:
            temporary_context.cleanup()


def run_enrich_profile_batch(args) -> None:
    """Fill complete near + 20 km horizons without downloading large raster neighborhoods."""
    database = Path(args.database).resolve()
    connection = connect_database(database)
    run_id = begin_run(connection, "enrich-profile-batch", "GeoAdmin elevation profile")
    stats = {"selected": 0, "enriched": 0, "failed": 0}
    try:
        rows = connection.execute("""
            SELECT b.row_id,b.latitude,b.longitude,b.direction_degrees,b.covered,e.canopy_context
            FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
            WHERE b.active=1 AND (e.terrain_horizon_profile IS NULL OR length(e.terrain_horizon_profile)<100 OR e.pipeline_version<>?)
            ORDER BY b.row_id LIMIT ?
        """, (PROFILE_PIPELINE_VERSION, args.limit)).fetchall()
        stats["selected"] = len(rows)
        if not rows:
            finish_run(connection, run_id, "skipped", {"reason": "all active benches have a horizon"})
            print(json.dumps(stats, indent=2))
            return
        deadline = time.monotonic() + args.max_runtime_minutes * 60
        minimum_interval = 1 / max(0.1, args.requests_per_second)
        official_context = official_context_version(connection)
        for row in rows:
            if time.monotonic() >= deadline:
                break
            request_started = time.monotonic()
            terrain = fetch_terrain_horizon(row["latitude"], row["longitude"])
            if terrain is None:
                stats["failed"] += 1
                time.sleep(max(0, minimum_interval - (time.monotonic() - request_started)))
                continue
            elevation, terrain_profile, elevation_samples = terrain
            local_context = nearby_context(connection, row["latitude"], row["longitude"], 350)
            distant_context = nearby_context(connection, row["latitude"], row["longitude"], 10_000, ["water", "forest", "major_road"])
            context = preferred_environment_context(
                list({feature["row_id"]: feature for feature in [*local_context, *distant_context]}.values()),
                official_context,
            )
            local_context = preferred_environment_context(local_context, official_context)
            profile, obstruction_types, obstruction_distances, canopy_percent, in_forest = merge_near_obstructions(
                row["latitude"], row["longitude"], elevation, terrain_profile, elevation_samples, local_context,
            )
            relief = min(1.0, (max(elevation_samples) - min(elevation_samples)) / 1500.0) if elevation_samples else 0.0
            labels, openness, water, naturalness, remoteness, view_sectors = classify_view(
                row["latitude"], row["longitude"], row["direction_degrees"], profile, terrain_profile, context, relief,
                elevation_samples, elevation, obstruction_types,
            )
            components = {"openness": openness, "relief": relief, "water": water, "naturalness": naturalness, "remoteness": remoteness}
            buildings = [feature for feature in local_context if feature["kind"] == "building"]
            paths = [feature for feature in local_context if feature["kind"] == "path"]
            waters = preferred_exact_features(context, "water", official_context)
            roads = [feature for feature in context if feature["kind"] == "major_road"]
            forests = preferred_exact_features(context, "forest", official_context)
            deterministic = deterministic_environment(
                row["latitude"], row["longitude"], forests, waters,
                nearby_land_cover(connection, row["latitude"], row["longitude"]),
                str(row["canopy_context"] or "unknown"),
            )
            in_forest = int(bool(deterministic["in_forest"]))

            def nearest(features: Sequence[sqlite3.Row]) -> Optional[float]:
                return min((feature_distance(row["latitude"], row["longitude"], feature) for feature in features), default=None)

            values = {
                "bench_row_id": row["row_id"],
                "elevation_meters": elevation,
                "elevation_source": "GeoAdmin-Höhenprofil",
                "elevation_updated_at": now_iso(),
                "computed_at": now_iso(),
                "in_forest": in_forest,
                "canopy_percent": canopy_percent,
                "distance_forest_meters": deterministic["forest_distance"],
                "distance_water_meters": deterministic["water_distance"],
                "distance_path_meters": nearest(paths),
                "distance_major_road_meters": nearest(roads),
                "horizon_profile": json.dumps(profile),
                "terrain_horizon_profile": json.dumps(terrain_profile),
                "obstruction_types": json.dumps(obstruction_types), "obstruction_distances": json.dumps(obstruction_distances),
                "building_obstruction_percent": 100 * obstruction_types.count("building") / 72,
                "vegetation_obstruction_percent": 100 * obstruction_types.count("vegetation") / 72,
                "distance_building_meters": nearest(buildings),
                "building_count_100m": sum(feature_distance(row["latitude"], row["longitude"], feature) <= 100 for feature in buildings),
                "sun_minutes_summer": direct_sun_minutes(row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 6, 21),
                "sun_minutes_winter": direct_sun_minutes(row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 12, 21),
                "sun_minutes_spring": direct_sun_minutes(row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 3, 20),
                "sun_minutes_autumn": direct_sun_minutes(row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 9, 22),
                "sun_confidence": "mittel",
                "view_score": score_view(**components),
                "view_confidence": "mittel",
                "view_components": json.dumps(components),
                "view_labels": json.dumps(labels, ensure_ascii=False),
                "view_sectors": json.dumps(view_sectors),
                "context_source_version": f"swissTLM3D:{official_context} + GeoAdmin" if official_context else "OpenStreetMap + GeoAdmin",
                "pipeline_version": PROFILE_PIPELINE_VERSION,
                "land_context": deterministic["land_context"],
                "waterfront": int(bool(deterministic["waterfront"])),
                "environment_computed_at": now_iso(),
            }
            with connection:
                upsert_enrichment(connection, values)
            stats["enriched"] += 1
            if stats["enriched"] % 25 == 0:
                print(f"Profile-enriched {stats['enriched']}/{len(rows)} benches", file=sys.stderr)
            time.sleep(max(0, minimum_interval - (time.monotonic() - request_started)))
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error), **stats})
        raise
    finally:
        connection.close()


def run_refresh_commons(args) -> None:
    database = Path(args.database).resolve()
    connection = connect_database(database)
    run_id = begin_run(connection, "refresh-commons")
    try:
        stats = {"media": commons_metadata(connection, args.limit)}
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def run_refresh(args) -> None:
    database = Path(args.database).resolve()
    connection = connect_database(database)
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    pbf = work_dir / "switzerland-latest.osm.pbf"
    source_version = "local"
    run_id = begin_run(connection, "refresh")
    stats: dict[str, int] = {}
    try:
        if args.pbf:
            pbf = Path(args.pbf).resolve()
        else:
            source_version = download_file(args.pbf_url, pbf)
        stats["imported"], stats["context_features"] = import_osm(connection, pbf, source_version)
        terrain_dir = Path(args.terrain_dir) if args.terrain_dir else work_dir / "swissalti3d"
        surface_dir = Path(args.surface_dir) if args.surface_dir else work_dir / "swisssurface3d"
        if args.download_geodata:
            stats["terrain_tiles"] = download_stac_tiles(connection, PROVIDERS.swissAltiCollection, terrain_dir, args.max_geodata_tiles)
            stats["surface_tiles"] = download_stac_tiles(connection, PROVIDERS.swissSurfaceCollection, surface_dir, args.max_geodata_tiles)
        stats["enriched"] = enrich_terrain(connection, terrain_dir, surface_dir, args.limit, args.recompute)
        stats["media"] = commons_metadata(connection, args.commons_limit) if args.commons_limit else 0
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


def run_inventory(args) -> None:
    connection = connect_database(Path(args.database).resolve())
    try:
        total = connection.execute("SELECT count(*) count FROM benches WHERE active=1").fetchone()["count"]
        enriched = connection.execute("SELECT count(*) count FROM benches b JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE b.active=1").fetchone()["count"]
        context = {row["kind"]: row["count"] for row in connection.execute("SELECT kind,count(*) count FROM environment_features GROUP BY kind")}
        fields = {}
        for field in ("backrest", "armrest", "covered", "wheelchair", "material", "direction_degrees"):
            fields[field] = connection.execute(f"SELECT count(*) count FROM benches WHERE active=1 AND {field} IS NOT NULL").fetchone()["count"]
        print(json.dumps({"active_benches": total, "enriched_benches": enriched, "context_features": context, "observed_field_counts": fields}, indent=2))
    finally:
        connection.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import and enrich Swiss benches into Benchly's SQLite database.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    from transit_pipeline import refresh as refresh_transit
    transit = subparsers.add_parser("refresh-transit", help="Refresh a separate Swiss GTFS stop/transfer index")
    transit.add_argument("--transit-database", default=os.environ.get("TRANSIT_DATABASE_PATH", "./data/transit.sqlite"))
    transit.add_argument("--gtfs-zip", help="Import a previously downloaded official GTFS archive")
    transit.set_defaults(function=refresh_transit, uses_lock=False)

    from landscape_pipeline import refresh as refresh_landscape
    landscape = subparsers.add_parser("refresh-landscape", help="Build a resumable offline walking landscape index")
    landscape.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    landscape.add_argument("--landscape-database", default=os.environ.get("LANDSCAPE_DATABASE_PATH", "./data/landscape.sqlite"))
    landscape.add_argument("--limit", type=int, default=2000)
    landscape.add_argument("--bounds", type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"), help="Optional regional coverage pilot")
    landscape.add_argument("--terrain-raster", help="Optional local LV95 DTM GeoTIFF")
    landscape.add_argument("--surface-raster", help="Optional local LV95 DSM GeoTIFF")
    landscape.set_defaults(function=refresh_landscape, uses_lock=False)

    osm_import = subparsers.add_parser("import-osm", help="Download and import the current national OSM extract")
    osm_import.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    osm_import.add_argument("--pbf", help="Use an existing Switzerland .osm.pbf instead of downloading")
    osm_import.add_argument("--pbf-url", default=DEFAULT_PBF)
    osm_import.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    osm_import.set_defaults(function=run_import_osm, uses_lock=True)

    official = subparsers.add_parser("import-official-context", help="Import exact swissTLM3D geometries when the official version changes")
    official.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    official.add_argument("--archive", help="Use an existing swissTLM3D GeoPackage ZIP")
    official.add_argument("--source-version", help="Version label for a local archive")
    official.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    official.add_argument("--force", action="store_true")
    official.add_argument("--first-sunday-only", action="store_true")
    official.set_defaults(function=run_import_official_context, uses_lock=True)

    buildings = subparsers.add_parser("import-swissbuildings3d", help="Import swissBUILDINGS3D Solid footprints and roof heights")
    buildings.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    buildings.add_argument("--archive", help="Use an existing national swissBUILDINGS3D FileGDB ZIP")
    buildings.add_argument("--source-version", help="Version label for a local archive")
    buildings.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    buildings.add_argument("--force", action="store_true")
    buildings.add_argument("--first-sunday-only", action="store_true")
    buildings.add_argument("--cell-degrees", type=float, default=0.05)
    buildings.add_argument("--max-cells", type=int, default=3)
    buildings.set_defaults(function=run_import_swissbuildings, uses_lock=True)

    weather = subparsers.add_parser("refresh-weather", help="Refresh compact MeteoSwiss ICON and precipitation rasters")
    weather.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    weather_mode = weather.add_mutually_exclusive_group()
    weather_mode.add_argument("--radar-only", action="store_true")
    weather_mode.add_argument("--icon-only", action="store_true")
    weather.set_defaults(function=run_refresh_weather, uses_lock=True)

    enrich = subparsers.add_parser("enrich-batch", help="Enrich one resumable spatial cell with bounded downloads")
    enrich.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    enrich.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    enrich.add_argument("--cell-degrees", type=float, default=0.05)
    enrich.add_argument("--limit", type=int, default=1000)
    enrich.add_argument("--max-geodata-tiles", type=int, default=3000)
    enrich.add_argument("--max-download-gib", type=float, default=80)
    enrich.add_argument("--max-runtime-hours", type=float, default=8)
    enrich.add_argument("--recompute", action="store_true")
    enrich.set_defaults(function=run_enrich_batch, uses_lock=True)

    profile = subparsers.add_parser("enrich-profile-batch", help="Compute near and 20 km horizons through GeoAdmin profiles")
    profile.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    profile.add_argument("--limit", type=int, default=1000)
    profile.add_argument("--requests-per-second", type=float, default=1.0)
    profile.add_argument("--max-runtime-minutes", type=float, default=45)
    profile.set_defaults(function=run_enrich_profile_batch, uses_lock=True)

    commons = subparsers.add_parser("refresh-commons", help="Refresh a bounded number of nearby Commons results")
    commons.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    commons.add_argument("--limit", type=int, default=500)
    commons.set_defaults(function=run_refresh_commons, uses_lock=True)

    discovery = subparsers.add_parser("discover-open-images", help="Discover open imagery once per spatial cell")
    discovery.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    discovery.add_argument("--max-cells", type=int, default=500)
    discovery.add_argument("--cell-degrees", type=float, default=0.02)
    discovery.add_argument("--requests-per-second", type=float, default=1.0)
    discovery.add_argument("--bounds", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    discovery.add_argument("--include-resolved", action="store_true", help="Include already classified benches inside an explicit pilot area")
    discovery.set_defaults(function=run_discover_open_images, uses_lock=True)

    analysis = subparsers.add_parser("analyze-scenes", help="Analyze temporary open images without storing their bytes")
    analysis.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    analysis.add_argument("--limit", type=int, default=300)
    analysis.add_argument("--max-runtime-hours", type=float, default=2)
    analysis.add_argument("--requests-per-second", type=float, default=.25)
    analysis.add_argument("--bounds", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    analysis.set_defaults(function=run_analyze_scenes, uses_lock=True)

    reconcile = subparsers.add_parser("reconcile-environment", help="Fuse deterministic context and visual evidence")
    reconcile.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    reconcile.add_argument("--limit", type=int, default=5000)
    reconcile.add_argument("--bounds", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    reconcile.add_argument("--max-total", type=int, default=1000, help="Keep the visual pilot capped until its quality gate passes")
    reconcile.set_defaults(function=run_reconcile_environment, uses_lock=True)

    audit = subparsers.add_parser("audit-environment", help="Report environment evidence coverage and conflicts")
    audit.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    audit.add_argument("--require-production", action="store_true")
    audit.set_defaults(function=run_audit_environment, uses_lock=False)

    benchmark = subparsers.add_parser("benchmark-vision", help="Evaluate vision models against a labelled 100-location JSONL set")
    benchmark.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    benchmark.add_argument("--dataset", required=True)
    benchmark.add_argument("--models", nargs="+", default=["benchly-vision", "general"])
    benchmark.add_argument("--allow-small", action="store_true", help="Allow a development-only fixture below 100 locations")
    benchmark.add_argument("--requests-per-second", type=float, default=.25)
    benchmark.add_argument("--report-only", action="store_true", help="Emit rejected benchmark metrics without failing the job")
    benchmark.set_defaults(function=run_benchmark_vision, uses_lock=True)

    refresh = subparsers.add_parser("refresh", help="Run the resumable national refresh pipeline")
    refresh.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    refresh.add_argument("--pbf", help="Use an existing Switzerland .osm.pbf instead of downloading")
    refresh.add_argument("--pbf-url", default=DEFAULT_PBF)
    refresh.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    refresh.add_argument("--terrain-dir", help="Directory containing swissALTI3D GeoTIFF tiles")
    refresh.add_argument("--surface-dir", help="Directory containing swissSURFACE3D GeoTIFF tiles")
    refresh.add_argument("--download-geodata", action="store_true", help="Download required swissALTI3D/swissSURFACE3D STAC tiles")
    refresh.add_argument("--max-geodata-tiles", type=int, help="Safety cap for a pilot STAC download")
    refresh.add_argument("--commons-limit", type=int, default=0, help="Fetch nearby Commons metadata for this many benches")
    refresh.add_argument("--limit", type=int, help="Limit terrain enrichment for a pilot run")
    refresh.add_argument("--recompute", action="store_true", help="Recompute already current enrichments after source data changes")
    refresh.set_defaults(function=run_refresh, uses_lock=True)
    inventory = subparsers.add_parser("inventory", help="Report bench totals and data completeness")
    inventory.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    inventory.set_defaults(function=run_inventory, uses_lock=False)
    return parser


if __name__ == "__main__":
    parsed_args = build_parser().parse_args()
    try:
        if parsed_args.uses_lock:
            database = Path(parsed_args.database).resolve()
            with exclusive_worker_lock(database) as acquired:
                if not acquired:
                    print("Another Benchly worker owns the SQLite writer lock; skipping this run.")
                    sys.exit(0)
                parsed_args.function(parsed_args)
        else:
            parsed_args.function(parsed_args)
    except Exception as exception:
        print(f"Benchly worker failed: {exception}", file=sys.stderr)
        sys.exit(1)
