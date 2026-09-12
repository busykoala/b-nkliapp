"""Bounded, resumable prewarming of exact bench viewpoints."""

from __future__ import annotations

import json
import time
from argparse import Namespace
from pathlib import Path

from benchly.context.rasters import RasterCollection
from benchly.db import connect_database
from benchly.panorama.cache import PanoramaCache, geometry_cache_key, render_cache_key
from benchly.panorama.datasets import (
    load_buildings,
    load_semantic_index,
    raster_source_version,
    sample_terrain_rays,
)
from benchly.panorama.models import (
    GEOMETRY_VERSION,
    BuildingGeometry,
    GeometryIdentity,
    PanoramaConfig,
    RenderIdentity,
    SourceEvidence,
)
from benchly.panorama.repository import (
    mark_failed,
    mark_generating,
    mark_ready,
    mark_render_ready,
    pending_benches,
    require_schema,
)
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import render_panorama_svg
from benchly.runtime import now_iso


def _database_version(database, source: str, fallback: str) -> str:
    row = database.execute("SELECT version FROM official_context_sources WHERE source=?", (source,)).fetchone()
    return str(row["version"]) if row else fallback


def _osm_version(database) -> str:
    row = database.execute("""SELECT coalesce(source_version,pipeline_version,finished_at) version FROM pipeline_runs
        WHERE kind IN ('import-osm','refresh') AND status='completed' ORDER BY id DESC LIMIT 1""").fetchone()
    return str(row["version"]) if row and row["version"] else "unknown"


def _bench_variant(row) -> str:
    material = str(row["material"] or "wood").casefold()
    kind = "stone" if any(value in material for value in ("stone", "concrete", "stein", "beton")) else "metal" if any(
        value in material for value in ("metal", "steel", "iron", "metall", "stahl", "eisen")) else "wood"
    shape = "back-arm" if row["backrest"] and row["armrest"] else "back" if row["backrest"] else "backless"
    return f"{kind}-{shape}"


def panorama_batch_job(args: Namespace) -> None:
    database = connect_database(Path(args.database).resolve())
    terrain = RasterCollection(Path(args.terrain_dir).resolve())
    cache = PanoramaCache(Path(args.cache_dir).resolve())
    stats = {"selected": 0, "generated": 0, "cache_hits": 0, "partial": 0, "unavailable": 0, "failed": 0,
             "terrain_seconds": 0.0, "semantic_seconds": 0.0, "building_seconds": 0.0,
             "visibility_seconds": 0.0, "render_seconds": 0.0}
    try:
        require_schema(database)
        if not terrain.datasets:
            raise RuntimeError("panorama-batch requires indexed swissALTI3D GeoTIFFs")
        terrain_version = raster_source_version(terrain)
        semantic_version = _database_version(database, "swissTLM3D", f"osm:{_osm_version(database)}")
        building_version = _database_version(database, "swissBUILDINGS3D", f"context:{semantic_version}:osm:{_osm_version(database)}")
        source_versions = {
            "terrain": terrain_version,
            "semantic": semantic_version,
            "building": building_version,
            "algorithm": GEOMETRY_VERSION,
        }
        config = PanoramaConfig(
            angular_resolution_degrees=args.angular_resolution,
            maximum_distance_meters=args.maximum_distance_meters,
        )
        rows = pending_benches(database, GEOMETRY_VERSION, args.limit)
        stats["selected"] = len(rows)
        deadline = time.monotonic() + args.max_runtime_hours * 3600
        for row in rows:
            if time.monotonic() >= deadline:
                break
            identity = GeometryIdentity(
                latitude=float(row["latitude"]), longitude=float(row["longitude"]),
                ground_elevation_meters=float(row["elevation_meters"]),
                terrain_version=terrain_version, semantic_version=semantic_version,
                building_version=building_version,
                maximum_distance_meters=config.maximum_distance_meters,
                angular_resolution_degrees=config.angular_resolution_degrees,
            )
            key = geometry_cache_key(identity)
            mark_generating(database, row, key, source_versions)
            try:
                geometry = cache.get_geometry(key)
                if geometry is None:
                    started = time.perf_counter()
                    semantic_index = load_semantic_index(database, float(row["latitude"]), float(row["longitude"]), args.semantic_radius_meters)
                    stats["semantic_seconds"] += time.perf_counter() - started
                    started = time.perf_counter()
                    rays = sample_terrain_rays(float(row["latitude"]), float(row["longitude"]), terrain, config, semantic_index)
                    stats["terrain_seconds"] += time.perf_counter() - started
                    started = time.perf_counter()
                    buildings: list[BuildingGeometry] = load_buildings(
                        database, float(row["latitude"]), float(row["longitude"]), terrain, args.building_radius_meters)
                    stats["building_seconds"] += time.perf_counter() - started
                    started = time.perf_counter()
                    geometry = build_panorama_geometry(identity, rays, buildings, (
                        SourceEvidence(source="swissALTI3D", version=terrain_version, confidence=1),
                        SourceEvidence(source="swissTLM3D", version=semantic_version, confidence=.9),
                        SourceEvidence(source="building hierarchy", version=building_version, confidence=.75),
                    ), config)
                    stats["visibility_seconds"] += time.perf_counter() - started
                    path = cache.put_geometry(geometry)
                    stats["generated"] += 1
                else:
                    path = cache.geometry_path(key)
                    stats["cache_hits"] += 1
                if not geometry.complete:
                    stats["partial"] += 1
                mark_ready(database, int(row["row_id"]), key, str(path), path.stat().st_size, geometry.complete, geometry.warnings)

                render_identity = RenderIdentity(
                    geometry_key=key,
                    # The full circle is direction-neutral. The app performs a
                    # smooth wrap-safe crop centered on the effective direction.
                    center_azimuth_degrees=0,
                    horizontal_fov_degrees=360,
                    width=args.preview_width,
                    height=args.preview_height,
                    weather_bucket="phase-b-neutral",
                    solar_lunar_bucket="phase-b-neutral",
                    bench_variant=_bench_variant(row),
                    covered=None if row["covered"] is None else bool(row["covered"]),
                )
                render_key = render_cache_key(render_identity)
                render_path = cache.render_path(render_key)
                if not render_path.exists():
                    started = time.perf_counter()
                    svg = render_panorama_svg(geometry, render_identity.width, render_identity.height)
                    render_path = cache.put_render(render_key, svg)
                    stats["render_seconds"] += time.perf_counter() - started
                mark_render_ready(database, int(row["row_id"]), render_identity, str(render_path), render_path.stat().st_size)
            except Exception as error:
                status = "unavailable" if "coverage" in str(error).casefold() else "error"
                mark_failed(database, int(row["row_id"]), key, status, str(error))
                stats["unavailable" if status == "unavailable" else "failed"] += 1
        stats["finished_at"] = now_iso()
        print(json.dumps(stats, indent=2, sort_keys=True))
    finally:
        terrain.close()
        database.close()
