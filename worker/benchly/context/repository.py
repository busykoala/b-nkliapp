from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert

from benchly.context.models import (
    BuildingImportCell,
    BuildingSourceAsset,
    EnvironmentFeature,
    LandCoverFeature,
    OfficialContextSource,
)
from benchly.db import write


def _upsert(database, model, rows: Sequence[dict[str, object]], keys: list, fields: Sequence[str]) -> None:
    if not rows:
        return
    statement = insert(model).values(list(rows))
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=keys,
            set_={field: getattr(statement.excluded, field) for field in fields},
        ),
    )


def upsert_environment_features(database, rows: Sequence[dict[str, object]]) -> None:
    rows = [
        {field: getattr(validated, field) for field in row if field != "row_id"}
        for row in rows
        for validated in [EnvironmentFeature.model_validate(row)]
    ]
    fields = tuple(key for key in rows[0] if key not in {"source", "source_id", "kind"}) if rows else ()
    _upsert(
        database,
        EnvironmentFeature,
        rows,
        [EnvironmentFeature.source, EnvironmentFeature.source_id, EnvironmentFeature.kind],
        fields,
    )


def upsert_land_cover(database, rows: Sequence[dict[str, object]]) -> None:
    rows = [
        {field: getattr(validated, field) for field in row if field != "row_id"}
        for row in rows
        for validated in [LandCoverFeature.model_validate(row)]
    ]
    fields = tuple(key for key in rows[0] if key not in {"source", "source_id", "cover_class"}) if rows else ()
    _upsert(
        database,
        LandCoverFeature,
        rows,
        [LandCoverFeature.source, LandCoverFeature.source_id, LandCoverFeature.cover_class],
        fields,
    )


def discard_old_official_generation(database, imported_at: str) -> None:
    write(
        database,
        delete(EnvironmentFeature).where(
            EnvironmentFeature.source == "swissTLM3D",
            EnvironmentFeature.imported_at != imported_at,
        ),
    )
    write(
        database,
        delete(LandCoverFeature).where(
            LandCoverFeature.source == "swissTLM3D",
            LandCoverFeature.imported_at != imported_at,
        ),
    )


def discard_environment_rows(database, row_ids: Sequence[int]) -> None:
    if row_ids:
        write(database, delete(EnvironmentFeature).where(EnvironmentFeature.row_id.in_(row_ids)))


def discard_old_osm_context(database, imported_at: str) -> None:
    after = 0
    while True:
        rows = database.execute("SELECT row_id,imported_at FROM environment_features WHERE source='OpenStreetMap' AND row_id>? ORDER BY row_id LIMIT 1000", (after,)).fetchall()
        if not rows:
            return
        stale = [row[0] for row in rows if row[1] != imported_at]
        if stale:
            write(database, delete(EnvironmentFeature).where(EnvironmentFeature.row_id.in_(stale)))
            database.commit()
        after = rows[-1][0]


def discard_old_source_generation(database, source: str, imported_at: str) -> None:
    write(
        database,
        delete(EnvironmentFeature).where(
            EnvironmentFeature.source == source,
            EnvironmentFeature.imported_at != imported_at,
        ),
    )


def upsert_official_source(database, values: dict[str, object]) -> None:
    values = OfficialContextSource.model_validate(values).model_dump()
    _upsert(
        database,
        OfficialContextSource,
        [values],
        [OfficialContextSource.source],
        ("version", "asset_url", "asset_checksum", "imported_at", "stats"),
    )


def upsert_building_asset(database, values: dict[str, object]) -> None:
    values = BuildingSourceAsset.model_validate(values).model_dump()
    _upsert(
        database,
        BuildingSourceAsset,
        [values],
        [BuildingSourceAsset.asset_id],
        ("source_version", "asset_url", "imported_at", "stats"),
    )


def upsert_building_cell(database, values: dict[str, object]) -> None:
    values = BuildingImportCell.model_validate(values).model_dump()
    _upsert(
        database,
        BuildingImportCell,
        [values],
        [BuildingImportCell.cell_key],
        ("bounds", "imported_at", "stats"),
    )
