from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert

from benchly.db import Database, write
from .models import BenchDirectionEstimate


def upsert_estimates(database: Database, values: Sequence[dict[str, object]]) -> None:
    if not values:
        return
    rows = [BenchDirectionEstimate.model_validate(value).model_dump() for value in values]
    statement = insert(BenchDirectionEstimate).values(rows)
    excluded = statement.excluded
    write(database, statement.on_conflict_do_update(
        index_elements=[BenchDirectionEstimate.bench_row_id],
        set_={
            field: getattr(excluded, field)
            for field in BenchDirectionEstimate.model_fields
            if field != "bench_row_id"
        },
    ))


def delete_analysis_run(database: Database, analysis_run_id: str) -> int:
    result = write(
        database,
        delete(BenchDirectionEstimate).where(BenchDirectionEstimate.analysis_run_id == analysis_run_id),
    )
    return int(result.rowcount or 0)
