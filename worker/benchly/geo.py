"""Small WGS84 geometry helpers shared by worker features."""

from __future__ import annotations

import math


def circular_difference(first: float, second: float) -> float:
    return abs(((first - second + 540) % 360) - 180)

def destination(latitude: float, longitude: float, bearing: float, distance_meters: float) -> tuple[float, float]:
    earth = 6_371_000.0
    angular = distance_meters / earth
    lat1, lon1, angle = map(math.radians, (latitude, longitude, bearing))
    lat2 = math.asin(math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(angle))
    lon2 = lon1 + math.atan2(math.sin(angle) * math.sin(angular) * math.cos(lat1), math.cos(angular) - math.sin(lat1) * math.sin(lat2))
    return math.degrees(lat2), math.degrees(lon2)


def distance_meters(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    mean_latitude = math.radians((latitude_a + latitude_b) / 2)
    north = (latitude_b - latitude_a) * 111_320
    east = (longitude_b - longitude_a) * 111_320 * math.cos(mean_latitude)
    return math.hypot(north, east)


def bearing_degrees(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    north = (latitude_b - latitude_a) * 111_320
    east = (longitude_b - longitude_a) * 111_320 * math.cos(math.radians((latitude_a + latitude_b) / 2))
    return math.degrees(math.atan2(east, north)) % 360
