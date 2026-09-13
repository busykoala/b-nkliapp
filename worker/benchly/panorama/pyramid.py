"""Resumable, content-addressed terrain pyramid preparation for panorama rays."""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import math
import os
import re
import sqlite3
from argparse import Namespace
from dataclasses import dataclass
from pathlib import Path

import numpy as np


CELL_PATTERN = re.compile(r"_(\d{4})-(\d{4})_2_2056(?:_\d+)?\.tif$")
RESOLUTIONS = (10, 30, 90)
NODATA = 65_535


@dataclass(frozen=True)
class SourceCell:
    cell: str
    path: str
    input_key: str
    left: float
    bottom: float


@dataclass(frozen=True)
class PreparedCell:
    cell: str
    input_key: str
    arrays: tuple[tuple[int, np.ndarray], ...]


def _source_priority(path: Path) -> tuple[str, int, int]:
    sidecar = path.with_suffix(".tif.json")
    updated = ""
    if sidecar.exists():
        try:
            payload = json.loads(sidecar.read_text())
            updated = str(payload.get("source_updated_at") or payload.get("source_version") or "")
        except (OSError, ValueError):
            pass
    stat = path.stat()
    return updated, stat.st_mtime_ns, stat.st_size


def discover_source_cells(directory: Path) -> list[SourceCell]:
    """Select one newest source tile for every official 1-km terrain cell."""
    selected: dict[str, Path] = {}
    for path in directory.rglob("*.tif"):
        match = CELL_PATTERN.search(path.name)
        if not match:
            continue
        easting, northing = int(match.group(1)), int(match.group(2))
        cell = f"{easting}-{northing}"
        current = selected.get(cell)
        if current is None or _source_priority(path) > _source_priority(current):
            selected[cell] = path
    cells = []
    for cell, path in sorted(selected.items()):
        easting, northing = map(int, cell.split("-"))
        stat = path.stat()
        identity = hashlib.sha256(f"{path.resolve()}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()
        cells.append(SourceCell(cell, str(path.resolve()), identity, easting * 1_000, northing * 1_000))
    return cells


def _prepare_cell(cell: SourceCell) -> PreparedCell:
    import rasterio
    from rasterio.enums import Resampling

    arrays = []
    with rasterio.open(cell.path) as source:
        for resolution in RESOLUTIONS:
            size = math.ceil(1_000 / resolution)
            values = source.read(1, out_shape=(size, size), masked=True, resampling=Resampling.average)
            data = np.full((size, size), NODATA, dtype=np.uint16)
            valid = ~np.ma.getmaskarray(values)
            scaled = np.clip(np.rint(np.asarray(values.filled(0), dtype=np.float32) * 10), 0, NODATA - 1)
            data[valid] = scaled[valid].astype(np.uint16)
            arrays.append((resolution, data))
    return PreparedCell(cell.cell, cell.input_key, tuple(arrays))


def _state(path: Path) -> sqlite3.Connection:
    database = sqlite3.connect(path, timeout=60)
    database.execute("PRAGMA journal_mode=WAL")
    database.execute("PRAGMA synchronous=FULL")
    database.execute("""CREATE TABLE IF NOT EXISTS cells(
      resolution INTEGER NOT NULL,cell TEXT NOT NULL,input_key TEXT NOT NULL,status TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(resolution,cell))""")
    database.commit()
    return database


def _blank(dataset, nodata: int) -> None:
    for _index, window in dataset.block_windows(1):
        dataset.write(np.full((window.height, window.width), nodata, dtype=np.uint16), 1, window=window)


def ensure_memory_map(path: Path) -> Path:
    """Materialize an atomic raw companion shared by all extraction workers."""
    import rasterio

    target = path.with_suffix(".mmap")
    with rasterio.open(path) as source:
        expected = source.width * source.height * np.dtype(source.dtypes[0]).itemsize
        if target.is_file() and target.stat().st_size == expected:
            return target
        temporary = target.with_suffix(".part")
        mapped = np.memmap(
            temporary, dtype=source.dtypes[0], mode="w+", shape=(source.height, source.width),
        )
        for _index, window in source.block_windows(1):
            mapped[
                int(window.row_off):int(window.row_off + window.height),
                int(window.col_off):int(window.col_off + window.width),
            ] = source.read(1, window=window)
        mapped.flush()
        del mapped
    os.replace(temporary, target)
    return target


def prepare_terrain_pyramid_job(args: Namespace) -> None:
    """Create 10/30/90-m regional COG-like GeoTIFFs beside the 2-m source."""
    import rasterio
    from affine import Affine
    from rasterio.windows import Window

    source = Path(args.source_dir).resolve()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    cells = discover_source_cells(source)
    if not cells:
        raise RuntimeError("no swissALTI3D 1-km source cells found")
    source_key = hashlib.sha256("".join(f"{cell.cell}:{cell.input_key}\n" for cell in cells).encode()).hexdigest()
    min_x = int(min(cell.left for cell in cells))
    max_x = int(max(cell.left for cell in cells) + 1_000)
    min_y = int(min(cell.bottom for cell in cells))
    max_y = int(max(cell.bottom for cell in cells) + 1_000)
    database = _state(output / "progress.sqlite")
    datasets = {}
    temporary_paths = {}
    final_paths = {}
    for resolution in RESOLUTIONS:
        directory = output / f"{resolution}m"
        directory.mkdir(parents=True, exist_ok=True)
        final = directory / f"terrain-{source_key[:20]}-{resolution}m.tif"
        temporary = final.with_suffix(".part.tif")
        final_paths[resolution] = final
        temporary_paths[resolution] = temporary
        if final.exists():
            continue
        width = math.ceil((max_x - min_x) / resolution)
        height = math.ceil((max_y - min_y) / resolution)
        if not temporary.exists():
            database.execute("DELETE FROM cells WHERE resolution=?", (resolution,))
            dataset = rasterio.open(
                temporary, "w", driver="GTiff", width=width, height=height, count=1, dtype="uint16",
                crs="EPSG:2056", transform=Affine(resolution, 0, min_x, 0, -resolution, max_y),
                nodata=NODATA, tiled=True, blockxsize=512, blockysize=512,
                compress="ZSTD", predictor=2, BIGTIFF="IF_SAFER", NUM_THREADS="ALL_CPUS",
            )
            dataset.scales = (0.1,)
            dataset.offsets = (0.0,)
            _blank(dataset, NODATA)
            dataset.close()
            database.commit()
        datasets[resolution] = rasterio.open(temporary, "r+")

    ready = {(int(row[0]), str(row[1]), str(row[2])) for row in database.execute(
        "SELECT resolution,cell,input_key FROM cells WHERE status='ready'"
    )}
    pending = [cell for cell in cells if any(
        resolution in datasets and (resolution, cell.cell, cell.input_key) not in ready for resolution in RESOLUTIONS
    )]
    worker_count = min(12, max(1, args.cpu_workers), max(1, args.memory_limit_gib // 4))
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=worker_count) as executor:
            futures = {executor.submit(_prepare_cell, cell): cell for cell in pending}
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                source_cell = futures[future]
                for resolution, array in result.arrays:
                    dataset = datasets.get(resolution)
                    if dataset is None or (resolution, result.cell, result.input_key) in ready:
                        continue
                    col = round((source_cell.left - min_x) / resolution)
                    row = round((max_y - (source_cell.bottom + 1_000)) / resolution)
                    height = min(array.shape[0], dataset.height - row)
                    width = min(array.shape[1], dataset.width - col)
                    dataset.write(array[:height, :width], 1, window=Window(col, row, width, height))
                    database.execute("INSERT OR REPLACE INTO cells(resolution,cell,input_key,status) VALUES(?,?,?,'ready')",
                                     (resolution, result.cell, result.input_key))
                database.commit()
        for resolution, dataset in datasets.items():
            dataset.close()
            expected = len(cells)
            complete = int(database.execute(
                "SELECT count(*) FROM cells WHERE resolution=? AND status='ready'", (resolution,)
            ).fetchone()[0])
            if complete != expected:
                raise RuntimeError(f"terrain pyramid {resolution}m is incomplete: {complete}/{expected}")
            os.replace(temporary_paths[resolution], final_paths[resolution])
            sidecar = final_paths[resolution].with_suffix(".tif.json")
            sidecar.write_text(json.dumps({
                "collection": "swissALTI3D derived pyramid", "source_version": source_key,
                "resolution_meters": resolution, "source_cells": expected,
            }, sort_keys=True) + "\n")
        for path in final_paths.values():
            ensure_memory_map(path)
    finally:
        for dataset in datasets.values():
            if not dataset.closed:
                dataset.close()
        database.close()
    print(json.dumps({
        "source_cells": len(cells), "source_key": source_key, "cpu_workers": worker_count,
        "outputs": {str(resolution): str(path) for resolution, path in final_paths.items()},
        "shared_memory_maps": {str(resolution): str(path.with_suffix('.mmap')) for resolution, path in final_paths.items()},
    }, indent=2, sort_keys=True))
