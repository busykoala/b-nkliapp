from __future__ import annotations

import sqlite3

import numpy as np
from shapely import to_wkb
from shapely.geometry import Point, Polygon, box

from benchly.panorama.datasets import (
    SemanticIndex,
    WGS84_TO_LV95,
    distance_schedule,
    load_buildings,
    load_semantic_index,
    sample_terrain_rays,
)
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


def test_semantic_ingestion_reads_indexed_land_cover_and_water():
    longitude, latitude = 8.2, 46.9
    easting, northing = WGS84_TO_LV95.transform(longitude, latitude)
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript("""
      CREATE TABLE land_cover_features(row_id INTEGER PRIMARY KEY,geometry_wkb BLOB,class TEXT,source TEXT);
      CREATE VIRTUAL TABLE land_cover_spatial_index USING rtree(
        row_id,min_longitude,max_longitude,min_latitude,max_latitude
      );
      CREATE TABLE environment_features(
        row_id INTEGER PRIMARY KEY,geometry_wkb BLOB,kind TEXT,subtype TEXT,source TEXT
      );
      CREATE VIRTUAL TABLE environment_spatial_index USING rtree(
        row_id,min_longitude,max_longitude,min_latitude,max_latitude
      );
    """)
    broad = box(easting - 100, northing - 100, easting + 100, northing + 100)
    lake = box(easting - 10, northing - 10, easting + 10, northing + 10)
    bounds = (longitude - .01, longitude + .01, latitude - .01, latitude + .01)
    connection.execute("INSERT INTO land_cover_features VALUES(1,?,'Wiese','swissTLM3D')", (to_wkb(broad),))
    connection.execute("INSERT INTO land_cover_spatial_index VALUES(1,?,?,?,?)", bounds)
    connection.execute("INSERT INTO environment_features VALUES(2,?,'water','See','OpenStreetMap')", (to_wkb(lake),))
    connection.execute("INSERT INTO environment_spatial_index VALUES(2,?,?,?,?)", bounds)

    index = load_semantic_index(connection, latitude, longitude, 1_000)
    semantics, confidences, sources = index.classify(np.asarray([longitude]), np.asarray([latitude]))
    assert semantics.tolist() == [SemanticClass.WATER]
    assert confidences.tolist() == [.98]
    assert sources.tolist() == ["OpenStreetMap"]


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
    assert all(sample.slope_degrees == 0 for ray in rays for sample in ray.samples)
    assert all(sample.relief_meters == 0 for ray in rays for sample in ray.samples)


def test_terrain_samples_retain_slope_and_local_relief():
    class Terrain:
        @staticmethod
        def sample_many(locations):
            # Repeat a rising profile independently for each direction.
            per_ray = len(locations) // 4
            return [500 + index * 10 for _ray in range(4) for index in range(per_ray)]

    terrain_rays = sample_terrain_rays(
        46.9, 8.2, Terrain(),
        PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=1_000),
    )
    middle = terrain_rays[0].samples[len(terrain_rays[0].samples) // 2]
    assert middle.slope_degrees is not None and middle.slope_degrees > 0
    assert middle.relief_meters == 40


def test_terrain_lod_prefers_regional_overview_far_away():
    class Terrain:
        datasets = [{"version": "fixture"}]

        def __init__(self, value):
            self.value = value
            self.calls = []

        def sample_many(self, locations):
            self.calls.append(len(locations))
            return [self.value] * len(locations)

    primary = Terrain(500)
    regional = Terrain(510)
    terrain_rays = sample_terrain_rays(
        46.9, 8.2, primary,
        PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=150_000),
        regional_terrain=regional,
        high_resolution_distance_meters=20_000,
    )
    near = [sample for ray in terrain_rays for sample in ray.samples if sample.distance_meters <= 20_000]
    far = [sample for ray in terrain_rays for sample in ray.samples if sample.distance_meters > 20_000]
    assert near and far
    assert {sample.terrain_source for sample in near} == {"swissALTI3D"}
    assert {sample.terrain_source for sample in far} == {"regional-terrain"}
    assert sum(primary.calls) == len(near)
    assert sum(regional.calls) == len(far)


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
    connection.execute(
        "INSERT INTO environment_features VALUES(2,?,?,?,?,?,?,?,?,?,?,?)",
        ("OpenStreetMap", "building-node", "2026", "building", to_wkb(Point(easting + 4, northing)),
         latitude, longitude, None, None, None, None),
    )
    connection.execute(
        "INSERT INTO environment_spatial_index VALUES(2,?,?,?,?)",
        (longitude, longitude, latitude, latitude),
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
    assert buildings[0].orientation_degrees == 90
