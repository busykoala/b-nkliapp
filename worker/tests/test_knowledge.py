"""Behavioural checks for provenance, spatial joins, uncertainty and conservative matching."""
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from shapely import to_wkb
from shapely.geometry import LineString, Point, box
from benchly.benches.importer import import_osm, osm_timestamp
from benchly.benches.models import Bench, BenchEnrichment, BenchMetadataEdit, Media
from benchly.context.geometry import WGS84_TO_LV95
from benchly.context.models import EnvironmentFeature
from benchly.db import open_database
from benchly.knowledge.approaches import analyze_approach, slope_profile
from benchly.knowledge.evidence import resolve
from benchly.knowledge.geography import enrich_geography
from benchly.knowledge.inventories import InventoryRecord, match_record
from benchly.knowledge.models import Evidence, Geography, PlaceFeature
from benchly.knowledge.repository import record_evidence, upsert
from benchly.imagery.calibration import fit_platt, metrics, split_groups, benchmark_coverage


@pytest.fixture
def database(tmp_path):
    db = open_database(tmp_path / "knowledge.sqlite")
    db.create_tables([Bench, BenchEnrichment, BenchMetadataEdit, Media, EnvironmentFeature, Evidence, PlaceFeature, Geography])
    yield db
    db.close()


def test_xml_import_retains_original_metadata_on_reimport(database, tmp_path):
    source = tmp_path / "benches.osm"
    source.write_text('''<osm version="0.6"><node id="123" lat="46.68" lon="7.68" version="7" timestamp="2020-01-02T03:04:05Z" changeset="987">
      <tag k="amenity" v="bench"/><tag k="backrest" v="yes"/></node></osm>''')
    import_osm(database, source)
    first = database.execute("SELECT * FROM benches").fetchone()
    assert first["osm_version"] == 7
    assert first["osm_changeset"] == 987
    assert first["source_updated_at"] == first["osm_timestamp"] == "2020-01-02T03:04:05Z"
    assert first["imported_at"] != first["source_updated_at"]
    import_osm(database, source)
    assert database.execute("SELECT count(*) FROM benches").fetchone()[0] == 1
    assert database.execute("SELECT source_updated_at FROM benches").fetchone()[0] == "2020-01-02T03:04:05Z"


def test_missing_osm_timestamp_is_unknown_not_today():
    assert osm_timestamp(SimpleNamespace(timestamp=None)) is None
    assert osm_timestamp(SimpleNamespace(timestamp=datetime(1970, 1, 1, tzinfo=timezone.utc))) is None


def assertion(value, source_id="one", source_type="community", date="2026-09-01T00:00:00Z", confidence=.9):
    return dict(attribute="backrest", value_json=json.dumps(value), source_type=source_type, source_id=source_id,
                observed_at=date, source_updated_at=None, imported_at=date, confidence=confidence)


def test_equal_fresh_conflicting_reports_remain_unresolved():
    result = resolve([assertion(1), assertion(0, "two")], datetime(2026, 9, 9, tzinfo=timezone.utc))
    assert result["value_json"] is None
    assert result["conflicting"] == 1
    assert result["evidence_count"] == 2


def test_agreement_counts_independent_sources_and_retains_negative_values():
    result = resolve([assertion(0), assertion(0), assertion(0, "two")], datetime(2026, 9, 9, tzinfo=timezone.utc))
    assert result["value_json"] == "0"
    assert result["evidence_count"] == 2
    assert result["confidence"] == "high"


def test_recent_reports_outweigh_old_mapping_without_erasing_conflict():
    result = resolve([assertion(1, "map", "osm", "2005-01-01T00:00:00Z"), assertion(0), assertion(0, "two")], datetime(2026, 9, 9, tzinfo=timezone.utc))
    assert result["value_json"] == "0"
    assert result["conflicting"] == 1


def test_one_capture_group_and_self_confidence_cannot_prove_a_fact():
    result = resolve([assertion(1, "photo-group", "imagery", confidence=1)] * 12, datetime(2026, 9, 9, tzinfo=timezone.utc))
    assert result["evidence_count"] == 1
    assert result["confidence"] == "low"


def test_recording_evidence_is_idempotent_and_preserves_contradictions(database):
    for value in (0, 0, 1):
        record_evidence(database, 1, "backrest", value, "community", "observer", observed_at="2026-09-01", confidence=.8)
    assert database.execute("SELECT count(*) FROM bench_attribute_evidence").fetchone()[0] == 2


def bench():
    return dict(row_id=1, latitude=46.68, longitude=7.68)


def context_line(coords, source="way-1", **tags):
    return {"kind": "path", "geometry_wkb": to_wkb(LineString(coords)), "source_id": source,
            "raw_tags": json.dumps({"highway": "footway", **tags})}


def test_no_path_and_disconnected_path_do_not_become_accessible():
    b = bench()
    x, y = WGS84_TO_LV95.transform(b["longitude"], b["latitude"])
    result = analyze_approach(b, [context_line([(x+80, y-100), (x+80, y+100)], wheelchair="yes")])
    assert result["confidence"] == "unknown"
    assert "step_free_possible" not in result


def test_steps_are_recorded_and_missing_dem_does_not_mean_flat():
    b = bench()
    x, y = WGS84_TO_LV95.transform(b["longitude"], b["latitude"])
    result = analyze_approach(b, [context_line([(x, y), (x, y+220)], highway="steps")])
    assert result["steps"] == 1
    assert result["step_free_possible"] == 0
    assert result["maximum_slope_percent"] is None


def test_grade_uses_horizontal_route_distance():
    x, y = WGS84_TO_LV95.transform(7.68, 46.68)
    def sample(lat, lon):
        _, north = WGS84_TO_LV95.transform(lon, lat)
        return (north - y) * .05 + 500
    average, maximum, gain = slope_profile([(x, y), (x, y+200)], sample)
    assert average == pytest.approx(5, abs=.01)
    assert maximum == pytest.approx(5, abs=.01)
    assert gain == pytest.approx(10, abs=.01)


def test_missing_one_dem_sample_keeps_whole_grade_unknown():
    x, y = WGS84_TO_LV95.transform(7.68, 46.68)
    assert slope_profile([(x, y), (x, y+200)], lambda lat, lon: None) == (None, None, None)


def test_adjacent_similar_benches_are_not_merged():
    record = InventoryRecord(external_id="park-1", latitude=46.68, longitude=7.68, attributes={"backrest": "yes", "material": "wood"})
    rows = [{**bench(), "backrest": 1, "material": "wood"}, {**bench(), "row_id": 2, "latitude": 46.68001, "backrest": 1, "material": "wood"}]
    row_id, _, status, candidates = match_record(record, rows)
    assert row_id is None and status == "review" and len(candidates) == 2


def test_matching_requires_attributes_as_well_as_distance():
    record = InventoryRecord(external_id="park-1", latitude=46.68, longitude=7.68, attributes={})
    assert match_record(record, [bench()])[2] == "review"
    record.attributes = {"backrest": "yes"}
    assert match_record(record, [{**bench(), "backrest": 1}])[2] == "matched"
    assert match_record(record, [{**bench(), "backrest": 0}])[2] == "review"


def test_boundary_containment_beats_nearest_locality(database):
    database.execute("CREATE VIRTUAL TABLE official_place_spatial USING rtree(id,min_lon,max_lon,min_lat,max_lat)")
    b = bench()
    x, y = WGS84_TO_LV95.transform(b["longitude"], b["latitude"])
    rows = [("municipality", "Spiez", box(x-100, y-100, x+100, y+100)), ("locality", "Hafen", Point(x+20, y))]
    for index, (kind, name, geom) in enumerate(rows, 1):
        upsert(database, PlaceFeature, dict(id=index, source="fixture", source_id=str(index), kind=kind, name=name,
            municipality_id="768" if kind == "municipality" else None, geometry_wkb=to_wkb(geom),
            min_lon=7.67, max_lon=7.69, min_lat=46.67, max_lat=46.69, source_version="2026", imported_at="2026-09-01"), ["source", "source_id"])
        database.execute("INSERT INTO official_place_spatial VALUES(?,?,?,?,?)", (index, 7.67, 7.69, 46.67, 46.69))
    result = enrich_geography(database, b)
    assert result["municipality_name"] == "Spiez" and result["municipality_id"] == "768"
    assert result["locality_name"] == "Hafen"
    assert result["locality_distance_meters"] == pytest.approx(20)


def test_metrics_include_confusion_and_calibration_error():
    result = metrics([True, False, True, False], [.9, .8, .3, .1])
    assert result["confusion"] == {"tp": 1, "fp": 1, "tn": 1, "fn": 1}
    assert result["precision"] == result["recall"] == result["f1"] == .5
    assert result["brier"] == pytest.approx((.01+.64+.49+.01)/4)
    assert result["ece"] is not None
    assert fit_platt([True]*40, [.9]*40) is None


def test_shared_images_never_cross_calibration_test_split():
    records = [{"id": "a", "latitude": 46.68, "longitude": 7.68, "images": [{"url": "same"}]},
               {"id": "b", "latitude": 47.68, "longitude": 8.68, "images": [{"url": "same"}]}]
    assert len(set(split_groups(records))) == 1
    assert benchmark_coverage(records)["remaining"] == 998
    assert benchmark_coverage(records)["strata"]["image_quality"] == {"unknown": 2}


def test_path_junctions_use_shared_nodes_not_visual_crossings():
    b = bench()
    x, y = WGS84_TO_LV95.transform(b["longitude"], b["latitude"])
    # A real shared intermediate vertex connects the short spur to a long footway.
    spur = context_line([(x, y), (x+20, y)], _node_refs="1,2")
    main = context_line([(x+20, y-150), (x+20, y), (x+20, y+150)], "way-2", _node_refs="3,2,4")
    assert analyze_approach(b, [spur, main])["length_meters"] == 170
    crossing = context_line([(x+20, y-150), (x+20, y+150)], "way-2", _node_refs="3,4")
    assert analyze_approach(b, [spur, crossing])["length_meters"] == 20


def test_unknown_benchmark_strata_can_be_completed_later():
    from benchly.imagery.calibration import sample_strata
    result = sample_strata({"elevation_band": "unknown", "elevation_meters": 1700, "provider": "unknown", "images": [{"provider": "Commons"}]})
    assert result["elevation_band"] == "alpine"
    assert result["provider"] == "Commons"


def test_zurich_adapter_uses_native_identity_without_inventing_dates_or_physical_tags():
    from benchly.knowledge.municipal import normalize_zurich
    payload = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "bankstandorte_ogd.1", "geometry": {"type": "Point", "coordinates": [8.545338, 47.366631]}, "properties": {"objid": "2", "objectid": 1, "sitzbankmodelle": "046 / gebogene Sitzlatten", "adresse": None}}]}
    record = normalize_zurich(payload)[0]
    assert record.external_id == "2"
    assert record.source_updated_at is None
    assert "backrest" not in record.attributes
    payload["features"].append(payload["features"][0])
    with pytest.raises(ValueError, match="duplicate"):
        normalize_zurich(payload)


def test_overpass_json_reads_element_metadata_and_center_geometry(database, tmp_path):
    path = tmp_path / "snapshot.json"
    path.write_text(json.dumps({"elements": [
        {"type": "node", "id": 125, "lat": 46.68, "lon": 7.68, "version": 4, "timestamp": "2022-02-03T04:05:06Z", "changeset": 876, "tags": {"amenity": "bench"}},
        {"type": "way", "id": 126, "center": {"lat": 46.7, "lon": 7.7}, "version": 2, "timestamp": "2021-02-03T04:05:06Z", "changeset": 654, "tags": {"amenity": "bench"}}
    ]}))
    import_osm(database, path)
    rows = database.execute("SELECT id,osm_version,osm_changeset,source_updated_at,latitude FROM benches ORDER BY row_id").fetchall()
    assert tuple(rows[0]) == ("osm-node-125", 4, 876, "2022-02-03T04:05:06Z", 46.68)
    assert tuple(rows[1]) == ("osm-way-126", 2, 654, "2021-02-03T04:05:06Z", 46.7)


def test_amenities_preserve_building_use_and_drinking_water_evidence():
    from benchly.knowledge.amenities import amenity_categories
    assert amenity_categories({"kind": "building", "raw_tags": '{"building":"yes","amenity":"toilets"}'}) == {"toilets"}
    assert amenity_categories({"kind": "fountain", "raw_tags": '{"amenity":"fountain"}'}) == {"fountain"}
    assert amenity_categories({"kind": "fountain", "raw_tags": '{"amenity":"fountain","drinking_water":"yes"}'}) == {"fountain", "drinking_water"}
