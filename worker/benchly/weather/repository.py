from __future__ import annotations

from sqlalchemy.dialects.sqlite import insert

from benchly.db import write
from benchly.weather.models import WeatherSnapshot


def store_snapshot(database, values: dict[str, object]) -> None:
    snapshot = WeatherSnapshot.model_validate(values)
    statement = insert(WeatherSnapshot).values(snapshot.model_dump())
    excluded = statement.excluded
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[WeatherSnapshot.source, WeatherSnapshot.parameter],
            set_={
                field: getattr(excluded, field)
                for field in WeatherSnapshot.model_fields
                if field not in {"source", "parameter"}
            },
        ),
    )
    database.commit()
