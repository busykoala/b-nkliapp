import json
import math
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image
from shapely import to_wkb
from shapely.geometry import LineString, Polygon

from benchly.context.geometry import point_lv95
from benchly.direction.model import DIRECTIONS, DirectionSignal, circular_distribution, fuse_signals
from benchly.direction.signals import (
    image_axis_signal,
    is_viewpoint,
    nearest_building_signal,
    nearby_bench_group_signal,
    nearest_path_signal,
    openness_signal,
    terrain_signal,
)


class DirectionModelTests(unittest.TestCase):
    def test_fusion_is_normalized_and_selects_strongest_direction(self):
        signals = [DirectionSignal("test", circular_distribution(90, 4), 1, {})]
        estimate = fuse_signals(signals)
        self.assertIsNotNone(estimate)
        self.assertEqual(estimate.direction_degrees, 90)
        self.assertAlmostEqual(sum(estimate.probabilities), 1)

    def test_path_prefers_the_side_towards_the_path(self):
        origin = point_lv95(47, 8)
        path = LineString([(origin.x - 20, origin.y + 2), (origin.x + 20, origin.y + 2)])
        feature = {"kind": "path", "geometry_wkb": to_wkb(path), "source_id": "way-1", "raw_tags": '{"highway":"footway"}'}
        ordinary = nearest_path_signal(47, 8, [feature], viewpoint=False)
        outlook = nearest_path_signal(47, 8, [feature], viewpoint=True)
        self.assertIsNotNone(ordinary)
        self.assertIsNotNone(outlook)
        self.assertGreater(ordinary.probabilities[0], ordinary.probabilities[4])
        self.assertAlmostEqual(outlook.probabilities[0], outlook.probabilities[4])

    def test_viewpoint_openness_can_override_the_path_prior(self):
        origin = point_lv95(47, 8)
        path = LineString([(origin.x - 20, origin.y + 2), (origin.x + 20, origin.y + 2)])
        feature = {"kind": "path", "geometry_wkb": to_wkb(path), "source_id": "way-1", "raw_tags": '{"highway":"footway"}'}
        path_signal = nearest_path_signal(47, 8, [feature], viewpoint=True)
        sectors = {"sectors": [
            {"mean_horizon": 35, "open": False} if index == 0 else
            {"mean_horizon": -2, "open": True} if index == 4 else
            {"mean_horizon": 15, "open": False}
            for index in range(8)
        ]}
        view_signal = openness_signal(json.dumps(sectors), viewpoint=True)
        estimate = fuse_signals([path_signal, view_signal])
        self.assertEqual(estimate.direction_degrees, 180)

    def test_building_signal_points_away_and_ignores_inside_points(self):
        origin = point_lv95(47, 8)
        north_building = Polygon([
            (origin.x - 10, origin.y + .5), (origin.x + 10, origin.y + .5),
            (origin.x + 10, origin.y + 10), (origin.x - 10, origin.y + 10),
        ])
        feature = {"kind": "building", "geometry_wkb": to_wkb(north_building), "source_id": "building-1"}
        signal = nearest_building_signal(47, 8, [feature])
        self.assertIsNotNone(signal)
        self.assertEqual(DIRECTIONS[int(np.argmax(signal.probabilities))], 180)
        covering = {"kind": "building", "geometry_wkb": to_wkb(origin.buffer(5)), "source_id": "bad"}
        self.assertIsNone(nearest_building_signal(47, 8, [covering]))
        corner = Polygon([
            (origin.x + .5, origin.y + .5), (origin.x + 10, origin.y + .5),
            (origin.x + 10, origin.y + 10), (origin.x + .5, origin.y + 10),
        ])
        self.assertIsNone(nearest_building_signal(
            47, 8, [{"kind": "building", "geometry_wkb": to_wkb(corner), "source_id": "corner"}]
        ))

    def test_coherent_nearby_observations_form_a_weak_signal(self):
        database = sqlite3.connect(":memory:")
        database.row_factory = sqlite3.Row
        database.execute("CREATE TABLE benches(row_id INTEGER,active INTEGER,latitude REAL,longitude REAL,direction_degrees REAL)")
        database.executemany("INSERT INTO benches VALUES(?,?,?,?,?)", [
            (1, 1, 47, 8, None), (2, 1, 47.00002, 8, 90), (3, 1, 47, 8.00002, 95),
        ])
        signal = nearby_bench_group_signal(database, {"row_id": 1, "latitude": 47, "longitude": 8})
        self.assertIsNotNone(signal)
        self.assertEqual(DIRECTIONS[int(np.argmax(signal.probabilities))], 90)

    def test_source_identity_changes_when_an_image_asset_changes(self):
        from benchly.direction.sources import SwissImageCache

        first = SwissImageCache._identity({"checksum": "a"}, 47, 8, 12)
        second = SwissImageCache._identity({"checksum": "b"}, 47, 8, 12)
        moved = SwissImageCache._identity({"checksum": "a"}, 47.0001, 8, 12)
        self.assertNotEqual(first, second)
        self.assertNotEqual(first, moved)

    def test_grouped_crop_resume_uses_atomic_cached_patch_without_opening_source(self):
        from benchly.direction.sources import SwissImageCache

        with tempfile.TemporaryDirectory() as folder:
            cache = SwissImageCache(Path(folder), requests_per_second=100)
            item = {"id": "tile", "checksum": "cached", "datetime": "2025", "gsd": .1, "href": "/must/not/open.tif", "bbox": [7.9, 46.9, 8.1, 47.1]}
            cache.items = [item]
            cache.grid[(800, 4700)] = [item]
            key = cache._identity(item, 47, 8, 12)
            image_path = Path(folder) / "patches" / key[:2] / f"{key}.png"
            image_path.parent.mkdir(parents=True)
            Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8)).save(image_path)
            image_path.with_suffix(".json").write_text(json.dumps({"meters_per_pixel": .1}))
            rows = list(cache.crop_many([{"bench_id": "bench", "latitude": 47, "longitude": 8}]))
            self.assertEqual(len(rows), 1)
            self.assertIsNone(rows[0][2])

    def test_typed_publication_repository_upserts_and_removes_one_run(self):
        from benchly.direction.repository import delete_analysis_run, upsert_estimates

        database = sqlite3.connect(":memory:")
        database.execute("""CREATE TABLE bench_direction_estimates(
          bench_row_id INTEGER PRIMARY KEY,bench_id TEXT,bench_latitude REAL,bench_longitude REAL,
          direction_degrees REAL,top_probability REAL,entropy REAL,probabilities_json TEXT,signals_json TEXT,
          source_versions_json TEXT,analysis_run_id TEXT,method_version TEXT,computed_at TEXT,published_at TEXT
        )""")
        value = {
            "bench_row_id": 1, "bench_id": "osm-node-1", "bench_latitude": 47.0, "bench_longitude": 8.0,
            "direction_degrees": 90.0, "top_probability": .8, "entropy": .3, "probabilities_json": "{}",
            "signals_json": "[]", "source_versions_json": "{}", "analysis_run_id": "run-a",
            "method_version": "test", "computed_at": "now", "published_at": "now",
        }
        upsert_estimates(database, [value])  # type: ignore[arg-type]
        upsert_estimates(database, [{**value, "direction_degrees": 135.0}])  # type: ignore[arg-type]
        self.assertEqual(database.execute("SELECT direction_degrees FROM bench_direction_estimates").fetchone()[0], 135)
        self.assertEqual(delete_analysis_run(database, "run-a"), 1)  # type: ignore[arg-type]

    def test_publication_repository_uses_bounded_batches(self):
        from benchly.direction import repository

        database = sqlite3.connect(":memory:")
        database.execute("""CREATE TABLE bench_direction_estimates(
          bench_row_id INTEGER PRIMARY KEY,bench_id TEXT,bench_latitude REAL,bench_longitude REAL,
          direction_degrees REAL,top_probability REAL,entropy REAL,probabilities_json TEXT,signals_json TEXT,
          source_versions_json TEXT,analysis_run_id TEXT,method_version TEXT,computed_at TEXT,published_at TEXT
        )""")
        template = {
            "bench_latitude": 47.0, "bench_longitude": 8.0, "direction_degrees": 90.0,
            "top_probability": .8, "entropy": .3, "probabilities_json": "{}", "signals_json": "[]",
            "source_versions_json": "{}", "analysis_run_id": "run-a", "method_version": "test",
            "computed_at": "now", "published_at": "now",
        }
        values = [
            {**template, "bench_row_id": row_id, "bench_id": f"osm-node-{row_id}"}
            for row_id in range(1, 1_002)
        ]
        with patch.object(repository, "write", wraps=repository.write) as write:
            repository.upsert_estimates(database, values)  # type: ignore[arg-type]
        self.assertEqual(write.call_count, 3)
        self.assertEqual(database.execute("SELECT count(*) FROM bench_direction_estimates").fetchone()[0], 1_001)

    def test_no_signal_fallback_is_stable_uniform_and_explicit(self):
        from benchly.direction.publish import no_signal_fallback

        bench = {"bench_row_id": 7, "bench_id": "osm-node-42", "latitude": 47.0, "longitude": 8.0}
        first, probabilities, signals = no_signal_fallback(bench)  # type: ignore[arg-type]
        second, _, _ = no_signal_fallback(bench)  # type: ignore[arg-type]
        self.assertEqual(first["direction_degrees"], second["direction_degrees"])
        self.assertIn(first["direction_degrees"], DIRECTIONS)
        self.assertEqual(set(probabilities.values()), {.125})
        self.assertEqual(first["top_probability"], .125)
        self.assertEqual(first["entropy"], 1.0)
        self.assertEqual(signals[0]["name"], "no_signal_fallback")

    def test_all_benches_mode_includes_production_rows_newer_than_analysis(self):
        from benchly.direction.analysis import open_analysis
        from benchly.direction.model import METHOD_VERSION
        from benchly.direction.publish import publish

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            production_path = root / "production.sqlite"
            production = sqlite3.connect(production_path)
            production.executescript("""
              CREATE TABLE benches(
                row_id INTEGER PRIMARY KEY,id TEXT,latitude REAL,longitude REAL,direction_degrees REAL,
                active INTEGER,source_updated_at TEXT
              );
              CREATE TABLE bench_direction_estimates(
                bench_row_id INTEGER PRIMARY KEY,bench_id TEXT,bench_latitude REAL,bench_longitude REAL,
                direction_degrees REAL,top_probability REAL,entropy REAL,probabilities_json TEXT,signals_json TEXT,
                source_versions_json TEXT,analysis_run_id TEXT,method_version TEXT,computed_at TEXT,published_at TEXT
              );
            """)
            production.executemany("INSERT INTO benches VALUES(?,?,?,?,?,?,?)", [
                (1, "osm-node-1", 47.0, 8.0, None, 1, "old"),
                (2, "osm-node-2", 47.1, 8.1, None, 1, "new"),
            ])
            production.commit()
            production.close()
            analysis_path = root / "analysis.sqlite"
            analysis = open_analysis(analysis_path)
            analysis.execute("""INSERT INTO direction_analysis_runs(
              run_id,status,method_version,source_database,source_identity,mode,stats_json,started_at,finished_at
            ) VALUES(?,?,?,?,?,'all','{}','now','now')""", ("run", "completed", METHOD_VERSION, "source", "id"))
            analysis.execute("INSERT INTO direction_analysis_benches VALUES('run',1,'osm-node-1',47,8,NULL,'test',0,'old',NULL)")
            analysis.execute("INSERT INTO direction_predictions VALUES('run',1,90,.5,.8,1)")
            analysis.commit()
            analysis.close()

            result = publish(SimpleNamespace(
                database=str(production_path), analysis_database=str(analysis_path), run_id="run",
                minimum_probability=0, include_no_signal_fallback=True, apply=False, backup=None,
            ))
            self.assertEqual(result["selected"], 2)
            self.assertEqual(result["eligible"], 2)
            self.assertEqual(result["production_only_fallbacks_selected"], 1)

    def test_review_csv_import_persists_a_verdict(self):
        from benchly.direction.analysis import import_reviews, open_analysis

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            analysis_path = root / "analysis.sqlite"
            database = open_analysis(analysis_path)
            database.execute("""INSERT INTO direction_analysis_runs(
              run_id,status,method_version,source_database,source_identity,mode,stats_json,started_at,finished_at
            ) VALUES('run','completed','test','source','id','all','{\"thresholds\":[]}','now','now')""")
            database.execute("INSERT INTO direction_analysis_benches VALUES('run',1,'osm-node-1',47,8,NULL,'test',0,'now','ZH')")
            database.execute("INSERT INTO direction_predictions VALUES('run',1,90,.8,.3,1)")
            database.commit()
            database.close()
            review = root / "review.csv"
            review.write_text("bench_id,verdict\nosm-node-1,plausible\n")
            result = import_reviews(SimpleNamespace(
                analysis_database=str(analysis_path), run_id="run", csv=str(review), reviewer="tester",
                report_directory=str(root / "reports"),
            ))
            self.assertEqual(result["imported"], 1)
            database = open_analysis(analysis_path)
            self.assertEqual(database.execute("SELECT verdict FROM direction_reviews").fetchone()[0], "plausible")
            database.close()

    def test_multilingual_viewpoint_words_are_recognized(self):
        self.assertTrue(is_viewpoint({"raw_tags": "{}", "name": "Point de vue", "description": None}))
        self.assertTrue(is_viewpoint({"raw_tags": '{"tourism":"viewpoint"}', "name": None, "description": None}))
        self.assertFalse(is_viewpoint({"raw_tags": "{}", "name": "Bushaltestelle", "description": None}))

    def test_consistent_downhill_gradient_produces_terrain_signal(self):
        class Raster:
            def sample(self, latitude, longitude):
                point = point_lv95(latitude, longitude)
                return 500 + .1 * point.y

        signal = terrain_signal(47, 8, Raster())
        self.assertIsNotNone(signal)
        self.assertEqual(DIRECTIONS[int(np.argmax(signal.probabilities))], 180)

    def test_image_tensor_finds_an_elongated_axis(self):
        image = np.full((120, 120), 220, dtype=np.uint8)
        image[56:64, 35:85] = 30
        signal = image_axis_signal(image, .1)
        self.assertIsNotNone(signal)
        axis = float(signal.details["axis_degrees"])
        self.assertLess(min(abs(axis - 90), abs(axis)), 12)


if __name__ == "__main__":
    unittest.main()
