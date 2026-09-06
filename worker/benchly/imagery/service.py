"""Bounded open-imagery discovery and scene analysis orchestration.

Image bytes exist only in local variables for the duration of one inference call.
They are never written to SQLite, a file, or an application media row.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from typing import Optional, Sequence

from benchly.catalog import load_catalog
from benchly.imagery.client import DEFAULT_MODEL, _request_json, download_image, infer_scene_frames
from benchly.imagery.discovery import discover_images
from benchly.imagery.providers import (
    DiscoveredImage,
    search_commons as provider_search_commons,
    search_kartaview as provider_search_kartaview,
    search_panoramax as provider_search_panoramax,
    search_swissimage,
    swissimage_at,
)
from benchly.imagery.repository import (
    mark_analyzed,
    mark_grouped,
    mark_retry,
)
from benchly.runtime import now_iso

_RUNTIME = load_catalog().runtime
_PROVIDERS = load_catalog().providers
PROMPT_VERSION = _RUNTIME.scenePromptVersion


def search_panoramax(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    return provider_search_panoramax(bounds, _request_json)


def search_commons(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    return provider_search_commons(bounds, _request_json)


def search_kartaview(bounds: tuple[float, float, float, float]) -> list[DiscoveredImage]:
    return provider_search_kartaview(bounds, _request_json)


PROVIDERS = {
    "Panoramax": search_panoramax,
    "Wikimedia Commons": search_commons,
    "KartaView": search_kartaview,
    "SWISSIMAGE": search_swissimage,
}


def discover_open_images(connection: sqlite3.Connection, max_cells: int = 500, cell_degrees: float = 0.02,
                         requests_per_second: float = 1.0,
                         bounds: Optional[tuple[float, float, float, float]] = None,
                         include_resolved: bool = False) -> dict[str, int]:
    return discover_images(
        connection,
        PROVIDERS,
        swissimage_at,
        max_cells=max_cells,
        cell_degrees=cell_degrees,
        requests_per_second=requests_per_second,
        bounds=bounds,
        include_resolved=include_resolved,
    )


def _diverse_frames(rows: Sequence[sqlite3.Row], maximum: int = 4) -> list[sqlite3.Row]:
    selected: list[sqlite3.Row] = []
    buckets: set[object] = set()
    for row in rows:
        bucket: object = round(float(row["heading"]) / 45) % 8 if row["heading"] is not None else row["id"]
        if bucket in buckets:
            continue
        buckets.add(bucket)
        selected.append(row)
        if len(selected) == maximum:
            break
    return selected


def analyze_scenes(connection: sqlite3.Connection, limit: int, deadline: float, requests_per_second: float = .25,
                   bounds: Optional[tuple[float, float, float, float]] = None) -> dict[str, int]:
    endpoint = os.environ.get("INFERENCE_BASE_URL", str(_PROVIDERS.inferenceDefaultUrl))
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    model = os.environ.get("BENCHLY_VISION_MODEL", DEFAULT_MODEL)
    if not api_key:
        raise RuntimeError("INFERENCE_API_KEY is required")
    groups_today = connection.execute("""
      SELECT count(*) FROM (
        SELECT provider,capture_group_id FROM image_observations
        WHERE analyzed_at IS NOT NULL AND date(analyzed_at)=date('now')
        GROUP BY provider,capture_group_id
      )
    """).fetchone()[0]
    limit = max(0, min(limit, 300 - int(groups_today)))
    target_join = ""
    target_clause = ""
    parameters: list[object] = []
    if bounds:
        target_join = """JOIN bench_image_evidence target_e ON target_e.image_observation_id=image_observations.id
          JOIN benches target_b ON target_b.row_id=target_e.bench_row_id"""
        target_clause = "AND target_b.longitude BETWEEN ? AND ? AND target_b.latitude BETWEEN ? AND ?"
        parameters.extend((bounds[0], bounds[2], bounds[1], bounds[3]))
    parameters.append(limit)
    groups = connection.execute(f"""
        SELECT provider,capture_group_id,min(discovered_at) discovered_at
        FROM image_observations {target_join}
        WHERE analysis_status IN ('pending','retry') AND attempts<3
          AND coalesce(license,'')<>'' AND source_url LIKE 'https://%' AND fetch_url LIKE 'https://%'
          {target_clause}
        GROUP BY provider,capture_group_id ORDER BY discovered_at LIMIT ?
    """, parameters).fetchall()
    stats = {"groups": 0, "images": 0, "failed": 0, "irrelevant": 0}
    minimum_interval = 1 / max(.05, requests_per_second)
    last_image_request = 0.0
    for group in groups:
        if time.monotonic() >= deadline:
            break
        rows = connection.execute("""
            SELECT o.*,coalesce(min(e.distance_meters),999) nearest_bench
            FROM image_observations o LEFT JOIN bench_image_evidence e ON e.image_observation_id=o.id
            WHERE o.provider=? AND o.capture_group_id=?
              AND coalesce(o.license,'')<>'' AND o.source_url LIKE 'https://%' AND o.fetch_url LIKE 'https://%'
            GROUP BY o.id ORDER BY nearest_bench,o.id
        """, (group["provider"], group["capture_group_id"])).fetchall()
        frames = _diverse_frames(rows)
        started = time.monotonic()
        try:
            in_memory: list[tuple[bytes, str]] = []
            for row in frames:
                time.sleep(max(0, minimum_interval - (time.monotonic() - last_image_request)))
                last_image_request = time.monotonic()
                in_memory.append(download_image(row["fetch_url"]))
            hashes = [hashlib.sha256(payload).hexdigest() for payload, _ in in_memory]
            predictions = None
            for attempt in range(2):
                try:
                    predictions = infer_scene_frames(in_memory, endpoint, api_key, model)
                    break
                except (ValueError, json.JSONDecodeError):
                    if attempt:
                        raise
            assert predictions is not None
            relevant_count = 0
            for index, (row, prediction) in enumerate(zip(frames, predictions)):
                relevant = prediction["relevance_probability"] >= .55 and prediction["rejection_reason"] == "none"
                status = "analyzed" if relevant else "irrelevant"
                mark_analyzed(connection, row["id"], {
                    "analysis_status": status,
                    "relevance_probability": prediction["relevance_probability"],
                    "predictions": json.dumps(prediction, separators=(",", ":")),
                    "image_sha256": hashes[index],
                    "model_version": model,
                    "prompt_version": PROMPT_VERSION,
                    "analyzed_at": now_iso(),
                })
            # Frames not selected are redundant members of the same capture group.
            selected_ids = {row["id"] for row in frames}
            mark_grouped(
                connection,
                [row["id"] for row in rows if row["id"] not in selected_ids],
                model,
                PROMPT_VERSION,
                now_iso(),
            )
            stats["groups"] += 1
            stats["images"] += len(frames)
            relevant_count = sum(
                prediction["relevance_probability"] >= .55 and prediction["rejection_reason"] == "none"
                for prediction in predictions
            )
            stats["irrelevant"] += len(frames) - relevant_count
        except Exception as error:
            mark_retry(connection, [row["id"] for row in frames], str(error))
            stats["failed"] += 1
        finally:
            # No image object escapes this iteration; CPython releases the byte buffers here.
            connection.commit()
            time.sleep(max(0, minimum_interval - (time.monotonic() - started)))
    return stats
