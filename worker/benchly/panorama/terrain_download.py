"""Resumable latest-only swissALTI3D acquisition for the panorama model."""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request
from argparse import Namespace
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pyproj import Transformer

from benchly.context.contracts import StacPage
from benchly.context.sources import download_file
from benchly.runtime import now_iso, sha256_file
from benchly.settings import PROVIDERS


TERRAIN_ASSET_PATTERN = re.compile(r"_(\d{4})-(\d{4})_2_2056_5728\.tif$")


@dataclass(frozen=True)
class TerrainAsset:
    cell: tuple[int, int]
    href: str
    item_id: str
    source_updated_at: str


def required_terrain_cells(bench_index: Path, radius_km: int) -> set[tuple[int, int]]:
    """Return the compact union of kilometre cells around production benches."""
    transformer = Transformer.from_crs(4326, 2056, always_xy=True)
    bench_cells: set[tuple[int, int]] = set()
    for line_number, line in enumerate(bench_index.read_text().splitlines(), 1):
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) != 5:
            raise RuntimeError(f"invalid production bench index at line {line_number}")
        latitude, longitude = float(fields[3]), float(fields[4])
        easting, northing = transformer.transform(longitude, latitude)
        bench_cells.add((int(easting // 1_000), int(northing // 1_000)))
    if not bench_cells:
        raise RuntimeError("production bench index is empty")
    minimum_x = min(cell[0] for cell in bench_cells) - radius_km
    maximum_x = max(cell[0] for cell in bench_cells) + radius_km
    minimum_y = min(cell[1] for cell in bench_cells) - radius_km
    maximum_y = max(cell[1] for cell in bench_cells) + radius_km
    coverage = np.zeros((maximum_y - minimum_y + 1, maximum_x - minimum_x + 1), dtype=np.bool_)
    for easting, northing in bench_cells:
        left, right = easting - radius_km - minimum_x, easting + radius_km - minimum_x + 1
        bottom, top = northing - radius_km - minimum_y, northing + radius_km - minimum_y + 1
        coverage[bottom:top, left:right] = True
    rows, columns = np.nonzero(coverage)
    return {(int(column + minimum_x), int(row + minimum_y)) for row, column in zip(rows, columns)}


def newest_assets(page: StacPage, required: set[tuple[int, int]], selected: dict[tuple[int, int], TerrainAsset]) -> None:
    """Keep only the newest official 2-m GeoTIFF for each required cell."""
    for item in page.features:
        updated = str(item.properties.datetime or item.id or "")
        for asset in item.assets.values():
            href = str(asset.href)
            filename = Path(urllib.parse.urlparse(href).path).name
            match = TERRAIN_ASSET_PATTERN.search(filename)
            if not match or "geotiff" not in asset.type.lower():
                continue
            cell = int(match.group(1)), int(match.group(2))
            if cell not in required:
                continue
            candidate = TerrainAsset(cell, href, str(item.id), updated)
            current = selected.get(cell)
            if current is None or (candidate.source_updated_at, candidate.item_id, candidate.href) > (
                current.source_updated_at, current.item_id, current.href
            ):
                selected[cell] = candidate


def _fetch_page(url: str, cache_directory: Path) -> StacPage:
    cache_directory.mkdir(parents=True, exist_ok=True)
    cached = cache_directory / f"{hashlib.sha256(url.encode()).hexdigest()}.json"
    error: Exception | None = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Benchly (panorama terrain model)"})
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = response.read()
            StacPage.model_validate_json(payload)
            temporary = cached.with_suffix(".part")
            temporary.write_bytes(payload)
            os.replace(temporary, cached)
            return StacPage.model_validate_json(payload)
        except Exception as exception:  # network retries deliberately include timeouts and malformed responses
            error = exception
            time.sleep(2**attempt)
    if cached.exists():
        return StacPage.model_validate_json(cached.read_bytes())
    raise RuntimeError(f"could not fetch STAC page {url}: {error}")


def discover_latest_assets(required: set[tuple[int, int]], cache_directory: Path) -> dict[tuple[int, int], TerrainAsset]:
    endpoint = str(PROVIDERS.swisstopoRasterItemsTemplate).format(collection=PROVIDERS.swissAltiCollection)
    url = f"{endpoint}?{urllib.parse.urlencode({'limit': 100})}"
    selected: dict[tuple[int, int], TerrainAsset] = {}
    seen_pages: set[str] = set()
    while url:
        if url in seen_pages:
            raise RuntimeError("cyclic STAC pagination link")
        seen_pages.add(url)
        page = _fetch_page(url, cache_directory)
        newest_assets(page, required, selected)
        next_link = next((str(link.href) for link in page.links if link.rel == "next"), "")
        url = urllib.parse.urljoin(url, next_link) if next_link else ""
    return selected


def _state(path: Path) -> sqlite3.Connection:
    database = sqlite3.connect(path, timeout=60)
    database.execute("PRAGMA journal_mode=WAL")
    database.execute("PRAGMA synchronous=FULL")
    database.execute("""CREATE TABLE IF NOT EXISTS terrain_downloads(
      cell TEXT PRIMARY KEY,href TEXT NOT NULL,item_id TEXT NOT NULL,source_updated_at TEXT NOT NULL,
      relative_path TEXT,status TEXT NOT NULL,sha256 TEXT,artifact_bytes INTEGER,error TEXT,updated_at TEXT NOT NULL
    )""")
    database.commit()
    return database


def _download_asset(asset: TerrainAsset, destination: Path) -> tuple[TerrainAsset, Path, str, int, bool]:
    asset_key = hashlib.sha256(asset.href.encode()).hexdigest()[:16]
    target = destination / f"{asset_key}-{Path(urllib.parse.urlparse(asset.href).path).name}"
    downloaded = not target.exists()
    if downloaded:
        error: Exception | None = None
        for attempt in range(4):
            try:
                download_file(asset.href, target)
                break
            except Exception as exception:
                error = exception
                time.sleep(2**attempt)
        else:
            raise RuntimeError(f"could not download {asset.href}: {error}")
    digest = sha256_file(target)
    sidecar = target.with_suffix(".tif.json")
    temporary = sidecar.with_suffix(".part")
    temporary.write_text(json.dumps({
        "url": asset.href,
        "collection": PROVIDERS.swissAltiCollection,
        "source_version": asset.item_id,
        "source_updated_at": asset.source_updated_at,
        "sha256": digest,
    }, sort_keys=True) + "\n")
    os.replace(temporary, sidecar)
    return asset, target, digest, target.stat().st_size, downloaded


def fetch_panorama_terrain_job(args: Namespace) -> None:
    destination = Path(args.source_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    required = required_terrain_cells(Path(args.bench_index).resolve(), args.radius_km)
    selected = discover_latest_assets(required, destination / ".stac-pages")
    database = _state(destination / "download-progress.sqlite")
    maximum_bytes = int(args.max_download_gib * 1024**3)
    completed_bytes = 0
    failures: list[str] = []
    try:
        ready = {str(row[0]): str(row[1]) for row in database.execute(
            "SELECT cell,href FROM terrain_downloads WHERE status='ready'"
        )}
        pending = [asset for cell, asset in sorted(selected.items()) if ready.get(f"{cell[0]}-{cell[1]}") != asset.href]
        workers = max(1, min(8, args.io_threads))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            remaining = iter(pending)
            futures: dict[concurrent.futures.Future, TerrainAsset] = {}
            for _ in range(workers):
                if asset := next(remaining, None):
                    futures[executor.submit(_download_asset, asset, destination)] = asset
            stop_scheduling = False
            while futures:
                done, _waiting = concurrent.futures.wait(futures, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:
                    asset = futures.pop(future)
                    cell = f"{asset.cell[0]}-{asset.cell[1]}"
                    try:
                        _asset, path, digest, size, downloaded = future.result()
                        if downloaded:
                            completed_bytes += size
                        if completed_bytes > maximum_bytes:
                            stop_scheduling = True
                            raise RuntimeError(f"terrain download exceeded {args.max_download_gib} GiB run limit")
                        database.execute("""INSERT OR REPLACE INTO terrain_downloads
                          (cell,href,item_id,source_updated_at,relative_path,status,sha256,artifact_bytes,error,updated_at)
                          VALUES(?,?,?,?,?,'ready',?,?,NULL,?)""", (
                            cell, asset.href, asset.item_id, asset.source_updated_at,
                            str(path.relative_to(destination)), digest, size, now_iso(),
                        ))
                    except Exception as exception:
                        failures.append(f"{cell}: {exception}")
                        database.execute("""INSERT OR REPLACE INTO terrain_downloads
                          (cell,href,item_id,source_updated_at,status,error,updated_at)
                          VALUES(?,?,?,?,'error',?,?)""", (
                            cell, asset.href, asset.item_id, asset.source_updated_at, str(exception), now_iso(),
                        ))
                    database.commit()
                    if not stop_scheduling and (next_asset := next(remaining, None)):
                        futures[executor.submit(_download_asset, next_asset, destination)] = next_asset
    finally:
        ready_count = int(database.execute("SELECT count(*) FROM terrain_downloads WHERE status='ready'").fetchone()[0])
        database.close()
    print(json.dumps({
        "required_cells": len(required),
        "available_cells": len(selected),
        "ready_cells": ready_count,
        "downloaded_bytes_this_run": completed_bytes,
        "failed": len(failures),
        "errors": failures[:20],
    }, indent=2, sort_keys=True))
    if failures:
        raise RuntimeError(f"{len(failures)} terrain downloads failed; rerun resumes completed cells")
