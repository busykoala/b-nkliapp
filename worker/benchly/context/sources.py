"""Bounded downloads and STAC discovery for official context data."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from benchly.catalog import load_catalog
from benchly.context.contracts import StacPage
from benchly.runtime import now_iso

_PROVIDERS = load_catalog().providers


def download_file(url: str, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (+https://github.com/benchly)"})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
        version = response.headers.get("Last-Modified") or response.headers.get("ETag") or now_iso()
    temporary.replace(destination)
    return version


def discover_swisstlm_asset() -> tuple[str, str]:
    endpoint = os.environ.get("SWISSTLM_STAC_ITEMS", str(_PROVIDERS.swissTlmItemsUrl))
    request = urllib.request.Request(endpoint, headers={"User-Agent": "Benchly/1.0 (official context import)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = StacPage.model_validate(json.load(response))
    candidates: list[tuple[str, str]] = []
    for item in payload.features:
        version = str(item.properties.datetime or item.id or now_iso())
        for asset in item.assets.values():
            href = str(asset.href)
            label = f"{asset.title} {href}".lower()
            if href.endswith(".zip") and any(token in label for token in ("gpkg", "geopackage", "lv95")):
                candidates.append((version, href))
    if not candidates:
        raise RuntimeError("No swissTLM3D GeoPackage archive found in the official STAC collection")
    return sorted(candidates, reverse=True)[0]


def discover_swissbuildings_assets(bounds: tuple[float, float, float, float]) -> list[dict[str, str]]:
    endpoint = os.environ.get("SWISSBUILDINGS_STAC_ITEMS", str(_PROVIDERS.swissBuildingsItemsUrl))
    separator = "&" if "?" in endpoint else "?"
    bbox = ",".join(f"{value:.6f}" for value in bounds)
    url: str | None = f"{endpoint}{separator}{urllib.parse.urlencode({'limit': 100, 'bbox': bbox})}"
    candidates: dict[str, dict[str, str]] = {}
    pages = 0
    while url and pages < 10:
        request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0 (3D building import)"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = StacPage.model_validate(json.load(response))
        for item in payload.features:
            version = str(item.properties.datetime or item.id or now_iso())
            item_id = str(item.id or hashlib.sha256(version.encode()).hexdigest()[:16])
            for asset in item.assets.values():
                href = str(asset.href)
                filename = Path(urllib.parse.urlparse(href).path).name.lower()
                if filename.endswith("_2056_5728.gdb.zip"):
                    candidates[item_id] = {"id": item_id, "version": version, "url": href}
        url = next((str(link.href) for link in payload.links if link.rel == "next"), None)
        pages += 1
    return sorted(candidates.values(), key=lambda item: item["id"])


def safe_extract_zip(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        root = destination.resolve()
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if root not in target.parents and target != root:
                raise RuntimeError("Unsafe path in official data archive")
        bundle.extractall(destination)


def download_stac_tiles(connection: sqlite3.Connection, collection: str, destination: Path,
                        max_tiles: int | None = None,
                        bounds: tuple[float, float, float, float] | None = None,
                        max_bytes: int | None = None) -> int:
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
            page = StacPage.model_validate(json.load(response))
        for item in page.features:
            bbox = item.bbox
            if not bbox or len(bbox) < 4:
                continue
            if bounds and (bbox[2] < bounds[0] or bbox[0] > bounds[2] or bbox[3] < bounds[1] or bbox[1] > bounds[3]):
                continue
            if not bounds:
                needed = connection.execute("""
                    SELECT 1 FROM bench_spatial_index s JOIN benches b ON b.row_id=s.row_id
                    WHERE b.active=1 AND s.max_longitude>=? AND s.min_longitude<=?
                      AND s.max_latitude>=? AND s.min_latitude<=? LIMIT 1
                """, (bbox[0], bbox[2], bbox[1], bbox[3])).fetchone()
                if not needed:
                    continue
            candidates: list[str] = []
            for asset in item.assets.values():
                href = str(asset.href)
                filename = Path(urllib.parse.urlparse(href).path).name.lower()
                is_geotiff = filename.endswith((".tif", ".tiff")) and "geotiff" in asset.type.lower()
                if collection == _PROVIDERS.swissAltiCollection:
                    is_geotiff = is_geotiff and "_2_2056_5728." in filename
                elif collection == _PROVIDERS.swissSurfaceCollection:
                    is_geotiff = is_geotiff and "_0.5_2056_5728." in filename
                if is_geotiff:
                    candidates.append(href)
            for href in candidates:
                if href in seen_assets or (max_tiles is not None and downloaded >= max_tiles):
                    continue
                seen_assets.add(href)
                target = destination / Path(urllib.parse.urlparse(href).path).name
                if not target.exists():
                    print(f"Downloading {collection}: {target.name}", file=sys.stderr)
                    download_file(href, target)
                    downloaded_bytes += target.stat().st_size
                    if max_bytes is not None and downloaded_bytes > max_bytes:
                        target.unlink(missing_ok=True)
                        raise RuntimeError(f"STAC download limit exceeded for {collection}: {max_bytes} bytes")
                downloaded += 1
        next_link = next((str(link.href) for link in page.links if link.rel == "next"), None)
        url = urllib.parse.urljoin(url, next_link) if next_link else ""
    return downloaded
