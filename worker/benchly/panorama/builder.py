"""Resumable local generation, sizing, verification and LAN activation.

This is intentionally outside release CI.  The Mac keeps the authoritative
build workspace; production keeps only the active generation plus a bounded
incoming upload while activation is verified.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import math
import os
import shlex
import shutil
import sqlite3
import subprocess
import sys
import time
from argparse import Namespace
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from benchly.context.rasters import RasterCollection
from benchly.db import connect_database
from benchly.panorama.binary import decode_geometry, encode_geometry
from benchly.panorama.datasets import (
    LOD_SCHEDULE_KEY,
    load_buildings,
    load_semantic_index,
    raster_source_version,
    sample_terrain_rays,
)
from benchly.panorama.identity import implementation_key
from benchly.panorama.models import (
    GEOMETRY_IMPLEMENTATION,
    RENDER_IMPLEMENTATION,
    GeometryIdentity,
    PanoramaConfig,
    PanoramaGeometry,
    SourceEvidence,
)
from benchly.panorama.repository import activate_generation
from benchly.panorama.visibility import build_panorama_geometry
from benchly.panorama.watercolor import render_material_webp, render_panorama_webp

DEFAULT_ROOT = Path("data/panorama-builder")
GENERATION_FORMAT = "benchly-panorama-generation"
GENERATION_SCHEMA = 1
SERVER = "busykoala@192.168.1.206"
SERVER_ROOT = Path("/srv/data/benchly/panorama")
STEADY_TARGET_BYTES = 40 * 1024**3
WARNING_BYTES = 60 * 1024**3
MINIMUM_FREE_BYTES = 20 * 1024**3
DEFAULT_PVC_GIB = 80
# Quantised national terrain pyramid plus compact buildings/water/forest/tree
# packages. The 1% pilot measures per-bench artifacts and adds this conservative
# fixed budget to both steady and activation-peak projections.
SHARED_MODEL_BUDGET_BYTES = 15 * 1024**3


def _artifact_implementation() -> str:
    # Orchestration changes do not invalidate byte-identical image artifacts.
    # Only the checked-in codec, contract and painter contribute to identity.
    return implementation_key("binary.py", "models.py", "watercolor.py")


def _git_commit() -> str:
    """Use Git as the sole release identifier for a sealed generation."""
    override = os.environ.get("BENCHLY_GIT_COMMIT")
    if override:
        return override.strip()
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=Path(__file__).resolve().parents[3],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.part")
    try:
        temporary.write_bytes(payload)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _open_state(root: Path) -> sqlite3.Connection:
    root.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(root / "progress.sqlite", timeout=60)
    database.execute("PRAGMA journal_mode=WAL")
    database.execute("PRAGMA synchronous=FULL")
    database.executescript("""
      CREATE TABLE IF NOT EXISTS cells(
        cell_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,finished_at TEXT,last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS artifacts(
        source_path TEXT PRIMARY KEY,bench_id TEXT,cell_id TEXT,kind TEXT NOT NULL,relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,artifact_bytes INTEGER NOT NULL,source_bytes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ready','invalid')),created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS extractions(
        bench_id TEXT PRIMARY KEY,bench_row_id INTEGER NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,
        input_key TEXT NOT NULL,geometry_key TEXT,relative_path TEXT,sha256 TEXT,artifact_bytes INTEGER,
        status TEXT NOT NULL CHECK(status IN ('ready','error')),attempts INTEGER NOT NULL DEFAULT 0,
        finished_at TEXT,last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS reports(
        checkpoint TEXT PRIMARY KEY,completed INTEGER NOT NULL,total INTEGER NOT NULL,actual_bytes INTEGER NOT NULL,
        projected_final_bytes INTEGER NOT NULL,projected_peak_bytes INTEGER NOT NULL,recommended_pvc_gib INTEGER NOT NULL,
        created_at TEXT NOT NULL,detail_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    """)
    identity = database.execute("SELECT value FROM metadata WHERE key='artifact_implementation'").fetchone()
    artifact_implementation = _artifact_implementation()
    if identity is None or identity[0] != artifact_implementation:
        database.execute("DELETE FROM artifacts")
        database.execute("DELETE FROM metadata WHERE key='build_revision'")
        database.execute("DELETE FROM metadata WHERE key='builder_key'")
        database.execute("INSERT OR REPLACE INTO metadata VALUES('artifact_implementation',?)", (artifact_implementation,))
        database.commit()
    return database


def _legacy_geometry(path: Path) -> PanoramaGeometry:
    if path.suffix == ".bpc":
        return decode_geometry(path.read_bytes())
    with np.load(path, allow_pickle=False) as archive:
        return PanoramaGeometry.model_validate_json(archive["manifest"].tobytes())


@dataclass(frozen=True)
class Built:
    source_path: str
    cell_id: str
    bench_id: str
    artifacts: tuple[tuple[str, str, int], ...]
    source_bytes: int


def _build_one(source: str, generation_root: str, season: str) -> Built:
    source_path = Path(source)
    geometry = _legacy_geometry(source_path).model_copy(update={"version": GEOMETRY_IMPLEMENTATION})
    key = geometry.identity_key
    output = Path(generation_root)
    capsule = output / "capsules" / key[:2] / f"{key}.bpc"
    render = output / "renders" / key[:2] / f"{key}-{season}.webp"
    material = output / "materials" / key[:2] / f"{key}.webp"
    try:
        existing = decode_geometry(capsule.read_bytes()) if capsule.exists() else None
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        existing = None
    if existing is None or existing.version != geometry.version:
        _atomic(capsule, encode_geometry(geometry))
    if not render.exists():
        _atomic(render, render_panorama_webp(geometry, 4096, 1024, season))
    if not material.exists():
        _atomic(material, render_material_webp(geometry))
    artifacts = tuple((kind, str(path.relative_to(output)), path.stat().st_size) for kind, path in (
        ("capsule", capsule), ("render", render), ("material", material),
    ))
    cell = f"{math.floor(geometry.longitude * 20) / 20:.2f}:{math.floor(geometry.latitude * 20) / 20:.2f}"
    return Built(str(source_path), cell, key, artifacts, source_path.stat().st_size)


def _discover_sources(source_root: Path) -> list[Path]:
    return sorted((*source_root.rglob("*.npz"), *source_root.rglob("*.bpc")))


@dataclass(frozen=True)
class Extracted:
    bench_id: str
    bench_row_id: int
    latitude: float
    longitude: float
    input_key: str
    geometry_key: str
    relative_path: str
    sha256: str
    artifact_bytes: int


_EXTRACT_DATABASE: sqlite3.Connection | None = None
_EXTRACT_TERRAIN: RasterCollection | None = None
_EXTRACT_NEAR_TERRAIN: RasterCollection | None = None
_EXTRACT_FAR_TERRAIN: RasterCollection | None = None
_EXTRACT_ROOT: Path | None = None
_EXTRACT_CONFIG: PanoramaConfig | None = None
_EXTRACT_SOURCE_VERSIONS: dict[str, str] | None = None
_EXTRACT_SEMANTIC_CELL: tuple[tuple[int, int], object] | None = None


def _extraction_source_versions(database: sqlite3.Connection, terrain: RasterCollection,
                                near_terrain: RasterCollection, far_terrain: RasterCollection) -> dict[str, str]:
    def official(source: str, fallback: str = "absent") -> str:
        row = database.execute("SELECT version FROM official_context_sources WHERE source=?", (source,)).fetchone()
        return str(row[0]) if row and row[0] else fallback

    osm = database.execute("""SELECT coalesce(source_version,pipeline_version,finished_at) FROM pipeline_runs
      WHERE kind IN ('import-osm','refresh') AND status='completed' ORDER BY id DESC LIMIT 1""").fetchone()
    osm_key = str(osm[0]) if osm and osm[0] else "unknown"
    tlm = official("swissTLM3D")
    buildings = official("swissBUILDINGS3D")
    return {
        "terrain": hashlib.sha256(":".join((
            raster_source_version(terrain), raster_source_version(near_terrain), raster_source_version(far_terrain),
        )).encode()).hexdigest(),
        "semantic": f"tlm:{tlm}:osm:{osm_key}",
        "building": f"swiss:{buildings}:tlm:{tlm}:osm:{osm_key}",
        "algorithm": GEOMETRY_IMPLEMENTATION,
        "lod_schedule": LOD_SCHEDULE_KEY,
    }


def _extract_initializer(database_path: str, terrain_dir: str, pyramid_dir: str, root: str,
                         config_payload: dict[str, object], source_versions: dict[str, str], io_threads: int) -> None:
    global _EXTRACT_DATABASE, _EXTRACT_TERRAIN, _EXTRACT_NEAR_TERRAIN, _EXTRACT_FAR_TERRAIN
    global _EXTRACT_ROOT, _EXTRACT_CONFIG, _EXTRACT_SOURCE_VERSIONS, _EXTRACT_SEMANTIC_CELL
    os.environ["GDAL_NUM_THREADS"] = str(max(1, io_threads))
    os.environ["OMP_NUM_THREADS"] = "1"
    _EXTRACT_DATABASE = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True, timeout=60)
    _EXTRACT_DATABASE.row_factory = sqlite3.Row
    _EXTRACT_TERRAIN = RasterCollection(Path(terrain_dir))
    _EXTRACT_NEAR_TERRAIN = RasterCollection(Path(pyramid_dir) / "10m")
    _EXTRACT_FAR_TERRAIN = RasterCollection(Path(pyramid_dir) / "90m")
    _EXTRACT_ROOT = Path(root)
    _EXTRACT_CONFIG = PanoramaConfig.model_validate(config_payload)
    _EXTRACT_SOURCE_VERSIONS = source_versions
    _EXTRACT_SEMANTIC_CELL = None


def _extract_one(row: dict[str, object]) -> Extracted:
    global _EXTRACT_SEMANTIC_CELL
    if not all((_EXTRACT_DATABASE, _EXTRACT_TERRAIN, _EXTRACT_NEAR_TERRAIN, _EXTRACT_FAR_TERRAIN,
                _EXTRACT_ROOT, _EXTRACT_CONFIG, _EXTRACT_SOURCE_VERSIONS)):
        raise RuntimeError("panorama extraction worker is not initialized")
    database = _EXTRACT_DATABASE
    terrain = _EXTRACT_TERRAIN
    root = _EXTRACT_ROOT
    config = _EXTRACT_CONFIG
    source_versions = _EXTRACT_SOURCE_VERSIONS
    latitude, longitude = float(row["latitude"]), float(row["longitude"])
    ground = float(row["elevation_meters"]) if row.get("elevation_meters") is not None else terrain.sample(latitude, longitude)
    if ground is None:
        raise RuntimeError("terrain elevation unavailable")
    identity = GeometryIdentity(
        latitude=latitude,
        longitude=longitude,
        ground_elevation_meters=float(ground),
        terrain_version=source_versions["terrain"],
        lod_schedule_version=source_versions["lod_schedule"],
        semantic_version=source_versions["semantic"],
        building_version=source_versions["building"],
        maximum_distance_meters=config.maximum_distance_meters,
        angular_resolution_degrees=config.angular_resolution_degrees,
    )
    semantic_key = (math.floor(longitude * 20), math.floor(latitude * 20))
    if _EXTRACT_SEMANTIC_CELL is None or _EXTRACT_SEMANTIC_CELL[0] != semantic_key:
        center_longitude = (semantic_key[0] + .5) / 20
        center_latitude = (semantic_key[1] + .5) / 20
        _EXTRACT_SEMANTIC_CELL = (
            semantic_key,
            load_semantic_index(database, center_latitude, center_longitude, identity.semantic_radius_meters + 4_000),
        )
    semantics = _EXTRACT_SEMANTIC_CELL[1]
    rays = sample_terrain_rays(
        latitude, longitude, _EXTRACT_NEAR_TERRAIN, config, semantics,
        regional_terrain=_EXTRACT_FAR_TERRAIN,
        observer_ground_elevation_meters=float(ground),
    )
    buildings = load_buildings(database, latitude, longitude, terrain, identity.building_radius_meters)
    geometry = build_panorama_geometry(identity, rays, buildings, (
        SourceEvidence(source="swissALTI3D", version=source_versions["terrain"], confidence=1),
        SourceEvidence(source="land semantics", version=source_versions["semantic"], confidence=.9),
        SourceEvidence(source="building hierarchy", version=source_versions["building"], confidence=.75),
    ), config)
    relative = Path("source") / geometry.identity_key[:2] / f"{geometry.identity_key}.bpc"
    target = root / relative
    _atomic(target, encode_geometry(geometry))
    input_key = str(row["input_key"])
    return Extracted(
        bench_id=str(row["id"]), bench_row_id=int(row["row_id"]), latitude=latitude, longitude=longitude,
        input_key=input_key, geometry_key=geometry.identity_key, relative_path=str(relative),
        sha256=_sha256(target), artifact_bytes=target.stat().st_size,
    )


def panorama_extract_job(args: Namespace) -> None:
    """Resume national exact-geometry extraction on the local Mac."""
    root = Path(args.root).resolve()
    terrain_dir = Path(args.terrain_dir).resolve()
    pyramid_dir = Path(args.terrain_pyramid_dir).resolve() if args.terrain_pyramid_dir else terrain_dir.parent / "panorama-pyramid"
    source_database = sqlite3.connect(Path(args.database).resolve())
    source_database.row_factory = sqlite3.Row
    terrain = RasterCollection(terrain_dir)
    near_terrain = RasterCollection(pyramid_dir / "10m")
    far_terrain = RasterCollection(pyramid_dir / "90m")
    if not terrain.datasets or not near_terrain.datasets or not far_terrain.datasets:
        raise RuntimeError("panorama extraction requires 2m source plus prepared 10m and 90m terrain")
    source_versions = _extraction_source_versions(source_database, terrain, near_terrain, far_terrain)
    config = PanoramaConfig(angular_resolution_degrees=args.angular_resolution,
                            maximum_distance_meters=args.maximum_distance_meters)
    state = _open_state(root)
    rows: list[dict[str, object]] = []
    query = """SELECT b.row_id,b.id,b.latitude,b.longitude,e.elevation_meters
      FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE b.active=1"""
    parameters: tuple[object, ...] = ()
    if args.bench_id:
        placeholders = ",".join("?" for _ in args.bench_id)
        query += f" AND b.id IN ({placeholders})"
        parameters = tuple(args.bench_id)
    query += " ORDER BY CAST(b.longitude*20 AS INTEGER),CAST(b.latitude*20 AS INTEGER),b.row_id"
    for source_row in source_database.execute(query, parameters):
        row = dict(source_row)
        payload = {"id": row["id"], "latitude": row["latitude"], "longitude": row["longitude"],
                   "sources": source_versions, "config": config.model_dump(mode="json")}
        row["input_key"] = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        previous = state.execute("SELECT input_key,relative_path,sha256,status FROM extractions WHERE bench_id=?", (row["id"],)).fetchone()
        if previous and previous[0] == row["input_key"] and previous[3] == "ready":
            path = root / str(previous[1])
            if path.is_file() and _sha256(path) == previous[2]:
                continue
        rows.append(row)
        if args.limit and len(rows) >= args.limit:
            break
    source_database.close()
    terrain.close()
    near_terrain.close()
    far_terrain.close()
    total = int(state.execute("SELECT count(*) FROM extractions WHERE status='ready'").fetchone()[0]) + len(rows)
    completed = 0
    failed = 0
    started = time.monotonic()
    deadline = started + args.max_runtime_hours * 3600
    # Each worker's largest raster/semantic batch is budgeted at 4 GiB. This
    # caps planned concurrency under the requested shared-memory ceiling while
    # leaving macOS enough headroom for the UI and filesystem cache.
    memory_worker_limit = max(1, args.memory_limit_gib // 4)
    worker_count = min(12, max(1, args.cpu_workers), memory_worker_limit)
    io_per_worker = max(1, min(8, args.io_threads) // min(worker_count, max(1, args.io_threads)))
    executor = concurrent.futures.ProcessPoolExecutor(
        max_workers=worker_count,
        initializer=_extract_initializer,
        initargs=(str(Path(args.database).resolve()), str(terrain_dir), str(pyramid_dir), str(root),
                  config.model_dump(mode="json"), source_versions, io_per_worker),
    )
    iterator = iter(rows)
    pending: dict[concurrent.futures.Future[Extracted], dict[str, object]] = {}
    try:
        while len(pending) < worker_count * 2:
            try:
                row = next(iterator)
            except StopIteration:
                break
            pending[executor.submit(_extract_one, row)] = row
        while pending and time.monotonic() < deadline:
            done, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done:
                row = pending.pop(future)
                try:
                    result = future.result()
                    state.execute("""INSERT OR REPLACE INTO extractions
                      (bench_id,bench_row_id,latitude,longitude,input_key,geometry_key,relative_path,sha256,
                       artifact_bytes,status,attempts,finished_at,last_error)
                      VALUES(?,?,?,?,?,?,?,?,?,'ready',coalesce((SELECT attempts+1 FROM extractions WHERE bench_id=?),1),?,NULL)""", (
                        result.bench_id, result.bench_row_id, result.latitude, result.longitude, result.input_key,
                        result.geometry_key, result.relative_path, result.sha256, result.artifact_bytes,
                        result.bench_id, _now(),
                    ))
                    completed += 1
                except Exception as error:
                    failed += 1
                    state.execute("""INSERT INTO extractions
                      (bench_id,bench_row_id,latitude,longitude,input_key,status,attempts,finished_at,last_error)
                      VALUES(?,?,?,?,?,'error',1,?,?) ON CONFLICT(bench_id) DO UPDATE SET status='error',
                      attempts=attempts+1,finished_at=excluded.finished_at,last_error=excluded.last_error""", (
                        row["id"], row["row_id"], row["latitude"], row["longitude"], row["input_key"],
                        _now(), str(error)[:1000],
                    ))
                state.commit()
                if time.monotonic() < deadline:
                    try:
                        next_row = next(iterator)
                    except StopIteration:
                        continue
                    pending[executor.submit(_extract_one, next_row)] = next_row
    except KeyboardInterrupt:
        pass
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
        ready = int(state.execute("SELECT count(*) FROM extractions WHERE status='ready'").fetchone()[0])
        state.close()
    print(json.dumps({
        "selected": len(rows), "completed_this_run": completed, "failed_this_run": failed,
        "ready": ready, "expected": total, "elapsed_seconds": round(time.monotonic() - started, 3),
        "cpu_workers": worker_count, "io_threads": min(8, args.io_threads),
        "memory_budget_gib": args.memory_limit_gib,
        "accelerator": "cpu-vectorized-raster",
    }, indent=2, sort_keys=True))


def _selected_for_pilot(paths: list[Path], count: int) -> list[Path]:
    return sorted(paths, key=lambda path: hashlib.sha256(str(path).encode()).digest())[:count]


def _recommended_pvc(projected_peak: int) -> int:
    if projected_peak <= 68 * 1024**3:
        return DEFAULT_PVC_GIB
    required_gib = projected_peak * 1.2 / 1024**3
    return math.ceil(required_gib / 16) * 16


def _record_build(database: sqlite3.Connection, built: Built, generation: Path) -> None:
    for kind, relative, size in built.artifacts:
        path = generation / relative
        database.execute("""INSERT OR REPLACE INTO artifacts
          (source_path,bench_id,cell_id,kind,relative_path,sha256,artifact_bytes,source_bytes,status,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)""", (
            f"{built.source_path}:{kind}", built.bench_id, built.cell_id, kind, relative,
            _sha256(path), size, built.source_bytes, "ready", _now(),
        ))
    database.execute("""INSERT INTO cells(cell_id,status,attempts,finished_at) VALUES(?,'ready',1,?)
      ON CONFLICT(cell_id) DO UPDATE SET status='ready',attempts=attempts+1,finished_at=excluded.finished_at,last_error=NULL""",
      (built.cell_id, _now()))
    database.commit()


def _run_build(root: Path, sources: list[Path], workers: int, season: str) -> dict[str, int]:
    generation = root / "generation"
    state = _open_state(root)
    done = {row[0].rsplit(":", 1)[0] for row in state.execute("SELECT source_path FROM artifacts WHERE status='ready'")}
    pending = [path for path in sources if str(path) not in done]
    failed = 0
    try:
        # Spawn keeps Pillow/GDAL state isolated and saturates performance cores.
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
            future_paths = {pool.submit(_build_one, str(path), str(generation), season): path for path in pending}
            for future in concurrent.futures.as_completed(future_paths):
                path = future_paths[future]
                try:
                    _record_build(state, future.result(), generation)
                except Exception as error:
                    failed += 1
                    state.execute("""INSERT INTO cells(cell_id,status,attempts,last_error) VALUES(?,'error',1,?)
                      ON CONFLICT(cell_id) DO UPDATE SET status='error',attempts=attempts+1,last_error=excluded.last_error""",
                      (hashlib.sha256(str(path).encode()).hexdigest()[:12], str(error)[:1000]))
                    state.commit()
        complete = int(state.execute("SELECT count(DISTINCT source_path) FROM artifacts WHERE kind='capsule' AND status='ready'").fetchone()[0])
        return {"selected": len(sources), "previously_complete": len(sources) - len(pending), "complete": complete, "failed": failed}
    finally:
        state.close()


def panorama_pilot_job(args: Namespace) -> None:
    root = Path(args.root).resolve()
    sources = _discover_sources(Path(args.source_geometry).resolve())
    if not sources:
        raise RuntimeError("no prepared NPZ or BPC geometry was found")
    database = sqlite3.connect(Path(args.database).resolve())
    total = int(database.execute("SELECT count(*) FROM benches WHERE active=1").fetchone()[0])
    database.close()
    requested = max(1, math.ceil(total * .01))
    if len(sources) < math.ceil(requested * .8):
        raise RuntimeError(f"1% pilot needs about {requested} source capsules; found only {len(sources)}")
    chosen = _selected_for_pilot(sources, requested)
    started = time.monotonic()
    result = _run_build(root, chosen, min(args.cpu_workers, 12), args.season)
    state = _open_state(root)
    by_kind: dict[str, int] = {}
    for path in chosen:
        for kind, size in state.execute(
            "SELECT kind,artifact_bytes FROM artifacts WHERE source_path LIKE ? AND status='ready'", (f"{path}:%",)
        ):
            by_kind[str(kind)] = by_kind.get(str(kind), 0) + int(size)
    actual = sum(by_kind.values())
    projected_bench_bytes = round(actual / len(chosen) * total)
    projected_final = SHARED_MODEL_BUDGET_BYTES + projected_bench_bytes
    # Incoming plus active generation may coexist briefly. Source archives are
    # local-only and therefore deliberately excluded from the production peak.
    projected_peak = SHARED_MODEL_BUDGET_BYTES + projected_bench_bytes * 2
    recommended = _recommended_pvc(projected_peak)
    checkpoint = "1%"
    detail = {
        **result, "artifact_implementation": _artifact_implementation(), "render_key": RENDER_IMPLEMENTATION,
        "elapsed_seconds": round(time.monotonic() - started, 3), "artifact_bytes_by_kind": by_kind,
        "steady_target_bytes": STEADY_TARGET_BYTES, "warning_bytes": WARNING_BYTES,
        "minimum_free_bytes": MINIMUM_FREE_BYTES,
        "shared_model_budget_bytes": SHARED_MODEL_BUDGET_BYTES,
    }
    state.execute("INSERT OR REPLACE INTO reports VALUES(?,?,?,?,?,?,?,?,?)", (
        checkpoint, len(chosen), total, actual, projected_final, projected_peak, recommended, _now(),
        json.dumps(detail, sort_keys=True, separators=(",", ":")),
    ))
    state.commit()
    state.close()
    report = {"checkpoint": checkpoint, "actual_bytes": actual, "projected_final_bytes": projected_final,
              "projected_peak_bytes": projected_peak, "recommended_pvc_gib": recommended, **detail}
    report_path = root / "reports" / "storage-1-percent.json"
    _atomic(report_path, json.dumps(report, indent=2, sort_keys=True).encode() + b"\n")
    print(json.dumps(report, indent=2, sort_keys=True))


def panorama_build_job(args: Namespace) -> None:
    """Convert all prepared exact geometry into the production generation.

    Expensive geographic extraction can add BPC capsules to ``source_geometry``
    while this command is running; repeated invocations resume from hashes.
    CPU workers paint independent cells while the source producer may use its
    single MPS visibility process. This split prevents GPU/CPU oversubscription.
    """
    root = Path(args.root).resolve()
    sources = _discover_sources(Path(args.source_geometry).resolve())
    if not sources:
        raise RuntimeError("no prepared exact geometry found")
    result = _run_build(root, sources, min(args.cpu_workers, 12), args.season)
    state = _open_state(root)
    bytes_ready = int(state.execute("SELECT coalesce(sum(artifact_bytes),0) FROM artifacts WHERE status='ready'").fetchone()[0])
    state.close()
    print(json.dumps({**result, "bytes": bytes_ready, "root": str(root),
                      "artifact_implementation": _artifact_implementation()}, indent=2))


def _manifest(root: Path, database_path: Path, bench_index: Path | None = None) -> tuple[Path, dict[str, object]]:
    state = _open_state(root)
    records = [{"source_path": row[0], "geometry_key": row[1], "cell_id": row[2], "kind": row[3],
                "relative_path": row[4], "sha256": row[5], "bytes": row[6]}
               for row in state.execute("""SELECT source_path,bench_id,cell_id,kind,relative_path,sha256,artifact_bytes
                 FROM artifacts WHERE status='ready' ORDER BY kind,relative_path""")]
    extracted_by_geometry = {str(row[0]): {
        "geometry_key": str(row[0]), "bench_row_id": int(row[1]), "bench_id": str(row[2]),
        "bench_latitude": float(row[3]), "bench_longitude": float(row[4]),
    } for row in state.execute("""SELECT geometry_key,bench_row_id,bench_id,latitude,longitude FROM extractions
      WHERE status='ready' AND geometry_key IS NOT NULL""")}
    state.close()
    source_database = sqlite3.connect(database_path)
    source_database.row_factory = sqlite3.Row
    bench_by_geometry = {str(row["geometry_key"]): dict(row) for row in source_database.execute("""
      SELECT pg.geometry_key,b.row_id bench_row_id,b.id bench_id,b.latitude bench_latitude,b.longitude bench_longitude
      FROM bench_panorama_geometry pg JOIN benches b ON b.row_id=pg.bench_row_id
      WHERE b.active=1 AND pg.bench_id=b.id AND pg.bench_latitude=b.latitude AND pg.bench_longitude=b.longitude
    """)}
    source_database.close()
    production_by_bench: dict[str, dict[str, object]] = {}
    if bench_index and bench_index.exists():
        for line in bench_index.read_text().splitlines():
            geometry_key, bench_row_id, bench_id, latitude, longitude = line.split("\t")
            production = {
                "geometry_key": geometry_key, "bench_row_id": int(bench_row_id), "bench_id": bench_id,
                "bench_latitude": float(latitude), "bench_longitude": float(longitude),
            }
            production_by_bench[bench_id] = production
            if geometry_key:
                bench_by_geometry[geometry_key] = production
    bench_by_geometry.update(extracted_by_geometry)
    missing = sorted({str(item["geometry_key"]) for item in records} - bench_by_geometry.keys())
    # The resumable workspace can retain outputs for deleted/moved benches or
    # abandoned local fixtures. They are deliberately absent from a sealed
    # production manifest; every included artifact remains coordinate-bound.
    records = [item for item in records if str(item["geometry_key"]) not in missing]
    for item in records:
        item.update(bench_by_geometry[str(item["geometry_key"])])
        production = production_by_bench.get(str(item["bench_id"]))
        if production:
            item.update({key: production[key] for key in (
                "bench_row_id", "bench_id", "bench_latitude", "bench_longitude",
            )})
    preferred = {str(value["bench_id"]): key for key, value in extracted_by_geometry.items()}
    by_geometry: dict[str, list[dict[str, object]]] = {}
    for item in records:
        by_geometry.setdefault(str(item["geometry_key"]), []).append(item)
    selected: dict[str, tuple[int, str, list[dict[str, object]]]] = {}
    for geometry_key, items in by_geometry.items():
        bench_id = str(items[0]["bench_id"])
        rank = 0 if preferred.get(bench_id) == geometry_key else 1
        candidate = (rank, geometry_key, items)
        if bench_id not in selected or candidate[:2] < selected[bench_id][:2]:
            selected[bench_id] = candidate
    records = [item for _rank, _key, items in selected.values() for item in items]
    records.sort(key=lambda item: (str(item["kind"]), str(item["relative_path"])))
    git_commit = _git_commit()
    artifact_set = hashlib.sha256(json.dumps(records, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    generation_id = f"{git_commit[:12]}-{artifact_set[:16]}"
    payload: dict[str, object] = {
        "format": GENERATION_FORMAT, "schema": GENERATION_SCHEMA, "generation_id": generation_id,
        "git_commit": git_commit, "artifact_implementation": _artifact_implementation(),
        "geometry_implementation": GEOMETRY_IMPLEMENTATION, "render_implementation": RENDER_IMPLEMENTATION,
        "created_at": _now(), "artifacts": records,
        "artifact_count": len(records), "artifact_bytes": sum(int(item["bytes"]) for item in records),
        "ignored_unbound_artifacts": len(missing),
    }
    manifest = root / "generation" / "manifest.json"
    _atomic(manifest, json.dumps(payload, sort_keys=True, separators=(",", ":")).encode() + b"\n")
    checksum = _sha256(manifest)
    _atomic(root / "generation" / "manifest.sha256", f"{checksum}  manifest.json\n".encode())
    return manifest, payload


def panorama_manifest_job(args: Namespace) -> None:
    bench_index = Path(args.bench_index).resolve() if args.bench_index else None
    manifest, payload = _manifest(Path(args.root).resolve(), Path(args.database).resolve(), bench_index)
    print(json.dumps({"manifest": str(manifest), **{key: payload[key] for key in ("generation_id", "artifact_count", "artifact_bytes")}}, indent=2))


def panorama_verify_job(args: Namespace) -> None:
    root = Path(args.root).resolve() / "generation"
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest.get("format") != GENERATION_FORMAT or manifest.get("schema") != GENERATION_SCHEMA:
        raise RuntimeError("invalid panorama activation manifest")
    failures = []
    for record in manifest["artifacts"]:
        path = (root / record["relative_path"]).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size != record["bytes"] or _sha256(path) != record["sha256"]:
            failures.append(record["relative_path"])
            if len(failures) >= 10:
                break
    if failures:
        raise RuntimeError(f"artifact verification failed: {failures}")
    print(json.dumps({"verified": len(manifest["artifacts"]), "bytes": manifest["artifact_bytes"], "generation_id": manifest["generation_id"]}))


def _require_lan_target(target: str) -> None:
    if target != SERVER:
        raise RuntimeError(f"uploads are restricted to the LAN target {SERVER}")


def panorama_fetch_index_job(args: Namespace) -> None:
    """Fetch the small coordinate-bound production artifact index, not the DB."""
    _require_lan_target(args.target)
    query = ("SELECT coalesce(pg.geometry_key,''),b.row_id,b.id,b.latitude,b.longitude "
             "FROM benches b LEFT JOIN bench_panorama_geometry pg ON pg.bench_row_id=b.row_id "
             "AND pg.status='ready' AND pg.bench_id=b.id AND pg.bench_latitude=b.latitude "
             "AND pg.bench_longitude=b.longitude WHERE b.active=1;")
    remote = f"sqlite3 -separator {shlex.quote(chr(9))} {shlex.quote(args.remote_database)} {shlex.quote(query)}"
    result = subprocess.run(["ssh", args.target, remote], check=True, capture_output=True)
    lines = result.stdout.decode().splitlines()
    for line in lines:
        fields = line.split("\t")
        if len(fields) != 5 or (fields[0] and len(fields[0]) != 64):
            raise RuntimeError("invalid production bench index")
    destination = Path(args.output).resolve()
    _atomic(destination, result.stdout)
    print(json.dumps({"output": str(destination), "rows": len(lines), "target": args.target}))


def _rsync_command() -> str:
    candidates = ("/opt/homebrew/bin/rsync", "/usr/local/bin/rsync", shutil.which("rsync"))
    for candidate in candidates:
        if not candidate or not Path(candidate).is_file():
            continue
        result = subprocess.run([candidate, "--version"], check=True, capture_output=True, text=True)
        first = result.stdout.splitlines()[0]
        try:
            major = int(first.split("version", 1)[1].strip().split(".", 1)[0])
        except (IndexError, ValueError):
            continue
        if major >= 3:
            return candidate
    raise RuntimeError("rsync 3 or newer is required for resumable --append-verify uploads")


def panorama_upload_job(args: Namespace) -> None:
    _require_lan_target(args.target)
    root = Path(args.root).resolve()
    manifest = json.loads((root / "generation" / "manifest.json").read_text())
    generation_id = str(manifest["generation_id"])
    remote = f"{args.target}:{SERVER_ROOT}/incoming/{generation_id}/"
    subprocess.run(["ssh", args.target, "mkdir", "-p", str(SERVER_ROOT / "incoming" / generation_id)], check=True)
    rsync = _rsync_command()
    excludes = ("--exclude=manifest.json", "--exclude=manifest.sha256")
    subprocess.run([rsync, "-a", "--partial", "--append-verify", "--info=progress2", *excludes,
                    f"{root / 'generation'}/", remote], check=True)
    subprocess.run([rsync, "-a", "--partial", "--append-verify",
                    str(root / "generation" / "manifest.json"),
                    str(root / "generation" / "manifest.sha256"), remote], check=True)
    print(json.dumps({"uploaded": generation_id, "target": args.target, "bytes": manifest["artifact_bytes"]}))


def panorama_activate_job(args: Namespace) -> None:
    """Verify and activate on the server; execute there after the LAN upload."""
    root = Path(args.server_root).resolve()
    incoming = root / "incoming" / args.generation_id
    manifest_path = incoming / "manifest.json"
    expected = (incoming / "manifest.sha256").read_text().split()[0]
    if _sha256(manifest_path) != expected:
        raise RuntimeError("activation manifest checksum mismatch")
    manifest = json.loads(manifest_path.read_text())
    if (manifest.get("generation_id") != args.generation_id or manifest.get("format") != GENERATION_FORMAT
            or manifest.get("schema") != GENERATION_SCHEMA):
        raise RuntimeError("activation format or generation mismatch")
    for record in manifest["artifacts"]:
        path = (incoming / record["relative_path"]).resolve()
        if not path.is_relative_to(incoming) or path.stat().st_size != record["bytes"] or _sha256(path) != record["sha256"]:
            raise RuntimeError(f"invalid incoming artifact {record['relative_path']}")
    active = root / "active" / args.generation_id
    active.parent.mkdir(parents=True, exist_ok=True)
    if active.exists():
        raise RuntimeError(f"active generation path already exists: {active}")
    database = connect_database(Path(args.database).resolve())
    moved = False
    try:
        database.begin_immediate()
        active_bytes = int(database.execute(
            "SELECT coalesce(sum(artifact_bytes),0) FROM panorama_generations WHERE state='active'"
        ).fetchone()[0])
        logical_capacity = int(args.capacity_gib) * 1024**3
        activation_bytes = active_bytes + int(manifest["artifact_bytes"])
        if logical_capacity - activation_bytes < MINIMUM_FREE_BYTES:
            raise RuntimeError(
                f"activation needs 20 GiB logical headroom; {logical_capacity - activation_bytes} bytes remain"
            )
        if activation_bytes >= WARNING_BYTES:
            print(json.dumps({"warning": "panorama storage reached 60 GiB", "bytes": activation_bytes}), file=sys.stderr)
        bench_rows = {str(row[0]): (int(row[1]), float(row[2]), float(row[3])) for row in database.execute(
            "SELECT id,row_id,latitude,longitude FROM benches WHERE active=1"
        )}
        for record in manifest["artifacts"]:
            current = bench_rows.get(str(record["bench_id"]))
            expected_bench = (int(record["bench_row_id"]), float(record["bench_latitude"]), float(record["bench_longitude"]))
            if current != expected_bench:
                raise RuntimeError(f"bench changed since build: {record['bench_id']}")
        # The rename is atomic on the panorama filesystem. Do it while the DB
        # write lock is held, so the committed rows can never reference files
        # that are still in the incoming area.
        os.replace(incoming, active)
        moved = True
        activate_generation(database, manifest, expected, f"/panorama/active/{args.generation_id}")
        database.commit()
    except Exception:
        database.rollback()
        if moved and active.exists() and not incoming.exists():
            os.replace(active, incoming)
        raise
    finally:
        database.close()
    pointer = root / "current"
    temporary = root / f".current-{os.getpid()}"
    temporary.symlink_to(active)
    os.replace(temporary, pointer)
    # Forward-only policy: remove every superseded full generation now that
    # the transaction and pointer both identify the new, verified generation.
    for candidate in (root / "active").iterdir():
        if candidate != active and candidate.is_dir():
            shutil.rmtree(candidate)
    print(json.dumps({"activated": args.generation_id, "artifacts": manifest["artifact_count"], "rollback_generation": False}))


def panorama_status_job(args: Namespace) -> None:
    root = Path(args.root).resolve()
    state = _open_state(root)
    output = {
        "cells": dict(state.execute("SELECT status,count(*) FROM cells GROUP BY status")),
        "artifacts": dict(state.execute("SELECT kind,count(*) FROM artifacts WHERE status='ready' GROUP BY kind")),
        "bytes": int(state.execute("SELECT coalesce(sum(artifact_bytes),0) FROM artifacts WHERE status='ready'").fetchone()[0]),
        "reports": [{"checkpoint": row[0], "projected_final_bytes": row[1], "projected_peak_bytes": row[2], "recommended_pvc_gib": row[3]}
                    for row in state.execute("SELECT checkpoint,projected_final_bytes,projected_peak_bytes,recommended_pvc_gib FROM reports ORDER BY created_at")],
    }
    state.close()
    print(json.dumps(output, indent=2, sort_keys=True))


def panorama_reconcile_job(args: Namespace) -> None:
    """Release expired leases and enqueue benches in source-dirty 0.05° cells."""
    database = sqlite3.connect(Path(args.database).resolve(), timeout=60)
    database.row_factory = sqlite3.Row
    try:
        database.execute("BEGIN IMMEDIATE")
        database.execute("UPDATE panorama_dirty_cells SET lease_owner=NULL,lease_until=NULL WHERE lease_until<datetime('now')")
        cells = database.execute("""SELECT cell_id FROM panorama_dirty_cells
          WHERE lease_until IS NULL OR lease_until<datetime('now') ORDER BY priority,dirty_at LIMIT ?""", (args.max_cells,)).fetchall()
        queued = 0
        for cell in cells:
            west, south = (float(value) for value in str(cell["cell_id"]).split(":"))
            rows = database.execute("""SELECT row_id FROM benches WHERE active=1
              AND longitude>=? AND longitude<? AND latitude>=? AND latitude<?""", (west, west + .05, south, south + .05)).fetchall()
            for row in rows:
                database.execute("UPDATE bench_panorama_geometry SET status='stale',updated_at=? WHERE bench_row_id=?", (_now(), row["row_id"]))
                database.execute("""INSERT INTO bench_panorama_requests
                  (bench_row_id,requested_at,status,priority,attempts) VALUES(?,?,'pending',50,0)
                  ON CONFLICT(bench_row_id) DO UPDATE SET status='pending',priority=min(priority,50),
                    requested_at=excluded.requested_at,lease_owner=NULL,lease_until=NULL,next_attempt_at=NULL""", (row["row_id"], _now()))
                queued += 1
            database.execute("DELETE FROM panorama_dirty_cells WHERE cell_id=?", (cell["cell_id"],))
        database.commit()
        print(json.dumps({"cells": len(cells), "benches_queued": queued}))
    except Exception:
        database.rollback()
        raise
    finally:
        database.close()
