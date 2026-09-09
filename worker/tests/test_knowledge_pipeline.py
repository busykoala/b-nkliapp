"""Run the actual app migrations and the complete worker on a small, disposable database."""
import json
import re
import sqlite3
from pathlib import Path
from types import SimpleNamespace
import pytest
from benchly.knowledge.jobs import backfill_knowledge


@pytest.fixture
def migrated_database(tmp_path):
    path = tmp_path / "pipeline.sqlite"
    connection = sqlite3.connect(path)
    root = Path(__file__).resolve().parents[2]
    for filename in ("migrations.ts", "knowledge-migrations.ts"):
        text = (root / "src" / "db" / filename).read_text()
        for sql in re.findall(r"\bsql:\s*`(.*?)`", text, re.S):
            assert "${" not in sql, "Resolve dynamic migration SQL explicitly in this fixture"
            connection.executescript(sql)
    connection.execute("""INSERT INTO benches(id,osm_type,osm_id,latitude,longitude,backrest,raw_tags,source_updated_at,imported_at,osm_timestamp,osm_version)
      VALUES('osm-node-123','node',123,46.68,7.68,1,'{"backrest":"yes"}','2020-01-01','2026-09-09','2020-01-01',7)""")
    connection.commit()
    connection.close()
    return path


def run(path):
    backfill_knowledge(SimpleNamespace(database=path, terrain_dir=None, noise_dir=None, limit=10, after_row_id=0, queued_only=False))


def test_full_backfill_is_resumable_idempotent_and_keeps_unknowns(migrated_database):
    run(migrated_database)
    with sqlite3.connect(migrated_database) as connection:
        first = connection.execute("SELECT count(*) FROM bench_attribute_evidence").fetchone()[0]
        assert connection.execute("SELECT source_updated_at FROM bench_source_records").fetchone()[0] == "2020-01-01"
        assert connection.execute("SELECT value_json FROM bench_attribute_state WHERE attribute='backrest'").fetchone()[0] == "1"
        assert connection.execute("SELECT step_free_possible,maximum_slope_percent FROM bench_approaches").fetchone() == (None, None)
        assert connection.execute("SELECT count(*) FROM bench_completeness").fetchone()[0] == 8
        assert connection.execute("SELECT count(*) FROM bench_knowledge_queue").fetchone()[0] == 0
    run(migrated_database)
    with sqlite3.connect(migrated_database) as connection:
        assert connection.execute("SELECT count(*) FROM bench_attribute_evidence").fetchone()[0] == first
        assert connection.execute("SELECT count(*) FROM bench_source_records").fetchone()[0] == 1
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_moving_a_bench_invalidates_its_spatial_context(migrated_database):
    run(migrated_database)
    with sqlite3.connect(migrated_database) as connection:
        connection.execute("INSERT INTO bench_enrichments(bench_row_id,elevation_meters) VALUES(1,500)")
        connection.execute("UPDATE benches SET longitude=8 WHERE row_id=1")
        assert connection.execute("SELECT reason FROM bench_knowledge_queue").fetchone()[0] == "moved"
        assert connection.execute("SELECT count(*) FROM bench_approaches").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM bench_enrichments").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM bench_attribute_state").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM bench_attribute_evidence").fetchone()[0] > 0
    run(migrated_database)


def test_noise_channels_preserve_zero_and_mask_nodata(migrated_database, tmp_path):
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    from benchly.context.geometry import WGS84_TO_LV95
    from benchly.db import connect_database
    from benchly.knowledge.noise import NoiseRasters
    x, y = WGS84_TO_LV95.transform(7.68, 46.68)
    for name, value in (("road-day", 55), ("road-night", 0), ("rail-day", 61), ("rail-night", -9999)):
        with rasterio.open(tmp_path / f"sonbase-{name}.tif", "w", driver="GTiff", width=1, height=1, count=1,
            dtype="float32", crs="EPSG:2056", transform=from_origin(x-5, y+5, 10, 10), nodata=-9999) as target:
            target.write(np.array([[[value]]], dtype="float32"))
            target.update_tags(dataset_version="official-fixture-2026")
    database = connect_database(migrated_database)
    rasters = NoiseRasters(tmp_path)
    try:
        rasters.enrich(database, dict(database.execute("SELECT * FROM benches").fetchone()))
        rows = {(row["mode"], row["period"]): dict(row) for row in database.execute("SELECT * FROM bench_noise_exposure")}
        assert rows["road", "day"]["value"] == 55
        assert rows["road", "night"]["value"] == 0
        assert rows["rail", "day"]["value"] == 61
        assert rows["rail", "night"]["value"] is None
        assert {row["unit"] for row in rows.values()} == {"dB(A) Lr"}
        assert {row["dataset_version"] for row in rows.values()} == {"official-fixture-2026"}
    finally:
        rasters.close()
        database.close()


def test_later_batch_without_dem_preserves_measured_approach(migrated_database):
    from benchly.db import connect_database
    from benchly.context.geometry import WGS84_TO_LV95
    from benchly.knowledge.approaches import enrich_approach
    from shapely.geometry import LineString
    database = connect_database(migrated_database)
    try:
        bench = dict(database.execute("SELECT * FROM benches").fetchone())
        x, y = WGS84_TO_LV95.transform(bench["longitude"], bench["latitude"])
        context = [{"kind": "path", "source_id": "way-1", "raw_tags": '{"highway":"footway"}', "geometry_wkb": LineString([(x,y),(x+200,y)]).wkb}]
        measured = enrich_approach(database, bench, context, lambda lat, lon: WGS84_TO_LV95.transform(lon,lat)[0] * .1)
        later = enrich_approach(database, bench, context)
        assert measured["maximum_slope_percent"] == 10
        assert later["maximum_slope_percent"] == measured["maximum_slope_percent"]
    finally:
        database.close()


def test_removed_osm_attribute_does_not_resurrect_old_evidence(migrated_database):
    run(migrated_database)
    with sqlite3.connect(migrated_database) as database:
        database.execute("UPDATE benches SET raw_tags='{}',osm_version=8,osm_timestamp='2026-09-09' WHERE row_id=1")
    run(migrated_database)
    with sqlite3.connect(migrated_database) as database:
        assert database.execute("SELECT value_json FROM bench_attribute_state WHERE attribute='backrest'").fetchone()[0] is None
        assert database.execute("SELECT count(*) FROM bench_attribute_evidence WHERE attribute='backrest'").fetchone()[0] == 2


def test_additive_migration_accepts_new_context_kinds_and_indexes_them(migrated_database):
    with sqlite3.connect(migrated_database) as database:
        for index, kind in enumerate(("toilets", "drinking_water", "fountain", "shelter", "picnic_table", "playground", "barrier")):
            database.execute("""INSERT INTO environment_features(source,source_id,kind,center_latitude,center_longitude,
              min_latitude,max_latitude,min_longitude,max_longitude,imported_at)
              VALUES('OpenStreetMap',?,?,46.68,7.68,46.68,46.68,7.68,7.68,'2026-09-09')""", (f"node-{index}", kind))
        assert database.execute("SELECT count(*) FROM environment_spatial_index").fetchone()[0] == 7


def test_amenity_area_and_way_count_once_without_merging_neighbouring_objects(migrated_database):
    from shapely.geometry import Point
    from benchly.context.geometry import WGS84_TO_LV95
    from benchly.db import connect_database
    from benchly.knowledge.amenities import enrich_amenities, source_object_id
    from benchly.knowledge.evidence import refresh_states
    database = connect_database(migrated_database)
    try:
        bench = dict(database.execute("SELECT * FROM benches").fetchone())
        x, y = WGS84_TO_LV95.transform(bench["longitude"], bench["latitude"])
        context = [dict(kind="shelter", source="OpenStreetMap", source_id=identifier, raw_tags='{}',
            geometry_wkb=Point(x + distance, y).wkb, source_version="2026", source_updated_at=None)
            for identifier, distance in (("way-12", 20), ("area-24", 18), ("way-13", 21), ("area-27", 22))]
        shelter = next(row for row in enrich_amenities(database, bench, context) if row["category"] == "shelter")
        assert shelter["nearest_source_id"] == "way-12"
        assert shelter["distance_meters"] == 18
        assert shelter["count_100m"] == shelter["count_500m"] == 3
        assert source_object_id(context[-1]) == "relation-13"
        assert refresh_states(database, bench)["shelter"]["value_json"] == "18.0"
        enrich_amenities(database, bench, [])
        assert "shelter" not in refresh_states(database, bench)
    finally:
        database.close()
