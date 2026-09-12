from __future__ import annotations

import sqlite3

import numpy as np
from shapely import to_wkb
from shapely.geometry import Polygon, box

from benchly.panorama.datasets import SemanticIndex, WGS84_TO_LV95, distance_schedule, load_buildings, sample_terrain_rays
from benchly.panorama.models import PanoramaConfig, SemanticClass


def test_distance_schedule_is_dense_nearby_and_reaches_the_far_limit():
    distances = distance_schedule(150_000)
    assert distances[0] == 2
    assert distances[-1] == 150_000
    assert np.count_nonzero(distances <= 1_000) >= 45
    assert len(distances) < 150


def test_semantic_index_uses_specific_water_over_broad_land_cover():
    longitude, latitude = 8.2, 46.9
    easting, northing = WGS84_TO_LV95.transform(longitude, latitude)
    broad = box(easting - 100, northing - 100, easting + 100, northing + 100)
    lake = box(easting - 10, northing - 10, easting + 10, northing + 10)
    index = SemanticIndex([
        (broad, SemanticClass.OPEN_GRASSLAND, .8, "land-cover"),
        (lake, SemanticClass.WATER, .98, "surface-water"),
    ])
    semantics, confidences, sources = index.classify(np.asarray([longitude]), np.asarray([latitude]))
    assert semantics.tolist() == [SemanticClass.WATER]
    assert confidences.tolist() == [.98]
    assert sources.tolist() == ["surface-water"]


def test_empty_semantic_index_preserves_string_backed_enum_values():
    semantics, confidences, sources = SemanticIndex([]).classify(np.asarray([8.2]), np.asarray([46.9]))
    assert semantics.tolist() == [SemanticClass.UNKNOWN_TERRAIN]
    assert isinstance(semantics[0], SemanticClass)
    assert confidences.tolist() == [.35]
    assert sources.tolist() == ["swissALTI3D"]


def test_terrain_rays_without_semantic_index_use_valid_unknown_enum():
    class Terrain:
        @staticmethod
        def sample_many(locations):
            return [500.0] * len(locations)

    rays = sample_terrain_rays(
        46.9,
        8.2,
        Terrain(),
        PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=1_000),
    )
    assert len(rays) == 4
    assert all(sample.semantic == SemanticClass.UNKNOWN_TERRAIN for ray in rays for sample in ray.samples)


def test_building_loader_accepts_swissbuildings_3d_footprints():
    longitude, latitude = 8.2, 46.9
    easting, northing = WGS84_TO_LV95.transform(longitude, latitude)
    footprint = Polygon([
        (easting + 10, northing - 5, 505),
        (easting + 20, northing - 5, 505),
        (easting + 20, northing + 5, 505),
        (easting + 10, northing + 5, 505),
    ])
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript("""
      CREATE TABLE environment_features(
        row_id INTEGER PRIMARY KEY,source TEXT,source_id TEXT,source_version TEXT,kind TEXT,
        geometry_wkb BLOB,center_latitude REAL,center_longitude REAL,
        height_meters REAL,ground_elevation_meters REAL,eaves_elevation_meters REAL,roof_elevation_meters REAL
      );
      CREATE VIRTUAL TABLE environment_spatial_index USING rtree(
        row_id,min_longitude,max_longitude,min_latitude,max_latitude
      );
    """)
    connection.execute(
        "INSERT INTO environment_features VALUES(1,?,?,?,?,?,?,?,?,?,?,?)",
        ("swissBUILDINGS3D", "house-1", "2026", "building", to_wkb(footprint),
         latitude, longitude + .00015, 9, 500, 506, 509),
    )
    connection.execute(
        "INSERT INTO environment_spatial_index VALUES(1,?,?,?,?)",
        (longitude, longitude + .001, latitude - .001, latitude + .001),
    )

    class Terrain:
        @staticmethod
        def sample_many(locations):
            return [500.0] * len(locations)

    buildings = load_buildings(connection, latitude, longitude, Terrain(), 1_000)
    assert len(buildings) == 1
    assert buildings[0].source == "swissBUILDINGS3D"
    assert len(buildings[0].footprint) == 4
    assert all(len(coordinate) == 2 for coordinate in buildings[0].footprint)
