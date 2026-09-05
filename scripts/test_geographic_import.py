import gzip
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class GeographicImportTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="benchly-geography-test-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.database = self.root / "local.sqlite"
        self.backup = self.root / "backup.sqlite"
        self.archive = self.root / "export.gz"
        with sqlite3.connect(self.database) as db:
            db.executescript("""
              CREATE TABLE benches(row_id INTEGER PRIMARY KEY,id TEXT UNIQUE);
              INSERT INTO benches VALUES(42,'osm-node-123'),(43,'osm-node-456');
              CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
              INSERT INTO users VALUES(1,'Local user');
              CREATE TABLE bench_enrichments(bench_row_id INTEGER PRIMARY KEY,waterfront INTEGER,
                computed_at TEXT,environment_computed_at TEXT,context_source_version TEXT);
              INSERT INTO bench_enrichments VALUES(43,0,'2026-09-05','2026-09-05','local');
              CREATE TABLE environment_features(source TEXT,source_id TEXT,kind TEXT,geometry_wkb BLOB,
                UNIQUE(source,source_id,kind));
              CREATE TABLE land_cover_features(source TEXT,source_id TEXT,class TEXT,UNIQUE(source,source_id,class));
              CREATE TABLE official_context_sources(source TEXT PRIMARY KEY,version TEXT);
            """)

    def export(self, complete=True, bad_column=False):
        rows = [
            {"table": "bench_enrichments", "row": {"bench_row_id": 7, "bench_id": "osm-node-123", "waterfront": 1,
                "computed_at": "2026-09-04", "environment_computed_at": "2026-09-04", "context_source_version": "swissTLM3D"}},
            {"table": "bench_enrichments", "row": {"bench_row_id": 8, "bench_id": "osm-node-456", "waterfront": 1,
                "computed_at": "2026-09-04", "environment_computed_at": "2026-09-04", "context_source_version": "swissTLM3D"}},
            {"table": "bench_enrichments", "row": {"bench_row_id": 9, "bench_id": "osm-node-missing", "waterfront": 1}},
        ]
        if bad_column:
            rows[1]["row"]["unexpected"] = True
            rows[1]["row"]["computed_at"] = "2026-09-06"
        with gzip.open(self.archive, "wt") as output:
            for record in [{"format": "benchly-geography-v1"}, *rows,
                           *([{"complete": True, "counts": {"bench_enrichments": 3}}] if complete else [])]:
                output.write(json.dumps(record) + "\n")

    def run_import(self, apply=True):
        return subprocess.run([sys.executable, str(Path(__file__).with_name("import-geographic-data.py")),
            str(self.archive), "--database", str(self.database),
            *(["--apply", "--backup", str(self.backup)] if apply else [])], capture_output=True, text=True)

    def test_merge_matches_stable_ids_preserves_users_and_newer_analysis(self):
        self.export()
        result = self.run_import()
        self.assertEqual(result.returncode, 0, result.stderr)
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute("SELECT name FROM users").fetchone()[0], "Local user")
            self.assertEqual(db.execute("SELECT bench_row_id,waterfront FROM bench_enrichments ORDER BY bench_row_id").fetchall(), [(42, 1), (43, 0)])
        with sqlite3.connect(self.backup) as backup:
            self.assertEqual(backup.execute("SELECT count(*) FROM bench_enrichments").fetchone()[0], 1)

    def test_incomplete_export_never_touches_database(self):
        self.export(complete=False)
        self.assertNotEqual(self.run_import().returncode, 0)
        self.assertFalse(self.backup.exists())

    def test_schema_error_rolls_back_all_records(self):
        self.export(bad_column=True)
        self.assertNotEqual(self.run_import().returncode, 0)
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM bench_enrichments").fetchone()[0], 1)

    def test_dry_run_does_not_write(self):
        self.export()
        self.assertEqual(self.run_import(apply=False).returncode, 0)
        self.assertFalse(self.backup.exists())


if __name__ == "__main__":
    unittest.main()
