import sqlite3
import unittest

from benchly.benches.repository import refresh_nearby_amenities, upsert_inventory_benches


class BenchRepositoryTests(unittest.TestCase):
    def database(self):
        database = sqlite3.connect(":memory:")
        database.row_factory = sqlite3.Row
        database.executescript("""
          CREATE TABLE benches(
            row_id INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE,osm_type TEXT,osm_id INTEGER,
            latitude REAL,longitude REAL,backrest INTEGER,armrest INTEGER,covered INTEGER,
            wheelchair INTEGER,fireplace_nearby INTEGER,waste_basket_nearby INTEGER,
            seats INTEGER,material TEXT,direction_degrees REAL,operator TEXT,
            description TEXT,raw_tags TEXT,active INTEGER,source_updated_at TEXT,imported_at TEXT,
            name TEXT,dedication TEXT,location_name TEXT,location_key TEXT,location_postcode TEXT,
            location_canton TEXT,UNIQUE(osm_type,osm_id)
          );
          CREATE TABLE bench_metadata_edits(
            id INTEGER PRIMARY KEY,bench_row_id INTEGER,user_id INTEGER,field TEXT,
            old_value TEXT,new_value TEXT,created_at TEXT
          );
          CREATE TABLE environment_features(
            row_id INTEGER PRIMARY KEY,source TEXT,source_id TEXT,kind TEXT,subtype TEXT,
            center_latitude REAL,center_longitude REAL,min_latitude REAL,max_latitude REAL,
            min_longitude REAL,max_longitude REAL,height_meters REAL,raw_tags TEXT,imported_at TEXT,
            geometry_wkb BLOB,geometry_crs INTEGER,source_version TEXT,source_updated_at TEXT,
            ground_elevation_meters REAL,eaves_elevation_meters REAL,roof_elevation_meters REAL
          );
        """)
        return database

    def record(self, **overrides):
        return {
            "id": "osm-node-1", "osm_type": "node", "osm_id": 1,
            "latitude": 46.68, "longitude": 7.68, "backrest": 1,
            "raw_tags": "{}", "active": 1, "source_updated_at": "v1", "imported_at": "v1",
            **overrides,
        }

    def test_osm_refresh_preserves_only_community_edited_fields(self):
        database = self.database()
        upsert_inventory_benches(database, [self.record(name="Alter Name")], preserve_edits=True)
        row_id = database.execute("SELECT row_id FROM benches").fetchone()[0]
        database.execute(
            "INSERT INTO bench_metadata_edits VALUES(1,?,1,'name','Alter Name','Mein Bänkli','now')",
            (row_id,),
        )
        database.execute("UPDATE benches SET name='Mein Bänkli' WHERE row_id=?", (row_id,))

        upsert_inventory_benches(
            database,
            [self.record(latitude=46.69, name="Neuer OSM-Name", source_updated_at="v2", imported_at="v2")],
            preserve_edits=True,
        )

        refreshed = database.execute("SELECT name,latitude,source_updated_at FROM benches").fetchone()
        self.assertEqual(refreshed["name"], "Mein Bänkli")
        self.assertEqual(refreshed["latitude"], 46.69)
        self.assertEqual(refreshed["source_updated_at"], "v2")

    def test_nearby_amenity_hints_remain_editable(self):
        database = self.database()
        upsert_inventory_benches(database, [self.record()], preserve_edits=True)
        row_id = database.execute("SELECT row_id FROM benches").fetchone()[0]
        database.execute("""INSERT INTO environment_features(
          row_id,source,source_id,kind,center_latitude,center_longitude,min_latitude,max_latitude,
          min_longitude,max_longitude,raw_tags,imported_at,geometry_crs
        ) VALUES(1,'OpenStreetMap','node-2','fireplace',46.6803,7.6803,46.6803,46.6803,7.6803,7.6803,'{}','now',2056)""")

        refresh_nearby_amenities(database)
        self.assertEqual(database.execute("SELECT fireplace_nearby FROM benches").fetchone()[0], 1)

        database.execute("INSERT INTO bench_metadata_edits VALUES(1,?,1,'fireplaceNearby','1','0','now')", (row_id,))
        database.execute("UPDATE benches SET fireplace_nearby=0 WHERE row_id=?", (row_id,))
        refresh_nearby_amenities(database)
        self.assertEqual(database.execute("SELECT fireplace_nearby FROM benches").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
