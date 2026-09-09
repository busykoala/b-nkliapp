from benchly.terrain import classify_view
from benchly.context.geometry import classify_official_layer, feature_is_large_water
from shapely import to_wkb
from shapely.geometry import Polygon, LineString


def labels(profile, types, facing=None):
    return classify_view(46.688, 7.686, facing, profile, [0] * 72, [], 0,
                         obstruction_types=types)[0]


def test_broad_waterfront_opening_survives_buildings_behind_the_bench():
    horizon = [35] * 72
    types = ["building"] * 72
    for index in range(18):
        horizon[index] = 0
        types[index] = "terrain"
    assert "Weitsicht" in labels(horizon, types)
    assert "Eingeschränkte Aussicht" not in labels(horizon, types)
    assert "Weitsicht" not in labels(horizon, types, facing=225)


def test_sky_above_hedges_and_many_small_gaps_do_not_become_long_view():
    assert "Weitsicht" not in labels([6] * 72, ["vegetation"] * 72)
    horizon = [0 if index % 2 else 10 for index in range(72)]
    types = ["terrain" if index % 2 else "building" for index in range(72)]
    assert "Weitsicht" not in labels(horizon, types)


def test_north_facing_view_is_contiguous_across_zero_degrees():
    horizon = [35] * 72
    types = ["building"] * 72
    for index in [*range(66, 72), *range(7)]:
        horizon[index] = 0
        types[index] = "terrain"
    assert "Weitsicht" in labels(horizon, types, facing=0)
    assert "Weitsicht" not in labels(horizon, types, facing=180)


def test_place_names_do_not_turn_recreation_areas_into_water_or_forest():
    assert classify_official_layer("tlm_areale_freizeitareal", {
        "name": "Frei- und Seebad Spiez", "objektart": "Schwimmbadareal",
    }) == ("land_cover", "Schwimmbadareal")
    assert classify_official_layer("tlm_areale_freizeitareal", {
        "name": "Waldpark", "objektart": "Parkanlage",
    }) == ("land_cover", "Parkanlage")
    assert classify_official_layer("tlm_bb_bodenbedeckung", {"objektart": "Stehende Gewaesser"}) == ("environment", "water")
    assert classify_official_layer("tlm_bb_bodenbedeckung", {"objektart": "Wald"}) == ("environment", "forest")
    assert classify_official_layer("tlm_bb_bodenbedeckung", {"objektart": "Wald offen"}) == ("environment", "forest")
    assert classify_official_layer("tlm_areale_nutzungsareal", {"objektart": "Wald nicht bestockt"}) == ("land_cover", "Wald nicht bestockt")


def test_official_water_type_overrules_size_heuristic():
    river = {"geometry_wkb": to_wkb(Polygon([(0, 0), (1000, 0), (1000, 150), (0, 150)])),
             "raw_tags": '{"objektart":"Fliessgewaesser"}'}
    lake_boundary = {"geometry_wkb": to_wkb(LineString([(0, 0), (1000, 0)])),
                     "raw_tags": '{"objektart":"See","name":"Thunersee"}'}
    assert not feature_is_large_water(river)
    assert feature_is_large_water(lake_boundary)


def test_underground_water_is_not_visible_water_but_open_river_under_bridge_is():
    from benchly.context.evidence import preferred_exact_features
    rows = [{"row_id": index, "source": "swissTLM3D", "source_version": "current", "kind": "water",
             "geometry_wkb": to_wkb(LineString([(index, 0), (index, 10)])), "raw_tags": tags}
            for index, tags in enumerate([
                '{"verlauf":"Unterirdisch bestimmt"}', '{"VERLAUF":300}',
                '{"verlauf":"Oberirdisch","stufe":"-1"}', '{"verlauf":"Wasserfall"}',
            ])]
    assert [row["row_id"] for row in preferred_exact_features(rows, "water", "current")] == [2, 3]


def test_nearest_context_expands_past_false_bounding_box_hits(monkeypatch):
    from benchly.context import evidence
    far = {"row_id": 1}
    near = {"row_id": 2}
    radii = []

    def nearby(_connection, _lat, _lon, radius, _kinds):
        radii.append(radius)
        return [far] if radius < 500 else [far, near]

    monkeypatch.setattr(evidence, "nearby_context", nearby)
    monkeypatch.setattr(evidence, "preferred_exact_features", lambda rows, *_: rows)
    monkeypatch.setattr(evidence, "feature_distance", lambda _lat, _lon, row: 900 if row is far else 200)
    assert evidence.nearest_exact_context(None, 46.7, 7.7, "forest", "current") == [far, near]
    assert radii == [102, 510]


def test_existing_misclassified_geometry_is_moved_and_invalidated_atomically(tmp_path):
    from benchly.db import open_database
    from benchly.benches.models import BenchEnrichment
    from benchly.benches.repository import upsert_enrichment
    from benchly.context.models import EnvironmentFeature, LandCoverFeature
    from benchly.context.repository import upsert_environment_features
    from benchly.context.repair import repair_official_classifications
    db = open_database(tmp_path / "repair.sqlite")
    db.create_tables([EnvironmentFeature, LandCoverFeature, BenchEnrichment])
    geometry = to_wkb(Polygon([(0, 0), (10, 0), (10, 10), (0, 10)]))
    upsert_environment_features(db, [{
        "source": "swissTLM3D", "source_id": "tlm_areale_freizeitareal:pool", "kind": "water",
        "center_latitude": 46.68, "center_longitude": 7.68, "min_latitude": 46.68,
        "max_latitude": 46.69, "min_longitude": 7.68, "max_longitude": 7.69,
        "geometry_wkb": geometry, "raw_tags": '{"objektart":"Schwimmbadareal","name":"Seebad"}',
        "imported_at": "now", "source_version": "test",
    }])
    upsert_enrichment(db, {"bench_row_id": 1, "pipeline_version": "old", "environment_computed_at": "now"})
    db.commit()
    assert repair_official_classifications(db) == {"checked": 1, "water->Schwimmbadareal": 1}
    assert db.execute("SELECT count(*) FROM environment_features").fetchone()[0] == 1
    repair_official_classifications(db, apply=True)
    assert db.execute("SELECT count(*) FROM environment_features").fetchone()[0] == 0
    assert db.execute("SELECT geometry_wkb FROM land_cover_features").fetchone()[0] == geometry
    assert tuple(db.execute("SELECT pipeline_version,environment_computed_at FROM bench_enrichments").fetchone()) == (None, None)
    assert repair_official_classifications(db, apply=True) == {}
    db.close()


def test_surface_water_plan_preserves_moved_benches_and_newer_measurements(tmp_path):
    from benchly.db import open_database
    from benchly.benches.models import Bench, BenchEnrichment
    from benchly.benches.repository import upsert_inventory_benches, upsert_enrichment
    from benchly.context.repair import apply_surface_water_plan
    db = open_database(tmp_path / "surface.sqlite")
    db.create_tables([Bench, BenchEnrichment])
    plans = []
    for index in range(1, 4):
        upsert_inventory_benches(db, [{
            "id": f"osm-node-{index}", "osm_type": "node", "osm_id": index,
            "latitude": 46.7 + (.001 if index == 2 else 0), "longitude": 7.7,
            "source_updated_at": "now", "imported_at": "now",
        }], preserve_edits=False)
        upsert_enrichment(db, {"bench_row_id": index, "distance_water_meters": 70 if index == 3 else 50,
                              "waterfront": 1, "sun_confidence": "hoch", "pipeline_version": "previous",
                              "land_context": "forest", "view_labels": '["Weitsicht"]'})
        plans.append({"row_id": index, "id": f"osm-node-{index}", "latitude": 46.7, "longitude": 7.7,
                      "distance_water_meters": 50, "waterfront": 1,
                      "new_distance_water_meters": 150, "new_waterfront": 0})
    assert apply_surface_water_plan(db, plans) == {"updated": 1, "skipped_changed": 2}
    row = db.execute("SELECT * FROM bench_enrichments WHERE bench_row_id=1").fetchone()
    assert (row["distance_water_meters"], row["waterfront"], row["pipeline_version"]) == (150, 0, None)
    assert (row["land_context"], row["sun_confidence"], row["view_labels"]) == ("forest", "hoch", '["Weitsicht"]')
    assert apply_surface_water_plan(db, plans) == {"updated": 0, "skipped_changed": 3}
    db.close()
