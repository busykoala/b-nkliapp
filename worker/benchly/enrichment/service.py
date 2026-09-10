"""Orchestrate deterministic terrain enrichment for benches."""

from __future__ import annotations

import json
import math
import sqlite3
import sys
import time
from pathlib import Path
from typing import Optional

from benchly.benches.repository import upsert_enrichment
from benchly.knowledge import progress
from benchly.enrichment.attempts import RETRY_ELIGIBLE_SQL, record_attempt
from benchly.knowledge.approaches import prepare_approach, store_approach, terrain_metadata
from benchly.knowledge.repository import available as knowledge_available
from benchly.context.evidence import (
    feature_distance,
    nearby_context,
    nearby_land_cover,
    nearest_exact_context,
    official_context_version,
    preferred_environment_context,
    preferred_exact_features,
)
from benchly.terrain import RasterCollection, classify_view, direct_sun_minutes, horizon_profile
from benchly.benches.domain import apply_environment_hints, score_view
from benchly.catalog import load_catalog
from benchly.context.geometry import canopy_neighborhood, deterministic_environment
from benchly.runtime import now_iso

PIPELINE_VERSION = load_catalog().runtime.pipelineVersion

def spatial_cell_bounds(latitude: float, longitude: float, cell_degrees: float = 0.05) -> tuple[float, float, float, float]:
    """Return a stable lon/lat grid cell containing a bench."""
    min_longitude = math.floor(longitude / cell_degrees) * cell_degrees
    min_latitude = math.floor(latitude / cell_degrees) * cell_degrees
    return min_longitude, min_latitude, min_longitude + cell_degrees, min_latitude + cell_degrees


def expand_bounds(bounds: tuple[float, float, float, float], meters: float) -> tuple[float, float, float, float]:
    min_longitude, min_latitude, max_longitude, max_latitude = bounds
    mean_latitude = (min_latitude + max_latitude) / 2
    latitude_delta = meters / 111_320
    longitude_delta = meters / (111_320 * max(0.2, math.cos(math.radians(mean_latitude))))
    return (
        min_longitude - longitude_delta,
        min_latitude - latitude_delta,
        max_longitude + longitude_delta,
        max_latitude + latitude_delta,
    )


def next_enrichment_bounds(connection: sqlite3.Connection, cell_degrees: float = 0.05) -> Optional[tuple[float, float, float, float]]:
    row = connection.execute(f"""
        SELECT b.latitude,b.longitude
        FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
        WHERE b.active=1 AND (e.pipeline_version IS NULL OR e.pipeline_version<>?) AND {RETRY_ELIGIBLE_SQL}
        ORDER BY coalesce(e.computed_at, ''), b.row_id
        LIMIT 1
    """, (PIPELINE_VERSION, PIPELINE_VERSION)).fetchone()
    if not row:
        return None
    return spatial_cell_bounds(row["latitude"], row["longitude"], cell_degrees)


def enrich_terrain(connection: sqlite3.Connection, terrain_dir: Optional[Path], surface_dir: Optional[Path],
                   limit: Optional[int] = None, recompute: bool = False,
                   bounds: Optional[tuple[float, float, float, float]] = None,
                   deadline_monotonic: Optional[float] = None) -> int:
    terrain = RasterCollection(terrain_dir)
    terrain_inputs = terrain_metadata(terrain)
    surface = RasterCollection(surface_dir)
    if not terrain.datasets:
        print("No terrain GeoTIFFs found; recording missing-source attempts for this batch.", file=sys.stderr)
    query = """SELECT b.row_id,b.latitude,b.longitude,b.direction_degrees,b.covered,b.raw_tags
      FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
      WHERE b.active=1"""
    if not recompute:
        query += " AND (e.pipeline_version IS NULL OR e.pipeline_version<>?) AND " + RETRY_ELIGIBLE_SQL
        query_parameters: tuple[object, ...] = (PIPELINE_VERSION, PIPELINE_VERSION)
    else:
        query_parameters = ()
    if bounds:
        query += " AND b.longitude>=? AND b.longitude<? AND b.latitude>=? AND b.latitude<?"
        query_parameters += (bounds[0], bounds[2], bounds[1], bounds[3])
    query += " ORDER BY b.row_id"
    if limit:
        query += f" LIMIT {int(limit)}"
    rows = connection.execute(query, query_parameters).fetchall()
    updated = 0
    official_context = official_context_version(connection)
    knowledge_enabled = knowledge_available(connection)
    try:
        for row in rows:
            if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
                print("Enrichment runtime limit reached; remaining benches stay eligible.", file=sys.stderr)
                break
            input_revision = progress.revision(connection, row["row_id"]) if knowledge_enabled else None
            source_revision = progress.source_revision(connection) if knowledge_enabled else None
            elevation = terrain.sample(row["latitude"], row["longitude"])
            if elevation is None:
                with connection:
                    if hasattr(connection, "begin_immediate"):
                        connection.begin_immediate()
                    if knowledge_enabled and (progress.revision(connection, row["row_id"]) != input_revision or progress.source_revision(connection) != source_revision):
                        continue
                    record_attempt(connection, row, PIPELINE_VERSION, "missing_source", {"reason": "missing_origin_elevation"})
                continue
            local_context = nearby_context(connection, row["latitude"], row["longitude"], 350)
            distant_context = nearby_context(connection, row["latitude"], row["longitude"], 10_000, ["water", "forest", "major_road"])
            context_by_identity = {feature["row_id"]: feature for feature in [*local_context, *distant_context]}
            context = preferred_environment_context(list(context_by_identity.values()), official_context)
            local_context = preferred_environment_context(local_context, official_context)
            buildings = [feature for feature in local_context if feature["kind"] == "building" and feature["geometry_wkb"] is not None]
            canopy = canopy_neighborhood(row["latitude"], row["longitude"], terrain, surface, buildings)
            canopy_percent = None if canopy["share_10m"] is None else round(float(canopy["share_10m"]) * 100, 1)
            forests = preferred_exact_features(context, "forest", official_context)
            waters = preferred_exact_features(context, "water", official_context)
            environment = deterministic_environment(
                row["latitude"], row["longitude"], forests, waters,
                nearby_land_cover(connection, row["latitude"], row["longitude"]), str(canopy["context"]),
            )
            in_forest = int(bool(environment["in_forest"]))
            # A seated eye is approximately 1.1 m above bare terrain. Using the surface height
            # as origin would incorrectly place the observer on top of a tree canopy or roof.
            coverage = {"method": "raster-horizon-2", "latitude": row["latitude"], "longitude": row["longitude"], "computed_at": now_iso()}
            horizon, terrain_horizon, obstruction_types, obstruction_distances, elevations, far_max_elevations = horizon_profile(
                row["latitude"], row["longitude"], elevation + 1.1, surface, terrain, buildings, coverage,
            )
            if any(value is None for value in horizon):
                coverage["status"] = "partial"
                with connection:
                    if hasattr(connection, "begin_immediate"):
                        connection.begin_immediate()
                    if knowledge_enabled and (progress.revision(connection, row["row_id"]) != input_revision or progress.source_revision(connection) != source_revision):
                        continue
                    upsert_enrichment(connection, {"bench_row_id": row["row_id"], "terrain_coverage": json.dumps(coverage)})
                    record_attempt(connection, row, PIPELINE_VERSION, "missing_source", coverage)
                print(f"Incomplete raster coverage for bench {row['row_id']}; previous usable values retained", file=sys.stderr)
                continue
            coverage["status"] = "complete"
            facing = row["direction_degrees"]
            relief = min(1.0, ((max(elevations) - min(elevations)) / 1500.0) if elevations else 0.0)
            labels, openness, water, naturalness, remoteness, view_sectors = classify_view(
                row["latitude"], row["longitude"], facing, horizon, terrain_horizon, context, relief,
                far_max_elevations, elevation, obstruction_types,
            )
            components = apply_environment_hints(
                {"openness": openness, "relief": relief, "water": water, "naturalness": naturalness, "remoteness": remoteness},
                row["raw_tags"],
            )
            view = score_view(**components)
            sun_confidence = "hoch" if surface.datasets and buildings else "mittel" if surface.datasets else "niedrig"
            view_confidence = "hoch" if facing is not None and surface.datasets and context else "mittel" if surface.datasets and context else "niedrig"
            sun_summer = direct_sun_minutes(row["latitude"], row["longitude"], horizon, canopy_percent, bool(row["covered"]), 6, 21)
            sun_winter = direct_sun_minutes(row["latitude"], row["longitude"], horizon, canopy_percent, bool(row["covered"]), 12, 21)
            sun_spring = direct_sun_minutes(row["latitude"], row["longitude"], horizon, canopy_percent, bool(row["covered"]), 3, 20)
            sun_autumn = direct_sun_minutes(row["latitude"], row["longitude"], horizon, canopy_percent, bool(row["covered"]), 9, 22)
            building_percent = 100 * obstruction_types.count("building") / len(obstruction_types)
            vegetation_percent = 100 * obstruction_types.count("vegetation") / len(obstruction_types)
            distance_building = min((feature_distance(row["latitude"], row["longitude"], feature) for feature in buildings), default=None)
            building_count = sum(feature_distance(row["latitude"], row["longitude"], feature) <= 100 for feature in buildings)
            paths = [feature for feature in local_context if feature["kind"] == "path"]
            waters = [feature for feature in context if feature["kind"] == "water"]
            roads = [feature for feature in context if feature["kind"] == "major_road"]
            forests = [feature for feature in context if feature["kind"] == "forest"]
            nearest = lambda features: min((feature_distance(row["latitude"], row["longitude"], feature) for feature in features), default=None)
            values = {
                "bench_row_id": row["row_id"],
                "elevation_meters": elevation,
                "in_forest": in_forest,
                "canopy_percent": canopy_percent,
                "distance_forest_meters": environment["forest_distance"],
                "distance_water_meters": environment["water_distance"],
                "distance_path_meters": nearest(paths),
                "distance_major_road_meters": nearest(roads),
                "horizon_profile": json.dumps(horizon),
                "terrain_coverage": json.dumps(coverage),
                "terrain_horizon_profile": json.dumps(terrain_horizon),
                "obstruction_types": json.dumps(obstruction_types),
                "obstruction_distances": json.dumps(obstruction_distances),
                "building_obstruction_percent": building_percent,
                "vegetation_obstruction_percent": vegetation_percent,
                "distance_building_meters": distance_building,
                "building_count_100m": building_count,
                "sun_minutes_summer": sun_summer,
                "sun_minutes_winter": sun_winter,
                "sun_minutes_spring": sun_spring,
                "sun_minutes_autumn": sun_autumn,
                "sun_confidence": sun_confidence,
                "view_score": view,
                "view_confidence": view_confidence,
                "view_components": json.dumps(components),
                "view_labels": json.dumps(labels, ensure_ascii=False),
                "view_sectors": json.dumps(view_sectors),
                "context_source_version": f"swissTLM3D:{official_context}" if official_context else "OpenStreetMap",
                "pipeline_version": PIPELINE_VERSION,
                "computed_at": now_iso(),
                "land_context": environment["land_context"],
                "waterfront": int(bool(environment["waterfront"])),
                "canopy_context": canopy["context"],
                "canopy_share_3m": canopy["share_3m"],
                "canopy_share_10m": canopy["share_10m"],
                "canopy_share_25m": canopy["share_25m"],
                "vegetation_median_height": canopy["median_height"],
                "vegetation_max_height": canopy["max_height"],
                "environment_computed_at": now_iso(),
            }
            approach = prepare_approach(connection, dict(row), local_context, terrain.sample, dem_inputs=terrain_inputs) if knowledge_enabled else None
            # Terrain/DEM calculations can take minutes per bench. Only hold the
            # shared writer while storing one complete result, never between benches.
            with connection:
                if hasattr(connection, "begin_immediate"):
                    connection.begin_immediate()
                if knowledge_enabled and (progress.revision(connection, row["row_id"]) != input_revision or progress.source_revision(connection) != source_revision):
                    continue
                upsert_enrichment(connection, values)
                record_attempt(connection, row, PIPELINE_VERSION, "current", coverage)
                if approach is not None:
                    store_approach(connection, dict(row), approach)
            updated += 1
            print(f"Enriched {updated}/{len(rows)} benches (last row {row['row_id']})", file=sys.stderr)
    finally:
        terrain.close()
        surface.close()
    return updated


def reconcile_deterministic_context(connection: sqlite3.Connection, limit: int = 5000,
                                    bounds: Optional[tuple[float, float, float, float]] = None) -> dict[str, int]:
    bounds_clause = ""
    parameters: list[object] = []
    if bounds:
        bounds_clause = "AND b.longitude BETWEEN ? AND ? AND b.latitude BETWEEN ? AND ?"
        parameters.extend((bounds[0], bounds[2], bounds[1], bounds[3]))
    parameters.append(limit)
    unresolved_clause = "" if bounds else "AND (e.environment_computed_at IS NULL OR e.land_context IS NULL)"
    rows = connection.execute(f"""
      SELECT b.row_id,b.latitude,b.longitude,e.canopy_context
      FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
      WHERE b.active=1 {unresolved_clause} {bounds_clause}
      ORDER BY b.row_id LIMIT ?
    """, parameters).fetchall()
    stats = {"deterministic_reconciled": 0, "forest": 0, "waterfront": 0}
    official_context = official_context_version(connection)
    for row in rows:
        forests = nearest_exact_context(connection, row["latitude"], row["longitude"], "forest", official_context)
        waters = nearest_exact_context(connection, row["latitude"], row["longitude"], "water", official_context)
        result = deterministic_environment(
            row["latitude"], row["longitude"], forests, waters,
            nearby_land_cover(connection, row["latitude"], row["longitude"]),
            str(row["canopy_context"] or "unknown"),
        )
        upsert_enrichment(connection, {
            "bench_row_id": row["row_id"],
            "in_forest": int(bool(result["in_forest"])),
            "land_context": result["land_context"],
            "waterfront": int(bool(result["waterfront"])),
            "distance_forest_meters": result["forest_distance"],
            "distance_water_meters": result["water_distance"],
            "environment_computed_at": now_iso(),
        })
        stats["deterministic_reconciled"] += 1
        stats["forest"] += int(bool(result["in_forest"]))
        stats["waterfront"] += int(bool(result["waterfront"]))
        connection.commit()
    connection.commit()
    return stats
