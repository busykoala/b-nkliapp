"""Exact LV95 geometry and canopy helpers for the Benchly worker."""

from __future__ import annotations

import json
import math
import sqlite3
import subprocess
from pathlib import Path
from typing import Iterable, Optional, Sequence

from pyproj import Transformer
from shapely import from_wkb, get_coordinates, to_wkb
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import nearest_points, transform

WGS84_TO_LV95 = Transformer.from_crs(4326, 2056, always_xy=True)
LV95_TO_WGS84 = Transformer.from_crs(2056, 4326, always_xy=True)


def point_lv95(latitude: float, longitude: float) -> Point:
    easting, northing = WGS84_TO_LV95.transform(longitude, latitude)
    return Point(easting, northing)


def geometry_wkb_from_coordinates(
    coordinates: Sequence[tuple[float, float]], kind: str, closed: bool = False,
) -> Optional[bytes]:
    """Build exact geometry from (latitude, longitude) OSM coordinates in LV95."""
    if not coordinates:
        return None
    lon_lat = [(longitude, latitude) for latitude, longitude in coordinates]
    if len(lon_lat) == 1:
        geometry = Point(lon_lat[0])
    elif closed and len(lon_lat) >= 4 and kind in {"building", "forest", "water"}:
        geometry = Polygon(lon_lat)
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
    else:
        geometry = LineString(lon_lat)
    projected = transform(WGS84_TO_LV95.transform, geometry)
    return to_wkb(projected, hex=False)


def geometry_wkb_from_geojson(value: dict, source_crs: int = 4326) -> bytes:
    geometry = shape(value)
    if source_crs != 2056:
        transformer = Transformer.from_crs(source_crs, 2056, always_xy=True)
        geometry = transform(transformer.transform, geometry)
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    return to_wkb(geometry, hex=False)


def project_wgs84_wkb(value: bytes | str) -> bytes:
    raw = bytes.fromhex(value) if isinstance(value, str) else value
    geometry = transform(WGS84_TO_LV95.transform, from_wkb(raw))
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    return to_wkb(geometry, hex=False)


def _feature_geometry(feature: sqlite3.Row):
    try:
        raw = feature["geometry_wkb"]
    except (IndexError, KeyError):
        return None
    if raw is None:
        return None
    try:
        return from_wkb(bytes(raw))
    except Exception:
        return None


def feature_distance_exact(latitude: float, longitude: float, feature: sqlite3.Row) -> Optional[float]:
    geometry = _feature_geometry(feature)
    if geometry is None:
        return None
    return float(point_lv95(latitude, longitude).distance(geometry))


def feature_contains_exact(latitude: float, longitude: float, feature: sqlite3.Row) -> bool:
    geometry = _feature_geometry(feature)
    return bool(geometry is not None and geometry.covers(point_lv95(latitude, longitude)))


def feature_nearest_location(latitude: float, longitude: float, feature: sqlite3.Row) -> Optional[tuple[float, float]]:
    geometry = _feature_geometry(feature)
    if geometry is None:
        return None
    _origin, nearest = nearest_points(point_lv95(latitude, longitude), geometry)
    longitude_value, latitude_value = LV95_TO_WGS84.transform(nearest.x, nearest.y)
    return float(latitude_value), float(longitude_value)


def feature_angular_half_width(
    latitude: float, longitude: float, feature: sqlite3.Row, center_bearing: float,
) -> Optional[float]:
    """Return the exact visible angular footprint around a bench, including wrap at north."""
    geometry = _feature_geometry(feature)
    if geometry is None:
        return None
    origin = point_lv95(latitude, longitude)
    bearings = [
        (math.degrees(math.atan2(float(x) - origin.x, float(y) - origin.y)) + 360) % 360
        for x, y in get_coordinates(geometry)
        if float(x) != origin.x or float(y) != origin.y
    ]
    if not bearings:
        return None
    differences = [abs(((bearing - center_bearing + 540) % 360) - 180) for bearing in bearings]
    return min(89.0, max(2.5, max(differences)))


def feature_bounds_wgs84(geometry_wkb: bytes) -> tuple[float, float, float, float]:
    geometry = transform(LV95_TO_WGS84.transform, from_wkb(geometry_wkb))
    min_lon, min_lat, max_lon, max_lat = geometry.bounds
    return min_lon, min_lat, max_lon, max_lat


def point_hits_exact_building(latitude: float, longitude: float, buildings: Sequence[sqlite3.Row], tolerance: float = 2.5) -> bool:
    point = point_lv95(latitude, longitude)
    for building in buildings:
        geometry = _feature_geometry(building)
        if geometry is not None and geometry.distance(point) <= tolerance:
            return True
    return False


def _offset(latitude: float, longitude: float, east: float, north: float) -> tuple[float, float]:
    return latitude + north / 111_320, longitude + east / (111_320 * max(0.2, math.cos(math.radians(latitude))))


def canopy_neighborhood(
    latitude: float,
    longitude: float,
    terrain,
    surface,
    buildings: Sequence[sqlite3.Row],
) -> dict[str, object]:
    """Measure vegetation rather than treating one surface sample as woodland."""
    shares: dict[int, Optional[float]] = {}
    heights: list[float] = []
    for radius, step in ((3, 1.5), (10, 2.5), (25, 5.0)):
        vegetated = 0
        valid = 0
        radius_heights: list[float] = []
        cells = range(-math.ceil(radius / step), math.ceil(radius / step) + 1)
        for x_index in cells:
            for y_index in cells:
                east, north = x_index * step, y_index * step
                if east * east + north * north > radius * radius:
                    continue
                sample_latitude, sample_longitude = _offset(latitude, longitude, east, north)
                bare = terrain.sample(sample_latitude, sample_longitude)
                top = surface.sample(sample_latitude, sample_longitude)
                if bare is None or top is None:
                    continue
                valid += 1
                height = max(0.0, top - bare)
                if height >= 2.0 and not point_hits_exact_building(sample_latitude, sample_longitude, buildings):
                    vegetated += 1
                    radius_heights.append(height)
        shares[radius] = vegetated / valid if valid else None
        heights.extend(radius_heights)
    ordered = sorted(heights)
    median = ordered[len(ordered) // 2] if ordered else None
    share_10 = shares[10]
    share_25 = shares[25]
    context = "unknown" if share_10 is None else "dense" if share_10 >= 0.65 or (share_25 or 0) >= 0.72 else "partial" if share_10 >= 0.12 or (share_25 or 0) >= 0.18 else "none"
    return {
        "share_3m": shares[3], "share_10m": share_10, "share_25m": share_25,
        "median_height": median, "max_height": max(heights) if heights else None,
        "context": context,
    }


def deterministic_environment(
    latitude: float,
    longitude: float,
    forest_features: Sequence[sqlite3.Row],
    water_features: Sequence[sqlite3.Row],
    land_cover_features: Sequence[sqlite3.Row],
    canopy_context: str,
) -> dict[str, object]:
    forest_distances = [distance for feature in forest_features if (distance := feature_distance_exact(latitude, longitude, feature)) is not None]
    water_distances = [distance for feature in water_features if (distance := feature_distance_exact(latitude, longitude, feature)) is not None]
    in_forest = any(feature_contains_exact(latitude, longitude, feature) for feature in forest_features)
    forest_distance = min(forest_distances, default=None)
    water_distance = min(water_distances, default=None)
    cover_classes = {
        str(feature["class"]).lower()
        for feature in land_cover_features
        if feature_contains_exact(latitude, longitude, feature)
    }
    if in_forest:
        land_context = "forest"
    elif forest_distance is not None and forest_distance <= 25:
        land_context = "forest_edge"
    elif any(token in value for value in cover_classes for token in ("park", "gruen", "green", "freizeit")):
        land_context = "park"
    elif any(token in value for value in cover_classes for token in ("sied", "urban", "gebaeude", "building")):
        land_context = "urban"
    elif any(token in value for value in cover_classes for token in ("acker", "wiese", "feld", "open", "fels")):
        land_context = "open"
    elif cover_classes:
        land_context = "mixed"
    elif canopy_context == "dense":
        land_context = "mixed"
    else:
        land_context = "unknown"
    return {
        "in_forest": in_forest,
        "forest_distance": forest_distance,
        "water_distance": water_distance,
        "waterfront": water_distance is not None and water_distance <= 75,
        "land_context": land_context,
    }


def classify_official_layer(layer: str, properties: dict) -> tuple[Optional[str], Optional[str]]:
    value = f"{layer} {' '.join(str(item) for item in properties.values())}".lower()
    if any(token in value for token in ("gebaeude", "gebäude", "building")):
        return "environment", "building"
    if any(token in value for token in ("gewaesser", "gewässer", "see", "fluss", "river", "water")):
        return "environment", "water"
    if any(token in value for token in ("wald", "forest")):
        return "environment", "forest"
    if any(token in layer.lower() for token in ("bodenbedeck", "landcover", "land_cover", "areal")):
        return "land_cover", str(properties.get("OBJEKTART") or properties.get("objektart") or properties.get("type") or "unknown")
    return None, None


def geopackage_layers(path: Path) -> list[str]:
    result = subprocess.run(["ogrinfo", "-ro", "-so", str(path)], check=True, capture_output=True, text=True)
    layers: list[str] = []
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped and stripped[0].isdigit() and ": " in stripped:
            layers.append(stripped.split(": ", 1)[1].split(" (", 1)[0])
        elif stripped.startswith("Layer: "):
            layers.append(stripped.removeprefix("Layer: ").split(" (", 1)[0])
    return layers


def iter_layer_features(path: Path, layer: str) -> Iterable[dict]:
    process = subprocess.Popen(
        ["ogr2ogr", "-f", "GeoJSONSeq", "/vsistdout/", str(path), layer, "-t_srs", "EPSG:4326"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    assert process.stdout is not None
    for line in process.stdout:
        if line.strip():
            yield json.loads(line)
    stderr = process.stderr.read() if process.stderr else ""
    if process.wait() != 0:
        raise RuntimeError(f"ogr2ogr failed for {layer}: {stderr[-1000:]}")
