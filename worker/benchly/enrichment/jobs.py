"""Bounded terrain and horizon enrichment jobs."""

from __future__ import annotations

import json
import sqlite3
import sys
import time
from argparse import Namespace
from pathlib import Path
from typing import Optional, Sequence

from benchly.benches.domain import apply_environment_hints, score_view
from benchly.benches.repository import upsert_enrichment
from benchly.context.evidence import (
    feature_distance,
    nearby_context,
    nearby_land_cover,
    official_context_version,
    preferred_environment_context,
    preferred_exact_features,
)
from benchly.context.geometry import deterministic_environment
from benchly.context.sources import download_stac_tiles
from benchly.context.raster_cache import RasterCache
from benchly.db import connect_database
from benchly.enrichment.service import PIPELINE_VERSION, enrich_terrain, expand_bounds, next_enrichment_bounds
from benchly.runs.repository import begin_run, finish_run
from benchly.runtime import now_iso
from benchly.knowledge import progress
from benchly.settings import PROFILE_PIPELINE_VERSION, PROVIDERS
from benchly.terrain import classify_view, direct_sun_minutes, fetch_terrain_horizon, merge_near_obstructions


def enrich_batch_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    work_dir = Path(args.work_dir or Path(args.database).resolve().parent / "terrain-cache-v1")
    cache = RasterCache(work_dir)
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
        per_collection_bytes = int(args.max_download_gib * 1024**3 / 2)
        stats["cell_bounds"] = bounds
        stats["terrain_tiles"] = download_stac_tiles(
            connection,
            PROVIDERS.swissAltiCollection,
            terrain_dir,
            args.max_geodata_tiles,
            expand_bounds(bounds, 20_500),
            per_collection_bytes,
            cache=cache,
        )
        stats["surface_tiles"] = download_stac_tiles(
            connection,
            PROVIDERS.swissSurfaceCollection,
            surface_dir,
            args.max_geodata_tiles,
            expand_bounds(bounds, 500),
            per_collection_bytes,
            cache=cache,
        )
        stats["enriched"] = enrich_terrain(
            connection,
            terrain_dir,
            surface_dir,
            args.limit,
            args.recompute,
            bounds,
            time.monotonic() + args.max_runtime_hours * 3600,
        )
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error), **stats})
        raise
    finally:
        connection.close()


def _nearest(
    row: sqlite3.Row,
    features: Sequence[sqlite3.Row],
) -> Optional[float]:
    return min(
        (feature_distance(row["latitude"], row["longitude"], feature) for feature in features),
        default=None,
    )


def _profile_values(connection, row: sqlite3.Row, terrain) -> dict[str, object]:
    elevation, terrain_profile, elevation_samples = terrain
    local_context = nearby_context(connection, row["latitude"], row["longitude"], 350)
    distant_context = nearby_context(
        connection,
        row["latitude"],
        row["longitude"],
        10_000,
        ["water", "forest", "major_road"],
    )
    official_context = official_context_version(connection)
    context = preferred_environment_context(
        list({feature["row_id"]: feature for feature in [*local_context, *distant_context]}.values()),
        official_context,
    )
    local_context = preferred_environment_context(local_context, official_context)
    profile, obstruction_types, obstruction_distances, canopy_percent, _in_forest = merge_near_obstructions(
        row["latitude"],
        row["longitude"],
        elevation,
        terrain_profile,
        elevation_samples,
        local_context,
    )
    relief = min(1.0, (max(elevation_samples) - min(elevation_samples)) / 1500.0) if elevation_samples else 0.0
    labels, openness, water, naturalness, remoteness, view_sectors = classify_view(
        row["latitude"],
        row["longitude"],
        row["direction_degrees"],
        profile,
        terrain_profile,
        context,
        relief,
        elevation_samples,
        elevation,
        obstruction_types,
    )
    components = apply_environment_hints({
        "openness": openness,
        "relief": relief,
        "water": water,
        "naturalness": naturalness,
        "remoteness": remoteness,
    }, row["raw_tags"])
    buildings = [feature for feature in local_context if feature["kind"] == "building"]
    paths = [feature for feature in local_context if feature["kind"] == "path"]
    waters = preferred_exact_features(context, "water", official_context)
    roads = [feature for feature in context if feature["kind"] == "major_road"]
    forests = preferred_exact_features(context, "forest", official_context)
    environment = deterministic_environment(
        row["latitude"],
        row["longitude"],
        forests,
        waters,
        nearby_land_cover(connection, row["latitude"], row["longitude"]),
        str(row["canopy_context"] or "unknown"),
    )
    return {
        "bench_row_id": row["row_id"],
        "elevation_meters": elevation,
        "elevation_source": "GeoAdmin-Höhenprofil",
        "elevation_updated_at": now_iso(),
        "computed_at": now_iso(),
        "in_forest": int(bool(environment["in_forest"])),
        "canopy_percent": canopy_percent,
        "distance_forest_meters": environment["forest_distance"],
        "distance_water_meters": environment["water_distance"],
        "distance_path_meters": _nearest(row, paths),
        "distance_major_road_meters": _nearest(row, roads),
        "horizon_profile": json.dumps(profile),
        "terrain_horizon_profile": json.dumps(terrain_profile),
        "obstruction_types": json.dumps(obstruction_types),
        "obstruction_distances": json.dumps(obstruction_distances),
        "building_obstruction_percent": 100 * obstruction_types.count("building") / 72,
        "vegetation_obstruction_percent": 100 * obstruction_types.count("vegetation") / 72,
        "distance_building_meters": _nearest(row, buildings),
        "building_count_100m": sum(
            feature_distance(row["latitude"], row["longitude"], feature) <= 100 for feature in buildings
        ),
        "sun_minutes_summer": direct_sun_minutes(
            row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 6, 21
        ),
        "sun_minutes_winter": direct_sun_minutes(
            row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 12, 21
        ),
        "sun_minutes_spring": direct_sun_minutes(
            row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 3, 20
        ),
        "sun_minutes_autumn": direct_sun_minutes(
            row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 9, 22
        ),
        "sun_confidence": "mittel",
        "view_score": score_view(**components),
        "view_confidence": "mittel",
        "view_components": json.dumps(components),
        "view_labels": json.dumps(labels, ensure_ascii=False),
        "view_sectors": json.dumps(view_sectors),
        "context_source_version": (
            f"swissTLM3D:{official_context} + GeoAdmin" if official_context else "OpenStreetMap + GeoAdmin"
        ),
        "pipeline_version": PROFILE_PIPELINE_VERSION,
        "land_context": environment["land_context"],
        "waterfront": int(bool(environment["waterfront"])),
        "environment_computed_at": now_iso(),
    }


def enrich_profile_batch_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "enrich-profile-batch", "GeoAdmin elevation profile")
    stats = {"selected": 0, "enriched": 0, "failed": 0}
    try:
        rows = connection.execute(
            """
            SELECT b.row_id,b.latitude,b.longitude,b.direction_degrees,b.covered,b.raw_tags,e.canopy_context
            FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
            WHERE b.active=1 AND (
                e.terrain_horizon_profile IS NULL
                OR length(e.terrain_horizon_profile)<100
                OR e.pipeline_version IS NULL
                OR e.pipeline_version NOT IN (?,?)
            )
            ORDER BY b.row_id LIMIT ?
            """,
            (PROFILE_PIPELINE_VERSION, PIPELINE_VERSION, args.limit),
        ).fetchall()
        stats["selected"] = len(rows)
        if not rows:
            finish_run(connection, run_id, "skipped", {"reason": "all active benches have a horizon"})
            print(json.dumps(stats, indent=2))
            return
        deadline = time.monotonic() + args.max_runtime_minutes * 60
        minimum_interval = 1 / max(0.1, args.requests_per_second)
        for row in rows:
            if time.monotonic() >= deadline:
                break
            request_started = time.monotonic()
            input_revision = progress.revision(connection, row["row_id"])
            source_revision = progress.source_revision(connection)
            terrain = fetch_terrain_horizon(row["latitude"], row["longitude"])
            if terrain is None:
                stats["failed"] += 1
            else:
                values = _profile_values(connection, row, terrain)
                with connection:
                    connection.begin_immediate()
                    if progress.revision(connection, row["row_id"]) != input_revision or progress.source_revision(connection) != source_revision:
                        continue
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
