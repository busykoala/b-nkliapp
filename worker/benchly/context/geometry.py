"""Exact LV95 geometry and canopy helpers for the Benchly worker."""

from __future__ import annotations

import json
import math
import sqlite3
import subprocess
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional, Sequence

from pyproj import Transformer
from shapely import force_2d, from_wkb, get_coordinates, get_parts, to_wkb
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import nearest_points, transform, unary_union

from benchly.context.contracts import VectorFeature

WGS84_TO_LV95 = Transformer.from_crs(4326, 2056, always_xy=True)
LV95_TO_WGS84 = Transformer.from_crs(2056, 4326, always_xy=True)


@lru_cache(maxsize=4096)
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


def building_footprint_wkb_from_geojson(value: dict, source_crs: int = 4326) -> bytes:
    """Flatten a 3D building solid into one stable 2D shadow footprint."""
    geometry = shape(value)
    if source_crs != 2056:
        transformer = Transformer.from_crs(source_crs, 2056, always_xy=True)
        geometry = transform(transformer.transform, geometry)
    flat = force_2d(geometry)
    # A building solid contains roof, ground and vertical faces. After dropping
    # Z, the vertical faces have no area; unioning the remaining faces preserves
    # concave/L-shaped footprints instead of exaggerating them with a convex hull.
    faces = [part for part in get_parts(flat) if part.geom_type in {"Polygon", "MultiPolygon"} and part.area > 0.05]
    footprint = unary_union(faces) if faces else flat.convex_hull
    if not footprint.is_valid:
        footprint = footprint.buffer(0)
    return to_wkb(footprint, hex=False, output_dimension=2)


def project_wgs84_wkb(value: bytes | str) -> bytes:
    raw = bytes.fromhex(value) if isinstance(value, str) else value
    geometry = transform(WGS84_TO_LV95.transform, from_wkb(raw))
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    return to_wkb(geometry, hex=False)


@lru_cache(maxsize=2048)
def _decoded_geometry(raw: bytes):
    # Shapely 2 geometries are immutable. Horizon rays revisit the same exact
    # features many times, so keep a bounded cache of their decoded shapes.
    return from_wkb(raw)


def _feature_geometry(feature: sqlite3.Row):
    try:
        raw = feature["geometry_wkb"]
    except (IndexError, KeyError):
        return None
    if raw is None:
        return None
    try:
        return _decoded_geometry(bytes(raw))
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


def feature_is_large_water(feature: sqlite3.Row) -> bool:
    """Reserve the lake promise for broad, exact water surfaces."""
    keys = feature.keys()
    try:
        tags = json.loads(feature["raw_tags"] or "{}") if "raw_tags" in keys else {}
    except (ValueError, TypeError):
        tags = {}
    water_type = _normalized_type(tags.get("objektart") or tags.get("OBJEKTART") or tags.get("water") or tags.get("waterway") or "")
    if water_type in {"fliessgewaesser", "river", "riverbank", "stream", "canal", "pool", "basin", "pond"}:
        return False
    if water_type in {"see", "stehendegewaesser", "lake", "reservoir"}:
        return _feature_geometry(feature) is not None
    geometry = _feature_geometry(feature)
    if geometry is None or geometry.area < 20_000:
        return False
    min_x, min_y, max_x, max_y = geometry.bounds
    return max(max_x - min_x, max_y - min_y) >= 250 and min(max_x - min_x, max_y - min_y) >= 80


def feature_is_surface_water(feature) -> bool:
    """Keep subsurface hydrography out of visible-water and waterfront evidence."""
    try:
        tags = json.loads(feature["raw_tags"] or "{}")
    except (KeyError, IndexError, ValueError, TypeError):
        return True
    course = _normalized_type(tags.get("verlauf") or tags.get("VERLAUF") or "")
    # swissTLM3D VERLAUF 200/300: underground, known/unknown course.
    # STUFE alone is insufficient: an open river under a bridge can be -1.
    if course.startswith("unterirdisch") or course in {"200", "300"}:
        return False
    return str(tags.get("tunnel", "no")).casefold() not in {"yes", "culvert", "flooded"}


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
    origin_x, origin_y = origin.x, origin.y
    bearings = [
        (math.degrees(math.atan2(float(x) - origin_x, float(y) - origin_y)) + 360) % 360
        for x, y in get_coordinates(geometry)
        if float(x) != origin_x or float(y) != origin_y
    ]
    if not bearings:
        return None
    differences = [abs(((bearing - center_bearing + 540) % 360) - 180) for bearing in bearings]
    return min(89.0, max(2.5, max(differences)))


@lru_cache(maxsize=288)
def _bearing_ray(latitude: float, longitude: float, bearing: float, maximum_distance: float):
    origin = point_lv95(latitude, longitude)
    x, y = origin.x, origin.y
    radians = math.radians(bearing)
    return LineString([(x, y), (x + math.sin(radians) * maximum_distance,
                               y + math.cos(radians) * maximum_distance)])


def feature_ray_span(
    latitude: float, longitude: float, feature: sqlite3.Row, bearing: float, maximum_distance: float = 10_000,
) -> Optional[tuple[float, float]]:
    """Return exact entry/exit distances where a bearing ray crosses a feature."""
    geometry = _feature_geometry(feature)
    if geometry is None:
        return None
    origin = point_lv95(latitude, longitude)
    intersection = geometry.intersection(_bearing_ray(latitude, longitude, bearing, maximum_distance))
    if intersection.is_empty:
        return None

    def connected_parts(value):
        parts = list(get_parts(value))
        if len(parts) == 1 and parts[0] is value:
            return [value]
        result = []
        for part in parts:
            nested = list(get_parts(part))
            result.extend(connected_parts(part) if len(nested) > 1 else [part])
        return result

    spans = []
    for part in connected_parts(intersection):
        distances = sorted(float(origin.distance(Point(x, y))) for x, y in get_coordinates(part))
        if distances:
            spans.append((distances[0], distances[-1]))
    if geometry.covers(origin) and spans:
        nearest = min(spans, key=lambda value: value[0])
        spans[spans.index(nearest)] = (0.0, nearest[1])
    return min(spans, key=lambda value: value[0]) if spans else None


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
    water_distances = [distance for feature in water_features
                       if feature_is_surface_water(feature)
                       and (distance := feature_distance_exact(latitude, longitude, feature)) is not None]
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
    elif "wald nicht bestockt" in cover_classes or any(token in value for value in cover_classes for token in ("acker", "wiese", "feld", "open", "fels")):
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


def _normalized_type(value: str) -> str:
    value = str(value).casefold().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return "".join(character for character in ascii_value if character.isalnum())


def classify_official_layer(layer: str, properties: dict) -> tuple[Optional[str], Optional[str]]:
    # Names such as "Seebad", "Waldpark" and "Flussstrasse" say nothing
    # about the geometry's class. Only the layer and official object type do.
    normalized_layer = _normalized_type(layer)
    raw_type = properties.get("OBJEKTART") or properties.get("objektart") or properties.get("type") or "unknown"
    object_type = _normalized_type(raw_type)
    if any(token in normalized_layer for token in ("gebaeude", "gebaude", "building")):
        return "environment", "building"
    if any(token in normalized_layer for token in ("bodenbedeck", "landcover", "areal")):
        if object_type in {"fliessgewaesser", "stehendegewaesser", "see", "lake", "river", "water"}:
            return "environment", "water"
        if object_type in {"wald", "waldoffen", "gebueschwald", "gebuschwald", "forest"}:
            return "environment", "forest"
        return "land_cover", str(raw_type)
    if any(token in normalized_layer for token in ("gewaessername", "gewaesserlauf")):
        return None, None
    if any(token in normalized_layer for token in ("gewaesser", "gewasser", "river", "water")):
        return "environment", "water"
    if any(token in normalized_layer for token in ("wald", "forest")):
        return "environment", "forest"
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


def iter_layer_features(path: Path, layer: str) -> Iterable[dict[str, object]]:
    process = subprocess.Popen(
        ["ogr2ogr", "-f", "GeoJSONSeq", "/vsistdout/", str(path), layer, "-t_srs", "EPSG:4326"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    assert process.stdout is not None
    for line in process.stdout:
        if line.strip():
            yield VectorFeature.model_validate_json(line).model_dump()
    stderr = process.stderr.read() if process.stderr else ""
    if process.wait() != 0:
        raise RuntimeError(f"ogr2ogr failed for {layer}: {stderr[-1000:]}")
