"""Shared bounded raster cache. Versioned asset URLs identify immutable tiles.

Workers share the existing worker lock while downloading/sampling. Files used by
one batch are pinned until both DTM and DSM sampling finish. Never evict a pinned
file merely to make an incomplete batch appear successful.
"""
from __future__ import annotations
import os
import time
from pathlib import Path

CACHE_LIMIT_BYTES = 160 * 1024**3


class RasterCache:
    def __init__(self, directory: Path, max_bytes=CACHE_LIMIT_BYTES):
        self.directory = directory
        self.max_bytes = min(max_bytes, CACHE_LIMIT_BYTES)
        self.pinned = set()
        directory.mkdir(parents=True, exist_ok=True)

    def pin(self, path):
        self.pinned.add(Path(path).resolve())
        if path.exists():
            os.utime(path, ns=(time.time_ns(), path.stat().st_mtime_ns))

    def trim(self, reserve=0):
        files = sorted(self.directory.rglob("*.tif"), key=lambda path: path.stat().st_atime_ns)
        size = sum(path.stat().st_size for path in files)
        for path in files:
            if size + reserve <= self.max_bytes:
                break
            if path.resolve() in self.pinned:
                continue
            size -= path.stat().st_size
            path.unlink()
            path.with_suffix(".tif.json").unlink(missing_ok=True)
        if size + reserve > self.max_bytes:
            raise RuntimeError("Raster cache is full of tiles pinned by this batch; reduce spatial batch size")
        return size
