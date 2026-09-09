"""Validate a local photo checkpoint, rematch identities, and publish evidence."""

from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sqlite3

from benchly.benches.repository import upsert_enrichment
from benchly.imagery.photo_source import image_record, photo_source_base_url
from benchly.imagery.photo_evidence import PHOTO_RULE_VERSION, photo_signals
from benchly.imagery.photo_matching import match_photo_sources, photo_location_conflicts
from benchly.imagery.photo_models import BankPhotoObservation, BankPhotoSource
from benchly.imagery.photo_prediction import PHOTO_MODEL_VERSION, PHOTO_PROMPT_VERSION, BenchPhotoPrediction
from benchly.imagery.photo_repository import (
    create_photo_schema, discover_photo, save_photo_evidence, save_photo_result, save_source,
)
from benchly.imagery.photo_reviews import read_photo_reviews, save_photo_review, validate_photo_review
from benchly.runtime import now_iso


def read_photo_checkpoint(path):
    """Read data through explicit tables; never execute a supplied SQL dump."""
    base_url = photo_source_base_url()
    with sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True) as checkpoint:
        checkpoint.row_factory = sqlite3.Row
        sources = [BankPhotoSource.model_validate(dict(row)).model_dump() for row in
                   checkpoint.execute("SELECT * FROM bank_photo_sources")]
        photos = [BankPhotoObservation.model_validate(dict(row)).model_dump() for row in
                  checkpoint.execute("SELECT * FROM bank_photo_observations")]
    source_ids = {source["source_id"] for source in sources}
    for source in sources:
        # Out-of-range coordinates are retained as quarantined source evidence.
        # The matcher rejects them before doing any spherical arithmetic.
        if source["source_url"] != f"{base_url}/bench/{source['source_id']}":
            raise ValueError("invalid photo source URL")
        metadata = json.loads(source["source_metadata"])
        if not isinstance(metadata, dict) or set(metadata) - {
            "sight", "location", "infrastructure", "accessibility", "canton", "commune",
        }:
            raise ValueError("unexpected photo source metadata")
    for photo in photos:
        expected = image_record(photo["source_id"], f"/comments/{photo['image_id']}/image")
        if photo["source_id"] not in source_ids or photo["fetch_url"] != expected["fetch_url"]:
            raise ValueError("photo has no valid source or URL")
        if photo["status"] not in {"pending", "failed", "analyzed"}:
            raise ValueError("invalid photo status")
        if photo["status"] == "analyzed":
            BenchPhotoPrediction.model_validate_json(photo["prediction"])
            if not re.fullmatch(r"[0-9a-f]{64}", photo["image_sha256"] or ""):
                raise ValueError("analyzed photo is missing its source content hash")
    return sources, photos


def import_photo_checkpoint(database, checkpoint, *, apply=False, reviews=()):
    sources, photos = read_photo_checkpoint(checkpoint)
    benches = [dict(row) for row in database.execute(
        "SELECT row_id,id,latitude,longitude FROM benches WHERE active=1")]
    matches = match_photo_sources(sources, benches)
    stats = dict(Counter(match["match_method"] for match in matches.values()))
    stats.update(sources=len(sources), photos=len(photos), analyzed=sum(p["status"] == "analyzed" for p in photos))
    source_by_id = {s["source_id"]: s for s in sources}
    location_conflicts = photo_location_conflicts(sources, photos)
    stats.update(location_conflict_hashes=len(location_conflicts),
                 location_conflict_photos=sum(p["image_sha256"] in location_conflicts for p in photos))
    grouped = defaultdict(list)
    for photo in photos:
        bench_id = matches[photo["source_id"]]["bench_id"]
        if (bench_id and photo["status"] == "analyzed" and photo["model_version"] == PHOTO_MODEL_VERSION
                and photo["prompt_version"] == PHOTO_PROMPT_VERSION):
            grouped[bench_id].append({**photo, "source_metadata": source_by_id[photo["source_id"]]["source_metadata"]})
    review_updates = [validate_photo_review(row).model_dump() for row in reviews]
    analyzed_hashes = {p["image_sha256"] for p in photos if p["status"] == "analyzed"}
    if any(row["image_sha256"] not in analyzed_hashes for row in review_updates):
        raise ValueError("A review must refer to an analyzed photo in this checkpoint")
    if len({row["image_sha256"] for row in review_updates}) != len(review_updates):
        raise ValueError("Duplicate photo review")
    view_reviews = {**read_photo_reviews(database), **{row["image_sha256"]: row for row in review_updates}}
    signals = {bench_id: photo_signals(rows, location_conflicts=location_conflicts, view_reviews=view_reviews)
               for bench_id, rows in grouped.items()}
    stats.update(photo_benches=len(grouped), usable_photo_benches=sum(bool(s["photos"]) for s in signals.values()),
                 water_views=sum(bool(s["water_type"]) for s in signals.values()),
                 long_views=sum(s["long_view"] for s in signals.values()),
                 mountain_photo_candidates=sum(s["mountain"] for s in signals.values()))
    if not apply:
        return stats
    create_photo_schema(database)
    # Commit checkpoints in bounded batches. Each projection and its baseline
    # are subsequently updated together in the same transaction.
    for index, source in enumerate(sources):
        save_source(database, {**source, **matches[source["source_id"]]})
        if index % 500 == 0:
            database.commit()
    for index, photo in enumerate(photos):
        discover_photo(database, photo)
        save_photo_result(database, photo["source_id"], photo["image_id"], photo)
        if index % 500 == 0:
            database.commit()
    database.commit()
    for review in review_updates:
        save_photo_review(database, review)
    prior = {row["bench_id"] for row in database.execute("SELECT bench_id FROM bank_photo_evidence")}
    by_id = {bench["id"]: bench for bench in benches}
    for index, bench_id in enumerate(sorted(set(grouped) | prior)):
        bench = by_id.get(bench_id)
        if not bench:
            continue
        save_photo_evidence(database, {
            "bench_row_id": bench["row_id"], "bench_id": bench_id,
            "bench_latitude": bench["latitude"], "bench_longitude": bench["longitude"],
            "signals": json.dumps(signals.get(bench_id, {})), "observation_count": len(grouped.get(bench_id, [])),
            "model_version": PHOTO_MODEL_VERSION, "prompt_version": PHOTO_PROMPT_VERSION,
            "rule_version": PHOTO_RULE_VERSION, "evaluated_at": now_iso(),
        })
        upsert_enrichment(database, {"bench_row_id": bench["row_id"]})
        if index % 100 == 0:
            database.commit()
    database.commit()
    return stats


def import_photo_checkpoint_job(args):
    from benchly.db import connect_database
    from benchly.runs.repository import begin_run, finish_run

    database = connect_database(Path(args.database).resolve())
    run_id = begin_run(database, "import-bank-photo-evidence", PHOTO_MODEL_VERSION) if args.apply else None
    try:
        reviews = json.loads(args.reviews.read_text()) if args.reviews else []
        stats = import_photo_checkpoint(database, args.input, apply=args.apply, reviews=reviews)
        if run_id is not None:
            finish_run(database, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        database.rollback()
        if run_id is not None:
            finish_run(database, run_id, "failed", {"error": str(error)})
        raise
    finally:
        database.close()
