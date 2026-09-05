"""Download and import official Swiss context datasets."""

from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

from benchly.benches.repository import invalidate_enrichment
from benchly.catalog import load_catalog
from benchly.context.repository import (
    discard_old_official_generation,
    upsert_environment_features,
    upsert_land_cover,
)
from benchly.benches.domain import parse_height
from benchly.context.geometry import (
    building_footprint_wkb_from_geojson,
    classify_official_layer,
    feature_bounds_wgs84,
    geopackage_layers,
    geometry_wkb_from_geojson,
    iter_layer_features,
)
from benchly.runtime import now_iso

_PROVIDERS = load_catalog().providers

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
        str(_PROVIDERS.swissTlmItemsUrl),
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


def discover_swissbuildings_assets(bounds: tuple[float, float, float, float]) -> list[dict[str, str]]:
    endpoint = os.environ.get(
        "SWISSBUILDINGS_STAC_ITEMS",
        str(_PROVIDERS.swissBuildingsItemsUrl),
    )
    separator = "&" if "?" in endpoint else "?"
    bbox = ",".join(f"{value:.6f}" for value in bounds)
    url: Optional[str] = f"{endpoint}{separator}{urllib.parse.urlencode({'limit': 100, 'bbox': bbox})}"
    candidates: dict[str, dict[str, str]] = {}
    pages = 0
    while url and pages < 10:
        request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (3D building import)"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
        for item in payload.get("features", []):
            version = str(item.get("properties", {}).get("datetime") or item.get("id") or now_iso())
            item_id = str(item.get("id") or hashlib.sha256(version.encode()).hexdigest()[:16])
            for asset in (item.get("assets") or {}).values():
                href = str(asset.get("href") or "")
                filename = Path(urllib.parse.urlparse(href).path).name.lower()
                if href.startswith("https://") and filename.endswith("_2056_5728.gdb.zip"):
                    candidates[item_id] = {"id": item_id, "version": version, "url": href}
        url = next((str(link.get("href")) for link in payload.get("links", []) if link.get("rel") == "next"), None)
        pages += 1
    return sorted(candidates.values(), key=lambda item: item["id"])


def _geometry_z_values(value: object) -> list[float]:
    output: list[float] = []
    if isinstance(value, (list, tuple)):
        if len(value) >= 3 and all(isinstance(item, (int, float)) for item in value[:3]):
            output.append(float(value[2]))
        else:
            for item in value:
                output.extend(_geometry_z_values(item))
    return output


def _property_number(properties: dict, *tokens: str) -> Optional[float]:
    for key, value in properties.items():
        normalized = unicodedata.normalize("NFKD", str(key)).encode("ascii", "ignore").decode().lower()
        if all(token in normalized for token in tokens):
            try:
                number = float(value)
                if math.isfinite(number):
                    return number
            except (TypeError, ValueError):
                continue
    return None


def import_swissbuildings_gdb(connection: sqlite3.Connection, geodatabase: Path,
                              source_version: str, imported_at: str, source_prefix: str = "archive") -> dict[str, int]:
    layers = [layer for layer in geopackage_layers(geodatabase) if "building_solid" in layer.lower()]
    if not layers:
        raise RuntimeError(f"No Building_solid layer found in {geodatabase}")
    stats = {"building": 0, "skipped": 0}
    batch: list[dict[str, object]] = []

    def flush() -> None:
        if not batch:
            return
        upsert_environment_features(connection, batch)
        connection.commit()
        batch.clear()

    for layer in layers:
        for offset, feature in enumerate(iter_layer_features(geodatabase, layer)):
            geometry_json = feature.get("geometry")
            properties = feature.get("properties") or {}
            if not geometry_json:
                stats["skipped"] += 1
                continue
            try:
                geometry = building_footprint_wkb_from_geojson(geometry_json)
                min_lon, min_lat, max_lon, max_lat = feature_bounds_wgs84(geometry)
            except Exception:
                stats["skipped"] += 1
                continue
            if max_lat < 45.7 or min_lat > 47.9 or max_lon < 5.7 or min_lon > 10.7:
                continue
            heights = _geometry_z_values(geometry_json.get("coordinates"))
            ground = min(heights) if heights else _property_number(properties, "boden", "kote")
            roof = max(heights) if heights else (_property_number(properties, "dach", "max") or _property_number(properties, "max", "kote"))
            eaves = _property_number(properties, "dach", "min") or _property_number(properties, "trauf")
            height = roof - ground if roof is not None and ground is not None else _property_number(properties, "gebaude", "hohe")
            if height is not None and not 1.5 <= height <= 300:
                height = None
            source_id_value = feature.get("id") or properties.get("EGID") or properties.get("egid") or properties.get("UUID") or properties.get("uuid") or offset
            source_id = f"{source_prefix}:{layer}:{source_id_value}"
            compact_tags = {str(key): value for key, value in properties.items() if str(key).lower() in {"egid", "uuid", "objektart", "objecttype", "name"}}
            batch.append({
                "source": "swissBUILDINGS3D",
                "source_id": source_id,
                "kind": "building",
                "subtype": "solid",
                "center_latitude": (min_lat + max_lat) / 2,
                "center_longitude": (min_lon + max_lon) / 2,
                "min_latitude": min_lat,
                "max_latitude": max_lat,
                "min_longitude": min_lon,
                "max_longitude": max_lon,
                "height_meters": height,
                "raw_tags": json.dumps(compact_tags, ensure_ascii=False, separators=(",", ":")),
                "imported_at": imported_at,
                "geometry_wkb": geometry,
                "geometry_crs": 2056,
                "source_version": source_version,
                "source_updated_at": imported_at,
                "ground_elevation_meters": ground,
                "eaves_elevation_meters": eaves,
                "roof_elevation_meters": roof,
            })
            stats["building"] += 1
            if len(batch) >= 1000:
                flush()
    flush()
    return stats


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
    batch: list[dict[str, object]] = []
    land_batch: list[dict[str, object]] = []

    def flush() -> None:
        if batch:
            upsert_environment_features(connection, batch)
            batch.clear()
        if land_batch:
            upsert_land_cover(connection, land_batch)
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
                land_batch.append({
                    "source": "swissTLM3D",
                    "source_id": source_id,
                    "cover_class": kind_or_class,
                    "geometry_wkb": geometry,
                    "geometry_crs": 2056,
                    "min_latitude": min_lat,
                    "max_latitude": max_lat,
                    "min_longitude": min_lon,
                    "max_longitude": max_lon,
                    "source_version": source_version,
                    "source_updated_at": imported_at,
                    "imported_at": imported_at,
                })
                stats["land_cover"] += 1
            else:
                height = parse_height({str(key).lower(): str(value) for key, value in properties.items() if value is not None})
                batch.append({
                    "source": "swissTLM3D",
                    "source_id": source_id,
                    "kind": kind_or_class,
                    "subtype": kind_or_class,
                    "center_latitude": (min_lat + max_lat) / 2,
                    "center_longitude": (min_lon + max_lon) / 2,
                    "min_latitude": min_lat,
                    "max_latitude": max_lat,
                    "min_longitude": min_lon,
                    "max_longitude": max_lon,
                    "height_meters": height,
                    "raw_tags": json.dumps(properties, ensure_ascii=False, separators=(",", ":")),
                    "imported_at": imported_at,
                    "geometry_wkb": geometry,
                    "geometry_crs": 2056,
                    "source_version": source_version,
                    "source_updated_at": imported_at,
                })
                stats[kind_or_class] += 1
            if len(batch) + len(land_batch) >= 1000:
                flush()
    flush()
    if finalize:
        finalize_swisstlm_import(connection, imported_at)
    return stats


def finalize_swisstlm_import(connection: sqlite3.Connection, imported_at: str) -> None:
    """Publish one complete swissTLM generation after every archive part was imported."""
    discard_old_official_generation(connection, imported_at)
    invalidate_enrichment(connection, environment=True)
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
    url = _PROVIDERS.swisstopoRasterItemsTemplate.format(collection=collection)
    url = f"{url}?{urllib.parse.urlencode(parameters)}"
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
                filename = Path(urllib.parse.urlparse(href).path).name.lower()
                is_geotiff = filename.endswith((".tif", ".tiff")) and "geotiff" in media_type.lower()
                if collection == _PROVIDERS.swissAltiCollection:
                    is_geotiff = is_geotiff and "_2_2056_5728." in filename
                elif collection == _PROVIDERS.swissSurfaceCollection:
                    is_geotiff = is_geotiff and "_0.5_2056_5728." in filename
                if is_geotiff:
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
