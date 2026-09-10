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


@pytest.mark.parametrize("fail_second_store", [False, True])
def test_terrain_calculations_allow_app_writes_and_commit_one_complete_bench(migrated_database, monkeypatch, fail_second_store):
    from benchly.db import connect_database
    from benchly.enrichment import service
    from benchly.knowledge import approaches
    with sqlite3.connect(migrated_database) as setup:
        setup.execute("""INSERT INTO benches(id,osm_type,osm_id,latitude,longitude,raw_tags,source_updated_at,imported_at)
          VALUES('osm-node-124','node',124,46.68,7.681,'{}','','2026-09-09')""")
    app = sqlite3.connect(migrated_database, timeout=.05)
    database = connect_database(migrated_database)
    observed = []

    def app_write_during_calculation():
        # A real second connection, like the route planner's rate limiter.
        with app:
            app.execute("""INSERT INTO rate_limits(key_hash,action,window_start,count) VALUES('test','walk-plan',0,1)
              ON CONFLICT(key_hash,action,window_start) DO UPDATE SET count=count+1""")
            observed.append(app.execute("SELECT count(*) FROM bench_enrichments").fetchone()[0])

    class Raster:
        datasets = [object()]

        def __init__(self, _path):
            pass

        def sample(self, _lat, _lon):
            app_write_during_calculation()
            return 500

        def close(self):
            pass

    original_analyze = approaches.analyze_approach
    def analyze(*args, **kwargs):
        app_write_during_calculation()
        return original_analyze(*args, **kwargs)

    original_store = service.store_approach
    def store(connection, bench, values):
        if fail_second_store and bench["row_id"] == 2:
            raise RuntimeError("interrupted store")
        return original_store(connection, bench, values)

    monkeypatch.setattr(service, "RasterCollection", Raster)
    monkeypatch.setattr(service, "terrain_metadata", lambda _: [])
    monkeypatch.setattr(service, "nearby_context", lambda *args: [])
    monkeypatch.setattr(service, "nearby_land_cover", lambda *args: [])
    monkeypatch.setattr(service, "canopy_neighborhood", lambda *args: dict(share_3m=None, share_10m=None, share_25m=None, context="unknown", median_height=None, max_height=None))
    monkeypatch.setattr(service, "horizon_profile", lambda *args: ([0] * 72, [0] * 72, ["terrain"] * 72, [None] * 72, [500], [500] * 72))
    monkeypatch.setattr(service, "classify_view", lambda *args: ([], .5, 0, .5, .5, []))
    monkeypatch.setattr(service, "direct_sun_minutes", lambda *args: 0)
    monkeypatch.setattr(approaches, "analyze_approach", analyze)
    monkeypatch.setattr(service, "store_approach", store)
    try:
        if fail_second_store:
            with pytest.raises(RuntimeError, match="interrupted store"):
                service.enrich_terrain(database, None, None)
        else:
            assert service.enrich_terrain(database, None, None) == 2
        assert observed == [0, 0, 1, 1]
        expected = 1 if fail_second_store else 2
        assert app.execute("SELECT count(*) FROM bench_enrichments").fetchone()[0] == expected
        assert app.execute("SELECT count(*) FROM bench_approaches").fetchone()[0] == expected
        app_write_during_calculation()
    finally:
        database.close()
        app.close()


def test_backfill_calculates_without_writer_lock_and_does_not_acknowledge_new_edit(migrated_database, monkeypatch):
    from benchly.knowledge import jobs
    original = jobs.prepare_bench
    def concurrent_edit(database, bench, *args):
        result = original(database, bench, *args)
        with sqlite3.connect(migrated_database, timeout=.05) as app:
            app.execute("UPDATE benches SET longitude=longitude+.001 WHERE row_id=?", (bench["row_id"],))
        return result
    monkeypatch.setattr(jobs, "prepare_bench", concurrent_edit)
    run(migrated_database)
    with sqlite3.connect(migrated_database) as connection:
        assert connection.execute("SELECT count(*) FROM bench_knowledge_queue").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM bench_knowledge_outcomes").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM bench_approaches").fetchone()[0] == 0
    monkeypatch.setattr(jobs, "prepare_bench", original)
    run(migrated_database)
    with sqlite3.connect(migrated_database) as connection:
        assert connection.execute("SELECT count(*) FROM bench_knowledge_outcomes").fetchone()[0] == 8
        assert connection.execute("SELECT count(*) FROM bench_knowledge_queue").fetchone()[0] == 0


def test_failed_backfill_retains_previous_values_and_records_retry(migrated_database, monkeypatch):
    from benchly.knowledge import jobs
    run(migrated_database)
    with sqlite3.connect(migrated_database) as connection:
        before = connection.execute("SELECT * FROM bench_attribute_state").fetchall()
        connection.execute("UPDATE knowledge_generation SET revision=revision+1")
    monkeypatch.setattr(jobs, "nearby_context", lambda *_: (_ for _ in ()).throw(RuntimeError("source unavailable")))
    with pytest.raises(RuntimeError, match="recorded retryable failures"):
        run(migrated_database)
    with sqlite3.connect(migrated_database) as connection:
        assert connection.execute("SELECT * FROM bench_attribute_state").fetchall() == before
        assert connection.execute("SELECT count(*) FROM bench_knowledge_outcomes WHERE status='retryable_failure'").fetchone()[0] == 8


def test_failed_osm_parse_after_staging_a_batch_keeps_source_generation(migrated_database, tmp_path):
    from benchly.benches.importer import import_osm
    from benchly.db import connect_database
    elements = [{"type": "node", "id": index, "lat": 46.68, "lon": 7.68, "tags": {"amenity": "bench"}, "version": 2}
                for index in range(1000, 2100)]
    elements[-1]["timestamp"] = "invalid-source-date"
    path = tmp_path / "broken.json"
    path.write_text(json.dumps({"elements": elements}))
    database = connect_database(migrated_database)
    before = dict(database.execute("SELECT * FROM benches").fetchone())
    try:
        with pytest.raises(ValueError):
            import_osm(database, path, "failed-generation")
        assert dict(database.execute("SELECT * FROM benches").fetchone()) == before
        assert database.execute("SELECT count(*) FROM benches").fetchone()[0] == 1
    finally:
        database.close()


def test_osm_publication_resumes_without_losing_community_edits(migrated_database, tmp_path, monkeypatch):
    from benchly.benches import importer
    from benchly.db import connect_database
    path = tmp_path / "valid.json"
    path.write_text(json.dumps({"elements": [{"type": "node", "id": index, "lat": 46.68, "lon": 7.68,
        "tags": {"amenity": "bench", "backrest": "yes"}, "timestamp": "2026-09-01T08:00:00Z", "version": 8} for index in range(1000, 2100)]}))
    database = connect_database(migrated_database)
    original = importer.upsert_inventory_benches
    calls = 0
    def interrupted(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("interrupted publication")
        return original(*args, **kwargs)
    monkeypatch.setattr(importer, "upsert_inventory_benches", interrupted)
    try:
        with pytest.raises(RuntimeError, match="interrupted publication"):
            importer.import_osm(database, path, "v8")
        database.rollback()
        assert database.execute("SELECT count(*) FROM benches WHERE osm_version=8").fetchone()[0] == 250
        monkeypatch.setattr(importer, "upsert_inventory_benches", original)
        assert importer.import_osm(database, path, "v8")[0] == 1100
        assert database.execute("SELECT count(*) FROM benches WHERE active=1 AND osm_timestamp IS NOT NULL AND osm_changeset IS NULL").fetchone()[0] == 1100
    finally:
        database.close()


def test_imports_every_amenity_category_and_barriers(migrated_database, tmp_path):
    from benchly.benches.importer import import_osm
    from benchly.db import connect_database
    from benchly.knowledge.amenities import CATEGORIES
    elements = [{"type": "node", "id": 123, "lat": 46.68, "lon": 7.68, "version": 8, "tags": {"amenity": "bench"}}]
    for index, category in enumerate(CATEGORIES):
        key, value = ("leisure", "firepit") if category == "fireplace" else ("leisure", category) if category in {"picnic_table", "playground"} else ("amenity", category)
        elements.append({"type": "node", "id": 200+index, "lat": 46.6801, "lon": 7.68, "tags": {key: value}})
    elements.append({"type": "node", "id": 300, "lat": 46.68, "lon": 7.68, "tags": {"barrier": "stile"}})
    path = tmp_path / "amenities.json"
    path.write_text(json.dumps({"elements": elements}))
    database = connect_database(migrated_database)
    try:
        import_osm(database, path, "all-kinds")
        kinds = {row[0] for row in database.execute("SELECT DISTINCT kind FROM environment_features")}
        assert kinds == {*CATEGORIES, "barrier"}
    finally:
        database.close()
    run(migrated_database)
    with sqlite3.connect(migrated_database) as connection:
        assert connection.execute("SELECT count(*) FROM bench_amenities WHERE distance_meters BETWEEN 0 AND 250").fetchone()[0] == 8


def test_physical_photo_estimates_require_validation_and_unique_non_conflicting_images(migrated_database):
    from benchly.db import connect_database
    from benchly.imagery.photo_models import BankPhotoSource, BankPhotoObservation
    from benchly.imagery.physical_estimates import PhysicalEstimates
    database = connect_database(migrated_database)
    database.create_tables([BankPhotoSource, BankPhotoObservation])
    database.commit()
    bench = dict(database.execute("SELECT * FROM benches").fetchone())
    prediction = json.dumps({"bench_visible": True, "perspective": "closeup", "usable_for_context": False, "backrest": True, "armrests": False, "material": "wood"})
    try:
        database.execute("""INSERT INTO bank_photo_sources(source_id,latitude,longitude,source_url,source_metadata,discovered_at,bench_id,match_method,match_distance_meters)
            VALUES(1,46.68,7.68,'https://example.org','{}','2026-09-01','osm-node-123','source_coordinate',0)""")
        database.execute("""INSERT INTO bank_photo_observations(source_id,image_id,fetch_url,status,image_sha256,prediction,model_version,prompt_version,attempts)
            VALUES(1,1,'https://example.org/image','analyzed','hash',?,'model','prompt',1)""", (prediction,))
        estimates = PhysicalEstimates(database)
        estimates.enrich(database, bench)
        assert {row[0] for row in database.execute("SELECT status FROM bench_photo_estimates")} == {"unvalidated"}
        assert database.execute("SELECT count(*) FROM bench_attribute_state").fetchone()[0] == 0
        estimates.validation = {("model", "prompt", attr): {"samples": 40, "accepted": True} for attr in ("backrest", "armrest", "material")}
        estimates.enrich(database, bench)
        assert database.execute("SELECT count(*) FROM bench_photo_estimates WHERE status='eligible'").fetchone()[0] == 3
        database.execute("UPDATE benches SET longitude=7.69")
        estimates.enrich(database, dict(database.execute("SELECT * FROM benches").fetchone()))
        assert database.execute("SELECT count(*) FROM bench_photo_estimates").fetchone()[0] == 0
        database.execute("UPDATE benches SET longitude=7.68")
        database.execute("""INSERT INTO bank_photo_sources(source_id,latitude,longitude,source_url,source_metadata,discovered_at,bench_id,match_method)
            VALUES(2,47,8,'https://example.org','{}','2026-09-01',NULL,'unmatched')""")
        database.execute("""INSERT INTO bank_photo_observations(source_id,image_id,fetch_url,status,image_sha256,prediction,attempts)
            VALUES(2,2,'https://example.org/image','analyzed','hash',?,1)""", (prediction,))
        estimates.enrich(database, bench)
        assert database.execute("SELECT count(*) FROM bench_photo_estimates").fetchone()[0] == 0
    finally:
        database.rollback()
        database.close()
