"""Small resumable Copernicus GLO-90 cache for panorama border coverage."""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import math
import os
from argparse import Namespace
from dataclasses import dataclass
from pathlib import Path

from benchly.context.sources import download_file


COPERNICUS_GLO90_ROOT = "https://copernicus-dem-90m.s3.amazonaws.com"


@dataclass(frozen=True)
class DegreeCell:
    latitude: int
    longitude: int

    @property
    def stem(self) -> str:
        latitude = f"{'N' if self.latitude >= 0 else 'S'}{abs(self.latitude):02d}_00"
        longitude = f"{'E' if self.longitude >= 0 else 'W'}{abs(self.longitude):03d}_00"
        return f"Copernicus_DSM_COG_30_{latitude}_{longitude}_DEM"

    @property
    def url(self) -> str:
        return f"{COPERNICUS_GLO90_ROOT}/{self.stem}/{self.stem}.tif"


def required_glo90_cells(bench_index: Path, radius_km: float) -> list[DegreeCell]:
    coordinates = []
    for line_number, line in enumerate(bench_index.read_text().splitlines(), 1):
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) != 5:
            raise RuntimeError(f"invalid production bench index at line {line_number}")
        coordinates.append((float(fields[3]), float(fields[4])))
    if not coordinates:
        raise RuntimeError("production bench index is empty")
    latitudes, longitudes = zip(*coordinates)
    latitude_margin = radius_km / 111.32
    longitude_margin = radius_km / (111.32 * max(.2, math.cos(math.radians(max(map(abs, latitudes))))))
    return [
        DegreeCell(latitude, longitude)
        for latitude in range(math.floor(min(latitudes) - latitude_margin), math.floor(max(latitudes) + latitude_margin) + 1)
        for longitude in range(math.floor(min(longitudes) - longitude_margin), math.floor(max(longitudes) + longitude_margin) + 1)
    ]


def _fetch(cell: DegreeCell, destination: Path) -> tuple[DegreeCell, int, str, bool]:
    target = destination / f"{cell.stem}.tif"
    sidecar = target.with_suffix(".tif.json")
    if target.is_file() and sidecar.is_file():
        metadata = json.loads(sidecar.read_text())
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if metadata.get("sha256") == digest:
            return cell, target.stat().st_size, digest, False
    source_version = download_file(cell.url, target, max_bytes=16 * 1024**2)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    temporary = sidecar.with_suffix(".part")
    temporary.write_text(json.dumps({
        "collection": "Copernicus DEM GLO-90",
        "source_updated_at": source_version,
        "source_version": source_version,
        "url": cell.url,
        "sha256": digest,
    }, sort_keys=True) + "\n")
    os.replace(temporary, sidecar)
    return cell, target.stat().st_size, digest, True


def fetch_border_terrain_job(args: Namespace) -> None:
    destination = Path(args.source_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    cells = required_glo90_cells(Path(args.bench_index).resolve(), args.radius_km)
    completed = 0
    downloaded_bytes = 0
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(8, args.io_threads))) as executor:
        futures = {executor.submit(_fetch, cell, destination): cell for cell in cells}
        for future in concurrent.futures.as_completed(futures):
            cell = futures[future]
            try:
                _cell, size, _digest, downloaded = future.result()
                completed += 1
                if downloaded:
                    downloaded_bytes += size
            except Exception as error:
                failures.append(f"{cell.stem}: {error}")
    print(json.dumps({
        "cells": len(cells),
        "ready": completed,
        "downloaded_bytes": downloaded_bytes,
        "failed": len(failures),
        "errors": failures[:20],
    }, indent=2, sort_keys=True))
    if failures:
        raise RuntimeError(f"{len(failures)} border terrain downloads failed; rerun resumes completed cells")
