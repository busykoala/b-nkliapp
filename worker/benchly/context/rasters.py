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
    def __init__(self, directory: Path | None, max_open=8, max_cached_blocks=96):
        self.max_open = max(1, min(max_open, 32))
        self.max_cached_blocks = max(0, max_cached_blocks)
        self.handles = OrderedDict()
        # Nearby panorama viewpoints repeatedly touch almost exactly the same
        # compressed COG blocks. GDAL's process cache avoids disk I/O, but it
        # still decompresses and masks those blocks for every bench. Keep a
        # small, process-local LRU of the already decoded arrays instead.
        self.blocks = OrderedDict()
        self.mapped = {}
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

    def _mapped_array(self, name, dataset):
        """Open an optional raw pyramid companion through the OS page cache."""
        if name in self.mapped:
            return self.mapped[name]
        path = Path(name).with_suffix(".mmap")
        dtype = dataset.dtypes[0]
        expected = dataset.width * dataset.height * __import__("numpy").dtype(dtype).itemsize
        if not path.is_file() or path.stat().st_size != expected:
            self.mapped[name] = None
            return None
        import numpy as np
        mapped = np.memmap(path, dtype=dtype, mode="r", shape=(dataset.height, dataset.width))
        self.mapped[name] = mapped
        return mapped

    def _candidates(self, latitude, longitude):
        bucket = (int(math.floor(longitude * 20)), int(math.floor(latitude * 20)))
        return [item for item in self._footprint_grid.get(bucket, ())
                if item["min_lon"] <= longitude <= item["max_lon"]
                and item["min_lat"] <= latitude <= item["max_lat"]]

    def describe_point(self, latitude: float, longitude: float) -> dict[str, object]:
        """Return diagnostic source metadata without pretending a vertical CRS exists."""
        candidates = self._candidates(latitude, longitude)
        if not candidates:
            return {"covered": False}
        item = candidates[0]
        try:
            dataset, _transformer = self._open(item["path"])
            crs = dataset.crs
            tags = dataset.tags()
            unit = (crs.linear_units if getattr(crs, "is_projected", False) else "degree") or "unknown"
            resolution = [abs(float(dataset.res[0])), abs(float(dataset.res[1]))]
            return {
                "covered": True,
                "asset": Path(item["path"]).name,
                "source": next((entry.get("source") for entry in self.datasets
                                if entry.get("asset") == Path(item["path"]).name), "supplied raster"),
                "version": item.get("version"),
                "horizontal_crs": str(crs),
                "pixel_resolution": {"x": resolution[0], "y": resolution[1], "unit": unit},
                "resolution_meters": resolution if unit.lower() in {"metre", "meter", "metres", "meters", "m"} else None,
                "nodata": dataset.nodata,
                "pixel_interpretation": tags.get("AREA_OR_POINT", "not declared"),
                "vertical_crs": str(crs) if getattr(crs, "is_vertical", False) else None,
                "height_reference_assumption": (
                    "The GeoTIFF does not encode a vertical CRS; heights are interpreted in metres "
                    "according to the named source dataset. No datum conversion is applied."
                ),
            }
        except (OSError, ValueError, IndexError):
            return {"covered": True, "asset": Path(item["path"]).name, "unreadable": True}

    def sample(self, latitude, longitude, interpolation="bilinear"):
        return self.sample_many([(latitude, longitude)], interpolation=interpolation)[0]

    def sample_many(self, points, interpolation="bilinear"):
        """Sample continuous raster values with bounded, tile-safe interpolation.

        Elevation is defined at pixel centres. Bilinear interpolation therefore
        shifts inverse pixel coordinates by half a cell, samples the four cell
        centres through the full collection, and renormalizes around nodata.
        Resolving those neighbours through the collection (rather than one
        dataset window) also crosses adjacent tile and edition boundaries.
        """
        points = list(points)
        if interpolation == "nearest":
            return self._sample_many_nearest(points)
        if interpolation != "bilinear":
            raise ValueError(f"unsupported raster interpolation: {interpolation}")
        output = []
        # Panorama batches contain hundreds of thousands of points. Keep the
        # temporary four-neighbour expansion bounded for multi-process builds.
        for offset in range(0, len(points), 32_768):
            output.extend(self._sample_many_bilinear_chunk(points[offset:offset + 32_768]))
        return output

    def _sample_many_bilinear_chunk(self, points):
        import numpy as np

        points = list(points)
        output = [None] * len(points)
        if self.index is None or not points:
            return output
        grouped = {}
        for index, (latitude, longitude) in enumerate(points):
            candidates = self._candidates(latitude, longitude)
            if candidates:
                grouped.setdefault(candidates[0]["path"], []).append((index, latitude, longitude))
        neighbour_points = []
        neighbour_owners = []
        neighbour_weights = []
        for name, values in grouped.items():
            try:
                dataset, to_dataset = self._open(name)
                to_wgs84 = Transformer.from_crs(dataset.crs, 4326, always_xy=True)
                latitudes = np.fromiter((value[1] for value in values), dtype=np.float64)
                longitudes = np.fromiter((value[2] for value in values), dtype=np.float64)
                eastings, northings = to_dataset.transform(longitudes, latitudes)
                columns, rows = (~dataset.transform) * (np.asarray(eastings), np.asarray(northings))
                centered_columns = np.asarray(columns) - .5
                centered_rows = np.asarray(rows) - .5
                left = np.floor(centered_columns).astype(np.int64)
                top = np.floor(centered_rows).astype(np.int64)
                x_fraction = centered_columns - left
                y_fraction = centered_rows - top
                for position, (index, _latitude, _longitude) in enumerate(values):
                    for row, y_weight in ((top[position], 1 - y_fraction[position]),
                                          (top[position] + 1, y_fraction[position])):
                        for column, x_weight in ((left[position], 1 - x_fraction[position]),
                                                 (left[position] + 1, x_fraction[position])):
                            weight = float(x_weight * y_weight)
                            if weight <= 1e-12:
                                continue
                            easting, northing = dataset.transform * (float(column) + .5, float(row) + .5)
                            longitude, latitude = to_wgs84.transform(easting, northing)
                            neighbour_points.append((latitude, longitude))
                            neighbour_owners.append(index)
                            neighbour_weights.append(weight)
            except (OSError, ValueError, IndexError):
                continue
        values = self._sample_many_nearest(neighbour_points)
        totals = np.zeros(len(points), dtype=np.float64)
        weights = np.zeros(len(points), dtype=np.float64)
        for owner, weight, value in zip(neighbour_owners, neighbour_weights, values):
            if value is None:
                continue
            totals[owner] += float(value) * weight
            weights[owner] += weight
        for index in np.flatnonzero(weights > 0):
            output[int(index)] = float(totals[index] / weights[index])
        return output

    def _sample_many_nearest(self, points):
        """Sample a point batch while opening and transforming each tile once."""
        import numpy as np
        from rasterio.windows import Window

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
                output_indices = np.fromiter((value[0] for value in values), dtype=np.int64)
                latitudes = np.fromiter((value[1] for value in values), dtype=np.float64)
                longitudes = np.fromiter((value[2] for value in values), dtype=np.float64)
                eastings, northings = transformer.transform(longitudes, latitudes)
                columns, rows = (~dataset.transform) * (np.asarray(eastings), np.asarray(northings))
                columns = np.floor(columns).astype(np.int64)
                rows = np.floor(rows).astype(np.int64)
                valid = (rows >= 0) & (rows < dataset.height) & (columns >= 0) & (columns < dataset.width)
                if not np.any(valid):
                    return

                mapped = self._mapped_array(name, dataset)
                if mapped is not None:
                    positions = np.flatnonzero(valid)
                    raw = np.asarray(mapped[rows[positions], columns[positions]])
                    numbers = raw.astype(np.float64) * dataset.scales[0] + dataset.offsets[0]
                    usable = np.isfinite(numbers)
                    if dataset.nodata is not None:
                        usable &= raw != dataset.nodata
                    for output_index, number in zip(output_indices[positions][usable], numbers[usable]):
                        output[int(output_index)] = float(number)
                    return

                # rasterio.dataset.sample creates a masked array and a one-pixel
                # GDAL read for every coordinate. A panorama contains nearly
                # half a million coordinates, but only touches a modest number
                # of raster blocks. Read each touched block once and index it
                # with NumPy instead. This preserves nearest-neighbour sampling
                # while removing millions of Python objects per bench.
                block_height, block_width = dataset.block_shapes[0]
                valid_positions = np.flatnonzero(valid)
                block_rows = rows[valid_positions] // block_height
                block_columns = columns[valid_positions] // block_width
                order = np.lexsort((block_columns, block_rows))
                sorted_positions = valid_positions[order]
                sorted_block_rows = block_rows[order]
                sorted_block_columns = block_columns[order]
                boundaries = np.flatnonzero(
                    (np.diff(sorted_block_rows) != 0) | (np.diff(sorted_block_columns) != 0)
                ) + 1
                for positions in np.split(sorted_positions, boundaries):
                    if not len(positions):
                        continue
                    block_row = int(rows[positions[0]] // block_height)
                    block_column = int(columns[positions[0]] // block_width)
                    row_offset = block_row * block_height
                    column_offset = block_column * block_width
                    window = Window(
                        column_offset,
                        row_offset,
                        min(block_width, dataset.width - column_offset),
                        min(block_height, dataset.height - row_offset),
                    )
                    cache_key = (name, block_row, block_column)
                    if cache_key in self.blocks:
                        block = self.blocks.pop(cache_key)
                        self.blocks[cache_key] = block
                    else:
                        block = dataset.read(1, window=window, masked=True)
                        if self.max_cached_blocks:
                            self.blocks[cache_key] = block
                            while len(self.blocks) > self.max_cached_blocks:
                                self.blocks.popitem(last=False)
                    selected = block[
                        rows[positions] - row_offset,
                        columns[positions] - column_offset,
                    ]
                    numbers = np.asarray(selected, dtype=np.float64) * dataset.scales[0] + dataset.offsets[0]
                    selected_mask = np.ma.getmaskarray(selected)
                    usable = (~selected_mask) & np.isfinite(numbers)
                    for output_index, number in zip(output_indices[positions][usable], numbers[usable]):
                        output[int(output_index)] = float(number)
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
        self.blocks.clear()
        self.mapped.clear()
        if self.index:
            self.index.close()
            self.index = None
