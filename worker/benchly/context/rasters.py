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
        self.footprints = []
        self._footprint_grid = {}
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

        # Keep the small footprint catalogue in memory. Panorama sampling can
        # address hundreds of thousands of points per viewpoint; an RTree SQL
        # lookup and CRS transformer construction per point would dominate the
        # actual raster work.
        for row in self.index.execute("""SELECT t.path,f.min_lon,f.max_lon,f.min_lat,f.max_lat,
                json_extract(t.metadata_json,'$.source_updated_at') source_updated_at,
                json_extract(t.metadata_json,'$.version') version
            FROM raster_footprints f JOIN raster_tiles t ON t.id=f.id
            ORDER BY source_updated_at DESC,version DESC,t.path DESC"""):
            item = dict(row)
            self.footprints.append(item)
            min_x, max_x = int(math.floor(item["min_lon"] * 20)), int(math.floor(item["max_lon"] * 20))
            min_y, max_y = int(math.floor(item["min_lat"] * 20)), int(math.floor(item["max_lat"] * 20))
            for x in range(min_x, max_x + 1):
                for y in range(min_y, max_y + 1):
                    self._footprint_grid.setdefault((x, y), []).append(item)

    def _open(self, name):
        import rasterio
        if name in self.handles:
            dataset, transform = self.handles.pop(name)
        else:
            if len(self.handles) >= self.max_open:
                self.handles.popitem(last=False)[1][0].close()
            dataset = rasterio.open(name)
            transform = Transformer.from_crs(4326, dataset.crs, always_xy=True)
        self.handles[name] = (dataset, transform)
        return dataset, transform

    def _candidates(self, latitude, longitude):
        bucket = (int(math.floor(longitude * 20)), int(math.floor(latitude * 20)))
        return [item for item in self._footprint_grid.get(bucket, ())
                if item["min_lon"] <= longitude <= item["max_lon"]
                and item["min_lat"] <= latitude <= item["max_lat"]]

    def sample(self, latitude, longitude):
        return self.sample_many([(latitude, longitude)])[0]

    def sample_many(self, points):
        """Sample a point batch while opening and transforming each tile once."""
        points = list(points)
        output = [None] * len(points)
        if self.index is None or not points:
            return output
        grouped = {}
        fallbacks = {}
        for index, (latitude, longitude) in enumerate(points):
            candidates = self._candidates(latitude, longitude)
            if candidates:
                grouped.setdefault(candidates[0]["path"], []).append((index, latitude, longitude))
                if len(candidates) > 1:
                    fallbacks[index] = candidates[1:]

        def sample_group(name, values):
            try:
                dataset, transformer = self._open(name)
                coordinates = [transformer.transform(longitude, latitude) for _index, latitude, longitude in values]
                raw_values = dataset.sample(coordinates, masked=True)
                for (index, _latitude, _longitude), raw in zip(values, raw_values):
                    value = raw[0]
                    if getattr(value, "mask", False):
                        continue
                    number = float(value) * dataset.scales[0] + dataset.offsets[0]
                    if math.isfinite(number):
                        output[index] = number
            except (OSError, ValueError, IndexError):
                return

        for name, values in grouped.items():
            sample_group(name, values)
        # Overlapping editions are ordered newest-first. Consult an older tile
        # only for points where the preferred asset returned nodata.
        remaining = {index: list(candidates) for index, candidates in fallbacks.items()}
        while remaining:
            retry = {}
            for index, candidates in list(remaining.items()):
                if output[index] is not None or not candidates:
                    remaining.pop(index)
                    continue
                candidate = candidates.pop(0)
                retry.setdefault(candidate["path"], []).append((index, points[index][0], points[index][1]))
            if not retry:
                break
            for name, values in retry.items():
                sample_group(name, values)
        return output

    def close(self):
        for dataset, _ in self.handles.values():
            dataset.close()
        self.handles.clear()
        if self.index:
            self.index.close()
            self.index = None
