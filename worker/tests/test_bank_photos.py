import json
from argparse import Namespace
from unittest.mock import patch

import pytest

from benchly.db import open_database
from benchly.imagery.photo_source import analyze_bank_photos, discover_source_photos, image_record
from benchly.imagery.photo_prediction import BenchPhotoPrediction
from benchly.imagery.photo_repository import create_photo_schema


@pytest.fixture(autouse=True)
def private_photo_source(monkeypatch):
    monkeypatch.setenv("BENCHLY_PHOTO_SOURCE_URL", "https://photos.example")


def prediction(**overrides):
    return BenchPhotoPrediction.model_validate({
        "perspective": "outlook", "usable": True, "land_context": "park", "land_confidence": .9,
        "water_type": "lake", "water_confidence": .95, "mountain_probability": .85,
        "long_view_probability": .85, "limited_view_probability": .1, "canopy": "none",
        "bench_visible": True, "backrest": True, "armrests": None, "material": "wood",
        **overrides,
    })


def test_photo_fusion_respects_perspective_and_conflicting_evidence():
    from benchly.imagery.photo_evidence import photo_signals, project_photo_signals

    def observation(image_id, **overrides):
        return {"source_id": 1, "image_id": image_id, "source_metadata": '{}',
                "prediction": prediction(**overrides).model_dump_json()}

    base = {"land_context": "forest", "view_labels": '["Weitsicht"]', "view_confidence": "hoch"}
    closeup = observation(1, perspective="closeup", usable=False)
    assert project_photo_signals(base, photo_signals([closeup])) == base
    toward = observation(2, perspective="toward_bench", long_view_probability=.99, mountain_probability=.99)
    signals = photo_signals([toward])
    assert not signals["water_type"] and not signals["long_view"] and not signals["mountain"]
    assert project_photo_signals(base, signals)["land_context"] == "forest"
    conflict = photo_signals([observation(3), observation(4, water_type="river")])
    assert conflict["water_type"] is None and conflict["water_conflict"]
    absent = observation(5, water_type="none", water_confidence=.99)
    assert photo_signals([observation(3), absent])["water_type"] == "lake"


def test_invalid_source_longitude_cannot_wrap_onto_a_real_bench():
    from benchly.imagery.photo_matching import match_photo_sources
    source = {"source_id": 7017, "latitude": 47.07429055533374, "longitude": 190807.70552515984}
    bench = {"id": "real", "latitude": source["latitude"], "longitude": source["longitude"] % 360}
    assert match_photo_sources([source], [bench])[7017]["match_method"] == "invalid_coordinates"


def test_photo_fusion_rejects_reviewed_tree_gap_despite_source_view_tags():
    from benchly.imagery.photo_evidence import photo_signals, project_photo_signals

    # Public photo 1989 shows nearby trees with narrow distant gaps. The model
    # still assigned long=0.9/mountain=0.95, and the source claims LONG/BROAD.
    observed = {"source_id": 1245, "image_id": 1989,
                "source_metadata": '{"sight":["LONG","BROAD","GREEN"]}',
                "prediction": prediction(water_type="none", long_view_probability=.9,
                    mountain_probability=.95).model_dump_json()}
    signals = photo_signals([observed])
    assert not signals["long_view"] and not signals["mountain"]
    measured = {"land_context": "forest", "view_labels": '["Weitsicht","Bergblick"]'}
    assert project_photo_signals(measured, signals) == measured
    clear = {**observed, "prediction": prediction(water_type="none", long_view_probability=.95,
        mountain_probability=.98).model_dump_json()}
    assert photo_signals([clear])["long_view"] and photo_signals([clear])["mountain"]


def test_photo_import_is_reversible_and_survives_later_measurements(tmp_path):
    from benchly.benches.models import Bench, BenchEnrichment
    from benchly.benches.repository import upsert_enrichment, upsert_inventory_benches
    from benchly.imagery.photo_source import seed_sources
    from benchly.imagery.photo_import import import_photo_checkpoint
    from benchly.imagery.photo_prediction import PHOTO_MODEL_VERSION, PHOTO_PROMPT_VERSION
    from benchly.imagery.photo_repository import save_photo_result

    checkpoint = tmp_path / "photos.sqlite"
    photos = open_database(checkpoint)
    create_photo_schema(photos)
    seed_sources(photos, [{"id": 42, "geometry": {"coordinates": [7.68, 46.68]},
                           "properties": {"mainImagePath": "/comments/9/image"}}])
    save_photo_result(photos, 42, 9, {
        "status": "analyzed", "prediction": prediction(long_view_probability=.99).model_dump_json(),
        "image_sha256": "a" * 64, "model_version": PHOTO_MODEL_VERSION, "prompt_version": PHOTO_PROMPT_VERSION,
    })
    photos.commit()
    production = open_database(tmp_path / "production.sqlite")
    production.create_tables([Bench, BenchEnrichment])
    upsert_inventory_benches(production, [{"id": "bench-a", "osm_type": "node", "osm_id": 1,
        "latitude": 46.68, "longitude": 7.68, "source_updated_at": "now", "imported_at": "now"}], False)
    upsert_enrichment(production, {"bench_row_id": 1, "view_labels": '["Eingeschränkte Aussicht"]',
                                   "sun_confidence": "hoch", "view_confidence": "mittel", "land_context": "unknown"})
    production.commit()
    assert import_photo_checkpoint(production, checkpoint)["photo_benches"] == 1
    assert not production.execute("SELECT 1 FROM sqlite_master WHERE name='bank_photo_evidence'").fetchone()
    import_photo_checkpoint(production, checkpoint, apply=True)
    row = production.execute("SELECT * FROM bench_enrichments").fetchone()
    assert set(json.loads(row["view_labels"])) == {"Seeblick", "Weitsicht"}
    assert row["land_context"] == "park" and row["sun_confidence"] == "hoch"
    first = production.execute("SELECT base_enrichment FROM bank_photo_evidence").fetchone()[0]
    import_photo_checkpoint(production, checkpoint, apply=True)
    assert production.execute("SELECT base_enrichment FROM bank_photo_evidence").fetchone()[0] == first
    # A stricter rule must recalculate the cached signals from observations;
    # merely stamping a new rule version would keep an old false Weitsicht.
    save_photo_result(production, 42, 9, {"prediction": prediction(long_view_probability=.9,
        mountain_probability=.95).model_dump_json()})
    production.execute("UPDATE bank_photo_evidence SET rule_version='bank-photo-fusion-v2'")
    production.commit()
    upsert_enrichment(production, {"bench_row_id": 1, "elevation_meters": 500})
    assert "Weitsicht" not in production.execute("SELECT view_labels FROM bench_enrichments").fetchone()[0]
    evidence = production.execute("SELECT rule_version,signals FROM bank_photo_evidence").fetchone()
    assert evidence[0] == "bank-photo-fusion-v5" and not json.loads(evidence[1])["long_view"]
    import_photo_checkpoint(production, checkpoint, apply=True)
    upsert_enrichment(production, {"bench_row_id": 1, "land_context": "forest", "view_labels": '["Hügelblick"]'})
    assert "Weitsicht" in production.execute("SELECT view_labels FROM bench_enrichments").fetchone()[0]
    save_photo_result(photos, 42, 9, {"prediction": prediction(usable=False, perspective="closeup").model_dump_json()})
    photos.commit()
    import_photo_checkpoint(production, checkpoint, apply=True)
    row = production.execute("SELECT * FROM bench_enrichments").fetchone()
    assert json.loads(row["view_labels"]) == ["Hügelblick"]
    assert row["land_context"] == "forest" and row["sun_confidence"] == "hoch"
    # A later, current official profile must retain its lake classification if
    # a photograph makes the model call that lake a river.
    from benchly.settings import PROFILE_PIPELINE_VERSION
    upsert_enrichment(production, {"bench_row_id": 1, "view_labels": '["Seeblick"]',
        "pipeline_version": PROFILE_PIPELINE_VERSION, "context_source_version": "swissTLM3D:current + GeoAdmin"})
    production.commit()
    save_photo_result(photos, 42, 9, {"prediction": prediction(water_type="river", water_confidence=.99,
        long_view_probability=0, mountain_probability=0).model_dump_json()})
    photos.commit()
    import_photo_checkpoint(production, checkpoint, apply=True)
    assert json.loads(production.execute("SELECT view_labels FROM bench_enrichments").fetchone()[0]) == ["Seeblick"]
    photos.close()
    production.close()


def test_identical_photo_only_conflicts_when_valid_sources_are_distant():
    from benchly.imagery.photo_matching import photo_location_conflicts

    sources = [{"source_id": 1, "latitude": 46.68, "longitude": 7.68},
               {"source_id": 2, "latitude": 46.6801, "longitude": 7.68},
               {"source_id": 3, "latitude": 47, "longitude": 7.68},
               {"source_id": 4, "latitude": 47, "longitude": 190807}]
    def photo(source_id, image_hash="a" * 64, status="analyzed"):
        return {"source_id": source_id, "image_sha256": image_hash, "status": status}

    nearby = [photo(1), photo(1), photo(2), photo(4), photo(3, status="failed")]
    assert photo_location_conflicts(sources, nearby) == {}
    assert photo_location_conflicts(sources, [*nearby, photo(3, "b" * 64)]) == {}
    conflicts = photo_location_conflicts(sources, [*nearby, photo(3)])
    assert conflicts["a" * 64]["source_ids"] == [1, 2, 3]
    assert conflicts["a" * 64]["separation_meters"] > 100


def test_visual_review_survives_reimport_and_refresh_without_rewriting_observation(tmp_path):
    from benchly.benches.models import Bench, BenchEnrichment
    from benchly.benches.repository import upsert_enrichment, upsert_inventory_benches
    from benchly.imagery.photo_source import seed_sources
    from benchly.imagery.photo_import import import_photo_checkpoint
    from benchly.imagery.photo_prediction import PHOTO_MODEL_VERSION, PHOTO_PROMPT_VERSION
    from benchly.imagery.photo_repository import save_photo_result
    from benchly.imagery.photo_reviews import save_photo_review

    checkpoint = tmp_path / "review-photos.sqlite"
    photos = open_database(checkpoint)
    create_photo_schema(photos)
    seed_sources(photos, [{"id": 42, "geometry": {"coordinates": [7.68, 46.68]},
                           "properties": {"mainImagePath": "/comments/9/image"}}])
    raw = prediction(long_view_probability=.99).model_dump_json()
    save_photo_result(photos, 42, 9, {"status": "analyzed", "prediction": raw,
        "image_sha256": "a" * 64, "model_version": PHOTO_MODEL_VERSION, "prompt_version": PHOTO_PROMPT_VERSION})
    photos.commit()
    production = open_database(tmp_path / "review-production.sqlite")
    production.create_tables([Bench, BenchEnrichment])
    upsert_inventory_benches(production, [{"id": "bench-a", "osm_type": "node", "osm_id": 1,
        "latitude": 46.68, "longitude": 7.68, "source_updated_at": "now", "imported_at": "now"}], False)
    upsert_enrichment(production, {"bench_row_id": 1, "view_labels": '["Hügelblick"]', "land_context": "unknown"})
    production.commit()
    import_photo_checkpoint(production, checkpoint, apply=True)
    review = {"image_sha256": "a" * 64, "exclude_view": True,
              "reason": "Front-facing close crop does not establish the inferred distant view",
              "reviewed_at": "2026-09-09T10:00:00+00:00"}
    assert import_photo_checkpoint(production, checkpoint, reviews=[review])["long_views"] == 0
    assert "Weitsicht" in production.execute("SELECT view_labels FROM bench_enrichments").fetchone()[0]
    with pytest.raises(ValueError, match="Duplicate"):
        import_photo_checkpoint(production, checkpoint, reviews=[review, review])
    save_photo_review(production, review)
    upsert_enrichment(production, {"bench_row_id": 1, "elevation_meters": 500})
    row = production.execute("SELECT * FROM bench_enrichments").fetchone()
    assert json.loads(row["view_labels"]) == ["Hügelblick"]
    assert row["land_context"] == "park"  # Independent land evidence survives.
    import_photo_checkpoint(production, checkpoint, apply=True, reviews=[review])
    assert json.loads(production.execute("SELECT view_labels FROM bench_enrichments").fetchone()[0]) == ["Hügelblick"]
    assert production.execute("SELECT prediction FROM bank_photo_observations").fetchone()[0] == raw
    assert production.execute("SELECT count(*) FROM bank_photo_reviews").fetchone()[0] == 1
    # New measurements are protected; a reviewed photograph supplies no view.
    upsert_enrichment(production, {"bench_row_id": 1, "view_labels": '["Weitsicht","Bergblick"]'})
    import_photo_checkpoint(production, checkpoint, apply=True)
    assert set(json.loads(production.execute("SELECT view_labels FROM bench_enrichments").fetchone()[0])) == {"Weitsicht", "Bergblick"}
    # Replacement bytes at the same URL are independent of the old review.
    save_photo_result(photos, 42, 9, {"image_sha256": "b" * 64})
    photos.commit()
    import_photo_checkpoint(production, checkpoint, apply=True)
    assert "Seeblick" in production.execute("SELECT view_labels FROM bench_enrichments").fetchone()[0]
    with pytest.raises(ValueError, match="unknown photo"):
        save_photo_review(production, review)
    photos.close()
    production.close()


def test_distant_duplicate_retracts_view_and_preserves_independent_photos(tmp_path):
    from benchly.benches.models import Bench, BenchEnrichment
    from benchly.benches.repository import upsert_enrichment, upsert_inventory_benches
    from benchly.imagery.photo_source import seed_sources
    from benchly.imagery.photo_import import import_photo_checkpoint
    from benchly.imagery.photo_prediction import PHOTO_MODEL_VERSION, PHOTO_PROMPT_VERSION
    from benchly.imagery.photo_repository import discover_photo, save_photo_result

    checkpoint = tmp_path / "duplicate-photos.sqlite"
    photos = open_database(checkpoint)
    create_photo_schema(photos)
    seed_sources(photos, [
        {"id": 42, "geometry": {"coordinates": [7.68, 46.68]}, "properties": {}},
        {"id": 84, "geometry": {"coordinates": [8.68, 47.68]}, "properties": {}},
    ])
    def save(database, source_id, image_id, image_hash):
        discover_photo(database, image_record(source_id, f"/comments/{image_id}/image"))
        save_photo_result(database, source_id, image_id, {
            "status": "analyzed", "prediction": prediction(long_view_probability=.99).model_dump_json(),
            "image_sha256": image_hash, "model_version": PHOTO_MODEL_VERSION, "prompt_version": PHOTO_PROMPT_VERSION,
        })
        database.commit()

    save(photos, 42, 9, "a" * 64)
    production = open_database(tmp_path / "duplicate-production.sqlite")
    production.create_tables([Bench, BenchEnrichment])
    upsert_inventory_benches(production, [
        {"id": "bench-a", "osm_type": "node", "osm_id": 1, "latitude": 46.68, "longitude": 7.68,
         "source_updated_at": "now", "imported_at": "now"},
        {"id": "bench-b", "osm_type": "node", "osm_id": 2, "latitude": 47.68, "longitude": 8.68,
         "source_updated_at": "now", "imported_at": "now"},
    ], False)
    upsert_enrichment(production, {"bench_row_id": 1, "view_labels": '["Eingeschränkte Aussicht"]'})
    production.commit()
    import_photo_checkpoint(production, checkpoint, apply=True)
    assert "Weitsicht" in production.execute("SELECT view_labels FROM bench_enrichments WHERE bench_row_id=1").fetchone()[0]

    save(photos, 84, 10, "a" * 64)
    # A normal geometric refresh during a rule upgrade must also look beyond
    # this bench and discover the same content at the other source location.
    save(production, 84, 10, "a" * 64)
    production.execute("UPDATE bank_photo_evidence SET rule_version='bank-photo-fusion-v3'")
    production.commit()
    upsert_enrichment(production, {"bench_row_id": 1, "elevation_meters": 500})
    assert json.loads(production.execute("SELECT view_labels FROM bench_enrichments WHERE bench_row_id=1").fetchone()[0]) == ["Eingeschränkte Aussicht"]

    stats = import_photo_checkpoint(production, checkpoint, apply=True)
    assert stats["location_conflict_hashes"] == 1 and stats["location_conflict_photos"] == 2
    assert stats["usable_photo_benches"] == 0
    assert production.execute("SELECT count(*) FROM bank_photo_observations WHERE status='analyzed'").fetchone()[0] == 2
    for row in production.execute("SELECT signals FROM bank_photo_evidence"):
        signals = json.loads(row[0])
        assert signals["photos"] == [] and len(signals["location_conflicts"]) == 1

    save(photos, 42, 11, "b" * 64)
    import_photo_checkpoint(production, checkpoint, apply=True)
    evidence = json.loads(production.execute("SELECT signals FROM bank_photo_evidence WHERE bench_row_id=1").fetchone()[0])
    assert evidence["photos"] == [{"source_id": 42, "image_id": 11}]
    assert "Weitsicht" in production.execute("SELECT view_labels FROM bench_enrichments WHERE bench_row_id=1").fetchone()[0]
    assert "Weitsicht" not in (production.execute("SELECT view_labels FROM bench_enrichments WHERE bench_row_id=2").fetchone()[0] or "")
    photos.close()
    production.close()


def test_photo_discovery_uses_source_comment_ids_not_arbitrary_urls():
    calls = []

    def request(url):
        calls.append(url)
        return [
            {"id": 9, "creation": 1700000000000, "restIconPath": "/comments/9/image",
             "text": "private text", "user": {"id": "private user"}},
            {"id": 10, "restIconPath": "https://unrelated.test/image"},
            {"id": 11, "restIconPath": "/comments/11/image/../../secret"},
        ]

    photos = discover_source_photos(42, request)
    assert len(photos) == 1
    assert photos[0]["source_id"] == 42 and photos[0]["image_id"] == 9
    assert photos[0]["captured_at"] is None  # Upload time is not capture time.
    assert "private" not in json.dumps(photos)
    assert calls == ["https://photos.example/bench/42/comments?count=100"]
    assert image_record(1, "//attacker.test/comments/2/image") is None


def test_analysis_resumes_without_downloading_completed_photos_or_storing_bytes(tmp_path, monkeypatch):
    from benchly.imagery.photo_source import seed_sources
    output = tmp_path / "observations.sqlite"
    db = open_database(output)
    create_photo_schema(db)
    seed_sources(db, [{"id": 42, "geometry": {"coordinates": [7.68, 46.68]}, "properties": {
        "mainImagePath": "/comments/9/image?big=true", "mainText": "not retained",
        "founder": {"id": "not retained"}, "location": "PARK",
    }}])
    db.close()
    args = Namespace(output=output, index=None, model="test", source_ids=None,
                     discover_comments=False, max_attempts=3, limit=0)
    monkeypatch.setenv("INFERENCE_API_KEY", "test-key")
    with patch("benchly.imagery.photo_source.download_image", return_value=(b"image-in-memory", "image/jpeg")) as download, \
         patch("benchly.imagery.photo_source.infer_bench_photo", return_value=prediction()):
        assert analyze_bank_photos(args)["analyzed"] == 1
        assert analyze_bank_photos(args)["analyzed"] == 0
        download.assert_called_once()
    db = open_database(output)
    row = db.execute("SELECT * FROM bank_photo_observations").fetchone()
    assert row["status"] == "analyzed" and len(row["image_sha256"]) == 64
    assert "image-in-memory" not in json.dumps(dict(row))
    assert "not retained" not in db.execute("SELECT source_metadata FROM bank_photo_sources").fetchone()[0]
    db.close()
    assert not list(tmp_path.glob("*.jpg"))


def test_failed_download_does_not_poison_the_next_photo(tmp_path, monkeypatch):
    from benchly.imagery.photo_source import seed_sources
    from benchly.imagery.photo_repository import discover_photo
    output = tmp_path / "observations.sqlite"
    db = open_database(output)
    create_photo_schema(db)
    seed_sources(db, [{"id": 42, "geometry": {"coordinates": [7.68, 46.68]}, "properties": {
        "mainImagePath": "/comments/9/image",
    }}])
    discover_photo(db, image_record(42, "/comments/10/image"))
    db.commit()
    db.close()
    args = Namespace(output=output, index=None, model="test", source_ids=None,
                     discover_comments=False, max_attempts=3, limit=0)
    monkeypatch.setenv("INFERENCE_API_KEY", "test-key")
    def download(url):
        if "/9/" in url:
            raise ValueError("missing image")
        return b"second-photo", "image/jpeg"
    with patch("benchly.imagery.photo_source.download_image", side_effect=download), \
         patch("benchly.imagery.photo_source.infer_bench_photo", return_value=prediction()):
        assert analyze_bank_photos(args) == {"analyzed": 1, "failed": 1, "discovered_sources": 0}


def test_dense_bench_groups_do_not_get_arbitrary_photo_assignments():
    from benchly.imagery.photo_matching import match_photo_sources
    source = {"source_id": 42, "latitude": 46.688, "longitude": 7.686}
    nearby = [
        {"id": "one", "latitude": 46.68802, "longitude": 7.686},
        {"id": "two", "latitude": 46.68798, "longitude": 7.686},
    ]
    assert match_photo_sources([source], nearby)[42]["match_method"] == "ambiguous"
    exact = {"id": "source-bench", "latitude": source["latitude"], "longitude": source["longitude"]}
    assert match_photo_sources([source], [exact, *nearby])[42]["bench_id"] == "source-bench"
    assert match_photo_sources([source], [nearby[0]])[42]["match_method"] == "unique_within_5m"
    assert match_photo_sources([source], [{"id": "distant", "latitude": 46.6881, "longitude": 7.686}])[42]["bench_id"] is None


def test_prefetched_discovery_keeps_photo_content_attached_to_its_source(tmp_path, monkeypatch):
    import hashlib
    from threading import Event
    from benchly.imagery.photo_source import seed_sources
    output = tmp_path / "prefetched.sqlite"
    db = open_database(output)
    create_photo_schema(db)
    seed_sources(db, [{"id": source, "geometry": {"coordinates": [7.68, 46.68]}, "properties": {}}
                      for source in [42, 43]])
    db.close()
    args = Namespace(output=output, index=None, model="test", source_ids=None,
                     discover_comments=True, max_attempts=3, limit=0)
    monkeypatch.setenv("INFERENCE_API_KEY", "test-key")
    next_photo_ready = Event()
    def download(url):
        if "/430/" in url:
            next_photo_ready.set()
        return url.encode(), "image/jpeg"
    def infer(image, *_args):
        if b"/420/" in image[0]:
            assert next_photo_ready.wait(2), "The next source image should load during this inference"
        return prediction()
    with patch("benchly.imagery.photo_source.discover_source_photos",
               side_effect=lambda source: [image_record(source, f"/comments/{source * 10}/image")]), \
         patch("benchly.imagery.photo_source.download_image", side_effect=download), \
         patch("benchly.imagery.photo_source.infer_bench_photo", side_effect=infer):
        assert analyze_bank_photos(args) == {"analyzed": 2, "failed": 0, "discovered_sources": 2}
    db = open_database(output)
    for row in db.execute("SELECT * FROM bank_photo_observations"):
        assert row["image_id"] == row["source_id"] * 10
        assert row["image_sha256"] == hashlib.sha256(row["fetch_url"].encode()).hexdigest()
    db.close()
