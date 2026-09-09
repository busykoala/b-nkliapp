"""GeoAdmin terrain-profile client and horizon response mapping."""

from __future__ import annotations

import json
import math
import sys
import time
import urllib.parse
import urllib.request
from typing import Sequence

from pydantic import BaseModel, ConfigDict, TypeAdapter
from scipy.spatial import cKDTree

from benchly.catalog import load_catalog

PROFILE_DISTANCES_METERS = (10, 25, 50, 75, 100, 150, *range(200, 20_001, 200))
PROFILE_BEARING_GROUPS = (tuple(range(0, 180, 5)), tuple(range(180, 360, 5)))
GEOADMIN_PROFILE_URL = str(load_catalog().providers.geoAdminProfileUrl)


class ProfileAltitudes(BaseModel):
    model_config = ConfigDict(extra="ignore")

    COMB: float | str | None = None
    DTM2: float | str | None = None
    DTM25: float | str | None = None


class ProfilePoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    alts: ProfileAltitudes
    easting: float | None = None
    northing: float | None = None


PROFILE_RESPONSE = TypeAdapter(list[ProfilePoint])


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


def profile_height(point: ProfilePoint) -> float | None:
    for value in (point.alts.COMB, point.alts.DTM2, point.alts.DTM25):
        try:
            height = float(value) if value is not None else None
        except (TypeError, ValueError):
            continue
        if height is not None and -100 <= height <= 5_000:
            return height
    return None


def align_profile_points(points: Sequence[object], coordinates: Sequence[Sequence[float]]) -> list[ProfilePoint] | None:
    """Match actual LV95 locations; GeoAdmin can omit points outside DEM coverage."""
    try:
        validated = PROFILE_RESPONSE.validate_python(points)
    except ValueError:
        return None
    if not validated or any(
        point.easting is None or point.northing is None
        or not math.isfinite(point.easting) or not math.isfinite(point.northing)
        for point in validated
    ):
        return None
    tree = cKDTree([(point.easting, point.northing) for point in validated])
    # The service rounds coordinates to millimetres. A centimetre accommodates
    # this rounding without substituting a height from another terrain sample.
    distances, indices = tree.query(coordinates, distance_upper_bound=.01)
    if any(not math.isfinite(distance) for distance in distances):
        return None
    aligned = [validated[int(index)] for index in indices]
    return aligned if all(profile_height(point) is not None for point in aligned) else None


def terrain_horizon_from_profile(points: Sequence[object], bearing_count: int = 72) -> tuple[float, list[float], list[float]] | None:
    try:
        validated = PROFILE_RESPONSE.validate_python(points)
    except ValueError:
        return None
    expected = 1 + bearing_count * (len(PROFILE_DISTANCES_METERS) + 1)
    if len(validated) != expected:
        return None
    elevation = profile_height(validated[0])
    if elevation is None:
        return None
    profile: list[float] = []
    samples: list[float] = []
    cursor = 1
    for _bearing in range(bearing_count):
        maximum_angle = -5.0
        for distance in PROFILE_DISTANCES_METERS:
            sample = profile_height(validated[cursor])
            cursor += 1
            if sample is None:
                return None
            samples.append(sample)
            maximum_angle = max(maximum_angle, math.degrees(math.atan2(sample - (elevation + 1.1), distance)))
        cursor += 1
        profile.append(round(maximum_angle, 2))
    return elevation, profile, samples


def fetch_terrain_horizon(latitude: float, longitude: float, timeout: float = 20) -> tuple[float, list[float], list[float]] | None:
    elevation: float | None = None
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
                    aligned = align_profile_points(json.load(response), coordinates)
                    result = terrain_horizon_from_profile(aligned, len(bearings)) if aligned is not None else None
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
