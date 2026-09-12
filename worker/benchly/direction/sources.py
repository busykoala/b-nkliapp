"""Persistent, retry-safe source access for the one-off direction analysis."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import random
import time
import urllib.parse
import urllib.request
import urllib.error

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.spatial import cKDTree

from benchly.context.geometry import WGS84_TO_LV95
from benchly.context.sources import download_file
from benchly.settings import DEFAULT_OSM_PBF_URL
from .model import DirectionSignal, axis_distribution

# SWISSIMAGE's current national mosaic is refreshed over a three-year cycle.
# Restrict discovery to that complete current cycle; walking the unfiltered
# collection would also enumerate every historical tile since 2017.
SWISSIMAGE_ITEMS = "https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissimage-dop10/items?limit=100&datetime=2023-01-01T00%3A00%3A00Z%2F.."


def cached_osm_pbf(cache_directory: Path, supplied: str | None, *, download: bool = False,
                   url: str = DEFAULT_OSM_PBF_URL) -> Path | None:
    if supplied:
        path = Path(supplied).resolve()
        if not path.exists():
            raise RuntimeError(f"OSM PBF does not exist: {path}")
        return path
    target = cache_directory / "osm" / Path(urllib.parse.urlparse(url).path).name
    if target.exists():
        return target
    if not download:
        return None
    download_file(url, target)
    return target


class OsmDirectionContext:
    """Bench-way axes and viewpoints extracted in one streaming PBF pass."""

    def __init__(self, path: Path | None):
        self.way_axes: dict[int, float] = {}
        self.viewpoints = np.empty((0, 2), dtype=float)
        self._tree: cKDTree | None = None
        if path is not None:
            self._read(path)

    def _read(self, path: Path) -> None:
        try:
            import osmium
        except ImportError as error:
            raise RuntimeError("OSM direction context requires pyosmium") from error
        cache = path.with_suffix(path.suffix + ".direction-v1.npz")
        identity = f"{path.stat().st_size}:{path.stat().st_mtime_ns}"
        if cache.exists():
            stored = np.load(cache, allow_pickle=False)
            if str(stored["identity"].item()) == identity:
                self.way_axes = {int(key): float(value) for key, value in zip(stored["way_ids"], stored["way_axes"])}
                self.viewpoints = stored["viewpoints"]
                self._tree = cKDTree(self.viewpoints) if len(self.viewpoints) else None
                return
        axes: dict[int, float] = {}
        viewpoints: list[tuple[float, float]] = []

        class Handler(osmium.SimpleHandler):
            def node(self, node) -> None:
                if node.tags.get("tourism") == "viewpoint" and node.location.valid():
                    viewpoints.append(WGS84_TO_LV95.transform(node.location.lon, node.location.lat))

            def way(self, way) -> None:
                locations = [(node.lon, node.lat) for node in way.nodes if node.location.valid()]
                if not locations:
                    return
                if way.tags.get("tourism") == "viewpoint":
                    longitude = sum(item[0] for item in locations) / len(locations)
                    latitude = sum(item[1] for item in locations) / len(locations)
                    viewpoints.append(WGS84_TO_LV95.transform(longitude, latitude))
                if way.tags.get("amenity") != "bench" or len(locations) < 2:
                    return
                coordinates = np.asarray([WGS84_TO_LV95.transform(*location) for location in locations], dtype=float)
                coordinates -= coordinates.mean(axis=0)
                covariance = coordinates.T @ coordinates
                values, vectors = np.linalg.eigh(covariance)
                vector = vectors[:, int(np.argmax(values))]
                axes[int(way.id)] = math.degrees(math.atan2(vector[0], vector[1])) % 180

        Handler().apply_file(str(path), locations=True)
        self.way_axes = axes
        self.viewpoints = np.asarray(viewpoints, dtype=float).reshape((-1, 2)) if viewpoints else np.empty((0, 2))
        self._tree = cKDTree(self.viewpoints) if len(self.viewpoints) else None
        temporary = cache.with_suffix(cache.suffix + ".part")
        with temporary.open("wb") as handle:
            np.savez_compressed(
                handle, identity=np.asarray(identity), way_ids=np.asarray(list(axes), dtype=np.int64),
                way_axes=np.asarray(list(axes.values()), dtype=float), viewpoints=self.viewpoints,
            )
        temporary.replace(cache)

    def viewpoint_distance(self, latitude: float, longitude: float) -> float | None:
        if self._tree is None:
            return None
        point = WGS84_TO_LV95.transform(longitude, latitude)
        distance, _index = self._tree.query(point)
        return float(distance)

    def way_axis_signal(self, osm_type: str, osm_id: int) -> DirectionSignal | None:
        axis = self.way_axes.get(osm_id) if osm_type == "way" else None
        if axis is None:
            return None
        return DirectionSignal("way_axis", axis_distribution(axis, 5.0), 2.4, {
            "axis_degrees": round(axis, 2), "osm_way_id": osm_id,
        })


class SwissImageCache:
    """Cache source metadata and small COG windows, never a national mosaic."""

    def __init__(self, directory: Path, *, requests_per_second: float = .5):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.catalog_path = directory / "stac-items.json"
        self.requests_per_second = max(.05, requests_per_second)
        self._last_request = 0.0
        self.items = self._load_catalog() if self.catalog_path.exists() else []
        self.grid: dict[tuple[int, int], list[dict[str, object]]] = {}
        for item in self.items:
            bbox = item["bbox"]
            for x in range(math.floor(float(bbox[0]) * 100), math.floor(float(bbox[2]) * 100) + 1):
                for y in range(math.floor(float(bbox[1]) * 100), math.floor(float(bbox[3]) * 100) + 1):
                    self.grid.setdefault((x, y), []).append(item)

    def _load_catalog(self) -> list[dict[str, object]]:
        payload = json.loads(self.catalog_path.read_text())
        if payload.get("catalog_version") != 2:
            return []
        return list(payload.get("items", []))

    def refresh_catalog(self) -> int:
        items: dict[str, dict[str, object]] = {}
        url: str | None = SWISSIMAGE_ITEMS
        page_number = 0
        catalog_key = hashlib.sha256(SWISSIMAGE_ITEMS.encode()).hexdigest()[:12]
        pages = self.directory / f"stac-pages-{catalog_key}"
        pages.mkdir(parents=True, exist_ok=True)
        while url:
            page_number += 1
            page_path = pages / f"{page_number:04}.json"
            payload = json.loads(page_path.read_text()) if page_path.exists() else self._request_json(url, page_path)
            if page_number % 25 == 0:
                print(json.dumps({"source": "SWISSIMAGE STAC", "cached_pages": page_number, "items": len(items)}), flush=True)
            for feature in payload.get("features", []):
                candidates = []
                for asset in feature.get("assets", {}).values():
                    if float(asset.get("gsd", 999)) <= .26 and str(asset.get("href", "")).endswith(".tif"):
                        candidates.append(asset)
                if candidates and feature.get("bbox"):
                    asset = candidates[0]
                    items[str(feature["id"])] = {
                        "id": feature["id"], "bbox": feature["bbox"], "datetime": feature.get("properties", {}).get("datetime"),
                        "href": asset["href"], "checksum": asset.get("file:checksum"), "gsd": asset.get("gsd", .1),
                    }
            next_link = next((link.get("href") for link in payload.get("links", []) if link.get("rel") == "next"), None)
            url = urllib.parse.urljoin(url, next_link) if next_link else None
        temporary = self.catalog_path.with_suffix(".json.part")
        temporary.write_text(json.dumps({"catalog_version": 2, "source": SWISSIMAGE_ITEMS, "items": list(items.values())}, separators=(",", ":")))
        temporary.replace(self.catalog_path)
        self.items = list(items.values())
        self.__init__(self.directory, requests_per_second=self.requests_per_second)
        return len(self.items)

    def _request_json(self, url: str, target: Path) -> dict[str, object]:
        metadata_path = target.with_suffix(".meta.json")
        cached_metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
        for attempt in range(5):
            delay = 1 / self.requests_per_second - (time.monotonic() - self._last_request)
            if delay > 0:
                time.sleep(delay)
            headers = {"User-Agent": "Benchly/1.0 (direction analysis)"}
            if cached_metadata.get("etag") and target.exists():
                headers["If-None-Match"] = cached_metadata["etag"]
            request = urllib.request.Request(url, headers=headers)
            try:
                self._last_request = time.monotonic()
                with urllib.request.urlopen(request, timeout=60) as response:
                    payload = json.load(response)
                temporary = target.with_suffix(".json.part")
                temporary.write_text(json.dumps(payload, separators=(",", ":")))
                temporary.replace(target)
                temporary_metadata = metadata_path.with_suffix(".json.part")
                temporary_metadata.write_text(json.dumps({
                    "url": url, "etag": response.headers.get("ETag"),
                    "last_modified": response.headers.get("Last-Modified"),
                }, separators=(",", ":")))
                temporary_metadata.replace(metadata_path)
                return payload
            except urllib.error.HTTPError as error:
                if error.code == 304 and target.exists():
                    return json.loads(target.read_text())
                if attempt == 4:
                    raise
                time.sleep((2 ** attempt) + random.random())
            except Exception:
                if attempt == 4:
                    raise
                time.sleep((2 ** attempt) + random.random())
        raise RuntimeError("unreachable")

    def _item_at(self, latitude: float, longitude: float, *, max_gsd: float = .11) -> dict[str, object] | None:
        candidates = self.grid.get((math.floor(longitude * 100), math.floor(latitude * 100)), [])
        matching = [item for item in candidates if item["bbox"][0] <= longitude <= item["bbox"][2]
                    and item["bbox"][1] <= latitude <= item["bbox"][3] and float(item.get("gsd", 999)) <= max_gsd]
        return max(matching, key=lambda item: str(item.get("datetime") or ""), default=None)

    def _fallback_item_at(self, latitude: float, longitude: float, *, max_gsd: float) -> dict[str, object] | None:
        """Query one cached point only when the current-cycle catalog has a gap."""
        delta = .001
        query = urllib.parse.urlencode({
            "limit": 100, "bbox": f"{longitude-delta},{latitude-delta},{longitude+delta},{latitude+delta}",
        })
        url = f"https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissimage-dop10/items?{query}"
        key = hashlib.sha256(url.encode()).hexdigest()
        target = self.directory / "stac-points" / f"{key}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = json.loads(target.read_text()) if target.exists() else self._request_json(url, target)
        candidates = []
        for feature in payload.get("features", []):
            for asset in feature.get("assets", {}).values():
                gsd = float(asset.get("gsd", 999))
                bbox = feature.get("bbox")
                if bbox and gsd <= max_gsd and str(asset.get("href", "")).endswith(".tif"):
                    candidates.append({
                        "id": feature["id"], "bbox": bbox, "datetime": feature.get("properties", {}).get("datetime"),
                        "href": asset["href"], "checksum": asset.get("file:checksum"), "gsd": gsd,
                    })
        matching = [item for item in candidates if item["bbox"][0] <= longitude <= item["bbox"][2]
                    and item["bbox"][1] <= latitude <= item["bbox"][3]]
        return max(matching, key=lambda item: str(item.get("datetime") or ""), default=None)

    @staticmethod
    def _identity(item: dict[str, object], latitude: float, longitude: float, size_meters: float) -> str:
        value = json.dumps([
            item.get("checksum"), round(float(latitude), 7), round(float(longitude), 7), size_meters,
        ], separators=(",", ":"))
        return hashlib.sha256(value.encode()).hexdigest()

    def _cached_crop(self, key: str) -> tuple[np.ndarray, float, dict[str, object]] | None:
        image_path = self.directory / "patches" / key[:2] / f"{key}.png"
        metadata_path = image_path.with_suffix(".json")
        if not image_path.exists() or not metadata_path.exists():
            return None
        metadata = json.loads(metadata_path.read_text())
        metadata["cache_path"] = str(image_path.resolve())
        return np.asarray(Image.open(image_path)), float(metadata["meters_per_pixel"]), metadata

    def _crop_from_dataset(self, dataset, item: dict[str, object], bench_id: str, latitude: float, longitude: float,
                           size_meters: float) -> tuple[np.ndarray, float, dict[str, object]]:
        from rasterio.windows import from_bounds

        key = self._identity(item, latitude, longitude, size_meters)
        cached = self._cached_crop(key)
        if cached:
            return cached
        image_path = self.directory / "patches" / key[:2] / f"{key}.png"
        metadata_path = image_path.with_suffix(".json")
        image_path.parent.mkdir(parents=True, exist_ok=True)
        easting, northing = WGS84_TO_LV95.transform(longitude, latitude)
        half = size_meters / 2
        window = from_bounds(easting - half, northing - half, easting + half, northing + half, dataset.transform)
        data = dataset.read((1, 2, 3), window=window, boundless=True, fill_value=0)
        meters_per_pixel = float(sum(abs(value) for value in dataset.res) / 2)
        rgb = np.moveaxis(data, 0, 2).astype(np.uint8)
        metadata = {
            "bench_id": bench_id, "latitude": latitude, "longitude": longitude,
            "asset_id": item["id"], "asset_checksum": item.get("checksum"), "asset_datetime": item.get("datetime"),
            "meters_per_pixel": meters_per_pixel, "size_meters": size_meters,
            "source": "swisstopo SWISSIMAGE", "cache_path": str(image_path.resolve()),
        }
        temporary_image = image_path.with_suffix(".png.part")
        Image.fromarray(rgb).save(temporary_image, format="PNG")
        temporary_image.replace(image_path)
        temporary_metadata = metadata_path.with_suffix(".json.part")
        temporary_metadata.write_text(json.dumps(metadata, separators=(",", ":")))
        temporary_metadata.replace(metadata_path)
        return rgb, meters_per_pixel, metadata

    def crop(self, bench_id: str, latitude: float, longitude: float, *, size_meters: float = 12) -> tuple[np.ndarray, float, dict[str, object]] | None:
        if not self.items:
            self.refresh_catalog()
        item = self._item_at(latitude, longitude, max_gsd=.11)
        if item is None:
            return None
        key = self._identity(item, latitude, longitude, size_meters)
        cached = self._cached_crop(key)
        if cached:
            return cached
        import rasterio
        environment = rasterio.Env(
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
            GDAL_HTTP_MULTIRANGE="YES", VSI_CACHE="TRUE", VSI_CACHE_SIZE="33554432",
        )
        with environment, rasterio.open(str(item["href"])) as dataset:
            return self._crop_from_dataset(dataset, item, bench_id, latitude, longitude, size_meters)

    def crop_many(self, benches: list[object], *, size_meters: float = 12, max_gsd: float = .26,
                  fallback: bool = True):
        """Yield crops grouped by 1 km source asset, opening each remote COG once."""
        if not self.items:
            self.refresh_catalog()
        groups: dict[str, tuple[dict[str, object], list[object]]] = {}
        unmatched = []
        for bench in benches:
            item = self._item_at(float(bench["latitude"]), float(bench["longitude"]), max_gsd=max_gsd)  # type: ignore[index]
            if item is None and fallback:
                item = self._fallback_item_at(
                    float(bench["latitude"]), float(bench["longitude"]), max_gsd=max_gsd,  # type: ignore[index]
                )
            if item is None:
                unmatched.append(bench)
            else:
                groups.setdefault(str(item["id"]), (item, []))[1].append(bench)
        for bench in unmatched:
            yield bench, None, RuntimeError("No current SWISSIMAGE asset covers this coordinate")
        import rasterio
        environment = rasterio.Env(
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
            GDAL_HTTP_MULTIRANGE="YES", VSI_CACHE="TRUE", VSI_CACHE_SIZE="33554432",
        )
        with environment:
            for _asset_id, (item, rows) in sorted(groups.items()):
                uncached = [row for row in rows if self._cached_crop(self._identity(
                    item, float(row["latitude"]), float(row["longitude"]), size_meters  # type: ignore[index]
                )) is None]
                dataset = None
                try:
                    if uncached:
                        delay = 1 / self.requests_per_second - (time.monotonic() - self._last_request)
                        if delay > 0:
                            time.sleep(delay)
                        self._last_request = time.monotonic()
                        dataset = rasterio.open(str(item["href"]))
                except Exception as error:
                    for bench in rows:
                        yield bench, None, error
                    continue
                try:
                    for bench in rows:
                        try:
                            key = self._identity(item, float(bench["latitude"]), float(bench["longitude"]), size_meters)  # type: ignore[index]
                            crop = self._cached_crop(key)
                            if crop is None and dataset is not None:
                                crop = self._crop_from_dataset(
                                    dataset, item, str(bench["bench_id"]), float(bench["latitude"]),  # type: ignore[index]
                                    float(bench["longitude"]), size_meters,  # type: ignore[index]
                                )
                            yield bench, crop, None
                        except Exception as error:
                            yield bench, None, error
                finally:
                    if dataset is not None:
                        dataset.close()
