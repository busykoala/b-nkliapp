"""Physical photo estimates are a separate publication, never canonical facts.

Only unique, current spatial matches and non-conflicting content hashes qualify.
Human review is blind to the prediction; raw model output is not a calibrated
probability. Until independent validation is sufficient, nothing is published.
"""
from __future__ import annotations
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
from typing import Optional
from sqlalchemy import delete
from sqlmodel import Field, SQLModel
from benchly.db import write
from benchly.geo import distance_meters
from benchly.knowledge.repository import compact, upsert
from benchly.runtime import now_iso

ATTRIBUTES = {"backrest": "backrest", "armrest": "armrests", "material": "material"}
MATERIALS = {"wood", "metal", "stone", "concrete", "plastic", "mixed"}
METHOD = "physical-photo-estimate-1"


class PhotoEstimate(SQLModel, table=True):
    __tablename__ = "bench_photo_estimates"
    bench_row_id: int = Field(primary_key=True)
    attribute: str = Field(primary_key=True)
    value_json: Optional[str] = None
    status: str
    image_hashes_json: str
    model_version: str
    prompt_version: str
    captured_at: Optional[str] = None
    assessed_at: str
    validation_samples: int
    method_version: str
    latitude: float
    longitude: float


class PhysicalReview(SQLModel, table=True):
    __tablename__ = "photo_physical_reviews"
    image_sha256: str = Field(primary_key=True)
    reviewer: str = Field(primary_key=True)
    labels_json: str
    reviewed_at: str


def prediction_value(prediction, attribute):
    value = prediction.get(ATTRIBUTES[attribute])
    if attribute == "material":
        return value if value in MATERIALS else None
    return value if isinstance(value, bool) else None


def wilson_lower(correct, total):
    if not total:
        return 0
    p, z = correct / total, 1.96
    return (p + z*z/(2*total) - z*math.sqrt(p*(1-p)/total + z*z/(4*total*total))) / (1+z*z/total)


def validation(database):
    groups = defaultdict(list)
    rows = database.execute("""SELECT o.image_sha256,o.prediction,o.model_version,o.prompt_version,s.bench_id,
        r.reviewer,r.labels_json FROM photo_physical_reviews r JOIN bank_photo_observations o ON o.image_sha256=r.image_sha256
        JOIN bank_photo_sources s ON s.source_id=o.source_id WHERE o.status='analyzed' AND s.bench_id IS NOT NULL""").fetchall()
    reviews = defaultdict(dict)
    for row in rows:
        key = (row["model_version"], row["prompt_version"], row["image_sha256"])
        reviews[key][row["reviewer"]] = row
    seen_benches = set()
    for (model, prompt, image_hash), reviewers in sorted(reviews.items()):
        row = next(iter(reviewers.values()))
        prediction = json.loads(row["prediction"] or "{}")
        labels = [json.loads(review["labels_json"]) for review in reviewers.values()]
        for attribute in ATTRIBUTES:
            values = {compact(label.get(attribute)) for label in labels if label.get(attribute) is not None}
            predicted = prediction_value(prediction, attribute)
            key = (model, prompt, attribute, row["bench_id"])
            if len(values) != 1 or predicted is None or key in seen_benches:
                continue
            seen_benches.add(key)  # repeated photographs of a bench are not independent validation cases
            groups[model, prompt, attribute].append((predicted, compact(predicted) == next(iter(values))))
    result = {}
    for key, examples in groups.items():
        counts = Counter(compact(value) for value, _ in examples)
        correct = sum(correct for _, correct in examples)
        enough_classes = len(counts) >= (2 if key[2] != "material" else 3) and min(counts.values()) >= 5
        accepted = len(examples) >= 30 and enough_classes and wilson_lower(correct, len(examples)) >= .8
        result[key] = {"samples": len(examples), "accepted": accepted, "accuracy": correct / len(examples), "wilson_lower": wilson_lower(correct, len(examples))}
    return result


class PhysicalEstimates:
    def __init__(self, database):
        self.available = bool(database.execute("SELECT 1 FROM sqlite_master WHERE name='bank_photo_observations'").fetchone())
        self.validation = validation(database) if self.available else {}

    def enrich(self, database, bench):
        if not self.available:
            return
        rows = database.execute("""SELECT o.*,s.latitude source_latitude,s.longitude source_longitude,s.match_method,s.match_distance_meters
            FROM bank_photo_sources s JOIN bank_photo_observations o ON o.source_id=s.source_id
            WHERE s.bench_id=? AND o.status='analyzed' AND o.image_sha256 IS NOT NULL""", (bench["id"],)).fetchall()
        candidates = defaultdict(list)
        for row in rows:
            if row["match_method"] not in {"source_coordinate", "unique_within_5m"} or row["match_distance_meters"] is None or row["match_distance_meters"] > 5:
                continue
            if distance_meters(row["source_latitude"], row["source_longitude"], bench["latitude"], bench["longitude"]) > 5:
                continue
            neighbours = database.execute("""SELECT b.id,b.latitude,b.longitude FROM bench_spatial_index s JOIN benches b ON b.row_id=s.row_id
                WHERE b.active=1 AND s.min_longitude<=? AND s.max_longitude>=? AND s.min_latitude<=? AND s.max_latitude>=?""",
                (row["source_longitude"]+.00008, row["source_longitude"]-.00008, row["source_latitude"]+.00005, row["source_latitude"]-.00005)).fetchall()
            nearby = [(distance_meters(row["source_latitude"], row["source_longitude"], item["latitude"], item["longitude"]), item["id"]) for item in neighbours]
            exact = [item for item in nearby if item[0] < .1]
            within = [item for item in nearby if item[0] <= 5]
            unique = exact if exact else within
            if len(unique) != 1 or unique[0][1] != bench["id"]:
                continue
            other = database.execute("""SELECT 1 FROM bank_photo_observations o JOIN bank_photo_sources s ON s.source_id=o.source_id
                WHERE o.image_sha256=? AND (s.bench_id IS NULL OR s.bench_id!=?) LIMIT 1""", (row["image_sha256"], bench["id"])).fetchone()
            if other:
                continue
            prediction = json.loads(row["prediction"] or "{}")
            if prediction.get("bench_visible") is not True:
                continue
            # Close-ups are valid physical evidence even when unsuitable for views.
            for attribute in ATTRIBUTES:
                value = prediction_value(prediction, attribute)
                if value is not None:
                    candidates[attribute].append((value, row))
        write(database, delete(PhotoEstimate).where(PhotoEstimate.bench_row_id == bench["row_id"]))
        for attribute, items in candidates.items():
            distinct = {compact(value) for value, _ in items}
            versions = {(row["model_version"], row["prompt_version"]) for _, row in items}
            model, prompt = sorted(versions, key=str)[-1]
            checked = self.validation.get((model, prompt, attribute), {})
            conflict = len(distinct) != 1 or len(versions) != 1
            # A confirmed contrary attribute suppresses the estimate as well.
            for state in database.execute("SELECT value_json,conflicting FROM bench_attribute_state WHERE bench_row_id=? AND attribute=?", (bench["row_id"], attribute)):
                if state["conflicting"] or (state["value_json"] is not None and json.loads(state["value_json"]) != items[0][0]):
                    conflict = True
            dates = [row["captured_at"] for _, row in items if row["captured_at"]]
            upsert(database, PhotoEstimate, dict(bench_row_id=bench["row_id"], attribute=attribute,
                value_json=next(iter(distinct)) if len(distinct) == 1 else None,
                status="conflicting" if conflict else "eligible" if checked.get("accepted") else "unvalidated",
                image_hashes_json=compact(sorted({row["image_sha256"] for _, row in items})), model_version=model or "unknown",
                prompt_version=prompt or "unknown", captured_at=max(dates) if dates else None, assessed_at=now_iso(),
                validation_samples=checked.get("samples", 0), method_version=METHOD, latitude=bench["latitude"], longitude=bench["longitude"]),
                ["bench_row_id", "attribute"])


def export_review_queue(database, output: Path, limit=100):
    # Keep this operator file outside Git: it contains original image locations.
    rows = database.execute("""SELECT o.image_sha256,o.fetch_url,s.bench_id,s.latitude,s.longitude FROM bank_photo_observations o
        JOIN bank_photo_sources s ON s.source_id=o.source_id WHERE o.status='analyzed' AND s.bench_id IS NOT NULL
        AND json_extract(o.prediction,'$.bench_visible')=1 AND NOT EXISTS(SELECT 1 FROM photo_physical_reviews r WHERE r.image_sha256=o.image_sha256)
        GROUP BY o.image_sha256 ORDER BY o.image_sha256 LIMIT ?""", (limit,)).fetchall()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("".join(json.dumps({**dict(row), "labels": {key: None for key in ATTRIBUTES}}, ensure_ascii=False)+"\n" for row in rows))
    return len(rows)


def import_reviews(database, path: Path, reviewer: str):
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    for row in rows:
        labels = row["labels"]
        if set(labels) != set(ATTRIBUTES) or any(value is not None and (value not in MATERIALS if key == "material" else not isinstance(value, bool)) for key, value in labels.items()):
            raise ValueError("Review labels must be explicit booleans/material or unknown (null)")
        if not database.execute("SELECT 1 FROM bank_photo_observations WHERE image_sha256=? AND status='analyzed'", (row["image_sha256"],)).fetchone():
            raise ValueError("Review hash does not identify analyzed image bytes")
    for row in rows:
        upsert(database, PhysicalReview, dict(image_sha256=row["image_sha256"], reviewer=reviewer, labels_json=compact(row["labels"]), reviewed_at=now_iso()), ["image_sha256", "reviewer"])
    from benchly.knowledge.progress import source_changed
    source_changed(database)
    database.commit()
    return len(rows)


def review_job(args):
    from benchly.db import connect_database
    database = connect_database(Path(args.database))
    try:
        if args.export:
            print(json.dumps({"queued": export_review_queue(database, Path(args.export), args.limit)}))
        else:
            if not args.reviewer:
                raise ValueError("--reviewer must identify the independent human reviewer")
            print(json.dumps({"reviewed": import_reviews(database, Path(args.import_reviews), args.reviewer),
                "validation": {":".join(key): value for key, value in validation(database).items()}}))
    finally:
        database.close()
