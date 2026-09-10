import unittest
import sqlite3
import tempfile
from pathlib import Path
from types import SimpleNamespace
from shapely.geometry import Point, LineString
from benchly.landscape.service import cell_evidence, horizon_at, refresh, select_paths


def test_path_batches_merge_kinds_and_resume_inside_exact_spatial_bounds():
    with sqlite3.connect(":memory:") as source:
        source.row_factory = sqlite3.Row
        source.executescript("""CREATE TABLE environment_features(row_id INTEGER PRIMARY KEY,kind TEXT,
            geometry_wkb BLOB,min_longitude REAL,max_longitude REAL,min_latitude REAL,max_latitude REAL);
            CREATE INDEX environment_kind_idx ON environment_features(kind);
            CREATE VIRTUAL TABLE environment_spatial_index USING rtree(row_id,min_longitude,max_longitude,min_latitude,max_latitude);""")
        for row_id in range(1, 101):
            lon = 8.54 if row_id % 3 else 8.7
            source.execute("INSERT INTO environment_features VALUES(?,?,?,?,?,?,?)",
                (row_id, ("path", "major_road", "tree")[row_id % 3], b"geometry" if row_id % 10 else None, lon, lon + .0001, 47.37, 47.371))
        source.execute("INSERT INTO environment_spatial_index SELECT row_id,min_longitude,max_longitude,min_latitude,max_latitude FROM environment_features")
        for bounds in (None, [8.53, 47.36, 8.55, 47.38]):
            actual, last = [], 0
            while batch := select_paths(source, last, 7, bounds):
                actual.extend(row["row_id"] for row in batch)
                last = actual[-1]
            sql = "SELECT row_id FROM environment_features WHERE kind IN ('path','major_road') AND geometry_wkb IS NOT NULL"
            if bounds:
                sql += " AND max_longitude>=8.53 AND min_longitude<=8.55 AND max_latitude>=47.36 AND min_latitude<=47.38"
            assert actual == [row[0] for row in source.execute(sql + " ORDER BY row_id")]


class LandscapeTests(unittest.TestCase):
    def test_sonbase_value_tightens_quiet_score_and_is_retained(self):
        class EmptyResult:
            def fetchall(self):
                return []

        class EmptyDatabase:
            def execute(self, *_args):
                return EmptyResult()

        class NoiseRaster:
            nodata = -9999.0

            def sample(self, positions, masked=False):
                return iter([[64.0] for _ in positions])

        evidence = cell_evidence(EmptyDatabase(), 46.68844, 7.68949, noise=NoiseRaster())
        self.assertAlmostEqual(evidence[0], .2)
        self.assertEqual(evidence[6], 64.0)

    def test_masked_sonbase_value_is_ignored_before_conversion(self):
        class EmptyResult:
            def fetchall(self):
                return []

        class EmptyDatabase:
            def execute(self, *_args):
                return EmptyResult()

        class MaskedValue:
            mask = True

            def __float__(self):
                raise AssertionError("masked NoData must not be converted")

        class NoiseRaster:
            nodata = -9999.0

            def sample(self, positions, masked=False):
                return iter([[MaskedValue()] for _ in positions])

        evidence = cell_evidence(EmptyDatabase(), 46.68844, 7.68949, noise=NoiseRaster())
        self.assertEqual(evidence[0], 1.0)
        self.assertIsNone(evidence[6])

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
            args = SimpleNamespace(database=str(source_path), landscape_database=str(target), limit=2, bounds=None, terrain_raster=None, surface_raster=None, noise_raster=None)
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


def test_same_day_noise_revision_refreshes_completed_sweep_and_failure_retains_snapshot(tmp_path, monkeypatch):
    import benchly.landscape.service as service
    source_path, target = tmp_path / 'source.sqlite', tmp_path / 'landscape.sqlite'
    with sqlite3.connect(source_path) as db:
        db.executescript("""CREATE TABLE knowledge_generation(id INTEGER PRIMARY KEY,revision INTEGER);
            INSERT INTO knowledge_generation VALUES(1,1);
            CREATE TABLE environment_features(row_id INTEGER PRIMARY KEY,kind TEXT,geometry_wkb BLOB,geometry_crs INTEGER);
            CREATE TABLE land_cover_features(row_id INTEGER PRIMARY KEY,class TEXT,geometry_wkb BLOB,geometry_crs INTEGER);
            CREATE VIRTUAL TABLE environment_spatial_index USING rtree(row_id,min_longitude,max_longitude,min_latitude,max_latitude);
            CREATE VIRTUAL TABLE land_cover_spatial_index USING rtree(row_id,min_longitude,max_longitude,min_latitude,max_latitude);""")
        line = LineString([(7.68, 46.68), (7.6802, 46.6802)])
        db.execute("INSERT INTO environment_features VALUES(1,'path',?,4326)", (line.wkb,))
    args = SimpleNamespace(database=str(source_path), landscape_database=str(target), limit=2, bounds=None,
        terrain_raster=None, surface_raster=None, noise_raster=None)

    class Noise:
        version, level = 'rail-v1', 70

        def __init__(self, _directory):
            self.datasets = {('rail', 'day'): (None, self.version, 'rail')}

        def sample(self, *_args):
            return {('rail', 'day'): self.level}

        def close(self):
            pass

    monkeypatch.setattr(service, 'NoiseRasters', Noise)
    refresh(args)
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT DISTINCT rail_day_noise_db FROM cells').fetchall() == [(70,)]
        generation = db.execute('SELECT input_generation FROM cells LIMIT 1').fetchone()[0]
    Noise.version, Noise.level = 'rail-v2', 55
    refresh(args)
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT DISTINCT rail_day_noise_db FROM cells').fetchall() == [(55,)]
        assert db.execute('SELECT input_generation FROM cells LIMIT 1').fetchone()[0] != generation
    before = target.read_bytes()
    Noise.version = 'rail-v3'
    original = service.cell_evidence
    changed = False

    def source_edit(*args, **kwargs):
        nonlocal changed
        if not changed:
            with sqlite3.connect(source_path) as db:
                db.execute('UPDATE knowledge_generation SET revision=2')
            changed = True
        return original(*args, **kwargs)

    monkeypatch.setattr(service, 'cell_evidence', source_edit)
    import pytest
    with pytest.raises(RuntimeError, match='sources changed'):
        refresh(args)
    assert target.read_bytes() == before


def test_changing_sources_do_not_starve_later_paths_and_cells_keep_actual_generation(tmp_path, monkeypatch):
    import benchly.landscape.service as service
    source_path, target = tmp_path / 'source.sqlite', tmp_path / 'landscape.sqlite'
    with sqlite3.connect(source_path) as db:
        db.executescript("""CREATE TABLE knowledge_generation(id INTEGER PRIMARY KEY,revision INTEGER);
            INSERT INTO knowledge_generation VALUES(1,1);
            CREATE TABLE environment_features(row_id INTEGER PRIMARY KEY,kind TEXT,geometry_wkb BLOB,geometry_crs INTEGER);""")
        for row_id in range(1, 4):
            lon = 6.68 + row_id
            line = LineString([(lon, 46.68), (lon + .0002, 46.6802)])
            db.execute("INSERT INTO environment_features VALUES(?,'path',?,4326)", (row_id, line.wkb))
    args = SimpleNamespace(database=str(source_path), landscape_database=str(target), limit=1, bounds=None,
        terrain_raster=None, surface_raster=None, noise_raster=None)
    monkeypatch.setattr(service, 'cell_evidence', lambda *_args: (.5, .5, 0., None, 0., None, None))
    first_generation = None
    for revision, expected_cursor in enumerate((1, 2, 3, 1), start=1):
        with sqlite3.connect(source_path) as db:
            db.execute('UPDATE knowledge_generation SET revision=?', (revision,))
        refresh(args)
        with sqlite3.connect(target) as db:
            assert db.execute("SELECT value FROM metadata WHERE key='last_path'").fetchone()[0] == str(expected_cursor)
            generation = db.execute("SELECT value FROM metadata WHERE key='inputs:last_path'").fetchone()[0]
            oldest_cell = db.execute('SELECT input_generation FROM cells ORDER BY longitude,latitude LIMIT 1').fetchone()[0]
            if revision == 1:
                first_generation = generation
            if revision in (2, 3):
                assert oldest_cell == first_generation
                assert oldest_cell != generation
            if revision == 4:
                assert oldest_cell == generation
                assert oldest_cell != first_generation


def test_time_budget_publishes_partial_path_and_resumes_without_repeating_cells(tmp_path, monkeypatch, capsys):
    import json
    from collections import Counter
    import benchly.landscape.service as service
    source_path, target = tmp_path / 'source.sqlite', tmp_path / 'landscape.sqlite'
    with sqlite3.connect(source_path) as db:
        db.executescript("""CREATE TABLE knowledge_generation(id INTEGER PRIMARY KEY,revision INTEGER);
            INSERT INTO knowledge_generation VALUES(1,1);
            CREATE TABLE environment_features(row_id INTEGER PRIMARY KEY,kind TEXT,geometry_wkb BLOB,geometry_crs INTEGER);""")
        line = LineString([(7.68, 46.68), (7.6802, 46.6802)])
        db.execute("INSERT INTO environment_features VALUES(1,'path',?,4326)", (line.wkb,))
    args = SimpleNamespace(database=str(source_path), landscape_database=str(target), limit=1, bounds=None,
        terrain_raster=None, surface_raster=None, noise_raster=None, max_runtime_minutes=2 / 60)
    clock, revision, samples = [0.], [1], []
    monkeypatch.setattr(service, 'time', SimpleNamespace(monotonic=lambda: clock[0]))

    def sample(_source, lat, lon, *_args):
        samples.append((revision[0], lat, lon))
        clock[0] += 1
        return (.5, .5, 0., None, 0., None, None)

    monkeypatch.setattr(service, 'cell_evidence', sample)
    for version in (1, 2):
        revision[0] = version
        with sqlite3.connect(source_path) as db:
            db.execute('UPDATE knowledge_generation SET revision=?', (version,))
        args.max_runtime_minutes = 2 / 60
        refresh(args)
        report = json.loads(capsys.readouterr().out.strip())
        assert report['time_limit_reached'] and report['paths'] == 0 and report['cells'] == 2
        with sqlite3.connect(target) as db:
            assert db.execute("SELECT value FROM metadata WHERE key='last_path'").fetchone()[0] == '0'
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        args.max_runtime_minutes = 40
        refresh(args)
        report = json.loads(capsys.readouterr().out.strip())
        assert not report['time_limit_reached'] and report['paths'] == 1
        with sqlite3.connect(target) as db:
            assert db.execute("SELECT value FROM metadata WHERE key='last_path'").fetchone()[0] == '1'
            stored = {(lat, lon) for lat, lon in db.execute('SELECT latitude,longitude FROM cells')}
            assert db.execute('SELECT count(DISTINCT input_generation) FROM cells').fetchone()[0] == 1
        assert stored == {(lat, lon) for source, lat, lon in samples if source == version}
        assert len(stored) > 2
    assert all(count == 1 for count in Counter(samples).values())
