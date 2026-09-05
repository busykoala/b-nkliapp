from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert

from benchly.db import Database, write
from benchly.transit.models import TransitMetadata, TransitStop, TransitTransfer


BATCH_SIZE = 2_000


def create_schema(database: Database) -> None:
    database.create_tables((TransitMetadata, TransitStop, TransitTransfer))


def _chunks(records: Iterable[dict[str, object]]):
    batch: list[dict[str, object]] = []
    for record in records:
        batch.append(record)
        if len(batch) == BATCH_SIZE:
            yield batch
            batch = []
    if batch:
        yield batch


def insert_stops(database: Database, records: Iterable[dict[str, object]]) -> None:
    for batch in _chunks(records):
        rows = [TransitStop.model_validate(record).model_dump() for record in batch]
        write(database, insert(TransitStop).values(rows))


def insert_transfers(database: Database, records: Iterable[dict[str, object]]) -> None:
    for batch in _chunks(records):
        rows = [
            TransitTransfer.model_validate(record).model_dump(exclude={"row_id"})
            for record in batch
        ]
        write(database, insert(TransitTransfer).values(rows))


def insert_metadata(database: Database, values: dict[str, str]) -> None:
    rows = [TransitMetadata(key=key, value=value).model_dump() for key, value in values.items()]
    write(database, insert(TransitMetadata).values(rows))


def validate_index(database: Database) -> int:
    stop_count = int(database.write(select(func.count()).select_from(TransitStop)).scalar_one())
    transfer_count = int(database.write(select(func.count()).select_from(TransitTransfer)).scalar_one())
    if stop_count == 0 or transfer_count == 0:
        raise ValueError("Empty GTFS index")
    if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError("Invalid transit database")
    return stop_count
