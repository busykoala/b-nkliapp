"""Persistent footprint index and a small LRU of open GeoTIFF handles."""
from __future__ import annotations
from collections import OrderedDict
import json
import math
from pathlib import Path
from typing import Optional
from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert
from sqlmodel import Field, SQLModel
from benchly.db import open_database, write
import sys
from pyproj import Transformer


class RasterTile(SQLModel, table=True):
    __tablename__ = "raster_tiles"
    id: Optional[int] = Field(default=None, primary_key=True)
    path: str = Field(unique=True)
    size: int
    mtime: int
    metadata_json: str


class RasterFootprint(SQLModel, table=True):
    __tablename__ = "raster_footprints"
    id: int = Field(primary_key=True)
    min_lon: float
    max_lon: float
    min_lat: float
    max_lat: float


class RasterCollection:
    def __init__(self, directory: Path | None, max_open=8):
        self.max_open = max(1, min(max_open, 32))
        self.handles = OrderedDict()
        self.datasets = []  # lightweight metadata, never a handle per national tile
        self.index = None
        if not directory or not directory.exists():
            return
        import rasterio
        from rasterio.warp import transform_bounds
        self.index = open_database(directory / ".footprints-v1.sqlite")
        self.index.create_tables([RasterTile])
        self.index.execute("CREATE VIRTUAL TABLE IF NOT EXISTS raster_footprints USING rtree(id,min_lon,max_lon,min_lat,max_lat)")
        self.index.commit()
        existing = {row["path"]: row for row in self.index.execute("SELECT * FROM raster_tiles")}
        seen = set()
        for path in sorted(directory.rglob("*.tif")):
            name = str(path.resolve())
            seen.add(name)
            stat = path.stat()
            row = existing.get(name)
            if row and row["size"] == stat.st_size and row["mtime"] == stat.st_mtime_ns:
                self.datasets.append(json.loads(row["metadata_json"]))
                continue
            try:
                with rasterio.open(path) as dataset:
                    if not dataset.crs or dataset.count != 1:
                        continue
                    bounds = transform_bounds(dataset.crs, "EPSG:4326", *dataset.bounds, densify_pts=21)
                    sidecar = path.with_suffix(".tif.json")
                    source = json.loads(sidecar.read_text()) if sidecar.exists() else {}
                    metadata = {"asset": path.name, "source": source.get("collection", "supplied raster"),
                        "source_updated_at": source.get("source_updated_at"),
                        "version": source.get("source_version") or dataset.tags().get("dataset_version"),
                        "crs": str(dataset.crs), "resolution_meters": list(dataset.res)}
                statement = insert(RasterTile).values(path=name, size=stat.st_size, mtime=stat.st_mtime_ns, metadata_json=json.dumps(metadata))
                write(self.index, statement.on_conflict_do_update(index_elements=["path"], set_={field: getattr(statement.excluded, field) for field in ("size", "mtime", "metadata_json")}))
                row_id = self.index.execute("SELECT id FROM raster_tiles WHERE path=?", (name,)).fetchone()[0]
                write(self.index, delete(RasterFootprint).where(RasterFootprint.id == row_id))
                write(self.index, insert(RasterFootprint).values(id=row_id, min_lon=bounds[0], max_lon=bounds[2], min_lat=bounds[1], max_lat=bounds[3]))
                self.datasets.append(metadata)
            except Exception as error:
                print(f"Skipping invalid raster {path.name}: {error}", file=sys.stderr)
                if row:
                    write(self.index, delete(RasterFootprint).where(RasterFootprint.id == row["id"]))
                    write(self.index, delete(RasterTile).where(RasterTile.id == row["id"]))
        for name, row in existing.items():
            if name not in seen:
                write(self.index, delete(RasterFootprint).where(RasterFootprint.id == row["id"]))
                write(self.index, delete(RasterTile).where(RasterTile.id == row["id"]))
        self.index.commit()

    def sample(self, latitude, longitude):
        if self.index is None:
            return None
        import rasterio
        rows = self.index.execute("""SELECT t.path FROM raster_footprints s JOIN raster_tiles t ON t.id=s.id
            WHERE s.min_lon<=? AND s.max_lon>=? AND s.min_lat<=? AND s.max_lat>=?
            ORDER BY json_extract(t.metadata_json,'$.source_updated_at') DESC,json_extract(t.metadata_json,'$.version') DESC,t.path DESC""",
            (longitude, longitude, latitude, latitude))
        for row in rows:
            name = row[0]
            try:
                if name in self.handles:
                    dataset, transform = self.handles.pop(name)
                else:
                    if len(self.handles) >= self.max_open:
                        self.handles.popitem(last=False)[1][0].close()
                    dataset = rasterio.open(name)
                    transform = Transformer.from_crs(4326, dataset.crs, always_xy=True)
                self.handles[name] = (dataset, transform)
                x, y = transform.transform(longitude, latitude)
                if not (dataset.bounds.left <= x < dataset.bounds.right and dataset.bounds.bottom < y <= dataset.bounds.top):
                    continue
                raw = next(dataset.sample([(x, y)], masked=True))[0]
                if not getattr(raw, "mask", False):
                    value = float(raw) * dataset.scales[0] + dataset.offsets[0]
                    if math.isfinite(value):
                        return value
            except (OSError, ValueError, IndexError):
                continue
        return None

    def close(self):
        for dataset, _ in self.handles.values():
            dataset.close()
        self.handles.clear()
        if self.index:
            self.index.close()
            self.index = None
