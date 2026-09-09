"""All knowledge mutations use the same typed transaction as the worker."""
from __future__ import annotations
import hashlib
import json
from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert
from benchly.db import write
from benchly.knowledge.models import Evidence, KnowledgeQueue
from benchly.runtime import now_iso


def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def available(database):
    return bool(database.execute("SELECT 1 FROM sqlite_master WHERE name='bench_attribute_evidence'").fetchone())


def upsert(database, model, values, keys):
    values = model.model_validate(values).model_dump(exclude_unset=True)
    statement = insert(model).values(values)
    write(database, statement.on_conflict_do_update(index_elements=keys, set_={
        key: getattr(statement.excluded, key) for key in values if key not in keys and key != "id"
    }))


def record_evidence(database, bench_id, attribute, value, source_type, source_id, *,
                    observed_at=None, source_updated_at=None, confidence=None, method="knowledge-1", metadata=None, withdraw=False):
    if value is None and not withdraw:
        return
    content = dict(bench_row_id=bench_id, attribute=attribute, value_json=compact(value), source_type=source_type,
                   source_id=source_id, observed_at=observed_at, source_updated_at=source_updated_at,
                   confidence=confidence, method_version=method, metadata_json=compact(metadata or {}))
    key = hashlib.sha256(compact(content).encode()).hexdigest()
    evidence = Evidence.model_validate({**content, "imported_at": now_iso(), "evidence_key": key})
    write(database, insert(Evidence).values(evidence.model_dump(exclude={"id"})).on_conflict_do_nothing(index_elements=["evidence_key"]))


def finish_queue(database, row_id):
    write(database, delete(KnowledgeQueue).where(KnowledgeQueue.bench_row_id == row_id))
