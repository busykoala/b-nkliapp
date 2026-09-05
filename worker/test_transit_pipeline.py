import datetime as dt
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile
from transit_pipeline import import_archive


class TransitImportTest(unittest.TestCase):
    def fixture(self, folder, start="20260101", end="20261231"):
        path = Path(folder) / "feed.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("feed_info.txt", f"feed_start_date,feed_end_date\n{start},{end}\n")
            archive.writestr("stops.txt", "stop_id,stop_name,stop_lat,stop_lon,parent_station,platform_code\n8507000,Bern,46.949,7.439,,\n8507000:0:2,Bern,46.949,7.439,8507000,2\n")
            archive.writestr("transfers.txt", "from_stop_id,to_stop_id,transfer_type,min_transfer_time,from_trip_id\n8507000,8507000,2,180,\n8507000:0:2,8507000,4,,exact-trip\n")
        return path

    def test_import_keeps_hierarchy_and_qualified_rules(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "transit.sqlite"
            import_archive(self.fixture(folder), target, dt.date(2026, 9, 5))
            with sqlite3.connect(target) as db:
                self.assertEqual(db.execute("SELECT public_id,parent,platform FROM stops WHERE id='8507000:0:2'").fetchone(), ("8507000", "8507000", "2"))
                self.assertEqual(db.execute("SELECT from_trip FROM transfers WHERE type=4").fetchone()[0], "exact-trip")

    def test_invalid_feed_retains_existing_index(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "transit.sqlite"
            import_archive(self.fixture(folder), target, dt.date(2026, 9, 5))
            previous = target.read_bytes()
            with self.assertRaises(ValueError):
                import_archive(self.fixture(folder, "20270101", "20271231"), target, dt.date(2026, 9, 5))
            self.assertEqual(previous, target.read_bytes())

    def test_current_sloid_feed_uses_explicit_didok(self):
        with tempfile.TemporaryDirectory() as folder:
            archive_path = self.fixture(folder)
            with zipfile.ZipFile(archive_path) as source:
                files = {name: source.read(name) for name in source.namelist()}
            files["stops.txt"] = b"stop_id,stop_name,stop_lat,stop_lon,parent_station,platform_code,didok\nParentch:1:sloid:3000,Zuerich HB,47.378,8.537,,,8503000\nch:1:sloid:3000:501:33,Zuerich HB,47.378,8.537,Parentch:1:sloid:3000,33AB,8503000\n"
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name, data in files.items():
                    archive.writestr(name, data)
            target = Path(folder) / "transit.sqlite"
            import_archive(archive_path, target, dt.date(2026, 9, 5))
            with sqlite3.connect(target) as db:
                self.assertEqual(db.execute("SELECT public_id,parent,platform FROM stops WHERE platform='33AB'").fetchone(), ("8503000", "Parentch:1:sloid:3000", "33AB"))
