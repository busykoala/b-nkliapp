"""Bounded discovery workflow for open image providers."""

from __future__ import annotations

import math
import sqlite3
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta, timezone
from typing import Optional

from benchly.geo import bearing_degrees, circular_difference, distance_meters
from benchly.imagery.providers import DiscoveredImage, ProviderDelay
from benchly.imagery.repository import record_discovery, upsert_evidence, upsert_observation
from benchly.runtime import now_iso


def candidate_cells(connection: sqlite3.Connection, cell_degrees: float, limit: int,
                    bounds: Optional[tuple[float, float, float, float]] = None,
                    include_resolved: bool = False) -> list[sqlite3.Row]:
    bounds_clause = ""
    parameters: list[object] = [cell_degrees, cell_degrees]
    if bounds:
        bounds_clause = "AND b.longitude BETWEEN ? AND ? AND b.latitude BETWEEN ? AND ?"
        parameters.extend((bounds[0], bounds[2], bounds[1], bounds[3]))
    parameters.append(limit * 20)
    ambiguity_clause = "" if include_resolved else """AND lm.bench_row_id IS NULL AND (
          e.land_context IS NULL OR e.land_context IN ('unknown','mixed','forest_edge')
          OR e.canopy_context IS NULL
        )"""
    return connection.execute(f"""
        SELECT CAST(latitude / ? AS INTEGER) lat_cell,CAST(longitude / ? AS INTEGER) lon_cell,
          min(latitude) min_latitude,max(latitude) max_latitude,min(longitude) min_longitude,max(longitude) max_longitude
        FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
        LEFT JOIN bench_likely_metadata lm ON lm.bench_row_id=b.row_id
        WHERE b.active=1 {ambiguity_clause}
        {bounds_clause}
        GROUP BY lat_cell,lon_cell
        ORDER BY ((lat_cell * 1103515245 + lon_cell * 12345) & 2147483647)
        LIMIT ?
    """, parameters).fetchall()


def discover_images(connection: sqlite3.Connection, providers: Mapping[str, Callable],
                    swissimage_builder: Callable[[float, float], DiscoveredImage], *,
                    max_cells: int = 500, cell_degrees: float = 0.02,
                    requests_per_second: float = 1.0,
                    bounds: Optional[tuple[float, float, float, float]] = None,
                    include_resolved: bool = False) -> dict[str, int]:
    stats = {"cells": 0, "requests": 0, "images": 0, "links": 0, "failed": 0}
    cells_today = connection.execute("""
      SELECT count(DISTINCT cell_id) FROM image_discovery_cells
      WHERE discovered_at IS NOT NULL AND date(discovered_at)=date('now')
    """).fetchone()[0]
    max_cells = max(0, min(max_cells, 500 - int(cells_today)))
    if max_cells == 0:
        return stats
    minimum_interval = 1 / max(0.1, requests_per_second)
    failures: dict[str, int] = {provider: 0 for provider in providers}
    for cell in candidate_cells(connection, cell_degrees, max_cells, bounds, include_resolved):
        if stats["cells"] >= max_cells:
            break
        cell_id = f"{cell['lat_cell']}:{cell['lon_cell']}:{cell_degrees}"
        cell_bounds = (
            cell["lon_cell"] * cell_degrees, cell["lat_cell"] * cell_degrees,
            (cell["lon_cell"] + 1) * cell_degrees, (cell["lat_cell"] + 1) * cell_degrees,
        )
        expanded = (cell_bounds[0] - .004, cell_bounds[1] - .003, cell_bounds[2] + .004, cell_bounds[3] + .003)
        ground_images = 0
        processed_cell = False
        for provider, search in providers.items():
            if failures[provider] >= 3 or (provider == "SWISSIMAGE" and ground_images):
                continue
            previous = connection.execute(
                "SELECT status,discovered_at,retry_after FROM image_discovery_cells WHERE provider=? AND cell_id=?", (provider, cell_id),
            ).fetchone()
            if previous and previous["status"] == "completed" and previous["discovered_at"] and previous["discovered_at"] >= (datetime.now(timezone.utc) - timedelta(days=30)).isoformat():
                continue
            if previous and previous["status"] == "delayed" and previous["retry_after"] and previous["retry_after"] > now_iso():
                continue
            started = time.monotonic()
            processed_cell = True
            stats["requests"] += 1
            retry_after = None
            error_text = None
            try:
                if provider == "SWISSIMAGE":
                    ambiguous = connection.execute("""
                      SELECT b.latitude,b.longitude FROM benches b
                      WHERE b.active=1 AND b.latitude BETWEEN ? AND ? AND b.longitude BETWEEN ? AND ?
                        AND NOT EXISTS(
                          SELECT 1 FROM bench_image_evidence bie JOIN image_observations io ON io.id=bie.image_observation_id
                          WHERE bie.bench_row_id=b.row_id AND io.provider<>'SWISSIMAGE'
                        )
                      ORDER BY b.row_id LIMIT 4
                    """, (cell_bounds[1], cell_bounds[3], cell_bounds[0], cell_bounds[2])).fetchall()
                    images = [swissimage_builder(row["latitude"], row["longitude"]) for row in ambiguous]
                else:
                    images = search(expanded)
                images = [
                    image for image in images
                    if image.license and image.source_url.startswith("https://") and image.fetch_url.startswith("https://")
                ]
                failures[provider] = 0
                for image in images:
                    observation_id = upsert_observation(connection, {
                        "provider": image.provider, "provider_image_id": image.provider_image_id,
                        "capture_group_id": image.capture_group_id, "source_url": image.source_url,
                        "fetch_url": image.fetch_url, "latitude": image.latitude, "longitude": image.longitude,
                        "heading": image.heading, "captured_at": image.captured_at,
                        "author": image.author, "license": image.license, "discovered_at": now_iso(),
                    })
                    latitude_delta = 300 / 111_320
                    longitude_delta = 300 / (111_320 * max(.2, math.cos(math.radians(image.latitude))))
                    benches = connection.execute("""
                        SELECT row_id,latitude,longitude,direction_degrees FROM benches
                        WHERE active=1 AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
                    """, (image.latitude - latitude_delta, image.latitude + latitude_delta,
                          image.longitude - longitude_delta, image.longitude + longitude_delta)).fetchall()
                    for bench in benches:
                        distance = distance_meters(image.latitude, image.longitude, bench["latitude"], bench["longitude"])
                        if distance > 300:
                            continue
                        camera_to_bench = bearing_degrees(image.latitude, image.longitude, bench["latitude"], bench["longitude"])
                        bench_to_camera = bearing_degrees(bench["latitude"], bench["longitude"], image.latitude, image.longitude)
                        direct = int(
                            distance <= 150 and image.heading is not None and bench["direction_degrees"] is not None
                            and circular_difference(float(image.heading), camera_to_bench) <= 60
                            and circular_difference(float(bench["direction_degrees"]), bench_to_camera) <= 60
                        )
                        upsert_evidence(connection, {
                            "bench_row_id": bench["row_id"], "image_observation_id": observation_id,
                            "distance_meters": distance, "direct_view_eligible": direct,
                            "evidence_weight": max(.15, 1 - distance / 350),
                        })
                        stats["links"] += 1
                status = "completed"
                stats["images"] += len(images)
                if provider != "SWISSIMAGE":
                    ground_images += len(images)
            except ProviderDelay as error:
                images = []
                status, error_text = "delayed", str(error)
                retry_after = (datetime.now(timezone.utc) + timedelta(seconds=error.seconds)).isoformat()
                failures[provider] += 1
                stats["failed"] += 1
            except Exception as error:
                images = []
                status, error_text = "failed", str(error)[:500]
                failures[provider] += 1
                stats["failed"] += 1
            record_discovery(connection, {
                "provider": provider, "cell_id": cell_id,
                "min_latitude": cell_bounds[1], "max_latitude": cell_bounds[3],
                "min_longitude": cell_bounds[0], "max_longitude": cell_bounds[2],
                "status": status, "image_count": len(images), "attempts": 1,
                "last_error": error_text, "discovered_at": now_iso(), "retry_after": retry_after,
            })
            connection.commit()
            time.sleep(max(0, minimum_interval - (time.monotonic() - started)))
        stats["cells"] += int(processed_cell)
    return stats
