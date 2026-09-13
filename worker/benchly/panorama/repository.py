"""Small SQLite state boundary; artifact bytes remain outside the main DB."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, update
from sqlalchemy.dialects.sqlite import insert

from benchly.db import Database, write
from benchly.panorama.cache import render_cache_key
from benchly.panorama.models import (
    BenchPanoramaGeometryState,
    BenchPanoramaLightMapState,
    BenchPanoramaRenderState,
    BenchPanoramaRequestState,
)
from benchly.runtime import now_iso


def require_schema(database) -> None:
    required = {"bench_panorama_geometry", "bench_panorama_renders", "bench_panorama_requests", "bench_panorama_lightmaps"}
    present = {row[0] for row in database.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?,?)", tuple(required)
    )}
    missing = required - present
    if missing:
        raise RuntimeError(f"Panorama migration 0033 is required ({', '.join(sorted(missing))})")


def pending_benches(
    database,
    algorithm_version: str,
    source_versions: dict[str, str],
    render_style_version: str,
    render_width: int,
    render_height: int,
    season_bucket: str,
    limit: int,
    shard_index: int = 0,
    shard_count: int = 1,
):
    source_versions_json = json.dumps(source_versions, separators=(",", ":"))
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
      WHERE b.active=1 AND (b.row_id % ?) = ?
        AND (request.bench_row_id IS NULL OR (
          (request.next_attempt_at IS NULL OR julianday(request.next_attempt_at)<=julianday('now'))
          AND (request.status<>'leased' OR request.lease_until IS NULL OR julianday(request.lease_until)<=julianday('now'))
        )) AND (
        request.bench_row_id IS NOT NULL
        OR p.bench_row_id IS NULL OR p.algorithm_version<>? OR p.source_versions_json<>?
        OR p.status IN ('stale','error','unavailable')
        OR (p.status='generating' AND julianday(p.started_at)<julianday('now','-20 minutes'))
        OR p.bench_id<>b.id OR p.bench_latitude<>b.latitude OR p.bench_longitude<>b.longitude
        OR NOT EXISTS (
          SELECT 1 FROM bench_panorama_renders render
          WHERE render.bench_row_id=b.row_id AND render.geometry_key=p.geometry_key
            AND render.status='ready' AND render.style_version=?
            AND render.center_azimuth_degrees=0 AND render.horizontal_fov_degrees=360
            AND render.width=? AND render.height=?
            AND render.artifact_format='webp' AND render.season_bucket=?
            AND render.weather_bucket='dynamic-client-v1'
            AND render.solar_lunar_bucket='dynamic-client-v1'
            AND render.bench_variant='overlay-v1' AND render.covered IS NULL
        )
      )
      ORDER BY CASE WHEN request.bench_row_id IS NOT NULL THEN 0 ELSE 1 END,
        request.priority,
        CASE p.status WHEN 'stale' THEN 0 WHEN 'error' THEN 2 ELSE 1 END,
        request.requested_at,b.row_id
      LIMIT ?
    """, (
        shard_count, shard_index, algorithm_version, source_versions_json, render_style_version,
        render_width, render_height, season_bucket, limit,
    )).fetchall()


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
        status="leased",
        lease_owner=f"panorama-{os.getpid()}",
        lease_until=(datetime.now(UTC) + timedelta(minutes=20)).isoformat(),
        attempts=BenchPanoramaRequestState.attempts + 1,
        last_attempt_at=now,
        last_error=None,
    ))
    database.commit()


def install_fixture_geometry(database: Database, row, geometry, artifact_path: str, artifact_bytes: int) -> None:
    """Install immutable cached geometry for the local, offline review harness."""
    now = now_iso()
    record = BenchPanoramaGeometryState(
        bench_row_id=int(row["row_id"]), bench_id=str(row["id"]),
        bench_latitude=float(row["latitude"]), bench_longitude=float(row["longitude"]),
        geometry_key=geometry.identity_key, artifact_path=artifact_path, status="ready",
        complete=bool(geometry.complete),
        source_versions_json=json.dumps(
            {item.source: item.version for item in geometry.sources}, separators=(",", ":")
        ),
        algorithm_version=geometry.version,
        warnings_json=json.dumps(geometry.warnings, separators=(",", ":")),
        artifact_bytes=artifact_bytes, generated_at=now, updated_at=now,
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
            "artifact_path": excluded.artifact_path,
            "status": "ready",
            "complete": excluded.complete,
            "source_versions_json": excluded.source_versions_json,
            "algorithm_version": excluded.algorithm_version,
            "warnings_json": excluded.warnings_json,
            "artifact_bytes": excluded.artifact_bytes,
            "started_at": None,
            "generated_at": excluded.generated_at,
            "updated_at": excluded.updated_at,
            "error": None,
        },
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
    database.commit()


def mark_failed(database: Database, bench_row_id: int, geometry_key: str, status: str, error: str) -> None:
    if status not in {"unavailable", "error"}:
        raise ValueError("invalid panorama failure status")
    write(database, update(BenchPanoramaGeometryState).where(
        BenchPanoramaGeometryState.bench_row_id == bench_row_id,
        BenchPanoramaGeometryState.geometry_key == geometry_key,
    ).values(status=status, updated_at=now_iso(), error=error[:1000]))
    _schedule_retry(database, bench_row_id, error, timedelta(minutes=5), increment=False)
    database.commit()


def mark_request_retry(database: Database, bench_row_id: int, error: str) -> None:
    """Release an on-demand request when geometry cannot even be identified."""
    _schedule_retry(database, bench_row_id, error, timedelta(minutes=30), increment=True)
    database.commit()


def _schedule_retry(database: Database, bench_row_id: int, error: str, delay: timedelta, increment: bool) -> None:
    now = datetime.now(UTC)
    record = BenchPanoramaRequestState(
        bench_row_id=bench_row_id, requested_at=now.isoformat(), status="retry", priority=100,
        next_attempt_at=(now + delay).isoformat(), attempts=1, last_attempt_at=now.isoformat(),
        last_error=error[:1000],
    )
    statement = insert(BenchPanoramaRequestState).values(record.model_dump())
    excluded = statement.excluded
    values = {
        "status": "retry", "lease_owner": None, "lease_until": None,
        "next_attempt_at": excluded.next_attempt_at,
        "last_attempt_at": excluded.last_attempt_at,
        "last_error": excluded.last_error,
    }
    if increment:
        values["attempts"] = BenchPanoramaRequestState.attempts + 1
    write(database, statement.on_conflict_do_update(
        index_elements=[BenchPanoramaRequestState.bench_row_id], set_=values,
    ))


def mark_render_ready(database: Database, bench_row_id: int, identity, artifact_path: str, artifact_bytes: int) -> None:
    now = now_iso()
    record = BenchPanoramaRenderState(
        bench_row_id=bench_row_id, geometry_key=identity.geometry_key,
        render_key=render_cache_key(identity), artifact_path=artifact_path, status="ready",
        style_version=identity.style_version,
        season_bucket=identity.season_bucket,
        artifact_format="webp",
        source_completeness="complete" if identity.source_completeness else "partial",
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
            "season_bucket": excluded.season_bucket,
            "artifact_format": excluded.artifact_format,
            "source_completeness": excluded.source_completeness,
            "artifact_bytes": excluded.artifact_bytes,
            "generated_at": excluded.generated_at,
            "updated_at": excluded.updated_at,
            "error": None,
        },
    ))
    # A request is fulfilled only after the browser-consumable render exists.
    # Keeping it through geometry generation makes renderer failures retryable.
    write(database, delete(BenchPanoramaRequestState).where(
        BenchPanoramaRequestState.bench_row_id == bench_row_id,
    ))
    database.commit()


def mark_lightmap_ready(database: Database, bench_row_id: int, identity, light_key: str, artifact_path: str,
                        artifact_bytes: int) -> None:
    now = datetime.now(UTC)
    record = BenchPanoramaLightMapState(
        bench_row_id=bench_row_id,
        geometry_key=identity.geometry_key,
        light_key=light_key,
        solar_bucket=identity.solar_bucket,
        sun_azimuth_degrees=identity.sun_azimuth_degrees,
        sun_altitude_degrees=identity.sun_altitude_degrees,
        artifact_path=artifact_path,
        status="ready",
        artifact_bytes=artifact_bytes,
        generated_at=now.isoformat(),
        expires_at=(now + timedelta(hours=48)).isoformat(),
        updated_at=now.isoformat(),
    )
    statement = insert(BenchPanoramaLightMapState).values(record.model_dump(exclude={"id"}))
    excluded = statement.excluded
    write(database, statement.on_conflict_do_update(
        index_elements=[BenchPanoramaLightMapState.light_key],
        set_={
            "artifact_path": excluded.artifact_path,
            "status": "ready",
            "artifact_bytes": excluded.artifact_bytes,
            "generated_at": excluded.generated_at,
            "expires_at": excluded.expires_at,
            "updated_at": excluded.updated_at,
            "error": None,
        },
    ))
    database.commit()


def delete_expired_lightmaps(database: Database, now: str) -> list[str]:
    rows = database.execute(
        "SELECT artifact_path FROM bench_panorama_lightmaps WHERE expires_at<? AND artifact_path IS NOT NULL",
        (now,),
    ).fetchall()
    database.execute("DELETE FROM bench_panorama_lightmaps WHERE expires_at<?", (now,))
    database.commit()
    return [str(row["artifact_path"]) for row in rows]
