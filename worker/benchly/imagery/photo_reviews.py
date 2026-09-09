"""Persistent, content-bound visual review without altering model observations."""

from datetime import datetime
import re

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy import select, update

from benchly.db import write
from benchly.imagery.photo_models import BankPhotoReview, BankPhotoEvidence, BankPhotoObservation, BankPhotoSource


def read_photo_reviews(database):
    if not database.execute("SELECT 1 FROM sqlite_master WHERE name='bank_photo_reviews'").fetchone():
        return {}
    return {row["image_sha256"]: dict(row) for row in database.execute("SELECT * FROM bank_photo_reviews")}


def validate_photo_review(values):
    review = BankPhotoReview.model_validate(values)
    if not re.fullmatch(r"[0-9a-f]{64}", review.image_sha256) or not review.reason.strip():
        raise ValueError("A review requires an original content hash and reason")
    if datetime.fromisoformat(review.reviewed_at).tzinfo is None:
        raise ValueError("A review requires a timezone-aware timestamp")
    return review


def save_photo_review(database, values):
    """Caller holds the worker lock and commits the review with its projection."""
    review = validate_photo_review(values)
    if not database.execute(
        "SELECT 1 FROM bank_photo_observations WHERE image_sha256=? AND status='analyzed'",
        (review.image_sha256,),
    ).fetchone():
        raise ValueError("Cannot review an unknown photo")
    statement = insert(BankPhotoReview).values(review.model_dump())
    write(database, statement.on_conflict_do_update(
        index_elements=[BankPhotoReview.image_sha256],
        set_={key: getattr(statement.excluded, key) for key in ("exclude_view", "reason", "reviewed_at")},
    ))
    # The next ordinary upsert must re-evaluate even when the fusion rule did
    # not change. Re-importing the original checkpoint cannot remove this review.
    affected_benches = select(BankPhotoSource.bench_id).join(
        BankPhotoObservation, BankPhotoObservation.source_id == BankPhotoSource.source_id,
    ).where(BankPhotoObservation.image_sha256 == review.image_sha256)
    write(database, update(BankPhotoEvidence).where(
        BankPhotoEvidence.bench_id.in_(affected_benches),
    ).values(rule_version="review-pending"))
