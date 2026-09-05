from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert

from benchly.db import Database, write
from benchly.runs.models import PipelineCompletion, PipelineRun
from benchly.catalog import load_catalog
from benchly.runtime import now_iso


def begin_run(database: Database, kind: str, source_version: Optional[str] = None) -> int:
    record = PipelineRun(
        kind=kind,
        status="running",
        source_version=source_version,
        pipeline_version=load_catalog().runtime.pipelineVersion,
        started_at=now_iso(),
    )
    result = write(
        database,
        insert(PipelineRun).values(record.model_dump(exclude={"id", "stats", "finished_at"}))
    )
    database.commit()
    return int(result.inserted_primary_key[0] if hasattr(result, "inserted_primary_key") else result.lastrowid)


def finish_run(database: Database, run_id: int, status: str, stats: dict[str, object]) -> None:
    completion = PipelineCompletion.model_validate({"status": status, "stats": stats})
    write(
        database,
        update(PipelineRun)
        .where(PipelineRun.id == run_id)
        .values(
            status=completion.status,
            stats=json.dumps(completion.stats, separators=(",", ":")),
            finished_at=now_iso(),
        )
    )
    database.commit()


def set_source_version(database: Database, run_id: int, source_version: str) -> None:
    write(
        database,
        update(PipelineRun)
        .where(PipelineRun.id == run_id)
        .values(source_version=source_version)
    )
