"""Batch-oriented adapters from Benchly's national indices to panorama inputs."""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from collections import defaultdict
from collections.abc import Sequence

import numpy as np
from pyproj import Geod, Transformer
from shapely import from_wkb, get_parts, points
from shapely.geometry import Point
from shapely.strtree import STRtree

from benchly.context.evidence import nearby_context
from benchly.context.rasters import RasterCollection
from benchly.panorama.models import BuildingGeometry, PanoramaConfig, SemanticClass, TerrainRay, TerrainSample


WGS84 = Geod(ellps="WGS84")
WGS84_TO_LV95 = Transformer.from_crs(4326, 2056, always_xy=True)


def distance_schedule(maximum_distance_meters: float) -> np.ndarray:
    """Level-of-detail schedule: dense nearby, logarithmic in the far field."""
    sections = [
        np.geomspace(2, min(1_000, maximum_distance_meters), 48),
        np.geomspace(1_050, min(20_000, maximum_distance_meters), 42) if maximum_distance_meters > 1_000 else [],
        np.geomspace(20_500, maximum_distance_meters, 34) if maximum_distance_meters > 20_000 else [],
    ]
    return np.unique(np.asarray([round(float(value), 2) for section in sections for value in section], dtype=float))


def raster_source_version(collection: RasterCollection) -> str:
    payload = json.dumps(collection.datasets, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


class SemanticIndex:
    """One in-memory spatial query for all sampled points of one viewpoint."""

    def __init__(self, records: Sequence[tuple[object, SemanticClass, float, str]]):
        self.geometries = [record[0] for record in records]
        self.semantics = [record[1] for record in records]
        self.confidences = [record[2] for record in records]
        self.sources = [record[3] for record in records]
        self.tree = STRtree(self.geometries) if self.geometries else None

    def classify(self, longitudes: np.ndarray, latitudes: np.ndarray):
        size = len(longitudes)
        # np.full coerces str-backed Enums through a fixed-width string dtype
        # before placing them into an object array ("SemanticClass.U" here).
        # Assigning into an existing object array preserves the Enum instance.
        semantics = np.empty(size, dtype=object)
        semantics[:] = SemanticClass.UNKNOWN_TERRAIN
        confidences = np.full(size, .35, dtype=float)
        sources = np.full(size, "swissALTI3D", dtype=object)
        if self.tree is None or size == 0:
            return semantics, confidences, sources
        eastings, northings = WGS84_TO_LV95.transform(longitudes, latitudes)
        query_points = points(np.asarray(eastings), np.asarray(northings))
        matches = self.tree.query(query_points, predicate="within")
        if matches.size == 0:
            return semantics, confidences, sources
        # Later/higher priority records overwrite broad generic land cover.
        priorities = {
            SemanticClass.UNKNOWN_TERRAIN: 0,
            SemanticClass.OPEN_GRASSLAND: 1,
            SemanticClass.ROCK: 2,
            SemanticClass.FOREST: 3,
            SemanticClass.SNOW_OR_GLACIER: 4,
            SemanticClass.SETTLEMENT: 5,
            SemanticClass.RIVER: 6,
            SemanticClass.WATER: 7,
        }
        chosen = np.zeros(size, dtype=np.int8)
        for point_index, geometry_index in zip(matches[0], matches[1]):
            semantic = self.semantics[int(geometry_index)]
            priority = priorities.get(semantic, 0)
            if priority >= chosen[int(point_index)]:
                index = int(point_index)
                semantics[index] = semantic
                confidences[index] = self.confidences[int(geometry_index)]
                sources[index] = self.sources[int(geometry_index)]
                chosen[index] = priority
        return semantics, confidences, sources


def _semantic_class(value: str, kind: str | None = None) -> SemanticClass:
    normalized = value.casefold().replace("ö", "oe").replace("ä", "ae").replace("ü", "ue")
    if kind == "water":
        return SemanticClass.RIVER if any(token in normalized for token in ("fluss", "river", "stream", "bach", "canal")) else SemanticClass.WATER
    if kind == "forest" or any(token in normalized for token in ("wald", "gehoelz", "forest", "baum", "obstanlage")):
        return SemanticClass.FOREST
    if any(token in normalized for token in ("gletscher", "schneefeld", "glacier", "firn")):
        return SemanticClass.SNOW_OR_GLACIER
    if any(token in normalized for token in ("fels", "rock", "geroell", "lockergestein")):
        return SemanticClass.ROCK
    if any(token in normalized for token in ("siedlung", "parkplatz", "flugplatz", "industrie", "schule", "spital")):
        return SemanticClass.SETTLEMENT
    if any(token in normalized for token in ("reben", "golf", "camping", "acker", "wiese", "weide")):
        return SemanticClass.OPEN_GRASSLAND
    return SemanticClass.UNKNOWN_TERRAIN


def load_semantic_index(database, latitude: float, longitude: float, radius_meters: float = 20_000) -> SemanticIndex:
    latitude_delta = radius_meters / 111_320
    longitude_delta = radius_meters / (111_320 * max(.2, math.cos(math.radians(latitude))))
    bounds = (longitude - longitude_delta, longitude + longitude_delta, latitude - latitude_delta, latitude + latitude_delta)
    records: list[tuple[object, SemanticClass, float, str]] = []
    land = database.execute("""SELECT f.geometry_wkb,f.class,f.source FROM land_cover_spatial_index s
        JOIN land_cover_features f ON f.row_id=s.row_id
        WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?""", bounds).fetchall()
    for row in land:
        semantic = _semantic_class(str(row["class"]))
        if semantic == SemanticClass.UNKNOWN_TERRAIN:
            continue
        try:
            records.append((from_wkb(bytes(row["geometry_wkb"])), semantic, .9, str(row["source"])))
        except Exception:
            continue
    context = database.execute("""SELECT f.geometry_wkb,f.kind,f.subtype,f.source FROM environment_spatial_index s
        JOIN environment_features f ON f.row_id=s.row_id
        WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?
          AND f.kind IN ('water','forest') AND f.geometry_wkb IS NOT NULL""", bounds).fetchall()
    for row in context:
        semantic = _semantic_class(str(row["subtype"] or ""), str(row["kind"]))
        try:
            records.append((from_wkb(bytes(row["geometry_wkb"])), semantic, .98, str(row["source"])))
        except Exception:
            continue
    return SemanticIndex(records)


def sample_terrain_rays(
    latitude: float,
    longitude: float,
    terrain: RasterCollection,
    config: PanoramaConfig,
    semantics: SemanticIndex | None = None,
) -> list[TerrainRay]:
    """Sample the dedicated high-resolution 360° path in one raster batch."""
    distances = distance_schedule(config.maximum_distance_meters)
    azimuths = np.arange(config.column_count, dtype=float) * config.angular_resolution_degrees
    flat_bearings = np.repeat(azimuths, len(distances))
    flat_distances = np.tile(distances, len(azimuths))
    longitudes, latitudes, _ = WGS84.fwd(
        np.full(len(flat_bearings), longitude),
        np.full(len(flat_bearings), latitude),
        flat_bearings,
        flat_distances,
    )
    locations = list(zip(latitudes.tolist(), longitudes.tolist()))
    elevations = terrain.sample_many(locations)
    if semantics:
        classes, confidences, sources = semantics.classify(np.asarray(longitudes), np.asarray(latitudes))
    else:
        classes = np.empty(len(locations), dtype=object)
        classes[:] = SemanticClass.UNKNOWN_TERRAIN
        confidences = np.full(len(locations), .35)
        sources = np.full(len(locations), "swissALTI3D", dtype=object)
    rays = []
    for ray_index, azimuth in enumerate(azimuths):
        offset = ray_index * len(distances)
        samples = tuple(TerrainSample(
            distance_meters=float(distance),
            elevation_meters=float(elevation),
            semantic=classes[offset + index],
            confidence=float(confidences[offset + index]),
            source=str(sources[offset + index]),
        ) for index, (distance, elevation) in enumerate(zip(distances, elevations[offset:offset + len(distances)])) if elevation is not None)
        rays.append(TerrainRay(
            azimuth_degrees=float(azimuth),
            samples=samples,
            expected_sample_count=len(distances),
        ))
    return rays


def _row_height(row, key: str):
    return float(row[key]) if key in row.keys() and row[key] is not None else None


def load_buildings(database, latitude: float, longitude: float, terrain: RasterCollection,
                   radius_meters: float = 10_000) -> list[BuildingGeometry]:
    """Load and normalize only potentially visible building massing once."""
    rows = nearby_context(database, latitude, longitude, radius_meters, ["building"])
    origin_east, origin_north = WGS84_TO_LV95.transform(longitude, latitude)
    prepared = []
    for row in rows:
        try:
            source_geometry = from_wkb(bytes(row["geometry_wkb"]))
            polygon_parts = [
                part for part in get_parts(source_geometry)
                if part.geom_type == "Polygon" and part.area > .05
            ]
            if not polygon_parts:
                continue
            geometry = max(polygon_parts, key=lambda part: part.area)
            distance = float(Point(origin_east, origin_north).distance(geometry))
            if distance > radius_meters or geometry.covers(Point(origin_east, origin_north)):
                continue
            source = str(row["source"])
            explicit_height = _row_height(row, "height_meters")
            priority = 4 if source == "swissBUILDINGS3D" else 3 if source == "OpenStreetMap" and explicit_height else 2 if source == "swissTLM3D" else 1
            prepared.append((priority, distance, row, geometry, explicit_height))
        except Exception:
            continue
    prepared.sort(key=lambda item: (-item[0], item[1]))

    # Suppress lower-priority duplicates by substantial footprint overlap,
    # without confusing genuinely adjacent houses.
    selected = []
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for priority, distance, row, geometry, explicit_height in prepared:
        center = geometry.centroid
        key = (math.floor(center.x / 25), math.floor(center.y / 25))
        candidates = {index for dx in (-1, 0, 1) for dy in (-1, 0, 1) for index in grid.get((key[0] + dx, key[1] + dy), ())}
        duplicate = False
        for index in candidates:
            other = selected[index][3]
            overlap = geometry.intersection(other).area
            if overlap / max(.01, min(geometry.area, other.area)) >= .65:
                duplicate = True
                break
        if duplicate:
            continue
        selected.append((priority, distance, row, geometry, explicit_height))
        grid[key].append(len(selected) - 1)

    centers = [(float(item[2]["center_latitude"]), float(item[2]["center_longitude"])) for item in selected]
    ground_samples = terrain.sample_many(centers)
    result = []
    for (priority, distance, row, geometry, explicit_height), sampled_ground in zip(selected, ground_samples):
        source = str(row["source"])
        ground = _row_height(row, "ground_elevation_meters")
        ground = ground if ground is not None else sampled_ground
        if ground is None:
            continue
        roof = _row_height(row, "roof_elevation_meters")
        eaves = _row_height(row, "eaves_elevation_meters")
        if roof is None:
            roof = ground + (explicit_height or 8.5)
        if eaves is None:
            eaves = roof
        tolerance = .2 if distance <= 500 else 1 if distance <= 2_000 else 3
        simplified = geometry.simplify(tolerance, preserve_topology=True)
        parts = [part for part in get_parts(simplified) if part.geom_type == "Polygon"]
        if not parts:
            continue
        polygon = max(parts, key=lambda part: part.area)
        # swissBUILDINGS3D footprints may retain a Z coordinate.  Panorama
        # visibility works in the local horizontal plane, so deliberately
        # consume only X/Y instead of unpacking the coordinate tuple as 2-D.
        coordinates = tuple(
            (float(coordinate[0] - origin_east), float(coordinate[1] - origin_north))
            for coordinate in polygon.exterior.coords[:-1]
        )
        if len(coordinates) < 3:
            continue
        confidence = .98 if source == "swissBUILDINGS3D" else .8 if explicit_height is not None else .48
        result.append(BuildingGeometry(
            source_id=f"{source}:{row['source_id']}",
            footprint=coordinates,
            ground_elevation_meters=float(ground),
            eaves_elevation_meters=float(eaves),
            roof_elevation_meters=float(max(roof, eaves)),
            source=source,
            source_version=str(row["source_version"]) if "source_version" in row.keys() and row["source_version"] else None,
            confidence=confidence,
            roof_kind="known-pitched" if source == "swissBUILDINGS3D" and roof - eaves >= 1 else "flat-or-unknown",
        ))
    return result
