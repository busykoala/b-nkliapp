from __future__ import annotations

import sqlite3

import numpy as np
from shapely import to_wkb
from shapely.geometry import Point, Polygon, box
from capsule_fixtures import legacy_building_body

from benchly.panorama.datasets import (
    BuildingIndex,
    SemanticIndex,
    WGS84_TO_LV95,
    WGS84,
    buildings_for_viewpoint,
    distance_schedule,
    load_buildings,
    load_building_index,
    load_semantic_index,
    refine_building_contact_rays,
    sample_terrain_rays,
)
from benchly.panorama.models import BuildingGeometry, PanoramaConfig, SemanticClass, GeometryIdentity, TerrainRay, TerrainSample
from benchly.panorama.visibility import build_panorama_geometry


def test_distance_schedule_is_dense_nearby_and_reaches_the_far_limit():
    distances = distance_schedule(150_000)
    assert distances[0] == 2
    assert distances[-1] == 150_000
    assert np.count_nonzero(distances <= 1_000) >= 45
    assert len(distances) < 150


def test_lv95_vertices_project_to_the_same_true_bearings_as_terrain_rays():
    import math
    from benchly.panorama.datasets import _true_local_xy
    latitude, longitude = 46.8187879, 10.3436414
    vertices = []
    for bearing in (0, 90, 180, 270):
        lon, lat, _ = WGS84.fwd(longitude, latitude, bearing, 100)
        vertices.append(WGS84_TO_LV95.transform(lon, lat))
    projected = _true_local_xy(vertices, latitude, longitude)
    for (east, north), bearing in zip(projected, (0, 90, 180, 270), strict=True):
        # Allow millimetre-scale round-trip error from the datum transform;
        # the incorrect grid frame is displaced by metres in this fixture.
        assert abs(east - math.sin(math.radians(bearing)) * 100) < .005
        assert abs(north - math.cos(math.radians(bearing)) * 100) < .005
    origin_east, _ = WGS84_TO_LV95.transform(longitude, latitude)
    assert abs(vertices[0][0] - origin_east) > 3  # Grid-north subtraction fails this actual eastern-Swiss case.


def test_measured_wall_contacts_remove_range_shell_steps_without_moving_the_roof():
    import math
    config = PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=1000)
    identity = GeometryIdentity(latitude=46.9, longitude=8.2, ground_elevation_meters=500,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture", angular_resolution_degrees=90)
    rays = [TerrainRay(azimuth_degrees=azimuth, samples=tuple(TerrainSample(
        distance_meters=distance, elevation_meters=500, semantic=SemanticClass.OPEN_GRASSLAND,
        source="fixture") for distance in (2, 4, 6, 10, 100))) for azimuth in (0, 90, 180, 270)]
    class Terrain:
        @staticmethod
        def sample_many(locations): return [500.] * len(locations)
    bases = []
    old_bases = []
    for distance in (5.99, 6.01):
        house = BuildingGeometry(source_id="wall", footprint=((-1,distance),(1,distance),(1,distance+2),(-1,distance+2)),
            ground_elevation_meters=499, eaves_elevation_meters=511, roof_elevation_meters=511, source="fixture", confidence=1)
        before = build_panorama_geometry(identity, rays, [house], config=config)
        refined = refine_building_contact_rays(rays, [house], 46.9, 8.2, Terrain(), config)
        after = build_panorama_geometry(identity, refined, [house], config=config)
        old_bases.append(before.buildings[0].samples[0].lower_angle_degrees)
        profile = after.buildings[0].samples[0]
        bases.append(profile.lower_angle_degrees)
        assert abs(profile.lower_angle_degrees - math.degrees(math.atan2(-1.1, distance))) < .0001
        assert profile.upper_angle_degrees == before.buildings[0].samples[0].upper_angle_degrees
        assert set(rays[0].samples).issubset(set(refined[0].samples))
    assert abs(old_bases[0] - old_bases[1]) > 4
    assert abs(bases[0] - bases[1]) < .04


def test_wall_contact_samples_have_independent_material_evidence_and_missing_data_is_incomplete():
    config = PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=1000)
    ray = TerrainRay(azimuth_degrees=0, samples=(TerrainSample(distance_meters=2, elevation_meters=500,
        semantic=SemanticClass.WATER), TerrainSample(distance_meters=10, elevation_meters=500, semantic=SemanticClass.WATER)))
    house = BuildingGeometry(source_id="wall", footprint=((-1,5),(1,5),(1,7),(-1,7)),
        ground_elevation_meters=500, eaves_elevation_meters=511, roof_elevation_meters=511, source="fixture", confidence=1)
    class Terrain:
        @staticmethod
        def sample_many(locations): return [500.] * len(locations)
    class Missing:
        @staticmethod
        def sample_many(locations): return [None] * len(locations)
    class Materials(SemanticIndex):
        def __init__(self):
            super().__init__([])

        @staticmethod
        def classify(longitudes, latitudes):
            values = np.empty(len(longitudes), dtype=object); values[:] = SemanticClass.OPEN_GRASSLAND
            return values, np.ones(len(values)), np.full(len(values), "verified-bank")
    refined = refine_building_contact_rays([ray], [house,house], 46.9, 8.2, Terrain(), config, Materials())[0]
    assert len(refined.samples) == 3 and refined.has_complete_coverage
    contact = refined.samples[1]
    assert contact.distance_meters == 5 and contact.semantic == SemanticClass.OPEN_GRASSLAND
    assert contact.source == "verified-bank" and contact.terrain_source == "swissALTI3D-building-contact"
    missing = refine_building_contact_rays([ray], [house], 46.9, 8.2, Missing(), config)[0]
    assert missing.samples == ray.samples and not missing.has_complete_coverage


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
      CREATE TABLE land_cover_features(row_id INTEGER PRIMARY KEY,geometry_wkb BLOB,class TEXT,source TEXT,geometry_crs INTEGER DEFAULT 2056);
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
    connection.execute("INSERT INTO land_cover_features(row_id,geometry_wkb,class,source) VALUES(1,?,'Wiese','swissTLM3D')", (to_wkb(broad),))
    connection.execute("INSERT INTO land_cover_spatial_index VALUES(1,?,?,?,?)", bounds)
    connection.execute("INSERT INTO environment_features VALUES(2,?,'water','See','OpenStreetMap')", (to_wkb(lake),))
    connection.execute("INSERT INTO environment_spatial_index VALUES(2,?,?,?,?)", bounds)

    index = load_semantic_index(connection, latitude, longitude, 1_000)
    semantics, confidences, sources = index.classify(np.asarray([longitude]), np.asarray([latitude]))
    assert semantics.tolist() == [SemanticClass.WATER]
    assert confidences.tolist() == [.98]
    assert sources.tolist() == ["OpenStreetMap"]
    connection.execute("ALTER TABLE environment_features ADD COLUMN raw_tags TEXT")
    connection.execute("UPDATE environment_features SET raw_tags=? WHERE row_id=2", ('{"verlauf":"Unterirdisch bestimmt"}',))
    underground = load_semantic_index(connection, latitude, longitude, 1_000)
    classes, _, _ = underground.classify(np.asarray([longitude]), np.asarray([latitude]))
    assert classes.tolist() == [SemanticClass.OPEN_GRASSLAND]
    connection.execute("UPDATE environment_features SET raw_tags=? WHERE row_id=2", ('{"objektart":"Fliessgewaesser","verlauf":"Oberirdisch"}',))
    river = load_semantic_index(connection, latitude, longitude, 1_000)
    classes, _, _ = river.classify(np.asarray([longitude]), np.asarray([latitude]))
    assert classes.tolist() == [SemanticClass.RIVER]


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


def test_compaction_preserves_water_banks_instead_of_filling_a_depth_shell_blue():
    from benchly.panorama.datasets import WGS84
    latitude, longitude = 46.9, 8.2
    def ranges(locations):
        return np.asarray(WGS84.inv(np.full(len(locations), longitude), np.full(len(locations), latitude),
            np.asarray([point[1] for point in locations]), np.asarray([point[0] for point in locations]))[2])
    class Terrain:
        @staticmethod
        def sample_many(locations): return (100 + ranges(locations) * .05).tolist()
    class Materials(SemanticIndex):
        def __init__(self):
            super().__init__([])

        @staticmethod
        def classify(longitudes, latitudes):
            distances = ranges(list(zip(latitudes, longitudes)))
            values = np.empty(len(distances), dtype=object)
            values[:] = SemanticClass.FOREST
            values[(distances > 100) & (distances < 145)] = SemanticClass.WATER
            return values, np.full(len(values), 1.), np.full(len(values), "measured")
    config = PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=1000)
    rays = sample_terrain_rays(latitude, longitude, Terrain(), config, semantics=Materials(), observer_ground_elevation_meters=100)
    geometry = build_panorama_geometry(GeometryIdentity(latitude=latitude, longitude=longitude, ground_elevation_meters=100,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture", angular_resolution_degrees=90), rays, config=config)
    for column in geometry.columns:
        water = [span for span in column.spans if span.semantic == SemanticClass.WATER]
        assert water
        assert sum(span.upper_angle_degrees - span.lower_angle_degrees for span in water) < .6


def test_material_transitions_cannot_change_measured_depth_on_an_identical_slope():
    from benchly.panorama.datasets import WGS84
    latitude, longitude = 46.9, 8.2

    def ranges(locations):
        return np.asarray(WGS84.inv(np.full(len(locations), longitude), np.full(len(locations), latitude),
            np.asarray([point[1] for point in locations]), np.asarray([point[0] for point in locations]))[2])

    class Terrain:
        @staticmethod
        def sample_many(locations):
            distances = ranges(locations)
            return (100 + distances * (.04 + distances / 100_000)).tolist()

    class Materials(SemanticIndex):
        def __init__(self):
            super().__init__([])

        @staticmethod
        def classify(longitudes, latitudes):
            distances = ranges(list(zip(latitudes, longitudes)))
            values = np.empty(len(distances), dtype=object)
            values[:] = SemanticClass.FOREST
            # Only the northern ray crosses a mapped clearing. This changes
            # material, never the underlying radial slope or its depth.
            values[(latitudes > latitude) & (distances > 190) & (distances < 310)] = SemanticClass.OPEN_GRASSLAND
            return values, np.ones(len(values)), np.full(len(values), "measured")

    config = PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=1000)
    rays = sample_terrain_rays(latitude, longitude, Terrain(), config,
        semantics=Materials(), observer_ground_elevation_meters=100)
    assert any(sample.semantic == SemanticClass.OPEN_GRASSLAND for sample in rays[0].samples)
    assert all(sample.semantic == SemanticClass.FOREST for sample in rays[2].samples)
    assert [sample.distance_meters for sample in rays[0].samples] == [sample.distance_meters for sample in rays[2].samples]
    geometry = build_panorama_geometry(GeometryIdentity(latitude=latitude, longitude=longitude, ground_elevation_meters=100,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture", angular_resolution_degrees=90), rays, config=config)
    north, south = geometry.columns[0], geometry.columns[2]
    assert [(span.distance_meters, round(span.upper_angle_degrees, 6)) for span in north.spans] == [
        (span.distance_meters, round(span.upper_angle_degrees, 6)) for span in south.spans]


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
    distances = distance_schedule(150_000)
    assert sum(primary.calls) == 4 * int(np.count_nonzero(distances <= 20_000))
    assert sum(regional.calls) == 4 * int(np.count_nonzero(distances > 20_000))
    # Without an observer height there is no visibility envelope to cull;
    # retain the LOD samples rather than merging their measured distances.
    assert len(near) + len(far) == sum(primary.calls) + sum(regional.calls)


def test_terrain_rays_use_matching_local_dem_near_the_observer_before_coarse_pyramid():
    class Terrain:
        datasets = [{"version": "fixture"}]

        def __init__(self, value):
            self.value = value
            self.calls = []

        def sample_many(self, locations):
            self.calls.append(len(locations))
            return [self.value] * len(locations)

    local = Terrain(500)
    pyramid = Terrain(520)
    rays = sample_terrain_rays(
        46.9, 8.2, pyramid,
        PanoramaConfig(angular_resolution_degrees=90, maximum_distance_meters=1_000),
        observer_ground_elevation_meters=500,
        local_terrain=local,
        local_terrain_distance_meters=120,
    )
    local_samples = [sample for ray in rays for sample in ray.samples if sample.distance_meters <= 120]
    farther_samples = [sample for ray in rays for sample in ray.samples if sample.distance_meters > 120]
    assert local_samples and farther_samples
    assert {sample.elevation_meters for sample in local_samples} == {500}
    assert {sample.terrain_source for sample in local_samples} == {"swissALTI3D-local"}
    assert {sample.elevation_meters for sample in farther_samples} == {520}
    distances = distance_schedule(1_000)
    assert sum(local.calls) == 4 * int(np.count_nonzero(distances <= 120))
    assert sum(pyramid.calls) == 4 * int(np.count_nonzero(distances > 120))


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
    assert abs(buildings[0].orientation_degrees - 90.5557) < .001  # True bearing, including meridian convergence.
    cached = buildings_for_viewpoint(
        load_building_index(connection, latitude, longitude, 2_000),
        latitude, longitude, Terrain(), 1_000,
    )
    assert cached == buildings


def test_partial_3d_import_only_supersedes_overlapping_fallback_buildings():
    longitude, latitude = 8.2, 46.9
    east, north = WGS84_TO_LV95.transform(longitude, latitude)
    shapes = [box(east + 10, north, east + 45, north + 20),
              box(east + 12, north + 1, east + 46, north + 21),
              box(east + 100, north, east + 115, north + 10)]
    rows = [{"source": source, "source_id": str(index), "source_version": "fixture", "raw_tags": "{}",
             "geometry_wkb": to_wkb(shape), "center_latitude": latitude, "center_longitude": longitude,
             "height_meters": 10, "ground_elevation_meters": 500, "eaves_elevation_meters": 507,
             "roof_elevation_meters": 510}
            for index, (source, shape) in enumerate(zip(["swissBUILDINGS3D", "swissTLM3D", "swissTLM3D"], shapes))]
    class Terrain:
        @staticmethod
        def sample_many(locations): return [500] * len(locations)
    buildings = buildings_for_viewpoint(BuildingIndex(rows), latitude, longitude, Terrain(), 1000)
    assert {building.source_id for building in buildings} == {"swissBUILDINGS3D:0", "swissTLM3D:2"}


def test_measured_building_contacts_local_slope_without_changing_roof_datum():
    longitude, latitude = 8.2, 46.9
    east, north = WGS84_TO_LV95.transform(longitude, latitude)
    shape = box(east + 10, north - 10, east + 30, north + 10)
    row = {"source": "swissBUILDINGS3D", "source_id": "hillside", "source_version": "fixture",
        "raw_tags": "{}", "geometry_wkb": to_wkb(shape), "center_latitude": latitude,
        "center_longitude": longitude, "height_meters": 15, "ground_elevation_meters": 510,
        "eaves_elevation_meters": 520, "roof_elevation_meters": 525}
    class Terrain:
        @staticmethod
        def sample_many(locations):
            return [500 + (WGS84_TO_LV95.transform(lon, lat)[1] - north) * .4
                    for lat, lon in locations]
    building = buildings_for_viewpoint(BuildingIndex([row]), latitude, longitude, Terrain(), 1000)[0]
    assert building.ground_elevation_meters == 510
    assert building.eaves_elevation_meters == 520
    assert building.roof_elevation_meters == 525
    assert np.allclose(sorted(building.footprint_ground_elevations), [496, 496, 504, 504], atol=.01)


def test_verified_storey_reference_survives_import_projection_and_capsule():
    import json
    from benchly.panorama.binary import decode_geometry, encode_geometry
    longitude, latitude = 8.2, 46.9
    east, north = WGS84_TO_LV95.transform(longitude, latitude)
    reference = {"source": "BFS-GWR", "egid": "123", "storeys": 3,
        "exportDate": "15.10.2026", "responseSha256": "a" * 64}
    row = {"source": "swissBUILDINGS3D", "source_id": "house", "source_version": "fixture",
        "raw_tags": json.dumps({"benchly:building_reference": reference}),
        "geometry_wkb": to_wkb(box(east + 10, north - 10, east + 30, north + 10)),
        "center_latitude": latitude, "center_longitude": longitude, "height_meters": 9,
        "ground_elevation_meters": 500, "eaves_elevation_meters": 509, "roof_elevation_meters": 512}
    class Terrain:
        @staticmethod
        def sample_many(locations): return [500] * len(locations)
    buildings = buildings_for_viewpoint(BuildingIndex([row]), latitude, longitude, Terrain(), 1000)
    assert buildings[0].levels is None
    assert buildings[0].registered_storeys == 3
    assert buildings[0].registered_storeys_source == "BFS-GWR:123@15.10.2026#" + "a" * 64
    config = PanoramaConfig(angular_resolution_degrees=1)
    identity = GeometryIdentity(latitude=latitude, longitude=longitude, ground_elevation_meters=500,
        terrain_version="fixture", semantic_version="fixture", building_version="fixture", angular_resolution_degrees=1)
    rays = sample_terrain_rays(latitude, longitude, Terrain(), config, observer_ground_elevation_meters=500)
    geometry = build_panorama_geometry(identity, rays, buildings, config=config)
    restored = decode_geometry(encode_geometry(geometry)).buildings[0]
    assert restored.levels is None and restored.registered_storeys == 3
    assert restored.registered_storeys_source == buildings[0].registered_storeys_source


def test_aggregated_solid_keeps_mapped_house_units_without_changing_its_shape():
    import json
    import struct
    from benchly.panorama.binary import MAGIC, decode_geometry, encode_geometry
    from benchly.panorama.visibility import _building_columns
    longitude, latitude = 8.2, 46.9
    east, north = WGS84_TO_LV95.transform(longitude, latitude)
    whole = box(east+10,north-10,east+30,north+10)
    south, north_unit = box(east+10,north-10,east+30,north), box(east+10,north,east+30,north+10)
    def row(source, source_id, shape, levels=None):
        return {"source":source,"source_id":source_id,"source_version":"fixture",
            "raw_tags":json.dumps({"building:levels":str(levels)}) if levels else "{}",
            "geometry_wkb":to_wkb(shape),"center_latitude":latitude,"center_longitude":longitude,
            "height_meters":10,"ground_elevation_meters":500,"eaves_elevation_meters":508,"roof_elevation_meters":510}
    rows=[row("swissBUILDINGS3D","terrace",whole),row("OpenStreetMap","way-10",south,3),
          row("OpenStreetMap","area-20",south,3),row("OpenStreetMap","way-11",north_unit),
          row("OpenStreetMap","area-22",north_unit)]
    class Terrain:
        @staticmethod
        def sample_many(locations):return [500]*len(locations)
    buildings=buildings_for_viewpoint(BuildingIndex(rows),latitude,longitude,Terrain(),1000)
    assert len(buildings)==1
    building=buildings[0]
    assert len(building.facade_parts)==2  # Way and area are one actual house.
    assert [p.source_id for p in building.facade_parts]==["OpenStreetMap:way-10","OpenStreetMap:way-11"]
    assert building.facade_parts[0].levels==3 and building.facade_parts[1].levels is None
    assert abs(abs(sum(building.footprint[i][0]*building.footprint[(i+1)%len(building.footprint)][1]
        -building.footprint[(i+1)%len(building.footprint)][0]*building.footprint[i][1] for i in range(len(building.footprint))))/2-400)<.01  # Includes LV95 map-scale correction.
    assert building.footprint == buildings_for_viewpoint(BuildingIndex(rows[:1]),latitude,longitude,Terrain(),1000)[0].footprint
    config=PanoramaConfig(angular_resolution_degrees=1)
    profiles={p.azimuth_degrees:p for _,_,p in _building_columns(building,config,501.1)}
    assert profiles[60].facade_part_index==1 and profiles[120].facade_part_index==0
    identity=GeometryIdentity(latitude=latitude,longitude=longitude,ground_elevation_meters=500,
        terrain_version="fixture",semantic_version="fixture",building_version="fixture",angular_resolution_degrees=1)
    rays=sample_terrain_rays(latitude,longitude,Terrain(),config,observer_ground_elevation_meters=500)
    encoded=encode_geometry(build_panorama_geometry(identity,rays,buildings,config=config))
    restored=decode_geometry(encoded).buildings[0]
    assert restored.facade_parts==building.facade_parts
    assert {p.facade_part_index for p in restored.samples}=={0,1}
    header_size,body_size=struct.unpack("<II",encoded[8:16])
    header=json.loads(encoded[16:16+header_size]);header["schema"]=5
    header["arrays"].pop("building_part_indices")
    for building_metadata in header["buildings"]:building_metadata.pop("facade_parts")
    body=legacy_building_body(header,encoded[16+header_size:16+header_size+body_size])
    old_header=json.dumps(header,sort_keys=True,separators=(",",":")).encode()
    legacy=decode_geometry(MAGIC+struct.pack("<II",len(old_header),len(body))+old_header+body).buildings[0]
    assert legacy.facade_parts==() and all(s.facade_part_index is None for s in legacy.samples)
    # One whole-block duplicate supplies no evidence for internal divisions.
    no_units=buildings_for_viewpoint(BuildingIndex([rows[0],row("OpenStreetMap","way-99",whole)]),latitude,longitude,Terrain(),1000)
    assert no_units[0].facade_parts==()


def test_overlapping_or_single_nested_units_cannot_invent_a_facade_partition():
    from benchly.panorama.datasets import _source_facade_parts
    first=box(0,0,10,10);second=box(5,0,15,10)
    row=lambda source_id:{"source_id":source_id,"raw_tags":"{}"}
    assert _source_facade_parts([(row("way-1"),first)],0,0)==()
    assert _source_facade_parts([(row("way-1"),first),(row("way-2"),second)],0,0)==()
