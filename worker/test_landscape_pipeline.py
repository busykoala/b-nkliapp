import unittest
import sqlite3
import tempfile
from pathlib import Path
from types import SimpleNamespace
from shapely.geometry import Point, LineString
from landscape_pipeline import horizon_at, refresh


class LandscapeTests(unittest.TestCase):
    def test_missing_terrain_is_unknown_not_flat_sky(self):
        self.assertIsNone(horizon_at(Point(2600000, 1200000), None))

    def test_terrain_without_building_surface_remains_uncertain(self):
        class FlatRaster:
            def sample(self, positions, masked=False):
                return iter([[600.] for _ in positions])
        self.assertIsNone(horizon_at(Point(2600000, 1200000), FlatRaster()))

    def test_valid_flat_terrain_and_surface_have_72_rays(self):
        class FlatRaster:
            def sample(self, positions, masked=False):
                return iter([[600.] for _ in positions])
        self.assertEqual(horizon_at(Point(2600000, 1200000), FlatRaster(), FlatRaster()), [0.] * 72)

    def test_snapshot_is_published_and_failed_import_keeps_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.sqlite"
            target = Path(directory) / "landscape.sqlite"
            c = sqlite3.connect(source_path)
            c.executescript("""CREATE TABLE environment_features(row_id INTEGER PRIMARY KEY,kind TEXT,
                geometry_wkb BLOB,geometry_crs INTEGER,imported_at TEXT,
                min_longitude REAL,max_longitude REAL,min_latitude REAL,max_latitude REAL);
                CREATE VIRTUAL TABLE environment_spatial_index USING rtree(row_id,min_longitude,max_longitude,min_latitude,max_latitude);
                CREATE TABLE land_cover_features(row_id INTEGER PRIMARY KEY,class TEXT,geometry_wkb BLOB,geometry_crs INTEGER);
                CREATE VIRTUAL TABLE land_cover_spatial_index USING rtree(row_id,min_longitude,max_longitude,min_latitude,max_latitude);""")
            line = LineString([(7.68, 46.68), (7.6802, 46.6802)])
            c.execute("INSERT INTO environment_features VALUES(1,'path',?,4326,'2026-09-05T12:00:00Z',7.68,7.6802,46.68,46.6802)", (line.wkb,))
            c.commit()
            c.close()
            args = SimpleNamespace(database=str(source_path), landscape_database=str(target), limit=2, bounds=None, terrain_raster=None, surface_raster=None)
            refresh(args)
            db = sqlite3.connect(target)
            self.assertGreater(db.execute("SELECT count(*) FROM cells").fetchone()[0], 0)
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertIsNone(db.execute("SELECT horizon FROM cells LIMIT 1").fetchone()[0])
            db.close()
            before = target.read_bytes()
            args.limit = 0
            with self.assertRaises(ValueError):
                refresh(args)
            self.assertEqual(target.read_bytes(), before)
