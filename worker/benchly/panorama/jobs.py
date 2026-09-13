"""Bounded, resumable prewarming of exact bench viewpoints."""

from __future__ import annotations

import json
import multiprocessing
import resource
import signal
import sys
import time
from argparse import Namespace
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from astral import Observer
from astral.sun import azimuth as sun_azimuth, elevation as sun_elevation
from benchly.context.rasters import RasterCollection
from benchly.db import connect_database
from benchly.panorama.cache import PanoramaCache, geometry_cache_key, lightmap_cache_key, render_cache_key
from benchly.panorama.datasets import (
    LOD_SCHEDULE_VERSION,
    load_buildings,
    load_semantic_index,
    raster_source_version,
    sample_terrain_rays,
)
from benchly.panorama.models import (
    GEOMETRY_VERSION,
    BuildingGeometry,
    GeometryIdentity,
    LightMapIdentity,
    PanoramaConfig,
    RENDER_VERSION,
    RenderIdentity,
    SourceEvidence,
)
from benchly.panorama.repository import (
    delete_expired_lightmaps,
    mark_failed,
    mark_generating,
    mark_lightmap_ready,
    mark_ready,
    mark_render_ready,
    mark_request_retry,
    pending_benches,
    require_schema,
)
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import render_lightmap_webp, render_panorama_webp
from benchly.runtime import now_iso


def _database_version(database, source: str, fallback: str) -> str:
    row = database.execute("SELECT version FROM official_context_sources WHERE source=?", (source,)).fetchone()
    return str(row["version"]) if row else fallback


def _optional_database_version(database, source: str) -> str | None:
    row = database.execute("SELECT version FROM official_context_sources WHERE source=?", (source,)).fetchone()
    return str(row["version"]) if row else None


def _osm_version(database) -> str:
    row = database.execute("""SELECT coalesce(source_version,pipeline_version,finished_at) version FROM pipeline_runs
        WHERE kind IN ('import-osm','refresh') AND status='completed' ORDER BY id DESC LIMIT 1""").fetchone()
    return str(row["version"]) if row and row["version"] else "unknown"


def _season(now: datetime) -> str:
    month = now.astimezone(ZoneInfo("Europe/Zurich")).month
    return "spring" if 3 <= month <= 5 else "summer" if 6 <= month <= 8 else "autumn" if 9 <= month <= 11 else "winter"


def _solar_state(latitude: float, longitude: float, now: datetime) -> tuple[str, float, float]:
    bucket_minute = now.minute - now.minute % 10
    bucket = now.replace(minute=bucket_minute, second=0, microsecond=0).isoformat()
    observer = Observer(latitude=latitude, longitude=longitude)
    return bucket, float(sun_azimuth(observer, now)), float(sun_elevation(observer, now))


def panorama_batch_job(args: Namespace) -> None:
    database = connect_database(Path(args.database).resolve())
    terrain = RasterCollection(Path(args.terrain_dir).resolve())
    regional_terrain = RasterCollection(Path(args.regional_terrain_dir).resolve()) if args.regional_terrain_dir else None
    border_terrain = RasterCollection(Path(args.border_terrain_dir).resolve()) if args.border_terrain_dir else None
    cache = PanoramaCache(Path(args.cache_dir).resolve())
    stats = {"selected": 0, "generated": 0, "cache_hits": 0, "partial": 0, "unavailable": 0, "failed": 0,
             "terrain_seconds": 0.0, "semantic_seconds": 0.0, "building_seconds": 0.0,
             "visibility_seconds": 0.0, "render_seconds": 0.0, "cache_lookup_seconds": 0.0,
             "maximum_bench_seconds": 0.0, "errors": []}
    job_started = time.perf_counter()
    try:
        require_schema(database)
        for expired_path in delete_expired_lightmaps(database, now_iso()):
            try:
                Path(expired_path).unlink(missing_ok=True)
            except OSError:
                pass
        if not terrain.datasets:
            raise RuntimeError("panorama-batch requires indexed swissALTI3D GeoTIFFs")
        terrain_version = raster_source_version(terrain)
        regional_terrain_version = raster_source_version(regional_terrain) if regional_terrain and regional_terrain.datasets else None
        border_terrain_version = raster_source_version(border_terrain) if border_terrain and border_terrain.datasets else None
        osm_version = _osm_version(database)
        tlm_version = _database_version(database, "swissTLM3D", "absent")
        swissbuildings_version = _optional_database_version(database, "swissBUILDINGS3D")
        semantic_version = f"tlm:{tlm_version}:osm:{osm_version}"
        building_version = f"swiss:{swissbuildings_version or 'absent'}:tlm:{tlm_version}:osm:{osm_version}"
        config = PanoramaConfig(
            angular_resolution_degrees=args.angular_resolution,
            maximum_distance_meters=args.maximum_distance_meters,
        )
        now = datetime.now(UTC)
        season = _season(now)
        source_versions = {
            "terrain": terrain_version,
            "regional_terrain": regional_terrain_version or "absent",
            "border_terrain": border_terrain_version or "absent",
            "lod_schedule": LOD_SCHEDULE_VERSION,
            "high_resolution_distance_meters": f"{args.high_resolution_distance_meters:g}",
            "semantic": semantic_version,
            "building": building_version,
            "algorithm": GEOMETRY_VERSION,
            "angular_resolution_degrees": f"{config.angular_resolution_degrees:g}",
            "maximum_distance_meters": f"{config.maximum_distance_meters:g}",
            "observer_height_meters": f"{config.observer_height_meters:g}",
            "semantic_radius_meters": f"{args.semantic_radius_meters:g}",
            "building_radius_meters": f"{args.building_radius_meters:g}",
        }
        rows = pending_benches(
            database,
            GEOMETRY_VERSION,
            source_versions,
            RENDER_VERSION,
            args.preview_width,
            args.preview_height,
            season,
            args.limit,
            getattr(args, "shard_index", 0),
            getattr(args, "shard_count", 1),
        )
        stats["selected"] = len(rows)
        deadline = time.monotonic() + args.max_runtime_hours * 3600
        for row in rows:
            if time.monotonic() >= deadline:
                break
            bench_started = time.perf_counter()
            ground_elevation = float(row["elevation_meters"]) if row["elevation_meters"] is not None else terrain.sample(
                float(row["latitude"]), float(row["longitude"]),
            )
            if ground_elevation is None:
                stats["unavailable"] += 1
                mark_request_retry(database, int(row["row_id"]), "terrain elevation unavailable")
                continue
            identity = GeometryIdentity(
                latitude=float(row["latitude"]), longitude=float(row["longitude"]),
                ground_elevation_meters=float(ground_elevation),
                terrain_version=terrain_version,
                regional_terrain_version=regional_terrain_version,
                border_terrain_version=border_terrain_version,
                lod_schedule_version=LOD_SCHEDULE_VERSION,
                high_resolution_distance_meters=args.high_resolution_distance_meters,
                semantic_version=semantic_version,
                building_version=building_version,
                maximum_distance_meters=config.maximum_distance_meters,
                angular_resolution_degrees=config.angular_resolution_degrees,
                semantic_radius_meters=args.semantic_radius_meters,
                building_radius_meters=args.building_radius_meters,
            )
            key = geometry_cache_key(identity)
            mark_generating(database, row, key, source_versions)
            try:
                started = time.perf_counter()
                geometry = cache.get_geometry(key)
                stats["cache_lookup_seconds"] += time.perf_counter() - started
                if geometry is None:
                    started = time.perf_counter()
                    semantic_index = load_semantic_index(database, float(row["latitude"]), float(row["longitude"]), args.semantic_radius_meters)
                    stats["semantic_seconds"] += time.perf_counter() - started
                    started = time.perf_counter()
                    rays = sample_terrain_rays(
                        float(row["latitude"]), float(row["longitude"]), terrain, config, semantic_index,
                        regional_terrain=regional_terrain,
                        border_terrain=border_terrain,
                        high_resolution_distance_meters=args.high_resolution_distance_meters,
                    )
                    stats["terrain_seconds"] += time.perf_counter() - started
                    started = time.perf_counter()
                    buildings: list[BuildingGeometry] = load_buildings(
                        database, float(row["latitude"]), float(row["longitude"]), terrain, args.building_radius_meters)
                    stats["building_seconds"] += time.perf_counter() - started
                    started = time.perf_counter()
                    geometry = build_panorama_geometry(identity, rays, buildings, (
                        SourceEvidence(source="swissALTI3D", version=terrain_version, confidence=1),
                        *(() if regional_terrain_version is None else (
                            SourceEvidence(source="regional terrain", version=regional_terrain_version, confidence=.92),
                        )),
                        *(() if border_terrain_version is None else (
                            SourceEvidence(source="cross-border terrain", version=border_terrain_version, confidence=.86),
                        )),
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
                    season_bucket=season,
                    source_completeness=geometry.complete,
                )
                render_key = render_cache_key(render_identity)
                render_path = cache.render_path(render_key)
                if not render_path.exists():
                    started = time.perf_counter()
                    image = render_panorama_webp(geometry, render_identity.width, render_identity.height, season)
                    render_path = cache.put_render(render_key, image)
                    stats["render_seconds"] += time.perf_counter() - started

                solar_bucket, azimuth, altitude = _solar_state(float(row["latitude"]), float(row["longitude"]), datetime.now(UTC))
                light_identity = LightMapIdentity(
                    geometry_key=key,
                    solar_bucket=solar_bucket,
                    sun_azimuth_degrees=azimuth,
                    sun_altitude_degrees=altitude,
                )
                light_key = lightmap_cache_key(light_identity)
                light_path = cache.lightmap_path(light_key)
                if not light_path.exists():
                    light_path = cache.put_lightmap(light_key, render_lightmap_webp(
                        geometry, azimuth, altitude, light_identity.width, light_identity.height,
                    ))
                mark_lightmap_ready(database, int(row["row_id"]), light_identity, light_key, str(light_path), light_path.stat().st_size)
                mark_render_ready(database, int(row["row_id"]), render_identity, str(render_path), render_path.stat().st_size)
            except Exception as error:
                status = "unavailable" if "coverage" in str(error).casefold() else "error"
                mark_failed(database, int(row["row_id"]), key, status, str(error))
                stats["unavailable" if status == "unavailable" else "failed"] += 1
                if len(stats["errors"]) < 3:
                    stats["errors"].append({"bench_id": str(row["id"]), "error": str(error)[:400]})
            finally:
                stats["maximum_bench_seconds"] = max(stats["maximum_bench_seconds"], time.perf_counter() - bench_started)
        stats["finished_at"] = now_iso()
        stats["total_seconds"] = time.perf_counter() - job_started
        stats["maximum_rss_mb"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 if sys.platform != "darwin" else 1024 * 1024)
        print(json.dumps(stats, indent=2, sort_keys=True))
        if stats["selected"] and not stats["generated"] and not stats["cache_hits"]:
            raise RuntimeError("panorama batch produced no usable geometry; inspect the reported errors")
    finally:
        terrain.close()
        if regional_terrain:
            regional_terrain.close()
        if border_terrain:
            border_terrain.close()
        database.close()


def _panorama_worker_loop(args: Namespace) -> None:
    while True:
        try:
            panorama_batch_job(args)
            time.sleep(args.idle_seconds)
        except KeyboardInterrupt:
            return
        except Exception as error:
            print(json.dumps({"panorama_worker": args.shard_index, "error": str(error)[:500]}), file=sys.stderr)
            time.sleep(max(5, args.idle_seconds))


def panorama_worker_job(args: Namespace) -> None:
    """Keep four disjoint panorama shards warm without overlapping benches."""
    context = multiprocessing.get_context("spawn")
    processes = []
    for shard_index in range(args.processes):
        child_args = Namespace(**vars(args))
        child_args.shard_index = shard_index
        child_args.shard_count = args.processes
        process = context.Process(target=_panorama_worker_loop, args=(child_args,), name=f"panorama-{shard_index}", daemon=True)
        process.start()
        processes.append(process)

    stopping = False
    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while not stopping and all(process.is_alive() for process in processes):
            time.sleep(1)
        if not stopping:
            failed = next((process for process in processes if not process.is_alive()), None)
            raise RuntimeError(f"panorama shard exited unexpectedly ({failed.exitcode if failed else 'unknown'})")
    finally:
        for process in processes:
            if process.is_alive():
                process.terminate()
        for process in processes:
            process.join(timeout=10)
