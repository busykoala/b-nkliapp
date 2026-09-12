"""Deterministic direction signals from Benchly's exact local context."""

from __future__ import annotations

import json
import math
import re
from typing import Iterable

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely import from_wkb, get_parts
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from benchly.context.evidence import nearby_context, preferred_environment_context, official_context_version
from benchly.context.geometry import LV95_TO_WGS84, point_lv95
from benchly.geo import bearing_degrees, circular_difference, destination
from .model import DirectionSignal, axis_distribution, circular_distribution, mixture

VIEWPOINT_WORDS = re.compile(
    r"(?:aussicht|panorama|point\s+de\s+vue|belv[eé]d[eè]re|belvedere|punto\s+panoramico|vista|mirador)",
    re.IGNORECASE,
)


def is_viewpoint(bench: object, nearby_viewpoint_meters: float | None = None) -> bool:
    def value(key: str) -> object:
        try:
            return bench[key]  # type: ignore[index]
        except (KeyError, IndexError, TypeError):
            return getattr(bench, key, None)

    try:
        tags = json.loads(str(value("raw_tags") or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        tags = {}
    text = " ".join(str(item or "") for item in (
        value("name"), value("description"), tags.get("name"), tags.get("description"), tags.get("tourism"),
    ))
    return tags.get("tourism") == "viewpoint" or bool(VIEWPOINT_WORDS.search(text)) or (
        nearby_viewpoint_meters is not None and nearby_viewpoint_meters <= 100
    )


def _line_parts(geometry) -> list[LineString]:
    if geometry.geom_type in {"LineString", "LinearRing"}:
        return [LineString(geometry.coords)]
    return [LineString(part.coords) for part in get_parts(geometry) if part.geom_type in {"LineString", "LinearRing"}]


def nearest_path_signal(latitude: float, longitude: float, features: Iterable[object], *, viewpoint: bool = False) -> DirectionSignal | None:
    features = list(features)
    origin = point_lv95(latitude, longitude)
    best: tuple[float, LineString, object] | None = None
    for feature in features:
        try:
            if feature["kind"] != "path" or not feature["geometry_wkb"]:  # type: ignore[index]
                continue
            geometry = from_wkb(feature["geometry_wkb"])  # type: ignore[index]
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        for line in _line_parts(geometry):
            distance = float(line.distance(origin))
            if best is None or distance < best[0]:
                best = distance, line, feature
    if best is None or best[0] > 30:
        return None
    distance, line, feature = best
    offset = line.project(origin)
    span = min(2.0, max(0.25, line.length / 4))
    before = line.interpolate(max(0, offset - span))
    after = line.interpolate(min(line.length, offset + span))
    if before.distance(after) < .05:
        return None
    axis = math.degrees(math.atan2(after.x - before.x, after.y - before.y)) % 180
    snap = line.interpolate(offset)
    snap_lon, snap_lat = LV95_TO_WGS84.transform(snap.x, snap.y)
    toward = bearing_degrees(latitude, longitude, snap_lat, snap_lon)
    candidates = ((axis + 90) % 360, (axis + 270) % 360)
    toward_candidate = min(candidates, key=lambda item: circular_difference(item, toward))
    away_candidate = (toward_candidate + 180) % 360
    toward_share = .64 if distance <= 3 else .58 if distance <= 8 else .54
    if viewpoint:
        # Outlook evidence gets to resolve this later; retain the useful axis but
        # deliberately remove the ordinary "watch the path" side preference.
        toward_share = .5
    probabilities = mixture(
        (circular_distribution(toward_candidate, 4.0), toward_share),
        (circular_distribution(away_candidate, 4.0), 1 - toward_share),
    )
    try:
        source_id = feature["source_id"]  # type: ignore[index]
        tags = json.loads(feature["raw_tags"] or "{}")  # type: ignore[index]
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        source_id, tags = None, {}
    weight = 1.25 if distance <= 3 else .9 if distance <= 8 else .55
    highway = tags.get("highway")
    if highway in {"primary", "secondary", "tertiary", "trunk", "motorway"}:
        weight *= .55
    elif highway in {"residential", "service", "unclassified"}:
        weight *= .82
    urban_context = sum(1 for item in features if item["kind"] == "building") >= 4  # type: ignore[index]
    if urban_context:
        weight *= .9
    return DirectionSignal("path", probabilities, weight, {
        "distance_meters": round(distance, 2), "path_axis_degrees": round(axis, 2),
        "toward_path_degrees": round(toward_candidate, 2), "toward_share": toward_share,
        "viewpoint_exception": viewpoint, "source_id": source_id, "highway": highway, "urban_context": urban_context,
    })


def nearest_building_signal(latitude: float, longitude: float, features: Iterable[object]) -> DirectionSignal | None:
    origin = point_lv95(latitude, longitude)
    best: tuple[float, object, object] | None = None
    for feature in features:
        try:
            if feature["kind"] != "building" or not feature["geometry_wkb"]:  # type: ignore[index]
                continue
            geometry = from_wkb(feature["geometry_wkb"])  # type: ignore[index]
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        # A mapped point inside a footprint is commonly an offset/geometry
        # disagreement. It must never be interpreted as a facade normal.
        if geometry.covers(origin):
            continue
        distance = float(geometry.distance(origin))
        if best is None or distance < best[0]:
            best = distance, geometry, feature
    if best is None or best[0] > 3:
        return None
    distance, geometry, feature = best
    _origin, facade = nearest_points(origin, geometry)
    # At a corner there are two equally plausible facade normals. Do not turn
    # tiny mapping offsets into a confident diagonal "away from building" cue.
    boundaries = [part.exterior for part in get_parts(geometry) if part.geom_type == "Polygon"]
    if any(any(Point(coordinate).distance(facade) < .05 for coordinate in boundary.coords) for boundary in boundaries):
        return None
    facade_lon, facade_lat = LV95_TO_WGS84.transform(facade.x, facade.y)
    toward = bearing_degrees(latitude, longitude, facade_lat, facade_lon)
    away = (toward + 180) % 360
    # The labelled sample is exceptionally strong only in the first metre.
    weight = 2.6 if distance <= 1 else 1.1 if distance <= 2 else .55
    try:
        source_id = feature["source_id"]  # type: ignore[index]
    except (KeyError, IndexError, TypeError):
        source_id = None
    return DirectionSignal("building", circular_distribution(away, 4.5 if distance <= 1 else 3.0), weight, {
        "distance_meters": round(distance, 2), "away_degrees": round(away, 2), "source_id": source_id,
    })


def nearest_water_signal(latitude: float, longitude: float, features: Iterable[object]) -> DirectionSignal | None:
    origin = point_lv95(latitude, longitude)
    best: tuple[float, object, object] | None = None
    for feature in features:
        try:
            if feature["kind"] != "water" or not feature["geometry_wkb"]:  # type: ignore[index]
                continue
            geometry = from_wkb(feature["geometry_wkb"])  # type: ignore[index]
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        if geometry.covers(origin):
            continue
        distance = float(geometry.distance(origin))
        if best is None or distance < best[0]:
            best = distance, geometry, feature
    if best is None or best[0] > 150:
        return None
    distance, geometry, feature = best
    _origin, target = nearest_points(origin, geometry)
    target_lon, target_lat = LV95_TO_WGS84.transform(target.x, target.y)
    toward = bearing_degrees(latitude, longitude, target_lat, target_lon)
    weight = .75 if distance <= 25 else .45 if distance <= 75 else .25
    return DirectionSignal("water", circular_distribution(toward, 2.4), weight, {
        "distance_meters": round(distance, 2), "toward_degrees": round(toward, 2),
    })


def openness_signal(view_sectors_json: object, obstruction_types_json: object = None,
                    obstruction_distances_json: object = None, *, viewpoint: bool = False) -> DirectionSignal | None:
    try:
        payload = json.loads(str(view_sectors_json)) if view_sectors_json else {}
        sectors = payload.get("sectors", [])
    except (TypeError, ValueError, json.JSONDecodeError):
        sectors = []
    scores = np.ones(8, dtype=float)
    evidence = False
    if len(sectors) == 8:
        for index, sector in enumerate(sectors):
            horizon = float(sector.get("mean_horizon", 20))
            scores[index] *= math.exp(max(-2, min(2, (8 - horizon) / 8)))
            if sector.get("open"):
                scores[index] *= 1.8
                evidence = True
    try:
        types = json.loads(str(obstruction_types_json)) if obstruction_types_json else []
        distances = json.loads(str(obstruction_distances_json)) if obstruction_distances_json else []
    except (TypeError, ValueError, json.JSONDecodeError):
        types, distances = [], []
    if len(types) == 72:
        for index in range(8):
            positions = [(index * 9 + offset) % 72 for offset in range(9)]
            clear = sum(types[position] not in {"building", "vegetation"} for position in positions) / 9
            distance = np.mean([float(distances[position]) for position in positions]) if len(distances) == 72 else 0
            scores[index] *= .55 + clear + min(.6, distance / 150)
            evidence = evidence or clear >= .7
    if not evidence or max(scores) / max(1e-9, min(scores)) < 1.35:
        return None
    weight = 1.25 if viewpoint else .45
    return DirectionSignal("openness", tuple(float(value) for value in scores / scores.sum()), weight, {
        "viewpoint": viewpoint, "best_sector_degrees": int(np.argmax(scores)) * 45,
        "contrast": round(float(max(scores) / max(1e-9, np.median(scores))), 3),
    })


def terrain_signal(latitude: float, longitude: float, raster) -> DirectionSignal | None:
    if raster is None:
        return None
    gradients = []
    for radius in (5.0, 10.0):
        samples = []
        for bearing in range(0, 360, 45):
            sample_lat, sample_lon = destination(latitude, longitude, bearing, radius)
            height = raster.sample(sample_lat, sample_lon)
            if height is None or not math.isfinite(height):
                break
            radians = math.radians(bearing)
            samples.append((radius * math.sin(radians), radius * math.cos(radians), float(height)))
        if len(samples) != 8:
            continue
        matrix = np.asarray([[east, north, 1] for east, north, _height in samples], dtype=float)
        heights = np.asarray([height for _east, _north, height in samples], dtype=float)
        east_gradient, north_gradient, _offset = np.linalg.lstsq(matrix, heights, rcond=None)[0]
        slope = math.hypot(east_gradient, north_gradient)
        downhill = math.degrees(math.atan2(-east_gradient, -north_gradient)) % 360
        gradients.append((slope, downhill))
    if len(gradients) < 2 or min(item[0] for item in gradients) < .03:
        return None
    if circular_difference(gradients[0][1], gradients[1][1]) > 30:
        return None
    slope = sum(item[0] for item in gradients) / len(gradients)
    downhill = sum(item[1] for item in gradients) / len(gradients)
    return DirectionSignal("terrain", circular_distribution(downhill, 2.8), min(1.25, .45 + slope * 4), {
        "downhill_degrees": round(downhill, 2), "slope_percent": round(slope * 100, 2), "radii_meters": [5, 10],
    })


def _nearby_direction_signal(neighbors: list[tuple[float, float, int]]) -> DirectionSignal | None:
    if not neighbors or (len(neighbors) == 1 and neighbors[0][1] > 6):
        return None
    east = sum(math.sin(math.radians(direction)) for direction, _distance, _row_id in neighbors)
    north = sum(math.cos(math.radians(direction)) for direction, _distance, _row_id in neighbors)
    coherence = math.hypot(east, north) / len(neighbors)
    if coherence < .65:
        return None
    direction = math.degrees(math.atan2(east, north)) % 360
    weight = min(.9, .25 + .18 * len(neighbors)) * coherence
    return DirectionSignal("nearby_benches", circular_distribution(direction, 2.5 + 2 * coherence), weight, {
        "direction_degrees": round(direction, 2), "coherence": round(coherence, 3),
        "neighbor_count": len(neighbors), "maximum_distance_meters": round(max(item[1] for item in neighbors), 2),
        "bench_row_ids": [item[2] for item in neighbors[:12]],
    })


class KnownBenchDirections:
    """One spatial index reused for every bench in an analysis run."""

    def __init__(self, database):
        rows = database.execute("""
          SELECT row_id,latitude,longitude,direction_degrees FROM benches
          WHERE active=1 AND direction_degrees IS NOT NULL
        """).fetchall()
        self.row_ids = np.asarray([int(row["row_id"]) for row in rows], dtype=np.int64)
        self.directions = np.asarray([float(row["direction_degrees"]) for row in rows], dtype=float)
        self.points = np.asarray([
            tuple(point_lv95(float(row["latitude"]), float(row["longitude"])).coords)[0] for row in rows
        ], dtype=float).reshape((-1, 2))
        self.tree = cKDTree(self.points) if len(self.points) else None

    def signal(self, bench: object) -> DirectionSignal | None:
        if self.tree is None:
            return None
        origin = point_lv95(float(bench["latitude"]), float(bench["longitude"]))  # type: ignore[index]
        point = np.asarray(tuple(origin.coords)[0], dtype=float)
        neighbors = []
        for index in self.tree.query_ball_point(point, 25):
            if int(self.row_ids[index]) == int(bench["row_id"]):  # type: ignore[index]
                continue
            neighbors.append((
                float(self.directions[index]), float(np.linalg.norm(self.points[index] - point)), int(self.row_ids[index]),
            ))
        return _nearby_direction_signal(neighbors)


def nearby_bench_group_signal(database, bench: object) -> DirectionSignal | None:
    """Convenience entry point for tests and one-off single-bench analysis."""
    return KnownBenchDirections(database).signal(bench)


def image_axis_signal(image: np.ndarray, meters_per_pixel: float) -> DirectionSignal | None:
    """Estimate an elongated local axis around the mapped point.

    A colour-residual component finds bench-sized objects; a structure tensor
    is retained only as an independent agreement check. This deliberately
    returns an axis, never a guessed front side.
    """
    if image.ndim == 3:
        image = image[..., :3].mean(axis=2)
    rgb = np.asarray(image[..., :3], dtype=float) if image.ndim == 3 else np.repeat(np.asarray(image, dtype=float)[..., None], 3, axis=2)
    values = rgb.mean(axis=2)
    if min(values.shape) < 16 or not math.isfinite(meters_per_pixel) or meters_per_pixel <= 0:
        return None
    values = ndimage.gaussian_filter(values, max(.6, .18 / meters_per_pixel))
    gradient_y = ndimage.sobel(values, axis=0)
    gradient_x = ndimage.sobel(values, axis=1)
    yy, xx = np.indices(values.shape)
    radius_pixels = min(values.shape) / 2
    center_x, center_y = (values.shape[1] - 1) / 2, (values.shape[0] - 1) / 2
    mask = (xx - center_x) ** 2 + (yy - center_y) ** 2 <= min(radius_pixels, 3 / meters_per_pixel) ** 2
    jxx = float(np.sum(gradient_x[mask] ** 2))
    jyy = float(np.sum(gradient_y[mask] ** 2))
    jxy = float(np.sum(gradient_x[mask] * gradient_y[mask]))
    total = jxx + jyy
    coherence = math.hypot(jxx - jyy, 2 * jxy) / total if total > 1e-9 else 0
    # Tensor angle is the dominant gradient normal. It is not reliable enough
    # alone near paths/trees, but agreement materially raises component quality.
    gradient_angle = .5 * math.atan2(2 * jxy, jxx - jyy)
    tensor_axis = (math.degrees(math.atan2(math.cos(gradient_angle), math.sin(gradient_angle))) + 90) % 180

    background = np.stack([
        ndimage.gaussian_filter(rgb[..., channel], max(2, .7 / meters_per_pixel)) for channel in range(3)
    ], axis=2)
    residual = np.linalg.norm(rgb - background, axis=2)
    search = mask
    candidates: list[tuple[float, float, float, float, float, float]] = []
    for quantile in (65, 72, 78, 84, 90):
        threshold = float(np.percentile(residual[search], quantile))
        components, count = ndimage.label(ndimage.binary_closing((residual >= threshold) & search, iterations=1))
        for component in range(1, count + 1):
            component_y, component_x = np.where(components == component)
            area = len(component_x) * meters_per_pixel ** 2
            if len(component_x) < 5 or not .08 <= area <= 5:
                continue
            distance = math.hypot(
                (float(component_x.mean()) - center_x) * meters_per_pixel,
                (float(component_y.mean()) - center_y) * meters_per_pixel,
            )
            if distance > 1.7:
                continue
            points = np.column_stack((
                (component_x - component_x.mean()) * meters_per_pixel,
                (component_y - component_y.mean()) * meters_per_pixel,
            ))
            eigenvalues, eigenvectors = np.linalg.eigh(points.T @ points / len(points))
            ratio = float((eigenvalues[1] + 1e-4) / (eigenvalues[0] + 1e-4))
            length, width = 4 * math.sqrt(float(eigenvalues[1])), 4 * math.sqrt(float(eigenvalues[0]))
            if ratio < 1.5 or not .5 <= length <= 6 or width > 2:
                continue
            vector = eigenvectors[:, 1]
            axis = math.degrees(math.atan2(float(vector[0]), -float(vector[1]))) % 180
            score = math.log(ratio) * float(residual[component_y, component_x].mean()) * math.sqrt(area) / (1 + distance)
            candidates.append((score, axis, ratio, distance, length, width))
    if not candidates:
        return None
    _score, axis, ratio, distance, length, width = max(candidates)
    agreement = min(circular_difference(axis, tensor_axis), circular_difference(axis + 180, tensor_axis))
    weight = min(.95, .25 + .12 * math.log(ratio) + (.3 if agreement <= 30 else 0))
    concentration = 4.2 if agreement <= 30 else 3.0
    return DirectionSignal("image_axis", axis_distribution(axis, concentration), weight, {
        "axis_degrees": round(axis, 2), "component_ratio": round(ratio, 3),
        "center_distance_meters": round(distance, 3), "length_meters": round(length, 3), "width_meters": round(width, 3),
        "tensor_axis_degrees": round(tensor_axis, 2), "tensor_coherence": round(coherence, 4),
        "axis_agreement_degrees": round(agreement, 2), "meters_per_pixel": meters_per_pixel,
    })


def context_signals(database, bench: object, *, terrain=None, nearby_viewpoint_meters: float | None = None,
                    known_benches: KnownBenchDirections | None = None) -> list[DirectionSignal]:
    latitude, longitude = float(bench["latitude"]), float(bench["longitude"])  # type: ignore[index]
    context = nearby_context(database, latitude, longitude, 160, ["path", "building", "water"])
    context = preferred_environment_context(context, official_context_version(database))
    viewpoint = is_viewpoint(bench, nearby_viewpoint_meters)
    signals = [
        nearest_path_signal(latitude, longitude, context, viewpoint=viewpoint),
        nearest_building_signal(latitude, longitude, context),
        nearest_water_signal(latitude, longitude, context),
        openness_signal(bench["view_sectors"], bench["obstruction_types"], bench["obstruction_distances"], viewpoint=viewpoint),  # type: ignore[index]
        terrain_signal(latitude, longitude, terrain),
        known_benches.signal(bench) if known_benches else None,
    ]
    return [signal for signal in signals if signal is not None]
