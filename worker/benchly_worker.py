#!/usr/bin/env python3
"""Benchly's resumable OSM import and terrain-enrichment worker.

The web app never imports this module. Heavy GIS packages stay in the worker image;
the only shared artifact is the SQLite file on the persistent volume.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
import os
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional, Sequence

from environment_geometry import (
    canopy_neighborhood,
    classify_official_layer,
    deterministic_environment,
    feature_angular_half_width,
    feature_contains_exact,
    feature_distance_exact,
    feature_nearest_location,
    feature_bounds_wgs84,
    geopackage_layers,
    geometry_wkb_from_coordinates,
    geometry_wkb_from_geojson,
    iter_layer_features,
    point_hits_exact_building,
    project_wgs84_wkb,
)
from visual_pipeline import analyze_scenes, audit_environment, benchmark_models, discover_open_images, reconcile_environment

DEFAULT_PBF = "https://download.geofabrik.de/europe/switzerland-latest.osm.pbf"
PIPELINE_VERSION = "3.0.0"
PROFILE_PIPELINE_VERSION = "geo-admin-horizon-1.0"
PROFILE_DISTANCES_METERS = (10, 25, 50, 75, 100, 150, *range(200, 20_001, 200))
PROFILE_BEARING_GROUPS = (tuple(range(0, 180, 5)), tuple(range(180, 360, 5)))
KEEP_TAGS = {
    "amenity", "backrest", "armrest", "seats", "material", "direction", "covered",
    "wheelchair", "operator", "description", "image", "wikimedia_commons", "mapillary",
    "weather_protection", "surface", "colour", "access", "start_date",
}
CONTEXT_TAGS = KEEP_TAGS | {
    "building", "building:levels", "height", "roof:height", "natural", "water", "waterway",
    "landuse", "leisure", "highway", "name", "leaf_type", "leaf_cycle",
}
MAJOR_ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary"}
PATHS = {"footway", "path", "pedestrian", "track", "steps", "bridleway", "cycleway"}


@contextmanager
def exclusive_worker_lock(database: Path):
    """Prevent independent CronJobs from writing the shared SQLite file together."""
    lock_path = database.with_name(".benchly-worker.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        try:
            handle.seek(0)
            handle.truncate()
            handle.write(f"{os.getpid()} {now_iso()}\n")
            handle.flush()
            yield True
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_bool(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {"yes", "true", "1", "designated"}:
        return 1
    if normalized in {"no", "false", "0"}:
        return 0
    return None


CARDINAL = {
    "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5,
    "SE": 135, "SSE": 157.5, "S": 180, "SSW": 202.5, "SW": 225,
    "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
}


def parse_direction(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    normalized = value.strip().upper()
    if normalized in CARDINAL:
        return CARDINAL[normalized]
    try:
        return float(normalized.rstrip("°")) % 360
    except ValueError:
        return None


def parse_height(tags: dict[str, str]) -> Optional[float]:
    value = tags.get("height")
    if value:
        try:
            normalized = value.lower().replace("meters", "").replace("meter", "").replace("m", "").strip()
            return max(0.0, min(300.0, float(normalized)))
        except ValueError:
            pass
    levels = tags.get("building:levels")
    if levels:
        try:
            return max(2.5, min(300.0, float(levels) * 3.1 + float(tags.get("roof:height", "0").rstrip("m") or 0)))
        except ValueError:
            pass
    return None


def context_kind(tags: dict[str, str]) -> Optional[str]:
    if tags.get("building") not in {None, "no"}:
        return "building"
    if tags.get("natural") == "tree":
        return "tree"
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or tags.get("landuse") in {"reservoir", "basin"}:
        return "water"
    if tags.get("natural") == "wood" or tags.get("landuse") == "forest":
        return "forest"
    if tags.get("highway") in MAJOR_ROADS:
        return "major_road"
    if tags.get("highway") in PATHS:
        return "path"
    return None


def score_view(openness: float, relief: float, water: float, naturalness: float, remoteness: float) -> int:
    values = [max(0.0, min(1.0, item)) for item in (openness, relief, water, naturalness, remoteness)]
    return round(100 * (0.35 * values[0] + 0.25 * values[1] + 0.15 * values[2] + 0.15 * values[3] + 0.10 * values[4]))


def connect_database(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise RuntimeError(f"Database does not exist: {path}. Run `npm run db:migrate` first.")
    connection = sqlite3.connect(path, timeout=30)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=30000")
    connection.row_factory = sqlite3.Row
    required = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='benches'").fetchone()
    if not required:
        raise RuntimeError("Benchly schema is missing. Run the app migration first.")
    return connection


def begin_run(connection: sqlite3.Connection, kind: str, source_version: Optional[str] = None) -> int:
    cursor = connection.execute(
        "INSERT INTO pipeline_runs(kind,status,source_version,pipeline_version,started_at) VALUES(?,?,?,?,?)",
        (kind, "running", source_version, PIPELINE_VERSION, now_iso()),
    )
    connection.commit()
    return int(cursor.lastrowid)


def finish_run(connection: sqlite3.Connection, run_id: int, status: str, stats: dict) -> None:
    connection.execute(
        "UPDATE pipeline_runs SET status=?, stats=?, finished_at=? WHERE id=?",
        (status, json.dumps(stats, separators=(",", ":")), now_iso(), run_id),
    )
    connection.commit()


def download_file(url: str, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (+https://github.com/benchly)"})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
        version = response.headers.get("Last-Modified") or response.headers.get("ETag") or now_iso()
    temporary.replace(destination)
    return version


def discover_swisstlm_asset() -> tuple[str, str]:
    endpoint = os.environ.get(
        "SWISSTLM_STAC_ITEMS",
        "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swisstlm3d/items?limit=100",
    )
    request = urllib.request.Request(endpoint, headers={"User-Agent": "Benchly/1.0 (official context import)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    candidates: list[tuple[str, str]] = []
    for item in payload.get("features", []):
        version = str(item.get("properties", {}).get("datetime") or item.get("id") or now_iso())
        for asset in (item.get("assets") or {}).values():
            href = str(asset.get("href") or "")
            label = f"{asset.get('title', '')} {href}".lower()
            if href.startswith("https://") and href.endswith(".zip") and any(token in label for token in ("gpkg", "geopackage", "lv95")):
                candidates.append((version, href))
    if not candidates:
        raise RuntimeError("No swissTLM3D GeoPackage archive found in the official STAC collection")
    return sorted(candidates, reverse=True)[0]


def _safe_extract_zip(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        root = destination.resolve()
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if root not in target.parents and target != root:
                raise RuntimeError("Unsafe path in swissTLM archive")
        bundle.extractall(destination)


def import_swisstlm_geopackage(
    connection: sqlite3.Connection,
    geopackage: Path,
    source_version: str,
    imported_at: Optional[str] = None,
    finalize: bool = True,
) -> dict[str, int]:
    imported_at = imported_at or now_iso()
    stats = {"building": 0, "forest": 0, "water": 0, "land_cover": 0, "skipped": 0}
    batch: list[tuple] = []
    land_batch: list[tuple] = []

    def flush() -> None:
        if batch:
            connection.executemany("""
              INSERT INTO environment_features(source,source_id,kind,subtype,center_latitude,center_longitude,
                min_latitude,max_latitude,min_longitude,max_longitude,height_meters,raw_tags,imported_at,
                geometry_wkb,geometry_crs,source_version,source_updated_at)
              VALUES('swissTLM3D',?,?,?,?,?,?,?,?,?,?,?,?,?,2056,?,?)
              ON CONFLICT(source,source_id,kind) DO UPDATE SET subtype=excluded.subtype,
                center_latitude=excluded.center_latitude,center_longitude=excluded.center_longitude,
                min_latitude=excluded.min_latitude,max_latitude=excluded.max_latitude,
                min_longitude=excluded.min_longitude,max_longitude=excluded.max_longitude,
                height_meters=excluded.height_meters,raw_tags=excluded.raw_tags,imported_at=excluded.imported_at,
                geometry_wkb=excluded.geometry_wkb,geometry_crs=excluded.geometry_crs,
                source_version=excluded.source_version,source_updated_at=excluded.source_updated_at
            """, batch)
            batch.clear()
        if land_batch:
            connection.executemany("""
              INSERT INTO land_cover_features(source,source_id,class,geometry_wkb,geometry_crs,
                min_latitude,max_latitude,min_longitude,max_longitude,source_version,source_updated_at,imported_at)
              VALUES('swissTLM3D',?,?,?,2056,?,?,?,?,?,?,?)
              ON CONFLICT(source,source_id,class) DO UPDATE SET geometry_wkb=excluded.geometry_wkb,
                min_latitude=excluded.min_latitude,max_latitude=excluded.max_latitude,
                min_longitude=excluded.min_longitude,max_longitude=excluded.max_longitude,
                source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,
                imported_at=excluded.imported_at
            """, land_batch)
            land_batch.clear()
        connection.commit()

    for layer in geopackage_layers(geopackage):
        layer_hint, _ = classify_official_layer(layer, {})
        if layer_hint is None and not any(token in layer.lower() for token in ("wald", "wasser", "gewaesser", "gebäude", "gebaeude", "bodenbedeck", "landcover")):
            continue
        for offset, feature in enumerate(iter_layer_features(geopackage, layer)):
            geometry_json = feature.get("geometry")
            properties = feature.get("properties") or {}
            table, kind_or_class = classify_official_layer(layer, properties)
            if not geometry_json or not table or not kind_or_class:
                stats["skipped"] += 1
                continue
            try:
                geometry = geometry_wkb_from_geojson(geometry_json)
                min_lon, min_lat, max_lon, max_lat = feature_bounds_wgs84(geometry)
            except Exception:
                stats["skipped"] += 1
                continue
            if max_lat < 45.7 or min_lat > 47.9 or max_lon < 5.7 or min_lon > 10.7:
                continue
            raw_source_id = feature.get("id") or properties.get("UUID") or properties.get("uuid") or offset
            source_id = f"{layer}:{raw_source_id}"
            if table == "land_cover":
                land_batch.append((source_id, kind_or_class, geometry, min_lat, max_lat, min_lon, max_lon, source_version, imported_at, imported_at))
                stats["land_cover"] += 1
            else:
                height = parse_height({str(key).lower(): str(value) for key, value in properties.items() if value is not None})
                batch.append((source_id, kind_or_class, kind_or_class, (min_lat + max_lat) / 2, (min_lon + max_lon) / 2,
                              min_lat, max_lat, min_lon, max_lon, height,
                              json.dumps(properties, ensure_ascii=False, separators=(",", ":")), imported_at,
                              geometry, source_version, imported_at))
                stats[kind_or_class] += 1
            if len(batch) + len(land_batch) >= 1000:
                flush()
    flush()
    if finalize:
        finalize_swisstlm_import(connection, imported_at)
    return stats


def finalize_swisstlm_import(connection: sqlite3.Connection, imported_at: str) -> None:
    """Publish one complete swissTLM generation after every archive part was imported."""
    connection.execute("DELETE FROM environment_features WHERE source='swissTLM3D' AND imported_at<>?", (imported_at,))
    connection.execute("DELETE FROM land_cover_features WHERE source='swissTLM3D' AND imported_at<>?", (imported_at,))
    connection.execute("""
      UPDATE bench_enrichments SET environment_computed_at=NULL,pipeline_version=NULL,context_source_version=NULL
    """)
    connection.commit()


def download_stac_tiles(connection: sqlite3.Connection, collection: str, destination: Path,
                        max_tiles: Optional[int] = None,
                        bounds: Optional[tuple[float, float, float, float]] = None,
                        max_bytes: Optional[int] = None) -> int:
    """Download STAC assets for a bounded batch, with hard tile and byte limits."""
    destination.mkdir(parents=True, exist_ok=True)
    parameters = {"limit": "100"}
    if bounds:
        parameters["bbox"] = ",".join(f"{value:.7f}" for value in bounds)
    url = (
        f"https://data.geo.admin.ch/api/stac/v0.9/collections/{collection}/items?"
        + urllib.parse.urlencode(parameters)
    )
    downloaded = 0
    downloaded_bytes = 0
    seen_assets: set[str] = set()
    while url and (max_tiles is None or downloaded < max_tiles):
        request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (swisstopo OGD enrichment)"})
        with urllib.request.urlopen(request, timeout=60) as response:
            page = json.load(response)
        for item in page.get("features", []):
            bbox = item.get("bbox")
            if not bbox or len(bbox) < 4:
                continue
            if bounds and (
                bbox[2] < bounds[0] or bbox[0] > bounds[2]
                or bbox[3] < bounds[1] or bbox[1] > bounds[3]
            ):
                continue
            if not bounds:
                needed = connection.execute("""
                    SELECT 1 FROM bench_spatial_index s JOIN benches b ON b.row_id=s.row_id
                    WHERE b.active=1 AND s.max_longitude>=? AND s.min_longitude<=?
                      AND s.max_latitude>=? AND s.min_latitude<=? LIMIT 1
                """, (bbox[0], bbox[2], bbox[1], bbox[3])).fetchone()
                if not needed:
                    continue
            candidates = []
            for asset in item.get("assets", {}).values():
                href = asset.get("href", "")
                media_type = asset.get("type", "")
                if href.lower().endswith((".tif", ".tiff", ".zip")) or "geotiff" in media_type.lower():
                    candidates.append(href)
            for href in candidates:
                if not href or href in seen_assets or (max_tiles is not None and downloaded >= max_tiles):
                    continue
                seen_assets.add(href)
                filename = Path(urllib.parse.urlparse(href).path).name
                target = destination / filename
                if not target.exists():
                    print(f"Downloading {collection}: {filename}", file=sys.stderr)
                    download_file(href, target)
                    downloaded_bytes += target.stat().st_size
                    if max_bytes is not None and downloaded_bytes > max_bytes:
                        target.unlink(missing_ok=True)
                        raise RuntimeError(
                            f"STAC download limit exceeded for {collection}: {max_bytes} bytes"
                        )
                    if target.suffix.lower() == ".zip":
                        with zipfile.ZipFile(target) as archive:
                            for member in archive.namelist():
                                if member.lower().endswith((".tif", ".tiff")):
                                    archive.extract(member, destination)
                        target.unlink()
                downloaded += 1
        next_link = next((link.get("href") for link in page.get("links", []) if link.get("rel") == "next"), None)
        url = urllib.parse.urljoin(url, next_link) if next_link else ""
    return downloaded


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
    row = connection.execute("""
        SELECT b.latitude,b.longitude
        FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
        WHERE b.active=1 AND (e.pipeline_version IS NULL OR e.pipeline_version<>?)
        ORDER BY coalesce(e.computed_at, ''), b.row_id
        LIMIT 1
    """, (PIPELINE_VERSION,)).fetchone()
    if not row:
        return None
    return spatial_cell_bounds(row["latitude"], row["longitude"], cell_degrees)


@dataclass
class ImportedBench:
    osm_type: str
    osm_id: int
    latitude: float
    longitude: float
    tags: dict[str, str]


@dataclass
class ImportedContext:
    osm_type: str
    osm_id: int
    kind: str
    center_latitude: float
    center_longitude: float
    min_latitude: float
    max_latitude: float
    min_longitude: float
    max_longitude: float
    tags: dict[str, str]
    geometry_wkb: Optional[bytes]


def import_osm(connection: sqlite3.Connection, pbf_path: Path, source_version: str = "local") -> tuple[int, int]:
    try:
        import osmium
    except ImportError as error:
        raise RuntimeError("The OSM import requires `pip install -r worker/requirements.txt`.") from error

    # Demo records make a fresh UI useful, but must never survive the first real import.
    connection.execute("DELETE FROM benches WHERE row_id IN (SELECT bench_row_id FROM bench_enrichments WHERE pipeline_version LIKE 'demo-%')")
    connection.commit()
    imported_at = now_iso()
    pending: list[ImportedBench] = []
    pending_context: list[ImportedContext] = []
    total = 0
    context_total = 0

    def flush() -> None:
        nonlocal total
        if not pending:
            return
        rows = []
        for bench in pending:
            tags = bench.tags
            rows.append((
                f"osm-{bench.osm_type}-{bench.osm_id}", bench.osm_type, bench.osm_id,
                bench.latitude, bench.longitude, parse_bool(tags.get("backrest")),
                parse_bool(tags.get("armrest")), parse_bool(tags.get("covered")),
                parse_bool(tags.get("wheelchair")),
                int(tags["seats"]) if tags.get("seats", "").isdigit() else None,
                tags.get("material"), parse_direction(tags.get("direction")), tags.get("operator"),
                tags.get("description"), json.dumps(tags, ensure_ascii=False, separators=(",", ":")),
                imported_at, imported_at,
            ))
        connection.executemany("""
            INSERT INTO benches(id,osm_type,osm_id,latitude,longitude,backrest,armrest,covered,wheelchair,seats,
                material,direction_degrees,operator,description,raw_tags,active,source_updated_at,imported_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
            ON CONFLICT(osm_type,osm_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,
                backrest=excluded.backrest,armrest=excluded.armrest,covered=excluded.covered,wheelchair=excluded.wheelchair,
                seats=excluded.seats,material=excluded.material,direction_degrees=excluded.direction_degrees,
                operator=excluded.operator,description=excluded.description,raw_tags=excluded.raw_tags,active=1,
                source_updated_at=excluded.source_updated_at,imported_at=excluded.imported_at
        """, rows)
        for bench in pending:
            bench_id = f"osm-{bench.osm_type}-{bench.osm_id}"
            row = connection.execute("SELECT row_id FROM benches WHERE id=?", (bench_id,)).fetchone()
            if not row:
                continue
            connection.execute("DELETE FROM media WHERE bench_row_id=? AND relation='exact' AND provider IN ('OpenStreetMap image','Wikimedia Commons')", (row["row_id"],))
            image_url = bench.tags.get("image")
            if image_url and image_url.startswith(("https://", "http://")):
                connection.execute("""
                    INSERT OR IGNORE INTO media(bench_row_id,relation,provider,external_id,source_url,thumbnail_url,title,fetched_at)
                    VALUES(?, 'exact', 'OpenStreetMap image', ?, ?, ?, 'Bild der Sitzbank', ?)
                """, (row["row_id"], image_url, image_url, image_url, imported_at))
            commons = bench.tags.get("wikimedia_commons")
            if commons and commons.lower().startswith("file:"):
                filename = commons.split(":", 1)[1]
                encoded = urllib.parse.quote(filename.replace(" ", "_"))
                connection.execute("""
                    INSERT OR IGNORE INTO media(bench_row_id,relation,provider,external_id,source_url,thumbnail_url,title,fetched_at)
                    VALUES(?, 'exact', 'Wikimedia Commons', ?, ?, ?, ?, ?)
                """, (row["row_id"], commons,
                      f"https://commons.wikimedia.org/wiki/File:{encoded}",
                      f"https://commons.wikimedia.org/wiki/Special:Redirect/file/{encoded}?width=800",
                      filename, imported_at))
        connection.commit()
        total += len(rows)
        pending.clear()

    def flush_context() -> None:
        nonlocal context_total
        if not pending_context:
            return
        rows = []
        for item in pending_context:
            tags = item.tags
            rows.append((
                "OpenStreetMap", f"{item.osm_type}-{item.osm_id}", item.kind,
                tags.get("building") or tags.get("natural") or tags.get("water") or tags.get("highway") or tags.get("landuse"),
                item.center_latitude, item.center_longitude, item.min_latitude, item.max_latitude,
                item.min_longitude, item.max_longitude, parse_height(tags),
                json.dumps(tags, ensure_ascii=False, separators=(",", ":")), imported_at,
                item.geometry_wkb, source_version, imported_at,
            ))
        connection.executemany("""
            INSERT INTO environment_features(source,source_id,kind,subtype,center_latitude,center_longitude,
              min_latitude,max_latitude,min_longitude,max_longitude,height_meters,raw_tags,imported_at,
              geometry_wkb,source_version,source_updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(source,source_id,kind) DO UPDATE SET subtype=excluded.subtype,
              center_latitude=excluded.center_latitude,center_longitude=excluded.center_longitude,
              min_latitude=excluded.min_latitude,max_latitude=excluded.max_latitude,
              min_longitude=excluded.min_longitude,max_longitude=excluded.max_longitude,
              height_meters=excluded.height_meters,raw_tags=excluded.raw_tags,imported_at=excluded.imported_at,
              geometry_wkb=excluded.geometry_wkb,geometry_crs=2056,source_version=excluded.source_version,
              source_updated_at=excluded.source_updated_at
        """, rows)
        connection.commit()
        context_total += len(rows)
        pending_context.clear()

    class BenchHandler(osmium.SimpleHandler):
        def _append(self, osm_type: str, osm_id: int, latitude: float, longitude: float, tags) -> None:
            if not (45.7 <= latitude <= 47.9 and 5.7 <= longitude <= 10.7):
                return
            clean_tags = {tag.k: tag.v for tag in tags if tag.k in KEEP_TAGS}
            pending.append(ImportedBench(osm_type, int(osm_id), latitude, longitude, clean_tags))
            if len(pending) >= 1000:
                flush()

        def _append_context(self, osm_type: str, osm_id: int, coordinates, tags, geometry_wkb: Optional[bytes] = None) -> None:
            clean_tags = {tag.k: tag.v for tag in tags if tag.k in CONTEXT_TAGS}
            kind = context_kind(clean_tags)
            if not kind or not coordinates:
                return
            latitudes = [point[0] for point in coordinates]
            longitudes = [point[1] for point in coordinates]
            if max(latitudes) < 45.7 or min(latitudes) > 47.9 or max(longitudes) < 5.7 or min(longitudes) > 10.7:
                return
            pending_context.append(ImportedContext(
                osm_type, int(osm_id), kind,
                sum(latitudes) / len(latitudes), sum(longitudes) / len(longitudes),
                min(latitudes), max(latitudes), min(longitudes), max(longitudes), clean_tags,
                geometry_wkb or geometry_wkb_from_coordinates(
                    coordinates, kind,
                    len(coordinates) >= 4 and coordinates[0] == coordinates[-1],
                ),
            ))
            if len(pending_context) >= 2000:
                flush_context()

        def node(self, node) -> None:
            if node.tags.get("amenity") == "bench" and node.location.valid():
                self._append("node", node.id, node.location.lat, node.location.lon, node.tags)
            if node.location.valid() and node.tags.get("natural") == "tree":
                self._append_context("node", node.id, [(node.location.lat, node.location.lon)], node.tags)

        def way(self, way) -> None:
            locations = [(node.lat, node.lon) for node in way.nodes if node.location.valid()]
            if way.tags.get("amenity") == "bench" and locations:
                self._append("way", way.id, sum(p[0] for p in locations) / len(locations), sum(p[1] for p in locations) / len(locations), way.tags)
            self._append_context("way", way.id, locations, way.tags)

        def area(self, area) -> None:
            clean_tags = {tag.k: tag.v for tag in area.tags if tag.k in CONTEXT_TAGS}
            if not context_kind(clean_tags):
                return
            try:
                factory = osmium.geom.WKBFactory()
                geometry = project_wgs84_wkb(factory.create_multipolygon(area))
                # Area IDs distinguish relation-derived areas from way callbacks.
                bounds = feature_bounds_wgs84(geometry)
                coordinates = [(bounds[1], bounds[0]), (bounds[3], bounds[2])]
                self._append_context("area", area.id, coordinates, area.tags, geometry)
            except Exception as error:
                print(f"Skipping invalid OSM area {area.id}: {error}", file=sys.stderr)

    BenchHandler().apply_file(str(pbf_path), locations=True)
    flush()
    flush_context()
    connection.execute("UPDATE benches SET active=0 WHERE imported_at<>? AND id LIKE 'osm-%'", (imported_at,))
    connection.execute("DELETE FROM environment_features WHERE source='OpenStreetMap' AND imported_at<>?", (imported_at,))
    connection.execute("UPDATE bench_enrichments SET environment_computed_at=NULL")
    connection.commit()
    return total, context_total


class RasterCollection:
    def __init__(self, directory: Optional[Path]):
        self.datasets = []
        if not directory or not directory.exists():
            return
        try:
            import rasterio
        except ImportError as error:
            raise RuntimeError("Terrain analysis requires rasterio.") from error
        for path in sorted(directory.rglob("*.tif")):
            try:
                dataset = rasterio.open(path)
                self.datasets.append(dataset)
            except Exception as error:  # continue after a corrupt/non-raster tile
                print(f"Skipping {path}: {error}", file=sys.stderr)

    def sample(self, latitude: float, longitude: float) -> Optional[float]:
        if not self.datasets:
            return None
        from rasterio.warp import transform
        for dataset in self.datasets:
            try:
                x, y = transform("EPSG:4326", dataset.crs, [longitude], [latitude])
                if dataset.bounds.left <= x[0] <= dataset.bounds.right and dataset.bounds.bottom <= y[0] <= dataset.bounds.top:
                    value = next(dataset.sample([(x[0], y[0])]))[0]
                    if dataset.nodata is None or value != dataset.nodata:
                        return float(value)
            except Exception:
                continue
        return None

    def close(self) -> None:
        for dataset in self.datasets:
            dataset.close()


def destination(latitude: float, longitude: float, bearing: float, distance_meters: float) -> tuple[float, float]:
    earth = 6_371_000.0
    angular = distance_meters / earth
    lat1, lon1, angle = map(math.radians, (latitude, longitude, bearing))
    lat2 = math.asin(math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(angle))
    lon2 = lon1 + math.atan2(math.sin(angle) * math.sin(angular) * math.cos(lat1), math.cos(angular) - math.sin(lat1) * math.sin(lat2))
    return math.degrees(lat2), math.degrees(lon2)


def distance_meters(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    mean_latitude = math.radians((latitude_a + latitude_b) / 2)
    north = (latitude_b - latitude_a) * 111_320
    east = (longitude_b - longitude_a) * 111_320 * math.cos(mean_latitude)
    return math.hypot(north, east)


def bearing_degrees(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    north = (latitude_b - latitude_a) * 111_320
    east = (longitude_b - longitude_a) * 111_320 * math.cos(math.radians((latitude_a + latitude_b) / 2))
    return math.degrees(math.atan2(east, north)) % 360


def wgs84_to_lv95(latitude: float, longitude: float) -> tuple[float, float]:
    """Official swisstopo approximation used to address LV95 elevation services."""
    latitude_aux = (latitude * 3600 - 169_028.66) / 10_000
    longitude_aux = (longitude * 3600 - 26_782.5) / 10_000
    easting = (
        2_600_072.37 + 211_455.93 * longitude_aux
        - 10_938.51 * longitude_aux * latitude_aux
        - 0.36 * longitude_aux * latitude_aux ** 2
        - 44.54 * longitude_aux ** 3
    )
    northing = (
        1_200_147.07 + 308_807.95 * latitude_aux
        + 3_745.25 * longitude_aux ** 2 + 76.63 * latitude_aux ** 2
        - 194.56 * longitude_aux ** 2 * latitude_aux + 119.79 * latitude_aux ** 3
    )
    return easting, northing


def terrain_profile_coordinates(latitude: float, longitude: float,
                                bearings: Sequence[int] = tuple(range(0, 360, 5))) -> list[list[float]]:
    easting, northing = wgs84_to_lv95(latitude, longitude)
    coordinates = [[easting, northing]]
    for bearing in bearings:
        radians = math.radians(bearing)
        for distance in PROFILE_DISTANCES_METERS:
            coordinates.append([
                easting + math.sin(radians) * distance,
                northing + math.cos(radians) * distance,
            ])
        coordinates.append([easting, northing])
    return coordinates


def profile_height(point: object) -> Optional[float]:
    if not isinstance(point, dict) or not isinstance(point.get("alts"), dict):
        return None
    alts = point["alts"]
    value = alts.get("COMB", alts.get("DTM2", alts.get("DTM25")))
    try:
        height = float(value)
    except (TypeError, ValueError):
        return None
    return height if -100 <= height <= 5_000 else None


def terrain_horizon_from_profile(points: Sequence[object], bearing_count: int = 72) -> Optional[tuple[float, list[float], list[float]]]:
    expected = 1 + bearing_count * (len(PROFILE_DISTANCES_METERS) + 1)
    if len(points) < expected:
        return None
    elevation = profile_height(points[0])
    if elevation is None:
        return None
    profile: list[float] = []
    samples: list[float] = []
    cursor = 1
    for _bearing in range(bearing_count):
        maximum_angle = -5.0
        for distance in PROFILE_DISTANCES_METERS:
            sample = profile_height(points[cursor])
            cursor += 1
            samples.append(elevation if sample is None else sample)
            if sample is None:
                continue
            maximum_angle = max(maximum_angle, math.degrees(math.atan2(sample - (elevation + 1.1), distance)))
        cursor += 1
        profile.append(round(maximum_angle, 2))
    return (elevation, profile, samples) if len(profile) == bearing_count and len(samples) >= bearing_count else None


def fetch_terrain_horizon(latitude: float, longitude: float, timeout: float = 20) -> Optional[tuple[float, list[float], list[float]]]:
    elevation: Optional[float] = None
    complete_profile: list[float] = []
    complete_samples: list[float] = []
    for bearings in PROFILE_BEARING_GROUPS:
        coordinates = terrain_profile_coordinates(latitude, longitude, bearings)
        parameters = urllib.parse.urlencode({
            "geom": json.dumps({"type": "LineString", "coordinates": coordinates}, separators=(",", ":")),
            "sr": "2056",
            "nb_points": "2",
            "distinct_points": "True",
        }).encode()
        result = None
        for attempt in range(3):
            request = urllib.request.Request(
                "https://api3.geo.admin.ch/rest/services/profile.json",
                data=parameters,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Benchly/1.0 (terrain horizon batch)",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    result = terrain_horizon_from_profile(json.load(response), len(bearings))
                break
            except Exception as error:
                if attempt == 2:
                    print(f"GeoAdmin terrain profile failed: {error}", file=sys.stderr)
                    return None
                time.sleep(2 ** attempt)
        if result is None:
            return None
        group_elevation, group_profile, group_samples = result
        elevation = group_elevation if elevation is None else elevation
        complete_profile.extend(group_profile)
        complete_samples.extend(group_samples)
    if elevation is None or len(complete_profile) != 72:
        return None
    return elevation, complete_profile, complete_samples


def circular_difference(first: float, second: float) -> float:
    return abs(((first - second + 540) % 360) - 180)


def merge_near_obstructions(latitude: float, longitude: float, origin_elevation: float,
                            terrain_profile: Sequence[float], terrain_samples: Sequence[float],
                            context: Sequence[sqlite3.Row]) -> tuple[list[float], list[str], list[float], float, int]:
    profile = list(terrain_profile)
    obstruction_types = ["terrain"] * 72
    obstruction_distances = [0.0] * 72
    forests = [feature for feature in context if feature["kind"] == "forest"]
    for feature in [item for item in context if item["kind"] in {"building", "tree"}]:
        distance = max(2.5, feature_distance(latitude, longitude, feature))
        if distance > 350:
            continue
        bearing = feature_bearing(latitude, longitude, feature)
        default_height = 8.5 if feature["kind"] == "building" else 12.0
        height = feature["height_meters"] if feature["height_meters"] is not None else default_height
        bearing_index = round(bearing / 5) % 72
        distance_index = min(range(len(PROFILE_DISTANCES_METERS)), key=lambda index: abs(PROFILE_DISTANCES_METERS[index] - distance))
        sample_index = bearing_index * len(PROFILE_DISTANCES_METERS) + distance_index
        base_height = terrain_samples[sample_index] if len(terrain_samples) == 72 * len(PROFILE_DISTANCES_METERS) else origin_elevation
        relative_top = base_height + height - (origin_elevation + 1.1)
        angle = max(0.0, min(89.0, math.degrees(math.atan2(max(1.0, relative_top), distance))))
        exact_half_angle = feature_angular_half_width(latitude, longitude, feature, bearing)
        width = max(4.0, distance_meters(feature["min_latitude"], feature["min_longitude"], feature["max_latitude"], feature["max_longitude"]))
        half_angle = exact_half_angle if exact_half_angle is not None else min(60.0, max(3.0, math.degrees(math.atan2(width / 2, distance))))
        for index in range(72):
            if circular_difference(index * 5, bearing) <= half_angle and angle > profile[index]:
                profile[index] = round(angle, 2)
                obstruction_types[index] = "building" if feature["kind"] == "building" else "vegetation"
                obstruction_distances[index] = round(distance, 1)
    # Forest is a polygon fact. A nearby bounding box or an isolated tree is not woodland.
    in_forest = any(feature_contains_exact(latitude, longitude, feature) for feature in forests)
    if in_forest:
        for index in range(72):
            if profile[index] < 8:
                profile[index] = 8
                obstruction_types[index] = "vegetation"
                obstruction_distances[index] = 15
    vegetation_percent = 100 * obstruction_types.count("vegetation") / 72
    canopy_percent = min(95.0, (55 if in_forest else 0) + vegetation_percent * 0.8)
    return profile, obstruction_types, obstruction_distances, canopy_percent, int(in_forest)


def nearby_context(connection: sqlite3.Connection, latitude: float, longitude: float, radius_meters: float,
                   kinds: Optional[Sequence[str]] = None) -> list[sqlite3.Row]:
    latitude_delta = radius_meters / 111_320
    longitude_delta = radius_meters / (111_320 * max(0.2, math.cos(math.radians(latitude))))
    parameters: list[object] = [longitude - longitude_delta, longitude + longitude_delta, latitude - latitude_delta, latitude + latitude_delta]
    kind_clause = ""
    if kinds:
        kind_clause = f" AND f.kind IN ({','.join('?' for _ in kinds)})"
        parameters.extend(kinds)
    return connection.execute(f"""
        SELECT f.* FROM environment_spatial_index s
        JOIN environment_features f ON f.row_id=s.row_id
        WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?
        {kind_clause}
    """, parameters).fetchall()


def nearby_land_cover(connection: sqlite3.Connection, latitude: float, longitude: float, radius_meters: float = 50) -> list[sqlite3.Row]:
    latitude_delta = radius_meters / 111_320
    longitude_delta = radius_meters / (111_320 * max(0.2, math.cos(math.radians(latitude))))
    official_context = official_context_version(connection)
    source_clause = "AND f.source<>'swissTLM3D'"
    parameters: list[object] = [
        longitude - longitude_delta, longitude + longitude_delta,
        latitude - latitude_delta, latitude + latitude_delta,
    ]
    if official_context:
        source_clause = "AND (f.source<>'swissTLM3D' OR f.source_version=?)"
        parameters.append(official_context)
    return connection.execute("""
        SELECT f.* FROM land_cover_spatial_index s
        JOIN land_cover_features f ON f.row_id=s.row_id
        WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?
        {source_clause}
    """.format(source_clause=source_clause), parameters).fetchall()


def has_official_context(connection: sqlite3.Connection) -> bool:
    return official_context_version(connection) is not None


def official_context_version(connection: sqlite3.Connection) -> Optional[str]:
    row = connection.execute(
        "SELECT version FROM official_context_sources WHERE source='swissTLM3D' LIMIT 1"
    ).fetchone()
    return str(row["version"]) if row else None


def preferred_exact_features(
    features: Sequence[sqlite3.Row], kind: str, official_context: bool | str | None,
) -> list[sqlite3.Row]:
    """Use complete official geometry when available, otherwise exact OSM geometry."""
    exact = [
        feature for feature in features
        if feature["kind"] == kind and feature["geometry_wkb"] is not None
    ]
    official = [feature for feature in exact if feature["source"] == "swissTLM3D"]
    if isinstance(official_context, str):
        official = [feature for feature in official if feature["source_version"] == official_context]
    non_official = [feature for feature in exact if feature["source"] != "swissTLM3D"]
    return official if official_context else non_official


def preferred_environment_context(
    features: Sequence[sqlite3.Row], official_context: bool | str | None,
) -> list[sqlite3.Row]:
    other = [
        feature for feature in features
        if feature["kind"] not in {"building", "forest", "water"} and feature["geometry_wkb"] is not None
    ]
    return [
        *other,
        *preferred_exact_features(features, "building", official_context),
        *preferred_exact_features(features, "forest", official_context),
        *preferred_exact_features(features, "water", official_context),
    ]


def feature_distance(latitude: float, longitude: float, feature: sqlite3.Row) -> float:
    exact = feature_distance_exact(latitude, longitude, feature)
    if exact is not None:
        return exact
    nearest_latitude = min(max(latitude, feature["min_latitude"]), feature["max_latitude"])
    nearest_longitude = min(max(longitude, feature["min_longitude"]), feature["max_longitude"])
    return distance_meters(latitude, longitude, nearest_latitude, nearest_longitude)


def feature_bearing(latitude: float, longitude: float, feature: sqlite3.Row) -> float:
    nearest = feature_nearest_location(latitude, longitude, feature)
    target_latitude, target_longitude = nearest or (feature["center_latitude"], feature["center_longitude"])
    return bearing_degrees(latitude, longitude, target_latitude, target_longitude)


def point_hits_building(latitude: float, longitude: float, buildings: Sequence[sqlite3.Row], tolerance_meters: float = 2.5) -> bool:
    exact_buildings = [feature for feature in buildings if "geometry_wkb" in feature.keys() and feature["geometry_wkb"] is not None]
    return bool(exact_buildings and point_hits_exact_building(latitude, longitude, exact_buildings, tolerance_meters))


def horizon_profile(latitude: float, longitude: float, origin_height: float, surface: RasterCollection,
                    terrain: RasterCollection, buildings: Sequence[sqlite3.Row]) -> tuple[list[float], list[float], list[str], list[float], list[float]]:
    profile: list[float] = []
    terrain_profile: list[float] = []
    obstruction_types: list[str] = []
    obstruction_distances: list[float] = []
    relief_samples: list[float] = []
    near_distances = list(range(2, 22, 2)) + list(range(25, 101, 5)) + list(range(120, 301, 20))
    far_distances = [300 * (20_000 / 300) ** (index / 48) for index in range(1, 49)]
    for bearing in range(0, 360, 5):
        maximum_angle = -5.0
        maximum_terrain_angle = -5.0
        maximum_type = "unknown"
        maximum_distance = 0.0
        for sample_distance in near_distances:
            lat, lon = destination(latitude, longitude, bearing, sample_distance)
            terrain_elevation = terrain.sample(lat, lon)
            surface_elevation = surface.sample(lat, lon) if surface.datasets else None
            if terrain_elevation is not None:
                relief_samples.append(terrain_elevation)
                terrain_angle = math.degrees(math.atan2(terrain_elevation - origin_height, sample_distance))
                maximum_terrain_angle = max(maximum_terrain_angle, terrain_angle)
            elevation = surface_elevation if surface_elevation is not None else terrain_elevation
            if elevation is None:
                continue
            angle = math.degrees(math.atan2(elevation - origin_height, sample_distance))
            if angle > maximum_angle:
                raised_surface = surface_elevation is not None and terrain_elevation is not None and surface_elevation - terrain_elevation >= 2.0
                maximum_type = "building" if raised_surface and point_hits_building(lat, lon, buildings) else "vegetation" if raised_surface else "terrain"
                maximum_angle = angle
                maximum_distance = float(sample_distance)
        for sample_distance in far_distances:
            lat, lon = destination(latitude, longitude, bearing, sample_distance)
            elevation = terrain.sample(lat, lon)
            if elevation is None:
                continue
            relief_samples.append(elevation)
            angle = math.degrees(math.atan2(elevation - origin_height, sample_distance))
            maximum_terrain_angle = max(maximum_terrain_angle, angle)
            if angle > maximum_angle:
                maximum_angle = angle
                maximum_type = "terrain"
                maximum_distance = float(sample_distance)
        profile.append(round(maximum_angle, 2))
        terrain_profile.append(round(maximum_terrain_angle, 2))
        obstruction_types.append(maximum_type)
        obstruction_distances.append(round(maximum_distance, 1))
    return profile, terrain_profile, obstruction_types, obstruction_distances, relief_samples


def classify_view(latitude: float, longitude: float, facing: Optional[float], profile: Sequence[float],
                  terrain_profile: Sequence[float], context: Sequence[sqlite3.Row], relief: float) -> tuple[list[str], float, float, float, float, dict]:
    indices = list(range(72)) if facing is None else [index for index in range(72) if abs((((index * 5 - facing) + 180) % 360) - 180) <= 45]
    selected = [profile[index] for index in indices]
    openness = sum(max(0.0, 1 - max(0.0, angle) / 35) for angle in selected) / max(1, len(selected))
    buildings = [feature for feature in context if feature["kind"] == "building"]
    forests = [feature for feature in context if feature["kind"] == "forest"]
    water_features = [feature for feature in context if feature["kind"] == "water"]
    roads = [feature for feature in context if feature["kind"] == "major_road"]

    def in_view(feature: sqlite3.Row, maximum_distance: float) -> bool:
        distance = feature_distance(latitude, longitude, feature)
        if distance > maximum_distance:
            return False
        direction = feature_bearing(latitude, longitude, feature)
        if facing is not None and abs((((direction - facing) + 180) % 360) - 180) > 55:
            return False
        horizon = profile[int(round(direction / 5)) % 72]
        return horizon < 12

    visible_water = [feature for feature in water_features if in_view(feature, 10_000)]
    visible_forests = [feature for feature in forests if in_view(feature, 2_000)]
    nearest_water = min((feature_distance(latitude, longitude, feature) for feature in water_features), default=math.inf)
    nearest_building = min((feature_distance(latitude, longitude, feature) for feature in buildings), default=math.inf)
    nearest_road = min((feature_distance(latitude, longitude, feature) for feature in roads), default=math.inf)
    naturalness = min(1.0, 0.45 + (0.35 if visible_forests else 0) + (0.2 if visible_water else 0))
    remoteness = min(1.0, 0.35 * min(1, nearest_building / 100) + 0.65 * min(1, nearest_road / 300))
    water_score = 1.0 if visible_water and nearest_water < 1500 else 0.7 if visible_water else 0.2 if nearest_water < 300 else 0.0
    labels: list[str] = []
    selected_terrain = [terrain_profile[index] for index in indices]
    building_share = sum(1 for index in indices if profile[index] > terrain_profile[index] + 0.1) / max(1, len(indices))
    if relief >= 0.35 and max(selected_terrain, default=-5) >= 4:
        labels.append("Bergblick")
    if visible_water:
        labels.append("Seeblick" if any((feature["subtype"] or "") in {"lake", "reservoir", "water"} for feature in visible_water) else "Wasserblick")
    if openness >= 0.75:
        labels.append("Weitsicht")
    if visible_forests and naturalness >= 0.7:
        labels.append("Waldblick")
    if openness < 0.4 or sum(selected) / max(1, len(selected)) > 22 or building_share > 0.5:
        labels.append("Eingeschränkte Aussicht")
    if not labels:
        labels.append("Keine besondere Aussicht")
    sectors = []
    for start in range(0, 360, 45):
        values = [profile[index % 72] for index in range(start // 5, start // 5 + 9)]
        sectors.append({"from": start, "to": start + 45, "mean_horizon": round(sum(values) / len(values), 1), "open": sum(angle < 5 for angle in values) >= 5})
    return labels, openness, water_score, naturalness, remoteness, {"sectors": sectors, "visible_water_count": len(visible_water)}


def direct_sun_minutes(latitude: float, longitude: float, profile: Sequence[float], canopy_percent: float, covered: bool, month: int, day: int) -> int:
    try:
        from astral import Observer
        from astral.sun import azimuth, elevation
    except ImportError as error:
        raise RuntimeError("Sun exposure analysis requires astral.") from error
    observer = Observer(latitude=latitude, longitude=longitude)
    date = datetime(2024, month, day, tzinfo=timezone.utc)
    visible = 0
    for minutes in range(0, 24 * 60, 5):
        moment = date.replace(hour=minutes // 60, minute=minutes % 60)
        altitude = elevation(observer, moment)
        bearing = azimuth(observer, moment)
        position = (bearing % 360) / 5
        lower = int(math.floor(position)) % len(profile)
        upper = (lower + 1) % len(profile)
        horizon = profile[lower] * (1 - (position - math.floor(position))) + profile[upper] * (position - math.floor(position))
        if not covered and altitude > 0 and altitude > horizon:
            visible += 5
    return visible


def enrich_terrain(connection: sqlite3.Connection, terrain_dir: Optional[Path], surface_dir: Optional[Path],
                   limit: Optional[int] = None, recompute: bool = False,
                   bounds: Optional[tuple[float, float, float, float]] = None,
                   deadline_monotonic: Optional[float] = None) -> int:
    terrain = RasterCollection(terrain_dir)
    surface = RasterCollection(surface_dir)
    if not terrain.datasets:
        print("No terrain GeoTIFFs found; enrichment skipped. See worker/README.md.", file=sys.stderr)
        return 0
    query = """SELECT b.row_id,b.latitude,b.longitude,b.direction_degrees,b.covered
      FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
      WHERE b.active=1"""
    if not recompute:
        query += " AND (e.pipeline_version IS NULL OR e.pipeline_version<>?)"
        query_parameters: tuple[object, ...] = (PIPELINE_VERSION,)
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
    try:
        for row in rows:
            if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
                print("Enrichment runtime limit reached; remaining benches stay eligible.", file=sys.stderr)
                break
            elevation = terrain.sample(row["latitude"], row["longitude"])
            if elevation is None:
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
            horizon, terrain_horizon, obstruction_types, obstruction_distances, elevations = horizon_profile(
                row["latitude"], row["longitude"], elevation + 1.1, surface, terrain, buildings,
            )
            facing = row["direction_degrees"]
            relief = min(1.0, ((max(elevations) - min(elevations)) / 1500.0) if elevations else 0.0)
            labels, openness, water, naturalness, remoteness, view_sectors = classify_view(
                row["latitude"], row["longitude"], facing, horizon, terrain_horizon, context, relief,
            )
            components = {"openness": openness, "relief": relief, "water": water, "naturalness": naturalness, "remoteness": remoteness}
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
            connection.execute("""
                INSERT INTO bench_enrichments(bench_row_id,elevation_meters,in_forest,canopy_percent,
                    distance_forest_meters,distance_water_meters,distance_path_meters,distance_major_road_meters,
                    horizon_profile,terrain_horizon_profile,obstruction_types,obstruction_distances,
                    building_obstruction_percent,vegetation_obstruction_percent,distance_building_meters,building_count_100m,
                    sun_minutes_summer,sun_minutes_winter,sun_minutes_spring,sun_minutes_autumn,sun_confidence,
                    view_score,view_confidence,view_components,view_labels,view_sectors,context_source_version,pipeline_version,computed_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(bench_row_id) DO UPDATE SET elevation_meters=excluded.elevation_meters,in_forest=excluded.in_forest,
                    canopy_percent=excluded.canopy_percent,distance_forest_meters=excluded.distance_forest_meters,
                    distance_water_meters=excluded.distance_water_meters,distance_path_meters=excluded.distance_path_meters,
                    distance_major_road_meters=excluded.distance_major_road_meters,horizon_profile=excluded.horizon_profile,
                    terrain_horizon_profile=excluded.terrain_horizon_profile,obstruction_types=excluded.obstruction_types,
                    obstruction_distances=excluded.obstruction_distances,building_obstruction_percent=excluded.building_obstruction_percent,
                    vegetation_obstruction_percent=excluded.vegetation_obstruction_percent,distance_building_meters=excluded.distance_building_meters,
                    building_count_100m=excluded.building_count_100m,sun_minutes_summer=excluded.sun_minutes_summer,
                    sun_minutes_winter=excluded.sun_minutes_winter,sun_minutes_spring=excluded.sun_minutes_spring,
                    sun_minutes_autumn=excluded.sun_minutes_autumn,sun_confidence=excluded.sun_confidence,
                    view_score=excluded.view_score,view_confidence=excluded.view_confidence,view_components=excluded.view_components,
                    view_labels=excluded.view_labels,view_sectors=excluded.view_sectors,context_source_version=excluded.context_source_version,
                    pipeline_version=excluded.pipeline_version,computed_at=excluded.computed_at
            """, (row["row_id"], elevation, in_forest, canopy_percent, nearest(forests), nearest(waters), nearest(paths), nearest(roads),
                  json.dumps(horizon), json.dumps(terrain_horizon), json.dumps(obstruction_types), json.dumps(obstruction_distances),
                  building_percent, vegetation_percent, distance_building, building_count,
                  sun_summer, sun_winter, sun_spring, sun_autumn, sun_confidence, view, view_confidence,
                  json.dumps(components), json.dumps(labels, ensure_ascii=False), json.dumps(view_sectors),
                  f"swissTLM3D:{official_context}" if official_context else "OpenStreetMap", PIPELINE_VERSION, now_iso()))
            connection.execute("""
              UPDATE bench_enrichments SET land_context=?,waterfront=?,canopy_context=?,canopy_share_3m=?,
                canopy_share_10m=?,canopy_share_25m=?,vegetation_median_height=?,vegetation_max_height=?,
                environment_computed_at=?,in_forest=?,distance_forest_meters=?,distance_water_meters=?
              WHERE bench_row_id=?
            """, (environment["land_context"], int(bool(environment["waterfront"])), canopy["context"],
                  canopy["share_3m"], canopy["share_10m"], canopy["share_25m"], canopy["median_height"],
                  canopy["max_height"], now_iso(), in_forest, environment["forest_distance"],
                  environment["water_distance"], row["row_id"]))
            updated += 1
            if updated % 50 == 0:
                connection.commit()
                print(f"Enriched {updated}/{len(rows)} benches", file=sys.stderr)
        connection.commit()
    finally:
        terrain.close()
        surface.close()
    return updated


def commons_metadata(connection: sqlite3.Connection, limit: int) -> int:
    benches = connection.execute("""
        SELECT b.row_id,b.latitude,b.longitude FROM benches b
        WHERE b.active=1 AND NOT EXISTS(
          SELECT 1 FROM media m WHERE m.bench_row_id=b.row_id AND m.provider='Wikimedia Commons'
            AND m.relation='nearby' AND datetime(m.fetched_at) >= datetime('now','-30 days')
        )
        ORDER BY b.row_id LIMIT ?
    """, (limit,)).fetchall()
    inserted = 0
    for index, bench in enumerate(benches):
        connection.execute("DELETE FROM media WHERE bench_row_id=? AND provider='Wikimedia Commons' AND relation='nearby'", (bench["row_id"],))
        parameters = {
            "action": "query", "format": "json", "generator": "geosearch", "ggsprimary": "all",
            "ggsnamespace": "6", "ggsradius": "300", "ggslimit": "6",
            "ggscoord": f"{bench['latitude']}|{bench['longitude']}", "prop": "coordinates|imageinfo",
            "iiprop": "url|extmetadata", "iiurlwidth": "640",
        }
        url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(parameters)
        request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (nearby-photo metadata)"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                pages = json.load(response).get("query", {}).get("pages", {})
            for page in pages.values():
                info = (page.get("imageinfo") or [{}])[0]
                metadata = info.get("extmetadata", {})
                coordinates = (page.get("coordinates") or [{}])[0]
                photo_latitude, photo_longitude = coordinates.get("lat"), coordinates.get("lon")
                photo_distance = distance_meters(bench["latitude"], bench["longitude"], photo_latitude, photo_longitude) if photo_latitude is not None and photo_longitude is not None else None
                connection.execute("""
                    INSERT OR IGNORE INTO media(bench_row_id,relation,provider,external_id,source_url,thumbnail_url,author,license,
                        latitude,longitude,distance_meters,title,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (bench["row_id"], "nearby", "Wikimedia Commons", str(page.get("pageid")), info.get("descriptionurl", "https://commons.wikimedia.org"),
                      info.get("thumburl") or info.get("url"), strip_html(metadata.get("Artist", {}).get("value")), metadata.get("LicenseShortName", {}).get("value"),
                      photo_latitude, photo_longitude, photo_distance, page.get("title", "").removeprefix("File:"), now_iso()))
                inserted += 1
            connection.commit()
        except Exception as error:
            print(f"Commons lookup failed for bench {bench['row_id']}: {error}", file=sys.stderr)
        if index and index % 10 == 0:
            time.sleep(1)
    return inserted


def strip_html(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    output, inside = [], False
    for character in value:
        if character == "<": inside = True
        elif character == ">": inside = False
        elif not inside: output.append(character)
    return "".join(output).strip()[:200]


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
        connection.execute("UPDATE pipeline_runs SET source_version=? WHERE id=?", (source_version, run_id))
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
        connection.execute("""
          INSERT INTO official_context_sources(source,version,asset_url,asset_checksum,imported_at,stats)
          VALUES('swissTLM3D',?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET version=excluded.version,
            asset_url=excluded.asset_url,asset_checksum=excluded.asset_checksum,imported_at=excluded.imported_at,stats=excluded.stats
        """, (source_version, asset_url, checksum, now_iso(), json.dumps(stats, separators=(",", ":"))))
        connection.execute("UPDATE pipeline_runs SET source_version=? WHERE id=?", (source_version, run_id))
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error), **stats})
        raise
    finally:
        connection.close()
        if temporary_context:
            temporary_context.cleanup()


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
          FROM pipeline_runs WHERE kind='analyze-scenes' AND status='completed'
            AND finished_at IS NOT NULL AND date(started_at)=date('now')
        """).fetchone()[0])
        remaining_seconds = max(0.0, min(args.max_runtime_hours * 3600, 7200 - used_seconds))
        deadline = time.monotonic() + remaining_seconds
        stats = analyze_scenes(connection, args.limit, deadline, args.requests_per_second)
        stats["daily_runtime_remaining_seconds"] = round(remaining_seconds)
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def reconcile_deterministic_context(connection: sqlite3.Connection, limit: int = 5000) -> dict[str, int]:
    rows = connection.execute("""
      SELECT b.row_id,b.latitude,b.longitude,e.canopy_context
      FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
      WHERE b.active=1 AND (e.environment_computed_at IS NULL OR e.land_context IS NULL)
      ORDER BY b.row_id LIMIT ?
    """, (limit,)).fetchall()
    stats = {"deterministic_reconciled": 0, "forest": 0, "waterfront": 0}
    official_context = official_context_version(connection)
    for row in rows:
        context = nearby_context(connection, row["latitude"], row["longitude"], 10_000, ["forest", "water"])
        forests = preferred_exact_features(context, "forest", official_context)
        waters = preferred_exact_features(context, "water", official_context)
        result = deterministic_environment(
            row["latitude"], row["longitude"], forests, waters,
            nearby_land_cover(connection, row["latitude"], row["longitude"]),
            str(row["canopy_context"] or "unknown"),
        )
        connection.execute("""
          INSERT INTO bench_enrichments(bench_row_id,in_forest,land_context,waterfront,distance_forest_meters,
            distance_water_meters,environment_computed_at)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(bench_row_id) DO UPDATE SET in_forest=excluded.in_forest,
            land_context=excluded.land_context,waterfront=excluded.waterfront,
            distance_forest_meters=excluded.distance_forest_meters,distance_water_meters=excluded.distance_water_meters,
            environment_computed_at=excluded.environment_computed_at
        """, (row["row_id"], int(bool(result["in_forest"])), result["land_context"],
              int(bool(result["waterfront"])), result["forest_distance"], result["water_distance"], now_iso()))
        stats["deterministic_reconciled"] += 1
        stats["forest"] += int(bool(result["in_forest"]))
        stats["waterfront"] += int(bool(result["waterfront"]))
        if stats["deterministic_reconciled"] % 100 == 0:
            connection.commit()
    connection.commit()
    return stats


def run_reconcile_environment(args) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "reconcile-environment")
    try:
        stats = reconcile_deterministic_context(connection, args.limit)
        stats.update({f"visual_{key}": value for key, value in reconcile_environment(connection, args.limit).items()})
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
        ):
            raise RuntimeError("production data audit failed")
    finally:
        connection.close()


def run_benchmark_vision(args) -> None:
    result = benchmark_models(Path(args.dataset), args.models, args.allow_small)
    print(json.dumps(result, indent=2))
    if result["recommended"] is None:
        raise RuntimeError("No vision model met the acceptance thresholds")


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
            "ch.swisstopo.swissalti3d",
            terrain_dir,
            args.max_geodata_tiles,
            expand_bounds(bounds, 20_500),
            per_collection_bytes,
        )
        stats["surface_tiles"] = download_stac_tiles(
            connection,
            "ch.swisstopo.swisssurface3d-raster",
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
            WHERE b.active=1 AND (e.terrain_horizon_profile IS NULL OR length(e.terrain_horizon_profile)<100)
            ORDER BY b.row_id LIMIT ?
        """, (args.limit,)).fetchall()
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
                "row_id": row["row_id"], "elevation": elevation, "computed_at": now_iso(),
                "in_forest": in_forest, "canopy": canopy_percent, "forest": nearest(forests),
                "water_distance": nearest(waters), "path": nearest(paths), "road": nearest(roads),
                "horizon": json.dumps(profile), "terrain_horizon": json.dumps(terrain_profile),
                "obstruction_types": json.dumps(obstruction_types), "obstruction_distances": json.dumps(obstruction_distances),
                "building_percent": 100 * obstruction_types.count("building") / 72,
                "vegetation_percent": 100 * obstruction_types.count("vegetation") / 72,
                "distance_building": nearest(buildings),
                "building_count": sum(feature_distance(row["latitude"], row["longitude"], feature) <= 100 for feature in buildings),
                "summer": direct_sun_minutes(row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 6, 21),
                "winter": direct_sun_minutes(row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 12, 21),
                "spring": direct_sun_minutes(row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 3, 20),
                "autumn": direct_sun_minutes(row["latitude"], row["longitude"], profile, canopy_percent, bool(row["covered"]), 9, 22),
                "view_score": score_view(**components), "components": json.dumps(components),
                "labels": json.dumps(labels, ensure_ascii=False), "sectors": json.dumps(view_sectors),
                "context_version": f"swissTLM3D:{official_context} + GeoAdmin" if official_context else "OpenStreetMap + GeoAdmin",
            }
            with connection:
                connection.execute("""
                    INSERT INTO bench_enrichments(bench_row_id,elevation_meters,elevation_source,elevation_updated_at,
                      in_forest,canopy_percent,distance_forest_meters,distance_water_meters,distance_path_meters,distance_major_road_meters,
                      horizon_profile,terrain_horizon_profile,obstruction_types,obstruction_distances,
                      building_obstruction_percent,vegetation_obstruction_percent,distance_building_meters,building_count_100m,
                      sun_minutes_summer,sun_minutes_winter,sun_minutes_spring,sun_minutes_autumn,sun_confidence,
                      view_score,view_confidence,view_components,view_labels,view_sectors,context_source_version,pipeline_version,computed_at)
                    VALUES(:row_id,:elevation,'GeoAdmin-Höhenprofil',:computed_at,:in_forest,:canopy,:forest,:water_distance,:path,:road,
                      :horizon,:terrain_horizon,:obstruction_types,:obstruction_distances,:building_percent,:vegetation_percent,
                      :distance_building,:building_count,:summer,:winter,:spring,:autumn,'mittel',:view_score,'mittel',:components,
                      :labels,:sectors,:context_version,:pipeline_version,:computed_at)
                    ON CONFLICT(bench_row_id) DO UPDATE SET elevation_meters=excluded.elevation_meters,
                      elevation_source=excluded.elevation_source,elevation_updated_at=excluded.elevation_updated_at,
                      in_forest=excluded.in_forest,canopy_percent=excluded.canopy_percent,distance_forest_meters=excluded.distance_forest_meters,
                      distance_water_meters=excluded.distance_water_meters,distance_path_meters=excluded.distance_path_meters,
                      distance_major_road_meters=excluded.distance_major_road_meters,horizon_profile=excluded.horizon_profile,
                      terrain_horizon_profile=excluded.terrain_horizon_profile,obstruction_types=excluded.obstruction_types,
                      obstruction_distances=excluded.obstruction_distances,building_obstruction_percent=excluded.building_obstruction_percent,
                      vegetation_obstruction_percent=excluded.vegetation_obstruction_percent,distance_building_meters=excluded.distance_building_meters,
                      building_count_100m=excluded.building_count_100m,sun_minutes_summer=excluded.sun_minutes_summer,
                      sun_minutes_winter=excluded.sun_minutes_winter,sun_minutes_spring=excluded.sun_minutes_spring,
                      sun_minutes_autumn=excluded.sun_minutes_autumn,sun_confidence=excluded.sun_confidence,view_score=excluded.view_score,
                      view_confidence=excluded.view_confidence,view_components=excluded.view_components,view_labels=excluded.view_labels,
                      view_sectors=excluded.view_sectors,context_source_version=excluded.context_source_version,
                      pipeline_version=excluded.pipeline_version,computed_at=excluded.computed_at
                """, {**values, "pipeline_version": PROFILE_PIPELINE_VERSION})
                connection.execute("""
                  UPDATE bench_enrichments SET land_context=?,waterfront=?,in_forest=?,distance_forest_meters=?,
                    distance_water_meters=?,environment_computed_at=? WHERE bench_row_id=?
                """, (deterministic["land_context"], int(bool(deterministic["waterfront"])), in_forest,
                      deterministic["forest_distance"], deterministic["water_distance"], now_iso(), row["row_id"]))
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
            stats["terrain_tiles"] = download_stac_tiles(connection, "ch.swisstopo.swissalti3d", terrain_dir, args.max_geodata_tiles)
            stats["surface_tiles"] = download_stac_tiles(connection, "ch.swisstopo.swisssurface3d-raster", surface_dir, args.max_geodata_tiles)
        stats["enriched"] = enrich_terrain(connection, terrain_dir, surface_dir, args.limit, args.recompute)
        stats["media"] = commons_metadata(connection, args.commons_limit) if args.commons_limit else 0
        connection.execute("UPDATE pipeline_runs SET source_version=? WHERE id=?", (source_version, run_id))
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

    enrich = subparsers.add_parser("enrich-batch", help="Enrich one resumable spatial cell with bounded downloads")
    enrich.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    enrich.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    enrich.add_argument("--cell-degrees", type=float, default=0.05)
    enrich.add_argument("--limit", type=int, default=1000)
    enrich.add_argument("--max-geodata-tiles", type=int, default=2000)
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
    analysis.set_defaults(function=run_analyze_scenes, uses_lock=True)

    reconcile = subparsers.add_parser("reconcile-environment", help="Fuse deterministic context and visual evidence")
    reconcile.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    reconcile.add_argument("--limit", type=int, default=5000)
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
    benchmark.set_defaults(function=run_benchmark_vision, uses_lock=False)

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
