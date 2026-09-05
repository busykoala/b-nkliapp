from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.dialects.sqlite import insert

from benchly.db import Database, write
from benchly.landscape.models import LandscapeCell, LandscapeMetadata


def create_schema(database: Database) -> None:
    database.create_tables((LandscapeMetadata, LandscapeCell))


def upsert_cells(database: Database, values: Sequence[dict[str, object]]) -> None:
    if not values:
        return
    rows = [LandscapeCell.model_validate(value).model_dump() for value in values]
    statement = insert(LandscapeCell).values(rows)
    excluded = statement.excluded
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[LandscapeCell.x, LandscapeCell.y],
            set_={
                field: getattr(excluded, field)
                for field in LandscapeCell.model_fields
                if field not in {"x", "y"}
            },
        ),
    )


def upsert_metadata(database: Database, values: dict[str, str]) -> None:
    rows = [LandscapeMetadata(key=key, value=value).model_dump() for key, value in values.items()]
    statement = insert(LandscapeMetadata).values(rows)
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[LandscapeMetadata.key],
            set_={"value": statement.excluded.value},
        ),
    )
