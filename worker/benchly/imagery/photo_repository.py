"""Typed persistence for source-linked photo analysis."""

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy import update
from sqlalchemy.schema import CreateIndex

from benchly.db import write
from benchly.imagery.photo_models import BankPhotoEvidence, BankPhotoObservation, BankPhotoSource, BankPhotoReview


def create_photo_schema(database):
    database.create_tables([BankPhotoSource, BankPhotoObservation, BankPhotoEvidence, BankPhotoReview])
    for model in (BankPhotoSource, BankPhotoObservation):
        for index in model.__table__.indexes:
            write(database, CreateIndex(index, if_not_exists=True))
    database.commit()


def save_source(database, values):
    source = BankPhotoSource.model_validate(values)
    statement = insert(BankPhotoSource).values(source.model_dump(exclude_unset=True))
    write(database, statement.on_conflict_do_update(
        index_elements=[BankPhotoSource.source_id],
        set_={key: getattr(statement.excluded, key) for key in values if key != "source_id"},
    ))


def discover_photo(database, values):
    photo = BankPhotoObservation.model_validate(values)
    statement = insert(BankPhotoObservation).values(photo.model_dump(exclude_unset=True))
    write(database, statement.on_conflict_do_nothing())


def save_photo_result(database, source_id, image_id, values):
    # Validate the complete row before accepting model output or a replayed result.
    current = database.execute(
        "SELECT * FROM bank_photo_observations WHERE source_id=? AND image_id=?",
        (source_id, image_id),
    ).fetchone()
    row = BankPhotoObservation.model_validate({**dict(current), **values})
    write(database, update(BankPhotoObservation).where(
        BankPhotoObservation.source_id == source_id,
        BankPhotoObservation.image_id == image_id,
    ).values(**row.model_dump(exclude={"source_id", "image_id"})))


def finish_photo_discovery(database, source_id, completed_at=None, error=None):
    write(database, update(BankPhotoSource).where(BankPhotoSource.source_id == source_id).values(
        comments_discovered_at=completed_at, discovery_error=error,
    ))


def save_photo_evidence(database, values):
    row = BankPhotoEvidence.model_validate(values)
    statement = insert(BankPhotoEvidence).values(row.model_dump(exclude_unset=True))
    write(database, statement.on_conflict_do_update(
        index_elements=[BankPhotoEvidence.bench_row_id],
        set_={key: getattr(statement.excluded, key) for key in values if key != "bench_row_id"},
    ))


def project_enrichment_with_photos(database, values):
    """Keep future geometric refreshes consistent with current photo evidence."""
    import json
    from benchly.imagery.photo_evidence import (
        PHOTO_RULE_VERSION, PROJECTED_FIELDS, photo_signals, project_photo_signals, retract_previous_projection,
    )
    from benchly.imagery.photo_prediction import PHOTO_MODEL_VERSION, PHOTO_PROMPT_VERSION
    from benchly.imagery.photo_matching import photo_location_conflicts
    from benchly.imagery.photo_reviews import read_photo_reviews
    from benchly.catalog import load_catalog
    from benchly.runtime import now_iso
    from benchly.settings import PROFILE_PIPELINE_VERSION

    if not database.execute("SELECT 1 FROM sqlite_master WHERE name='bank_photo_evidence'").fetchone():
        return values
    evidence = database.execute("""SELECT p.*,b.latitude,b.longitude,b.id AS current_bench_id
        FROM bank_photo_evidence p JOIN benches b ON b.row_id=p.bench_row_id
        WHERE p.bench_row_id=?""", (values["bench_row_id"],)).fetchone()
    if not evidence:
        return values
    current_row = database.execute("SELECT * FROM bench_enrichments WHERE bench_row_id=?", (values["bench_row_id"],)).fetchone()
    current = {key: current_row[key] if current_row else None for key in PROJECTED_FIELDS}
    if current["view_confidence"] is None:
        current["view_confidence"] = "niedrig"
    base = retract_previous_projection(current, json.loads(evidence["base_enrichment"] or "{}"),
                                       json.loads(evidence["applied_enrichment"] or "{}"))
    base.update({key: values[key] for key in PROJECTED_FIELDS if key in values})
    same_place = (evidence["current_bench_id"] == evidence["bench_id"]
                  and evidence["latitude"] == evidence["bench_latitude"]
                  and evidence["longitude"] == evidence["bench_longitude"])
    def latest(field):
        return values.get(field, current_row[field] if current_row and field in current_row.keys() else None)
    measured_water_type = None
    if (latest("pipeline_version") in {PROFILE_PIPELINE_VERSION, load_catalog().runtime.pipelineVersion}
            and str(latest("context_source_version") or "").startswith("swissTLM3D:")):
        labels = set(json.loads(base.get("view_labels") or "[]"))
        if "Seeblick" in labels and "Wasserblick" not in labels:
            measured_water_type = "lake"
        elif "Wasserblick" in labels and "Seeblick" not in labels:
            measured_water_type = "river"
    signals = json.loads(evidence["signals"]) if same_place else {}
    evidence_updates = {}
    if same_place and evidence["rule_version"] != PHOTO_RULE_VERSION:
        observations = database.execute("""SELECT p.*,s.source_metadata
            FROM bank_photo_observations p JOIN bank_photo_sources s ON s.source_id=p.source_id
            WHERE s.bench_id=? AND p.status='analyzed' AND p.model_version=? AND p.prompt_version=?
            ORDER BY p.source_id,p.image_id""",
            (evidence["bench_id"], PHOTO_MODEL_VERSION, PHOTO_PROMPT_VERSION)).fetchall()
        related = database.execute("""SELECT p.source_id,p.status,p.image_sha256,s.latitude,s.longitude
            FROM bank_photo_observations p JOIN bank_photo_sources s ON s.source_id=p.source_id
            WHERE p.status='analyzed' AND p.image_sha256 IN (
                SELECT p0.image_sha256 FROM bank_photo_observations p0
                JOIN bank_photo_sources s0 ON s0.source_id=p0.source_id
                WHERE s0.bench_id=? AND p0.status='analyzed' AND p0.model_version=? AND p0.prompt_version=?)""",
            (evidence["bench_id"], PHOTO_MODEL_VERSION, PHOTO_PROMPT_VERSION)).fetchall()
        signals = photo_signals(observations, location_conflicts=photo_location_conflicts(related, related),
                                view_reviews=read_photo_reviews(database))
        evidence_updates = {"signals": json.dumps(signals), "observation_count": len(observations),
                            "model_version": PHOTO_MODEL_VERSION, "prompt_version": PHOTO_PROMPT_VERSION,
                            "evaluated_at": now_iso()}
    applied = project_photo_signals(base, signals,
                                   measured_water_type=measured_water_type)
    write(database, update(BankPhotoEvidence).where(
        BankPhotoEvidence.bench_row_id == values["bench_row_id"],
    ).values(base_enrichment=json.dumps(base), applied_enrichment=json.dumps(applied),
             rule_version=PHOTO_RULE_VERSION if same_place else evidence["rule_version"], **evidence_updates))
    return {**values, **applied}
