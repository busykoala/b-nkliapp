"""Terrain, horizon, shade and view calculations for bench enrichment."""

from __future__ import annotations

import json
import math
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional, Sequence

from benchly.catalog import load_catalog
from benchly.context.evidence import feature_bearing, feature_distance, point_hits_building
from benchly.geo import destination, distance_meters
from benchly.context.geometry import feature_angular_half_width, feature_contains_exact, feature_ray_span

PROFILE_DISTANCES_METERS = (10, 25, 50, 75, 100, 150, *range(200, 20_001, 200))
PROFILE_BEARING_GROUPS = (tuple(range(0, 180, 5)), tuple(range(180, 360, 5)))
GEOADMIN_PROFILE_URL = str(load_catalog().providers.geoAdminProfileUrl)

class RasterCollection:
    def __init__(self, directory: Optional[Path]):
        self.datasets = []
        if not directory or not directory.exists():
            return
        try:
            import rasterio
        except ImportError as error:
            raise RuntimeError("Terrain analysis requires rasterio.") from error
        for path in sorted(directory.rglob("*.tif")):
            try:
                dataset = rasterio.open(path)
                self.datasets.append(dataset)
            except Exception as error:  # continue after a corrupt/non-raster tile
                print(f"Skipping {path}: {error}", file=sys.stderr)

    def sample(self, latitude: float, longitude: float) -> Optional[float]:
        if not self.datasets:
            return None
        from rasterio.warp import transform
        for dataset in self.datasets:
            try:
                x, y = transform("EPSG:4326", dataset.crs, [longitude], [latitude])
                if dataset.bounds.left <= x[0] <= dataset.bounds.right and dataset.bounds.bottom <= y[0] <= dataset.bounds.top:
                    value = next(dataset.sample([(x[0], y[0])]))[0]
                    if dataset.nodata is None or value != dataset.nodata:
                        return float(value)
            except Exception:
                continue
        return None

    def close(self) -> None:
        for dataset in self.datasets:
            dataset.close()


def wgs84_to_lv95(latitude: float, longitude: float) -> tuple[float, float]:
    """Official swisstopo approximation used to address LV95 elevation services."""
    latitude_aux = (latitude * 3600 - 169_028.66) / 10_000
    longitude_aux = (longitude * 3600 - 26_782.5) / 10_000
    easting = (
        2_600_072.37 + 211_455.93 * longitude_aux
        - 10_938.51 * longitude_aux * latitude_aux
        - 0.36 * longitude_aux * latitude_aux ** 2
        - 44.54 * longitude_aux ** 3
    )
    northing = (
        1_200_147.07 + 308_807.95 * latitude_aux
        + 3_745.25 * longitude_aux ** 2 + 76.63 * latitude_aux ** 2
        - 194.56 * longitude_aux ** 2 * latitude_aux + 119.79 * latitude_aux ** 3
    )
    return easting, northing


def terrain_profile_coordinates(latitude: float, longitude: float,
                                bearings: Sequence[int] = tuple(range(0, 360, 5))) -> list[list[float]]:
    easting, northing = wgs84_to_lv95(latitude, longitude)
    coordinates = [[easting, northing]]
    for bearing in bearings:
        radians = math.radians(bearing)
        for distance in PROFILE_DISTANCES_METERS:
            coordinates.append([
                easting + math.sin(radians) * distance,
                northing + math.cos(radians) * distance,
            ])
        coordinates.append([easting, northing])
    return coordinates


def profile_height(point: object) -> Optional[float]:
    if not isinstance(point, dict) or not isinstance(point.get("alts"), dict):
        return None
    alts = point["alts"]
    value = alts.get("COMB", alts.get("DTM2", alts.get("DTM25")))
    try:
        height = float(value)
    except (TypeError, ValueError):
        return None
    return height if -100 <= height <= 5_000 else None


def terrain_horizon_from_profile(points: Sequence[object], bearing_count: int = 72) -> Optional[tuple[float, list[float], list[float]]]:
    expected = 1 + bearing_count * (len(PROFILE_DISTANCES_METERS) + 1)
    if len(points) < expected:
        return None
    elevation = profile_height(points[0])
    if elevation is None:
        return None
    profile: list[float] = []
    samples: list[float] = []
    cursor = 1
    for _bearing in range(bearing_count):
        maximum_angle = -5.0
        for distance in PROFILE_DISTANCES_METERS:
            sample = profile_height(points[cursor])
            cursor += 1
            samples.append(elevation if sample is None else sample)
            if sample is None:
                continue
            maximum_angle = max(maximum_angle, math.degrees(math.atan2(sample - (elevation + 1.1), distance)))
        cursor += 1
        profile.append(round(maximum_angle, 2))
    return (elevation, profile, samples) if len(profile) == bearing_count and len(samples) >= bearing_count else None


def fetch_terrain_horizon(latitude: float, longitude: float, timeout: float = 20) -> Optional[tuple[float, list[float], list[float]]]:
    elevation: Optional[float] = None
    complete_profile: list[float] = []
    complete_samples: list[float] = []
    for bearings in PROFILE_BEARING_GROUPS:
        coordinates = terrain_profile_coordinates(latitude, longitude, bearings)
        parameters = urllib.parse.urlencode({
            "geom": json.dumps({"type": "LineString", "coordinates": coordinates}, separators=(",", ":")),
            "sr": "2056",
            "nb_points": "2",
            "distinct_points": "True",
        }).encode()
        result = None
        for attempt in range(3):
            request = urllib.request.Request(
                GEOADMIN_PROFILE_URL,
                data=parameters,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Benchly/1.0 (terrain horizon batch)",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    result = terrain_horizon_from_profile(json.load(response), len(bearings))
                break
            except Exception as error:
                if attempt == 2:
                    print(f"GeoAdmin terrain profile failed: {error}", file=sys.stderr)
                    return None
                time.sleep(2 ** attempt)
        if result is None:
            return None
        group_elevation, group_profile, group_samples = result
        elevation = group_elevation if elevation is None else elevation
        complete_profile.extend(group_profile)
        complete_samples.extend(group_samples)
    if elevation is None or len(complete_profile) != 72:
        return None
    return elevation, complete_profile, complete_samples


def circular_difference(first: float, second: float) -> float:
    return abs(((first - second + 540) % 360) - 180)


def merge_near_obstructions(latitude: float, longitude: float, origin_elevation: float,
                            terrain_profile: Sequence[float], terrain_samples: Sequence[float],
                            context: Sequence[sqlite3.Row]) -> tuple[list[float], list[str], list[float], float, int]:
    profile = list(terrain_profile)
    obstruction_types = ["terrain"] * 72
    obstruction_distances = [0.0] * 72
    forests = [feature for feature in context if feature["kind"] == "forest"]
    for feature in [item for item in context if item["kind"] in {"building", "tree"}]:
        distance = max(2.5, feature_distance(latitude, longitude, feature))
        if distance > 350:
            continue
        bearing = feature_bearing(latitude, longitude, feature)
        default_height = 8.5 if feature["kind"] == "building" else 12.0
        height = feature["height_meters"] if feature["height_meters"] is not None else default_height
        bearing_index = round(bearing / 5) % 72
        distance_index = min(range(len(PROFILE_DISTANCES_METERS)), key=lambda index: abs(PROFILE_DISTANCES_METERS[index] - distance))
        sample_index = bearing_index * len(PROFILE_DISTANCES_METERS) + distance_index
        base_height = terrain_samples[sample_index] if len(terrain_samples) == 72 * len(PROFILE_DISTANCES_METERS) else origin_elevation
        roof_elevation = feature["roof_elevation_meters"] if "roof_elevation_meters" in feature.keys() else None
        relative_top = roof_elevation - (origin_elevation + 1.1) if roof_elevation is not None else base_height + height - (origin_elevation + 1.1)
        angle = max(0.0, min(89.0, math.degrees(math.atan2(max(1.0, relative_top), distance))))
        exact_half_angle = feature_angular_half_width(latitude, longitude, feature, bearing)
        width = max(4.0, distance_meters(feature["min_latitude"], feature["min_longitude"], feature["max_latitude"], feature["max_longitude"]))
        half_angle = exact_half_angle if exact_half_angle is not None else min(60.0, max(3.0, math.degrees(math.atan2(width / 2, distance))))
        for index in range(72):
            if circular_difference(index * 5, bearing) <= half_angle and angle > profile[index]:
                profile[index] = round(angle, 2)
                obstruction_types[index] = "building" if feature["kind"] == "building" else "vegetation"
                obstruction_distances[index] = round(distance, 1)
    # Forest is a polygon fact. A nearby bounding box or an isolated tree is not woodland.
    in_forest = any(feature_contains_exact(latitude, longitude, feature) for feature in forests)
    if in_forest:
        for index in range(72):
            if profile[index] < 8:
                profile[index] = 8
                obstruction_types[index] = "vegetation"
                obstruction_distances[index] = 15
    vegetation_percent = 100 * obstruction_types.count("vegetation") / 72
    canopy_percent = min(95.0, (55 if in_forest else 0) + vegetation_percent * 0.8)
    return profile, obstruction_types, obstruction_distances, canopy_percent, int(in_forest)


def horizon_profile(latitude: float, longitude: float, origin_height: float, surface: RasterCollection,
                    terrain: RasterCollection, buildings: Sequence[sqlite3.Row]) -> tuple[list[float], list[float], list[str], list[float], list[float], list[float]]:
    profile: list[float] = []
    terrain_profile: list[float] = []
    obstruction_types: list[str] = []
    obstruction_distances: list[float] = []
    relief_samples: list[float] = []
    far_max_elevations: list[float] = []
    near_distances = list(range(2, 22, 2)) + list(range(25, 101, 5)) + list(range(120, 301, 20))
    far_distances = [300 * (20_000 / 300) ** (index / 48) for index in range(1, 49)]
    for bearing in range(0, 360, 5):
        maximum_angle = -5.0
        maximum_terrain_angle = -5.0
        maximum_type = "unknown"
        maximum_distance = 0.0
        for sample_distance in near_distances:
            lat, lon = destination(latitude, longitude, bearing, sample_distance)
            terrain_elevation = terrain.sample(lat, lon)
            surface_elevation = surface.sample(lat, lon) if surface.datasets else None
            if terrain_elevation is not None:
                relief_samples.append(terrain_elevation)
                terrain_angle = math.degrees(math.atan2(terrain_elevation - origin_height, sample_distance))
                maximum_terrain_angle = max(maximum_terrain_angle, terrain_angle)
            elevation = surface_elevation if surface_elevation is not None else terrain_elevation
            if elevation is None:
                continue
            angle = math.degrees(math.atan2(elevation - origin_height, sample_distance))
            if angle > maximum_angle:
                raised_surface = surface_elevation is not None and terrain_elevation is not None and surface_elevation - terrain_elevation >= 2.0
                maximum_type = "building" if raised_surface and point_hits_building(lat, lon, buildings) else "vegetation" if raised_surface else "terrain"
                maximum_angle = angle
                maximum_distance = float(sample_distance)
        far_max_elevation = origin_height - 1.1
        for sample_distance in far_distances:
            lat, lon = destination(latitude, longitude, bearing, sample_distance)
            elevation = terrain.sample(lat, lon)
            if elevation is None:
                continue
            relief_samples.append(elevation)
            far_max_elevation = max(far_max_elevation, elevation)
            angle = math.degrees(math.atan2(elevation - origin_height, sample_distance))
            maximum_terrain_angle = max(maximum_terrain_angle, angle)
            if angle > maximum_angle:
                maximum_angle = angle
                maximum_type = "terrain"
                maximum_distance = float(sample_distance)
        profile.append(round(maximum_angle, 2))
        terrain_profile.append(round(maximum_terrain_angle, 2))
        obstruction_types.append(maximum_type)
        obstruction_distances.append(round(maximum_distance, 1))
        far_max_elevations.append(round(far_max_elevation, 1))
    return profile, terrain_profile, obstruction_types, obstruction_distances, relief_samples, far_max_elevations


def _longest_view_run(values: Sequence[bool], circular: bool) -> int:
    if not values:
        return 0
    source = [*values, *values] if circular else list(values)
    current = longest = 0
    for value in source:
        current = current + 1 if value else 0
        longest = max(longest, current)
    return min(len(values), longest)


def classify_view(latitude: float, longitude: float, facing: Optional[float], profile: Sequence[float],
                  terrain_profile: Sequence[float], context: Sequence[sqlite3.Row], relief: float,
                  terrain_samples: Sequence[float] = (), origin_elevation: Optional[float] = None,
                  obstruction_types: Sequence[str] = ()) -> tuple[list[str], float, float, float, float, dict]:
    indices = list(range(72)) if facing is None else [index for index in range(72) if abs((((index * 5 - facing) + 180) % 360) - 180) <= 45]
    selected = [profile[index] for index in indices]
    openness = sum(max(0.0, 1 - max(0.0, angle) / 35) for angle in selected) / max(1, len(selected))
    buildings = [feature for feature in context if feature["kind"] == "building"]
    forests = [feature for feature in context if feature["kind"] == "forest"]
    water_features = [feature for feature in context if feature["kind"] == "water"]
    roads = [feature for feature in context if feature["kind"] == "major_road"]

    def in_view(feature: sqlite3.Row, maximum_distance: float) -> bool:
        distance = feature_distance(latitude, longitude, feature)
        if distance > maximum_distance:
            return False
        direction = feature_bearing(latitude, longitude, feature)
        if facing is not None and abs((((direction - facing) + 180) % 360) - 180) > 55:
            return False
        horizon = profile[int(round(direction / 5)) % 72]
        return horizon < 12

    def row_value(feature: sqlite3.Row, key: str, default=None):
        return feature[key] if key in feature.keys() and feature[key] is not None else default

    def visible_water_rays(feature: sqlite3.Row) -> list[bool]:
        distance = feature_distance(latitude, longitude, feature)
        if distance > 10_000:
            return [False] * 72
        has_full_terrain = len(terrain_samples) == 72 * len(PROFILE_DISTANCES_METERS) and origin_elevation is not None
        result = [False] * 72
        blockers = [item for item in context if item["kind"] in {"building", "tree"}]
        for index in range(72):
            bearing = index * 5
            if facing is not None and abs((((bearing - facing) + 180) % 360) - 180) > 55:
                continue
            span = feature_ray_span(latitude, longitude, feature, bearing)
            entry = span[0] if span else None
            if entry is None and distance <= 75 and abs((((bearing - feature_bearing(latitude, longitude, feature)) + 180) % 360) - 180) <= 2.5:
                entry = distance
            if entry is None or entry > 10_000:
                continue
            if not has_full_terrain:
                result[index] = entry <= 75 and profile[index] < 8
                continue
            eye = float(origin_elevation) + 1.1
            target_distance = max(10, (span[0] + min(span[1], 10_000)) / 2 if span else entry)
            nearest_sample = min(range(len(PROFILE_DISTANCES_METERS)), key=lambda sample: abs(PROFILE_DISTANCES_METERS[sample] - target_distance))
            water_elevation = float(terrain_samples[index * len(PROFILE_DISTANCES_METERS) + nearest_sample])
            target_angle = math.degrees(math.atan2(water_elevation - eye, target_distance))
            foreground_angle = -90.0
            for sample_index, sample_distance in enumerate(PROFILE_DISTANCES_METERS):
                if sample_distance >= entry - 2:
                    break
                elevation = float(terrain_samples[index * len(PROFILE_DISTANCES_METERS) + sample_index])
                foreground_angle = max(foreground_angle, math.degrees(math.atan2(elevation - eye, sample_distance)))
            for blocker in blockers:
                blocker_distance = feature_distance(latitude, longitude, blocker)
                if blocker_distance >= entry or blocker_distance > 350:
                    continue
                blocker_bearing = feature_bearing(latitude, longitude, blocker)
                half_width = feature_angular_half_width(latitude, longitude, blocker, blocker_bearing) or 3.0
                if abs((((bearing - blocker_bearing) + 180) % 360) - 180) > half_width:
                    continue
                height = float(row_value(blocker, "height_meters", 8.5 if blocker["kind"] == "building" else 12.0))
                roof = row_value(blocker, "roof_elevation_meters")
                nearest_base_sample = min(range(len(PROFILE_DISTANCES_METERS)), key=lambda sample: abs(PROFILE_DISTANCES_METERS[sample] - blocker_distance))
                base = float(terrain_samples[(int(round(blocker_bearing / 5)) % 72) * len(PROFILE_DISTANCES_METERS) + nearest_base_sample])
                top = float(roof) if roof is not None else base + height
                foreground_angle = max(foreground_angle, math.degrees(math.atan2(top - eye, max(2.5, blocker_distance))))
            result[index] = target_angle + .6 >= foreground_angle
        return result

    water_visibility = [(feature, visible_water_rays(feature)) for feature in water_features]
    visible_water = [
        feature for feature, rays in water_visibility
        if _longest_view_run(rays, facing is None) >= (1 if feature_distance(latitude, longitude, feature) <= 75 else 2)
    ]
    if obstruction_types:
        blocked_share = sum(1 for index in indices if obstruction_types[index] in {"building", "vegetation"}) / max(1, len(indices))
    else:
        blocked_share = sum(1 for index in indices if profile[index] > terrain_profile[index] + .5) / max(1, len(indices))
    if facing is None and blocked_share >= .5:
        visible_water = [feature for feature in visible_water if feature_distance(latitude, longitude, feature) <= 75]
    visible_forests = [feature for feature in forests if in_view(feature, 2_000)]
    in_forest = any(feature_contains_exact(latitude, longitude, feature) for feature in forests)
    nearest_forest = min((feature_distance(latitude, longitude, feature) for feature in forests), default=math.inf)
    nearest_water = min((feature_distance(latitude, longitude, feature) for feature in water_features), default=math.inf)
    nearest_building = min((feature_distance(latitude, longitude, feature) for feature in buildings), default=math.inf)
    nearest_road = min((feature_distance(latitude, longitude, feature) for feature in roads), default=math.inf)
    # Naturalness describes the place around the bench, not merely the objects
    # visible above its horizon. Exact forest containment therefore carries the
    # strongest weight, followed by a forest edge and woodland in view.
    naturalness = min(1.0,
                      0.9 if in_forest else
                      0.72 if nearest_forest <= 25 else
                      0.6 if visible_forests else
                      0.35)
    if visible_water:
        naturalness = min(1.0, naturalness + 0.1)
    remoteness = min(1.0, 0.35 * min(1, nearest_building / 100) + 0.65 * min(1, nearest_road / 300))
    water_score = 1.0 if visible_water and nearest_water < 1500 else 0.7 if visible_water else 0.2 if nearest_water < 300 else 0.0
    labels: list[str] = []
    if len(terrain_samples) == 72:
        far_maximum = list(terrain_samples)
    elif len(terrain_samples) == 72 * len(PROFILE_DISTANCES_METERS):
        far_start = next(index for index, distance in enumerate(PROFILE_DISTANCES_METERS) if distance >= 2_000)
        far_maximum = [
            max(terrain_samples[index * len(PROFILE_DISTANCES_METERS) + far_start:(index + 1) * len(PROFILE_DISTANCES_METERS)], default=origin_elevation or 0)
            for index in range(72)
        ]
    else:
        far_maximum = [origin_elevation or 0] * 72
    terrain_sectors = []
    for index in indices:
        maximum = far_maximum[index]
        visible = profile[index] <= terrain_profile[index] + .5
        local_relief = maximum - (origin_elevation or maximum)
        prominent = terrain_profile[index] >= 1.5 and local_relief >= 120
        terrain_sectors.append({"mountain": visible and prominent and local_relief >= 500,
                                "hill": visible and prominent and local_relief < 500,
                                "maximum": maximum if visible and prominent else None})
    minimum_run = 8 if facing is None else 4
    mountain_run = _longest_view_run([bool(sector["mountain"]) for sector in terrain_sectors], facing is None)
    hill_run = _longest_view_run([bool(sector["hill"]) for sector in terrain_sectors], facing is None)
    if blocked_share < .5 and mountain_run >= minimum_run:
        labels.append("Bergblick")
    elif blocked_share < .5 and hill_run >= minimum_run:
        labels.append("Hügelblick")
    if visible_water:
        labels.append("Seeblick" if any((feature["subtype"] or "") in {"lake", "reservoir"} for feature in visible_water) else "Wasserblick")
    if openness >= 0.75:
        labels.append("Weitsicht")
    if (in_forest or nearest_forest <= 25 or visible_forests) and naturalness >= 0.7:
        labels.append("Waldumgebung")
    if openness < 0.4 or sum(selected) / max(1, len(selected)) > 22 or blocked_share >= 0.5:
        labels = [label for label in labels if label not in {"Bergblick", "Hügelblick", "Weitsicht"}]
        labels.append("Eingeschränkte Aussicht")
    if not labels:
        labels.append("Keine besondere Aussicht")
    sectors = []
    for start in range(0, 360, 45):
        values = [profile[index % 72] for index in range(start // 5, start // 5 + 9)]
        maximum_elevation = max(far_maximum[start // 5:start // 5 + 9], default=None)
        sectors.append({"from": start, "to": start + 45, "mean_horizon": round(sum(values) / len(values), 1), "open": sum(angle < 5 for angle in values) >= 5, "maximum_elevation_m": maximum_elevation})
    visible_maxima = [sector["maximum"] for sector in terrain_sectors if sector["maximum"] is not None]
    return labels, openness, water_score, naturalness, remoteness, {"sectors": sectors, "visible_water_count": len(visible_water), "visible_terrain_max_m": max(visible_maxima, default=None)}


def direct_sun_minutes(latitude: float, longitude: float, profile: Sequence[float], canopy_percent: float, covered: bool, month: int, day: int) -> int:
    try:
        from astral import Observer
        from astral.sun import azimuth, elevation
    except ImportError as error:
        raise RuntimeError("Sun exposure analysis requires astral.") from error
    observer = Observer(latitude=latitude, longitude=longitude)
    date = datetime(2024, month, day, tzinfo=timezone.utc)
    visible = 0
    for minutes in range(0, 24 * 60, 5):
        moment = date.replace(hour=minutes // 60, minute=minutes % 60)
        altitude = elevation(observer, moment)
        bearing = azimuth(observer, moment)
        position = (bearing % 360) / 5
        lower = int(math.floor(position)) % len(profile)
        upper = (lower + 1) % len(profile)
        horizon = profile[lower] * (1 - (position - math.floor(position))) + profile[upper] * (position - math.floor(position))
        if not covered and altitude > 0 and altitude > horizon:
            visible += 5
    return visible
