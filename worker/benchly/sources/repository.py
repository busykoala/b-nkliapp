from __future__ import annotations

from sqlalchemy.dialects.sqlite import insert

from benchly.db import Database, write
from benchly.sources.models import SourceProbe, SourceVersion


def prepare_source_status(database: Database) -> None:
    database.create_tables([SourceVersion])
    database.commit()


def save_probe(database: Database, probe: SourceProbe) -> None:
    values = probe.model_dump()
    statement = insert(SourceVersion).values(values)
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[SourceVersion.source_id],
            set_={key: getattr(statement.excluded, key) for key in values if key != "source_id"},
        ),
    )
    database.commit()

