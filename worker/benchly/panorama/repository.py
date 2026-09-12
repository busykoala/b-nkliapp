"""Small SQLite state boundary; artifact bytes remain outside the main DB."""

from __future__ import annotations

import json

from sqlalchemy import delete, update
from sqlalchemy.dialects.sqlite import insert

from benchly.db import Database, write
from benchly.panorama.cache import render_cache_key
from benchly.panorama.models import BenchPanoramaGeometryState, BenchPanoramaRenderState, BenchPanoramaRequestState
from benchly.runtime import now_iso


def require_schema(database) -> None:
    required = {"bench_panorama_geometry", "bench_panorama_renders", "bench_panorama_requests"}
    present = {row[0] for row in database.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?)", tuple(required)
    )}
    missing = required - present
    if missing:
        raise RuntimeError(f"Panorama migration 0031 is required ({', '.join(sorted(missing))})")


def pending_benches(database, algorithm_version: str, limit: int):
    return database.execute("""
      SELECT b.row_id,b.id,b.latitude,b.longitude,b.material,b.backrest,b.armrest,b.covered,
        coalesce(b.direction_degrees,
          CASE WHEN de.bench_id=b.id AND de.bench_latitude=b.latitude AND de.bench_longitude=b.longitude
            THEN de.direction_degrees END, 0) effective_direction_degrees,
        e.elevation_meters
      FROM benches b
      LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
      LEFT JOIN bench_direction_estimates de ON de.bench_row_id=b.row_id
      LEFT JOIN bench_panorama_geometry p ON p.bench_row_id=b.row_id
      LEFT JOIN bench_panorama_requests request ON request.bench_row_id=b.row_id
      WHERE b.active=1 AND e.elevation_meters IS NOT NULL AND (
        p.bench_row_id IS NULL OR p.algorithm_version<>? OR p.status IN ('stale','error','unavailable')
        OR (p.status='generating' AND julianday(p.started_at)<julianday('now','-20 minutes'))
        OR p.bench_id<>b.id OR p.bench_latitude<>b.latitude OR p.bench_longitude<>b.longitude
      )
      ORDER BY CASE WHEN request.bench_row_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE p.status WHEN 'stale' THEN 0 WHEN 'error' THEN 2 ELSE 1 END,
        request.requested_at,b.row_id
      LIMIT ?
    """, (algorithm_version, limit)).fetchall()


def mark_generating(database: Database, row, geometry_key: str, source_versions: dict[str, str]) -> None:
    now = now_iso()
    record = BenchPanoramaGeometryState(
        bench_row_id=int(row["row_id"]), bench_id=str(row["id"]),
        bench_latitude=float(row["latitude"]), bench_longitude=float(row["longitude"]),
        geometry_key=geometry_key, status="generating", complete=False,
        source_versions_json=json.dumps(source_versions, separators=(",", ":")),
        algorithm_version=source_versions["algorithm"], warnings_json="[]",
        started_at=now, updated_at=now,
    )
    statement = insert(BenchPanoramaGeometryState).values(record.model_dump())
    excluded = statement.excluded
    write(database, statement.on_conflict_do_update(
        index_elements=[BenchPanoramaGeometryState.bench_row_id],
        set_={
            "bench_id": excluded.bench_id,
            "bench_latitude": excluded.bench_latitude,
            "bench_longitude": excluded.bench_longitude,
            "geometry_key": excluded.geometry_key,
            "artifact_path": None,
            "status": "generating",
            "complete": False,
            "source_versions_json": excluded.source_versions_json,
            "algorithm_version": excluded.algorithm_version,
            "warnings_json": "[]",
            "artifact_bytes": None,
            "started_at": excluded.started_at,
            "generated_at": None,
            "updated_at": excluded.updated_at,
            "error": None,
        },
    ))
    write(database, update(BenchPanoramaRequestState).where(
        BenchPanoramaRequestState.bench_row_id == int(row["row_id"]),
    ).values(
        attempts=BenchPanoramaRequestState.attempts + 1,
        last_attempt_at=now,
        last_error=None,
    ))
    database.commit()


def mark_ready(database: Database, bench_row_id: int, geometry_key: str, artifact_path: str,
               artifact_bytes: int, complete: bool, warnings: tuple[str, ...]) -> None:
    now = now_iso()
    write(database, update(BenchPanoramaGeometryState).where(
        BenchPanoramaGeometryState.bench_row_id == bench_row_id,
        BenchPanoramaGeometryState.geometry_key == geometry_key,
    ).values(
        artifact_path=artifact_path, status="ready", complete=complete,
        warnings_json=json.dumps(warnings, separators=(",", ":")), artifact_bytes=artifact_bytes,
        generated_at=now, updated_at=now, error=None,
    ))
    write(database, delete(BenchPanoramaRequestState).where(
        BenchPanoramaRequestState.bench_row_id == bench_row_id,
    ))
    database.commit()


def mark_failed(database: Database, bench_row_id: int, geometry_key: str, status: str, error: str) -> None:
    if status not in {"unavailable", "error"}:
        raise ValueError("invalid panorama failure status")
    write(database, update(BenchPanoramaGeometryState).where(
        BenchPanoramaGeometryState.bench_row_id == bench_row_id,
        BenchPanoramaGeometryState.geometry_key == geometry_key,
    ).values(status=status, updated_at=now_iso(), error=error[:1000]))
    write(database, update(BenchPanoramaRequestState).where(
        BenchPanoramaRequestState.bench_row_id == bench_row_id,
    ).values(last_error=error[:1000]))
    database.commit()


def mark_render_ready(database: Database, bench_row_id: int, identity, artifact_path: str, artifact_bytes: int) -> None:
    now = now_iso()
    record = BenchPanoramaRenderState(
        bench_row_id=bench_row_id, geometry_key=identity.geometry_key,
        render_key=render_cache_key(identity), artifact_path=artifact_path, status="ready",
        style_version=identity.style_version,
        center_azimuth_degrees=identity.center_azimuth_degrees,
        horizontal_fov_degrees=identity.horizontal_fov_degrees,
        width=identity.width, height=identity.height,
        weather_bucket=identity.weather_bucket, solar_lunar_bucket=identity.solar_lunar_bucket,
        bench_variant=identity.bench_variant, covered=identity.covered,
        artifact_bytes=artifact_bytes, generated_at=now, updated_at=now,
    )
    statement = insert(BenchPanoramaRenderState).values(record.model_dump(exclude={"id"}))
    excluded = statement.excluded
    write(database, statement.on_conflict_do_update(
        index_elements=[BenchPanoramaRenderState.render_key],
        set_={
            "artifact_path": excluded.artifact_path,
            "status": "ready",
            "artifact_bytes": excluded.artifact_bytes,
            "generated_at": excluded.generated_at,
            "updated_at": excluded.updated_at,
            "error": None,
        },
    ))
    database.commit()
