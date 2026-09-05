"""Read and prioritize environmental evidence around a bench."""

from __future__ import annotations

import sqlite3
from typing import Optional, Sequence

from benchly.geo import bearing_degrees, distance_meters
from benchly.context.geometry import (
    feature_contains_exact,
    feature_distance_exact,
    feature_nearest_location,
    point_hits_exact_building,
)

def nearby_context(connection: sqlite3.Connection, latitude: float, longitude: float, radius_meters: float,
                   kinds: Optional[Sequence[str]] = None) -> list[sqlite3.Row]:
    latitude_delta = radius_meters / 111_320
    longitude_delta = radius_meters / (111_320 * max(0.2, math.cos(math.radians(latitude))))
    parameters: list[object] = [longitude - longitude_delta, longitude + longitude_delta, latitude - latitude_delta, latitude + latitude_delta]
    kind_clause = ""
    if kinds:
        kind_clause = f" AND f.kind IN ({','.join('?' for _ in kinds)})"
        parameters.extend(kinds)
    return connection.execute(f"""
        SELECT f.* FROM environment_spatial_index s
        JOIN environment_features f ON f.row_id=s.row_id
        WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?
        {kind_clause}
    """, parameters).fetchall()


def nearby_land_cover(connection: sqlite3.Connection, latitude: float, longitude: float, radius_meters: float = 50) -> list[sqlite3.Row]:
    latitude_delta = radius_meters / 111_320
    longitude_delta = radius_meters / (111_320 * max(0.2, math.cos(math.radians(latitude))))
    official_context = official_context_version(connection)
    source_clause = "AND f.source<>'swissTLM3D'"
    parameters: list[object] = [
        longitude - longitude_delta, longitude + longitude_delta,
        latitude - latitude_delta, latitude + latitude_delta,
    ]
    if official_context:
        source_clause = "AND (f.source<>'swissTLM3D' OR f.source_version=?)"
        parameters.append(official_context)
    return connection.execute("""
        SELECT f.* FROM land_cover_spatial_index s
        JOIN land_cover_features f ON f.row_id=s.row_id
        WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?
        {source_clause}
    """.format(source_clause=source_clause), parameters).fetchall()


def has_official_context(connection: sqlite3.Connection) -> bool:
    return official_context_version(connection) is not None


def official_context_version(connection: sqlite3.Connection) -> Optional[str]:
    row = connection.execute(
        "SELECT version FROM official_context_sources WHERE source='swissTLM3D' LIMIT 1"
    ).fetchone()
    return str(row["version"]) if row else None


def preferred_exact_features(
    features: Sequence[sqlite3.Row], kind: str, official_context: bool | str | None,
) -> list[sqlite3.Row]:
    """Use complete official geometry when available, otherwise exact OSM geometry."""
    def deduplicated(rows: Sequence[sqlite3.Row]) -> list[sqlite3.Row]:
        identities: dict[tuple[object, ...], sqlite3.Row] = {}
        for row in rows:
            keys = set(row.keys())
            identity = (
                row["kind"], round(float(row["center_latitude"]), 6), round(float(row["center_longitude"]), 6),
                round(float(row["min_latitude"]), 6), round(float(row["min_longitude"]), 6),
            ) if {"center_latitude", "center_longitude", "min_latitude", "min_longitude"} <= keys else (
                row["kind"], row["source"], row["source_version"] if "source_version" in keys else None,
                row["row_id"] if "row_id" in keys else id(row),
            )
            identities[identity] = row
        return list(identities.values())

    exact = [
        feature for feature in features
        if feature["kind"] == kind and feature["geometry_wkb"] is not None
    ]
    if kind == "building":
        detailed = [feature for feature in exact if feature["source"] == "swissBUILDINGS3D"]
        if detailed:
            return deduplicated(detailed)
    official = [feature for feature in exact if feature["source"] == "swissTLM3D"]
    if isinstance(official_context, str):
        official = [feature for feature in official if feature["source_version"] == official_context]
    non_official = [feature for feature in exact if feature["source"] not in {"swissTLM3D", "swissBUILDINGS3D"}]
    return deduplicated(official if official_context else non_official)


def preferred_environment_context(
    features: Sequence[sqlite3.Row], official_context: bool | str | None,
) -> list[sqlite3.Row]:
    other = [
        feature for feature in features
        if feature["kind"] not in {"building", "forest", "water"} and feature["geometry_wkb"] is not None
    ]
    return [
        *other,
        *preferred_exact_features(features, "building", official_context),
        *preferred_exact_features(features, "forest", official_context),
        *preferred_exact_features(features, "water", official_context),
    ]


def feature_distance(latitude: float, longitude: float, feature: sqlite3.Row) -> float:
    exact = feature_distance_exact(latitude, longitude, feature)
    if exact is not None:
        return exact
    nearest_latitude = min(max(latitude, feature["min_latitude"]), feature["max_latitude"])
    nearest_longitude = min(max(longitude, feature["min_longitude"]), feature["max_longitude"])
    return distance_meters(latitude, longitude, nearest_latitude, nearest_longitude)


def feature_bearing(latitude: float, longitude: float, feature: sqlite3.Row) -> float:
    nearest = feature_nearest_location(latitude, longitude, feature)
    target_latitude, target_longitude = nearest or (feature["center_latitude"], feature["center_longitude"])
    return bearing_degrees(latitude, longitude, target_latitude, target_longitude)


def point_hits_building(latitude: float, longitude: float, buildings: Sequence[sqlite3.Row], tolerance_meters: float = 2.5) -> bool:
    exact_buildings = [feature for feature in buildings if "geometry_wkb" in feature.keys() and feature["geometry_wkb"] is not None]
    return bool(exact_buildings and point_hits_exact_building(latitude, longitude, exact_buildings, tolerance_meters))
