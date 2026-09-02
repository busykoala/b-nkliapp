import unittest
import json
import sqlite3
import time
import urllib.error
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from shapely import to_wkb
from shapely.affinity import translate
from shapely.geometry import Polygon

from benchly_worker import (
    context_kind,
    exclusive_worker_lock,
    expand_bounds,
    finalize_swisstlm_import,
    import_swisstlm_geopackage,
    parse_bool,
    parse_direction,
    parse_height,
    preferred_exact_features,
    preferred_environment_context,
    import_osm,
    score_view,
    spatial_cell_bounds,
    terrain_horizon_from_profile,
    terrain_profile_coordinates,
    wgs84_to_lv95,
)
from environment_geometry import (
    canopy_neighborhood,
    deterministic_environment,
    feature_angular_half_width,
    feature_contains_exact,
    feature_distance_exact,
    point_lv95,
)
from visual_pipeline import (
    DiscoveredImage,
    ProviderDelay,
    _request_json,
    bearing_degrees,
    circular_difference,
    analyze_scenes,
    discover_open_images,
    infer_scene,
    infer_scene_frames,
    reconcile_environment,
    search_panoramax,
    validate_evaluation_dataset,
    validate_scene_prediction,
)


class WorkerUnitTests(unittest.TestCase):
    def test_direction_normalization(self):
        self.assertEqual(parse_direction("SW"), 225)
        self.assertEqual(parse_direction("-45"), 315)
        self.assertIsNone(parse_direction("both"))

    def test_boolean_normalization(self):
        self.assertEqual(parse_bool("yes"), 1)
        self.assertEqual(parse_bool("no"), 0)
        self.assertIsNone(parse_bool("unknown"))

    def test_view_formula(self):
        self.assertEqual(score_view(1, 1, 1, 1, 1), 100)
        self.assertEqual(score_view(0, 0, 0, 0, 0), 0)
        self.assertEqual(score_view(1, 0, 0, 0, 0), 35)

    def test_context_classification_and_height(self):
        self.assertEqual(context_kind({"building": "yes"}), "building")
        self.assertEqual(context_kind({"natural": "water"}), "water")
        self.assertEqual(context_kind({"highway": "footway"}), "path")
        self.assertAlmostEqual(parse_height({"building:levels": "3"}), 9.3)

    def test_spatial_batch_bounds_are_stable_and_expand(self):
        bounds = spatial_cell_bounds(46.68654, 7.86468)
        for actual, expected in zip(bounds, (7.85, 46.65, 7.90, 46.70)):
            self.assertAlmostEqual(actual, expected)
        expanded = expand_bounds(bounds, 500)
        self.assertLess(expanded[0], bounds[0])
        self.assertLess(expanded[1], bounds[1])
        self.assertGreater(expanded[2], bounds[2])
        self.assertGreater(expanded[3], bounds[3])

    def test_worker_lock_rejects_a_second_writer(self):
        with TemporaryDirectory() as directory:
            database = Path(directory) / "benchly.sqlite"
            with exclusive_worker_lock(database) as first:
                self.assertTrue(first)
                with exclusive_worker_lock(database) as second:
                    self.assertFalse(second)

    def test_geo_admin_profile_builds_a_complete_horizon(self):
        easting, northing = wgs84_to_lv95(47.37674, 8.54183)
        self.assertAlmostEqual(easting, 2_683_314, delta=2)
        self.assertAlmostEqual(northing, 1_247_908, delta=2)
        coordinates = terrain_profile_coordinates(47.37674, 8.54183)
        points = [{"alts": {"COMB": 500 if index == 0 else 510}} for index, _coordinate in enumerate(coordinates)]
        result = terrain_horizon_from_profile(points)
        self.assertIsNotNone(result)
        elevation, profile, samples = result
        self.assertEqual(elevation, 500)
        self.assertEqual(len(profile), 72)
        self.assertEqual(len(samples), 72 * 106)

    def test_concave_forest_bbox_does_not_mean_containment(self):
        origin = point_lv95(46.6622, 7.8092)
        easting, northing = origin.x, origin.y
        concave = Polygon([
            (easting - 20, northing - 20), (easting + 20, northing - 20),
            (easting + 20, northing + 20), (easting + 5, northing + 20),
            (easting + 5, northing - 5), (easting - 5, northing - 5),
            (easting - 5, northing + 20), (easting - 20, northing + 20),
        ])
        feature = {"geometry_wkb": to_wkb(concave), "kind": "forest"}
        self.assertFalse(feature_contains_exact(46.6622, 7.8092, feature))
        self.assertAlmostEqual(feature_distance_exact(46.6622, 7.8092, feature), 5, delta=.2)

    def test_daerligen_waterfront_stays_open_under_individual_trees(self):
        origin = point_lv95(46.6622, 7.8092)
        easting, northing = origin.x, origin.y
        water = {"geometry_wkb": to_wkb(Polygon([
            (easting - 100, northing + 8), (easting + 100, northing + 8),
            (easting + 100, northing + 200), (easting - 100, northing + 200),
        ])), "kind": "water"}
        forest = {"geometry_wkb": to_wkb(Polygon([
            (easting - 60, northing - 60), (easting + 60, northing - 60),
            (easting + 60, northing + 60), (easting + 30, northing + 60),
            (easting + 30, northing - 30), (easting - 30, northing - 30),
            (easting - 30, northing + 60), (easting - 60, northing + 60),
        ])), "kind": "forest"}
        land = {"geometry_wkb": to_wkb(origin.buffer(100)), "class": "open meadow"}
        result = deterministic_environment(46.6622, 7.8092, [forest], [water], [land], "partial")
        self.assertFalse(result["in_forest"])
        self.assertTrue(result["waterfront"])
        self.assertAlmostEqual(result["water_distance"], 8, delta=.2)
        self.assertEqual(result["land_context"], "open")

    def test_exact_forest_edge_is_separate_from_forest_containment(self):
        origin = point_lv95(47, 8)
        # Shift the exact polygon so its boundary is roughly 20 m from the bench.
        forest = {"geometry_wkb": to_wkb(translate(origin.buffer(10), xoff=30)), "kind": "forest"}
        result = deterministic_environment(47, 8, [forest], [], [], "none")
        self.assertFalse(result["in_forest"])
        self.assertAlmostEqual(result["forest_distance"], 20, delta=.2)
        self.assertEqual(result["land_context"], "forest_edge")

    def test_exact_building_shadow_uses_narrow_footprint_not_wide_bbox(self):
        origin = point_lv95(47, 8)
        building = {
            "geometry_wkb": to_wkb(Polygon([
                (origin.x - 2, origin.y + 20), (origin.x + 2, origin.y + 20),
                (origin.x + 2, origin.y + 25), (origin.x - 2, origin.y + 25),
            ])),
            "min_latitude": 46.99, "max_latitude": 47.01,
            "min_longitude": 7.99, "max_longitude": 8.01,
        }
        half_width = feature_angular_half_width(47, 8, building, 0)
        self.assertIsNotNone(half_width)
        self.assertLess(half_width, 10)

    def test_isolated_surface_peak_is_partial_canopy_not_forest(self):
        class Terrain:
            def sample(self, _latitude, _longitude):
                return 500.0

        class Surface:
            def sample(self, latitude, longitude):
                return 512.0 if abs(latitude - 47) < .000015 and abs(longitude - 8) < .00002 else 500.0

        result = canopy_neighborhood(47, 8, Terrain(), Surface(), [])
        self.assertLess(result["share_10m"], .5)
        self.assertIn(result["context"], {"none", "partial"})
        environment = deterministic_environment(47, 8, [], [], [], str(result["context"]))
        self.assertFalse(environment["in_forest"])

    def test_official_context_replaces_osm_for_forest_truth(self):
        database = sqlite3.connect(":memory:")
        database.row_factory = sqlite3.Row
        database.execute("CREATE TABLE features(kind TEXT,source TEXT,geometry_wkb BLOB)")
        geometry = to_wkb(point_lv95(47, 8).buffer(20))
        database.execute("INSERT INTO features VALUES('forest','OpenStreetMap',?)", (geometry,))
        osm_only = database.execute("SELECT * FROM features").fetchall()
        self.assertEqual(len(preferred_exact_features(osm_only, "forest", False)), 1)
        self.assertEqual(preferred_exact_features(osm_only, "forest", True), [])
        database.execute("INSERT INTO features VALUES('forest','swissTLM3D',?)", (geometry,))
        preferred = preferred_exact_features(database.execute("SELECT * FROM features").fetchall(), "forest", True)
        self.assertEqual(len(preferred), 1)
        self.assertEqual(preferred[0]["source"], "swissTLM3D")

    def test_current_official_version_replaces_stale_geometry_and_osm_buildings(self):
        database = sqlite3.connect(":memory:")
        database.row_factory = sqlite3.Row
        database.execute("CREATE TABLE features(kind TEXT,source TEXT,source_version TEXT,geometry_wkb BLOB)")
        geometry = to_wkb(point_lv95(47, 8).buffer(20))
        database.executemany("INSERT INTO features VALUES(?,?,?,?)", [
            ("forest", "swissTLM3D", "old", geometry),
            ("forest", "swissTLM3D", "current", geometry),
            ("building", "OpenStreetMap", "osm", geometry),
            ("building", "swissTLM3D", "current", geometry),
        ])
        rows = database.execute("SELECT * FROM features").fetchall()
        self.assertEqual([row["source_version"] for row in preferred_exact_features(rows, "forest", "current")], ["current"])
        context = preferred_environment_context(rows, "current")
        buildings = [row for row in context if row["kind"] == "building"]
        self.assertEqual(len(buildings), 1)
        self.assertEqual(buildings[0]["source"], "swissTLM3D")

    def test_multifile_official_refresh_keeps_all_parts_and_invalidates_enrichment(self):
        database = sqlite3.connect(":memory:")
        database.row_factory = sqlite3.Row
        database.executescript("""
          CREATE TABLE environment_features(row_id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT,source_id TEXT,kind TEXT,
            subtype TEXT,center_latitude REAL,center_longitude REAL,min_latitude REAL,max_latitude REAL,
            min_longitude REAL,max_longitude REAL,height_meters REAL,raw_tags TEXT,imported_at TEXT,
            geometry_wkb BLOB,geometry_crs INTEGER,source_version TEXT,source_updated_at TEXT,
            UNIQUE(source,source_id,kind));
          CREATE TABLE land_cover_features(row_id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT,source_id TEXT,class TEXT,
            geometry_wkb BLOB,geometry_crs INTEGER,min_latitude REAL,max_latitude REAL,min_longitude REAL,max_longitude REAL,
            source_version TEXT,source_updated_at TEXT,imported_at TEXT,UNIQUE(source,source_id,class));
          CREATE TABLE bench_enrichments(bench_row_id INTEGER PRIMARY KEY,environment_computed_at TEXT,pipeline_version TEXT,context_source_version TEXT);
          INSERT INTO environment_features(source,source_id,kind,center_latitude,center_longitude,min_latitude,max_latitude,
            min_longitude,max_longitude,raw_tags,imported_at,geometry_crs,source_version)
            VALUES('swissTLM3D','stale','forest',47,8,46.9,47.1,7.9,8.1,'{}','old',2056,'old');
          INSERT INTO bench_enrichments VALUES(1,'old','old-pipeline','swissTLM3D:old');
        """)
        forest = {"id": "forest-one", "properties": {}, "geometry": {
            "type": "Polygon", "coordinates": [[[8, 47], [8.001, 47], [8.001, 47.001], [8, 47.001], [8, 47]]],
        }}
        water = {"id": "water-one", "properties": {}, "geometry": {
            "type": "Polygon", "coordinates": [[[8.01, 47], [8.011, 47], [8.011, 47.001], [8.01, 47.001], [8.01, 47]]],
        }}
        with patch("benchly_worker.geopackage_layers", side_effect=[["TLM_WALD"], ["TLM_GEWAESSER"]]), \
             patch("benchly_worker.iter_layer_features", side_effect=[iter([forest]), iter([water])]):
            import_swisstlm_geopackage(database, Path("part-one.gpkg"), "v2", "generation-v2", finalize=False)
            import_swisstlm_geopackage(database, Path("part-two.gpkg"), "v2", "generation-v2", finalize=False)
        finalize_swisstlm_import(database, "generation-v2")
        rows = database.execute("SELECT source_id,kind,source_version FROM environment_features ORDER BY kind").fetchall()
        self.assertEqual([(row["source_id"], row["kind"], row["source_version"]) for row in rows], [
            ("TLM_WALD:forest-one", "forest", "v2"),
            ("TLM_GEWAESSER:water-one", "water", "v2"),
        ])
        enrichment = database.execute("SELECT * FROM bench_enrichments").fetchone()
        self.assertIsNone(enrichment["environment_computed_at"])
        self.assertIsNone(enrichment["pipeline_version"])
        self.assertIsNone(enrichment["context_source_version"])

    def test_scene_schema_rejects_missing_or_out_of_range_values(self):
        with self.assertRaises(ValueError):
            validate_scene_prediction({"relevance_probability": 2})

    def test_provider_retries_server_errors_and_honors_retry_after(self):
        server_error = urllib.error.HTTPError("https://example.test", 500, "error", {}, None)
        with patch("visual_pipeline.urllib.request.urlopen", side_effect=[server_error, BytesIO(b'{}')]), \
             patch("visual_pipeline.time.sleep") as sleep:
            self.assertEqual(_request_json("https://example.test"), {})
            sleep.assert_called_once_with(1)
        delayed = urllib.error.HTTPError("https://example.test", 429, "slow", {"Retry-After": "123"}, None)
        with patch("visual_pipeline.urllib.request.urlopen", side_effect=delayed):
            with self.assertRaises(ProviderDelay) as raised:
                _request_json("https://example.test")
        self.assertEqual(raised.exception.seconds, 123)

    def test_panoramax_uses_collection_as_one_capture_group(self):
        payload = {"features": [{
            "id": "image-one", "collection": "sequence-one",
            "geometry": {"coordinates": [7.81, 46.662]},
            "properties": {"view:azimuth": 123, "geovisio:producer": "Contributor", "license": "CC-BY-SA-4.0"},
            "assets": {"sd": {"href": "https://example.test/image.jpg"}},
        }]}
        with patch("visual_pipeline._request_json", return_value=payload):
            image = search_panoramax((7.8, 46.66, 7.82, 46.67))[0]
        self.assertEqual(image.capture_group_id, "panoramax:sequence-one")
        self.assertEqual(image.heading, 123)
        self.assertEqual(image.author, "Contributor")

    def test_inference_limit_counts_base64_request_size(self):
        oversized_after_encoding = [(b"x" * (5 * 1024 * 1024), "image/jpeg")] * 4
        with self.assertRaisesRegex(ValueError, "payload"):
            infer_scene(oversized_after_encoding, "https://example.test", "secret")

    def test_osm_way_and_relation_context_retain_exact_geometry(self):
        with TemporaryDirectory() as directory:
            database = sqlite3.connect(":memory:")
            database.row_factory = sqlite3.Row
            database.executescript("""
              CREATE TABLE benches(row_id INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,osm_type TEXT,osm_id INTEGER,
                latitude REAL,longitude REAL,backrest INTEGER,armrest INTEGER,covered INTEGER,wheelchair INTEGER,seats INTEGER,
                material TEXT,direction_degrees REAL,operator TEXT,description TEXT,raw_tags TEXT,active INTEGER,
                source_updated_at TEXT,imported_at TEXT,UNIQUE(osm_type,osm_id));
              CREATE TABLE bench_enrichments(bench_row_id INTEGER PRIMARY KEY,pipeline_version TEXT,environment_computed_at TEXT);
              CREATE TABLE media(id INTEGER PRIMARY KEY,bench_row_id INTEGER,relation TEXT,provider TEXT,external_id TEXT,
                source_url TEXT,thumbnail_url TEXT,title TEXT,fetched_at TEXT,UNIQUE(provider,external_id,bench_row_id));
              CREATE TABLE environment_features(row_id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT,source_id TEXT,kind TEXT,
                subtype TEXT,center_latitude REAL,center_longitude REAL,min_latitude REAL,max_latitude REAL,
                min_longitude REAL,max_longitude REAL,height_meters REAL,raw_tags TEXT,imported_at TEXT,
                geometry_wkb BLOB,geometry_crs INTEGER DEFAULT 2056,source_version TEXT,source_updated_at TEXT,
                UNIQUE(source,source_id,kind));
            """)
            fixture = Path(directory) / "context.osm"
            fixture.write_text("""<?xml version='1.0' encoding='UTF-8'?>
              <osm version='0.6'>
                <node id='1' lat='46.6620' lon='7.8088'/><node id='2' lat='46.6620' lon='7.8095'/>
                <node id='3' lat='46.6625' lon='7.8095'/><node id='4' lat='46.6625' lon='7.8088'/>
                <node id='5' lat='46.6622' lon='7.8091'><tag k='amenity' v='bench'/></node>
                <way id='10'><nd ref='1'/><nd ref='2'/><nd ref='3'/><nd ref='4'/><nd ref='1'/>
                  <tag k='natural' v='wood'/><tag k='type' v='multipolygon'/></way>
                <relation id='20'><member type='way' ref='10' role='outer'/>
                  <tag k='type' v='multipolygon'/><tag k='landuse' v='forest'/></relation>
              </osm>""")
            imported, context = import_osm(database, fixture, "fixture-v1")
            rows = database.execute("SELECT source_id,geometry_wkb,geometry_crs FROM environment_features").fetchall()
            self.assertEqual(imported, 1)
            self.assertGreaterEqual(context, 1)
            self.assertTrue(all(row["geometry_wkb"] for row in rows))
            self.assertTrue(all(row["geometry_crs"] == 2056 for row in rows))


class VisualPipelineTests(unittest.TestCase):
    @staticmethod
    def prediction(**overrides):
        value = {
            "relevance_probability": .95, "rejection_reason": "none", "forest_probability": .05,
            "park_probability": .1, "open_probability": .9, "urban_probability": .1,
            "canopy_context": "partial", "canopy_probability": .85, "water_probability": .9,
            "lake_view_probability": .9, "mountain_view_probability": .8, "open_view_probability": .85,
            "limited_view_probability": .1, "buildings_probability": .2, "road_rail_probability": .4,
            "bench_visible_probability": .2,
        }
        value.update(overrides)
        return value

    def database(self):
        database = sqlite3.connect(":memory:")
        database.row_factory = sqlite3.Row
        database.executescript("""
          CREATE TABLE benches(row_id INTEGER PRIMARY KEY,active INTEGER,latitude REAL,longitude REAL,direction_degrees REAL);
          CREATE TABLE bench_enrichments(bench_row_id INTEGER PRIMARY KEY,in_forest INTEGER,land_context TEXT,waterfront INTEGER,canopy_context TEXT);
          CREATE TABLE image_observations(id INTEGER PRIMARY KEY,provider TEXT,provider_image_id TEXT,capture_group_id TEXT,
            source_url TEXT,fetch_url TEXT,latitude REAL,longitude REAL,heading REAL,captured_at TEXT,author TEXT,license TEXT,image_sha256 TEXT,
            analysis_status TEXT,relevance_probability REAL,predictions TEXT,model_version TEXT,prompt_version TEXT,
            analyzed_at TEXT,attempts INTEGER DEFAULT 0,last_error TEXT,discovered_at TEXT,UNIQUE(provider,provider_image_id));
          CREATE TABLE bench_image_evidence(bench_row_id INTEGER,image_observation_id INTEGER,distance_meters REAL,direct_view_eligible INTEGER,evidence_weight REAL,
            PRIMARY KEY(bench_row_id,image_observation_id));
          CREATE TABLE image_discovery_cells(provider TEXT,cell_id TEXT,min_latitude REAL,max_latitude REAL,min_longitude REAL,max_longitude REAL,
            status TEXT,image_count INTEGER,attempts INTEGER,last_error TEXT,discovered_at TEXT,retry_after TEXT,PRIMARY KEY(provider,cell_id));
          CREATE TABLE bench_likely_metadata(bench_row_id INTEGER PRIMARY KEY,land_context TEXT,land_context_probability REAL,
            canopy_context TEXT,canopy_probability REAL,lake_view_probability REAL,mountain_view_probability REAL,
            open_view_probability REAL,limited_view_probability REAL,buildings_probability REAL,road_rail_probability REAL,
            confidence TEXT,evidence_group_count INTEGER,evidence_summary TEXT,model_version TEXT,reconciler_version TEXT,updated_at TEXT);
        """)
        return database

    def test_same_sequence_counts_once_and_waterfront_blocks_forest(self):
        database = self.database()
        database.execute("INSERT INTO benches VALUES(1,1,46.6622,7.8092,180)")
        database.execute("INSERT INTO bench_enrichments VALUES(1,0,'open',1,'dense')")
        forest_prediction = self.prediction(forest_probability=.99, open_probability=.7)
        for image_id, provider, group in ((1, "Panoramax", "same-sequence"), (2, "Panoramax", "same-sequence"), (3, "Wikimedia Commons", "other")):
            database.execute("""INSERT INTO image_observations(id,provider,provider_image_id,capture_group_id,source_url,fetch_url,
              latitude,longitude,license,analysis_status,relevance_probability,predictions,model_version,analyzed_at,discovered_at)
              VALUES(?,?,?,?,?,?,?,?,?,'analyzed',.95,?,'benchly-vision','2026-09-02','2026-09-02')""",
              (image_id, provider, str(image_id), group, "https://example.test/source", "https://example.test/image", 46.6622, 7.8092, "CC-BY-SA", json.dumps(forest_prediction)))
            database.execute("INSERT INTO bench_image_evidence VALUES(1,?,?,0,1)", (image_id, 20 + image_id))
        stats = reconcile_environment(database)
        row = database.execute("SELECT * FROM bench_likely_metadata").fetchone()
        self.assertEqual(stats["reconciled"], 1)
        self.assertEqual(row["evidence_group_count"], 2)
        self.assertNotEqual(row["land_context"], "forest")

    def test_lake_railway_frames_fuse_once_and_irrelevant_closeup_is_ignored(self):
        database = self.database()
        database.execute("INSERT INTO benches VALUES(1,1,46.6622,7.8092,0)")
        database.execute("INSERT INTO bench_enrichments VALUES(1,0,'open',1,'partial')")
        scenic = self.prediction(lake_view_probability=.96, road_rail_probability=.88)
        for image_id, status in ((1, "analyzed"), (2, "analyzed"), (3, "irrelevant")):
            database.execute("""INSERT INTO image_observations(id,provider,provider_image_id,capture_group_id,source_url,fetch_url,
              latitude,longitude,license,analysis_status,relevance_probability,predictions,model_version,analyzed_at,discovered_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                image_id, "Panoramax", str(image_id), "daerligen-sequence", "https://example.test/source",
                "https://example.test/image", 46.6622, 7.8092, "CC-BY-SA", status,
                .95 if status == "analyzed" else .05, json.dumps(scenic), "benchly-vision", "2026-09-02", "2026-09-02",
            ))
            database.execute("INSERT INTO bench_image_evidence VALUES(1,?,?,1,1)", (image_id, 20 + image_id))
        reconcile_environment(database)
        row = database.execute("SELECT * FROM bench_likely_metadata").fetchone()
        self.assertEqual(row["evidence_group_count"], 1)
        self.assertGreater(row["lake_view_probability"], .9)
        self.assertGreater(row["road_rail_probability"], .8)

    def test_direct_view_geometry_uses_camera_and_bench_headings(self):
        north = bearing_degrees(47, 8, 47.001, 8)
        south = bearing_degrees(47.001, 8, 47, 8)
        self.assertLess(circular_difference(north, 0), 1)
        self.assertLess(circular_difference(south, 180), 1)
        self.assertGreater(circular_difference(north, 180), 170)

    def test_analysis_keeps_no_image_files_after_success_or_failure(self):
        for failure in (False, True):
            database = self.database()
            database.execute("""INSERT INTO image_observations(id,provider,provider_image_id,capture_group_id,source_url,fetch_url,
              latitude,longitude,analysis_status,discovered_at) VALUES(1,'Panoramax','one','group','https://source','https://image',47,8,'pending','2026-09-02')""")
            with TemporaryDirectory() as directory, patch.dict("os.environ", {"INFERENCE_API_KEY": "secret"}), \
                 patch("visual_pipeline._download_image", return_value=(b"image-bytes", "image/jpeg")), \
                 patch("visual_pipeline.infer_scene_frames", side_effect=RuntimeError("model failed") if failure else None, return_value=[self.prediction()]):
                before = list(Path(directory).iterdir())
                analyze_scenes(database, 1, time.monotonic() + 2, requests_per_second=1000)
                self.assertEqual(list(Path(directory).iterdir()), before)
            status = database.execute("SELECT analysis_status FROM image_observations").fetchone()[0]
            self.assertEqual(status, "retry" if failure else "analyzed")

    def test_targeted_analysis_only_uses_groups_linked_inside_bounds(self):
        database = self.database()
        database.executemany("INSERT INTO benches VALUES(?,?,?,?,180)", [
            (1, 1, 46.6622, 7.8092), (2, 1, 47.37, 8.54),
        ])
        for image_id, bench_id, group in ((1, 1, "daerligen"), (2, 2, "zurich")):
            database.execute("""INSERT INTO image_observations(id,provider,provider_image_id,capture_group_id,source_url,fetch_url,
              latitude,longitude,analysis_status,discovered_at)
              VALUES(?,'Panoramax',?,?,?,'https://image',46.6622,7.8092,'pending','2026-09-02')""",
              (image_id, str(image_id), group, "https://source"))
            database.execute("INSERT INTO bench_image_evidence VALUES(?,?,20,1,1)", (bench_id, image_id))

        with patch.dict("os.environ", {"INFERENCE_API_KEY": "secret"}), \
             patch("visual_pipeline._download_image", return_value=(b"image-bytes", "image/jpeg")), \
             patch("visual_pipeline.infer_scene_frames", return_value=[self.prediction()]):
            stats = analyze_scenes(database, 2, time.monotonic() + 2, requests_per_second=1000,
                                   bounds=(7.8085, 46.6618, 7.8100, 46.6629))

        self.assertEqual(stats["groups"], 1)
        self.assertEqual(database.execute("SELECT analysis_status FROM image_observations WHERE id=1").fetchone()[0], "analyzed")
        self.assertEqual(database.execute("SELECT analysis_status FROM image_observations WHERE id=2").fetchone()[0], "pending")

    def test_frame_level_relevance_excludes_closeup_without_losing_scenic_group(self):
        database = self.database()
        database.execute("INSERT INTO benches VALUES(1,1,46.6622,7.8092,0)")
        database.execute("INSERT INTO bench_enrichments VALUES(1,0,'open',1,'partial')")
        for image_id, heading in ((1, 0), (2, 45), (3, 90)):
            database.execute("""INSERT INTO image_observations(id,provider,provider_image_id,capture_group_id,source_url,fetch_url,
              latitude,longitude,heading,license,analysis_status,discovered_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,'pending','2026-09-02')""", (
                image_id, "Panoramax", str(image_id), "daerligen-sequence", "https://source",
                f"https://image/{image_id}", 46.6622, 7.8092, heading, "CC-BY-SA",
            ))
            database.execute("INSERT INTO bench_image_evidence VALUES(1,?,?,1,1)", (image_id, 20 + image_id))
        closeup = self.prediction(
            relevance_probability=.03, rejection_reason="close_object", forest_probability=.99,
            lake_view_probability=.01, mountain_view_probability=.01, open_view_probability=.01,
        )
        with patch.dict("os.environ", {"INFERENCE_API_KEY": "secret"}), \
             patch("visual_pipeline._download_image", return_value=(b"image-bytes", "image/jpeg")), \
             patch("visual_pipeline.infer_scene_frames", return_value=[self.prediction(), self.prediction(), closeup]):
            stats = analyze_scenes(database, 1, time.monotonic() + 2, requests_per_second=1000)
        statuses = [row[0] for row in database.execute("SELECT analysis_status FROM image_observations ORDER BY id")]
        self.assertEqual(statuses, ["analyzed", "analyzed", "irrelevant"])
        self.assertEqual(stats["irrelevant"], 1)
        reconcile_environment(database)
        likely = database.execute("SELECT * FROM bench_likely_metadata").fetchone()
        self.assertEqual(likely["evidence_group_count"], 1)
        self.assertGreater(likely["lake_view_probability"], .85)
        self.assertNotEqual(likely["land_context"], "forest")

    def test_frame_inference_uses_strict_schema_and_requires_every_index(self):
        predictions = [self.prediction(), self.prediction(open_probability=.7)]
        response = {"choices": [{"message": {"content": json.dumps({"frames": [
            {"index": 0, "prediction": predictions[0]}, {"index": 1, "prediction": predictions[1]},
        ]})}}]}
        captured = {}

        def request(_url, **kwargs):
            captured.update(json.loads(kwargs["data"]))
            return response

        with patch("visual_pipeline._request_json", side_effect=request):
            actual = infer_scene_frames([(b"one", "image/jpeg"), (b"two", "image/jpeg")], "https://inference", "secret")
        self.assertEqual(actual, predictions)
        self.assertEqual(captured["response_format"]["type"], "json_schema")
        self.assertTrue(captured["response_format"]["json_schema"]["strict"])

    def test_evaluation_manifest_requires_labels_location_and_image_provenance(self):
        record = {
            "id": "daerligen-waterfront-1", "category": "waterfront",
            "latitude": 46.6622, "longitude": 7.8092,
            "images": [{
                "url": "https://example.test/image.jpg", "provider": "Panoramax",
                "source_url": "https://example.test/source", "license": "CC-BY-SA-4.0",
            }],
            "expected": {"forest": False, "lake_view": True, "mountain_view": True, "open_view": True, "limited_view": False},
        }
        self.assertEqual(validate_evaluation_dataset([record], allow_small=True)[0]["id"], record["id"])
        without_license = {**record, "id": "invalid", "images": [{**record["images"][0], "license": ""}]}
        with self.assertRaisesRegex(ValueError, "provenance"):
            validate_evaluation_dataset([without_license], allow_small=True)
        with self.assertRaisesRegex(ValueError, "at least 100"):
            validate_evaluation_dataset([record])

    def test_discovery_is_cell_based_and_resumable(self):
        database = self.database()
        database.execute("INSERT INTO benches VALUES(1,1,47,8,180)")
        calls = []

        def search(_bounds):
            calls.append(1)
            return [DiscoveredImage("Fake", "image-1", "group-1", "https://source", "https://image", 47, 8, 180, license="CC0")]

        with patch("visual_pipeline.PROVIDERS", {"Fake": search}):
            first = discover_open_images(database, max_cells=1, requests_per_second=1000)
            second = discover_open_images(database, max_cells=1, requests_per_second=1000)
        self.assertEqual(len(calls), 1)
        self.assertEqual(first["images"], 1)
        self.assertEqual(second["images"], 0)
        self.assertEqual(database.execute("SELECT count(*) FROM bench_image_evidence").fetchone()[0], 1)

    def test_targeted_discovery_can_include_already_resolved_benches(self):
        database = self.database()
        database.execute("INSERT INTO benches VALUES(1,1,46.6622,7.8092,180)")
        database.execute("INSERT INTO bench_enrichments(bench_row_id,land_context,canopy_context) VALUES(1,'open','none')")
        database.execute("INSERT INTO bench_likely_metadata(bench_row_id,land_context) VALUES(1,'open')")

        with patch("visual_pipeline.PROVIDERS", {"Fake": lambda _bounds: []}):
            regular = discover_open_images(database, max_cells=1, requests_per_second=1000,
                                           bounds=(7.8085, 46.6618, 7.8100, 46.6629))
            targeted = discover_open_images(database, max_cells=1, requests_per_second=1000,
                                            bounds=(7.8085, 46.6618, 7.8100, 46.6629),
                                            include_resolved=True)

        self.assertEqual(regular["cells"], 0)
        self.assertEqual(targeted["cells"], 1)

    def test_daily_discovery_and_analysis_caps_survive_restarts(self):
        database = self.database()
        database.execute("INSERT INTO benches VALUES(1,1,47,8,180)")
        database.executemany("""INSERT INTO image_discovery_cells(provider,cell_id,min_latitude,max_latitude,
          min_longitude,max_longitude,status,image_count,attempts,discovered_at)
          VALUES('Panoramax',?,47,47.01,8,8.01,'completed',0,1,datetime('now'))""",
          [(f"cell-{index}",) for index in range(500)])
        with patch("visual_pipeline.PROVIDERS", {"Fake": lambda _bounds: self.fail("daily discovery cap was exceeded")}):
            self.assertEqual(discover_open_images(database, max_cells=500, requests_per_second=1000)["cells"], 0)

        database.executemany("""INSERT INTO image_observations(id,provider,provider_image_id,capture_group_id,source_url,fetch_url,
          latitude,longitude,analysis_status,analyzed_at,discovered_at)
          VALUES(1+?,'Panoramax',?,?,'https://source','https://image',47,8,'analyzed',datetime('now'),datetime('now'))""",
          [(index, f"done-{index}", f"group-{index}") for index in range(300)])
        database.execute("""INSERT INTO image_observations(id,provider,provider_image_id,capture_group_id,source_url,fetch_url,
          latitude,longitude,analysis_status,discovered_at)
          VALUES(999,'Panoramax','pending','pending-group','https://source','https://image',47,8,'pending',datetime('now'))""")
        with patch.dict("os.environ", {"INFERENCE_API_KEY": "secret"}), \
             patch("visual_pipeline._download_image", side_effect=AssertionError("daily analysis cap was exceeded")):
            self.assertEqual(analyze_scenes(database, 300, time.monotonic() + 2, requests_per_second=1000)["groups"], 0)


if __name__ == "__main__":
    unittest.main()
