"""Durable outcomes, input revisions and source/algorithm invalidation for backfills.

A processed outcome is not a claim that an attribute is known. The generation
includes source publication, algorithm versions, raster inputs and a weekly
refresh window; the per-bench revision tracks contributions and moves.
"""
from __future__ import annotations
import hashlib
from datetime import datetime, timezone
from sqlalchemy import update
from benchly.db import write
from benchly.knowledge.evidence import CATEGORIES
from benchly.knowledge.models import KnowledgeGeneration, KnowledgeOutcome
from benchly.knowledge.repository import compact, upsert
from benchly.runtime import now_iso

METHOD = "knowledge-2"


def source_changed(database):
    write(database, update(KnowledgeGeneration).where(KnowledgeGeneration.id == 1).values(revision=KnowledgeGeneration.revision + 1))


def source_revision(database):
    return database.execute("SELECT revision FROM knowledge_generation WHERE id=1").fetchone()[0]


def generation(database, terrain_inputs, noise):
    from benchly.knowledge import amenities, approaches, evidence, geography
    from benchly.knowledge.noise import METHOD as noise_method
    from benchly.imagery.physical_estimates import METHOD as photo_method
    return hashlib.sha256(compact({"method": METHOD, "sources": source_revision(database),
        "algorithms": [amenities.METHOD, approaches.METHOD, evidence.METHOD, geography.METHOD, noise_method, photo_method],
        "terrain": terrain_inputs, "noise": {f"{mode}:{period}": str(value[1]) for (mode, period), value in noise.datasets.items()},
        "week": datetime.now(timezone.utc).strftime("%G-%V")}).encode()).hexdigest()[:24]


def revision(database, row_id):
    row = database.execute("SELECT revision FROM bench_knowledge_revisions WHERE bench_row_id=?", (row_id,)).fetchone()
    return row[0] if row else 0


def outcomes(database, bench, work_generation, input_revision, error=None):
    previous = {row["category"]: row["attempts"] for row in database.execute(
        "SELECT category,attempts FROM bench_knowledge_outcomes WHERE bench_row_id=? AND generation=?", (bench["row_id"], work_generation))}
    completeness = {row["category"]: dict(row) for row in database.execute(
        "SELECT * FROM bench_completeness WHERE bench_row_id=?", (bench["row_id"],))}
    conflicts = {row[0] for row in database.execute("SELECT attribute FROM bench_attribute_state WHERE bench_row_id=? AND conflicting=1", (bench["row_id"],))}
    for category, attributes in CATEGORIES.items():
        value = completeness.get(category, {})
        known = value.get("known_count", 0)
        uncertain = value.get("uncertain_count", 0)
        status = "retryable_failure" if error else "missing_source" if known == 0 and not conflicts.intersection(attributes) else "unresolved" if uncertain or known < len(attributes) else "current"
        upsert(database, KnowledgeOutcome, dict(bench_row_id=bench["row_id"], category=category,
            generation=work_generation, input_revision=input_revision, status=status, known_count=known,
            total_count=len(attributes), attempts=previous.get(category, 0)+1, error=error,
            processed_at=now_iso()), ["bench_row_id", "category"])


def report(database, work_generation):
    active = database.execute("SELECT count(*) FROM benches WHERE active=1").fetchone()[0]
    categories = {key: {"processed": 0, "current": 0, "missing_source": 0, "retryable_failure": 0, "unresolved": 0, "stale": 0}
        for key in CATEGORIES}
    for row in database.execute("""SELECT o.category,o.status,
        (o.generation=? AND o.input_revision=COALESCE(r.revision,0)) fresh,count(*) total
        FROM bench_knowledge_outcomes o JOIN benches b ON b.row_id=o.bench_row_id
        LEFT JOIN bench_knowledge_revisions r ON r.bench_row_id=b.row_id WHERE b.active=1
        GROUP BY o.category,o.status,fresh""", (work_generation,)):
        if row["category"] not in categories:
            continue
        group = categories[row["category"]]
        if row["fresh"]:
            group["processed"] += row["total"]
            group[row["status"]] += row["total"]
        else:
            group["stale"] += row["total"]
    for group in categories.values():
        group["pending"] = active - group["processed"]
    return {"generation": work_generation, "active_benches": active, "categories": categories}
