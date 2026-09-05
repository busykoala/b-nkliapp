from __future__ import annotations

from collections.abc import Iterable, Sequence

from sqlalchemy import case, delete, exists, func, literal, select, update
from sqlalchemy.dialects.sqlite import insert

from benchly.db import write
from benchly.benches.models import Bench, BenchEnrichment, BenchMetadataEdit, Media


EDITED_FIELDS = {
    "backrest": "backrest",
    "armrest": "armrest",
    "covered": "covered",
    "wheelchair": "wheelchair",
    "seats": "seats",
    "material": "material",
    "direction_degrees": "direction",
    "name": "name",
    "dedication": "dedication",
    "location_name": "location",
    "location_key": "location",
    "location_postcode": "location",
    "location_canton": "location",
}


def upsert_osm_benches(database, rows: Sequence[dict[str, object]], preserve_edits: bool) -> None:
    if not rows:
        return
    rows = [Bench.model_validate(row).model_dump(exclude_unset=True, exclude={"row_id"}) for row in rows]
    statement = insert(Bench).values(list(rows))
    excluded = statement.excluded
    direct = {
        "latitude": excluded.latitude,
        "longitude": excluded.longitude,
        "operator": excluded.operator,
        "description": excluded.description,
        "raw_tags": excluded.raw_tags,
        "active": literal(1),
        "source_updated_at": excluded.source_updated_at,
        "imported_at": excluded.imported_at,
    }
    for column_name, edit_field in EDITED_FIELDS.items():
        incoming = getattr(excluded, column_name)
        current = getattr(Bench, column_name)
        fallback = func.coalesce(incoming, current) if edit_field in {"name", "dedication", "location"} else incoming
        if preserve_edits:
            has_edit = exists(
                select(BenchMetadataEdit.id).where(
                    BenchMetadataEdit.bench_row_id == Bench.row_id,
                    BenchMetadataEdit.field == edit_field,
                )
            )
            direct[column_name] = case((has_edit, current), else_=fallback)
        else:
            direct[column_name] = fallback
    write(
        database,
        statement.on_conflict_do_update(index_elements=[Bench.osm_type, Bench.osm_id], set_=direct),
    )


def deactivate_stale_osm_benches(database, imported_at: str) -> None:
    write(
        database,
        update(Bench)
        .where(Bench.imported_at != imported_at, Bench.id.like("osm-%"))
        .values(active=0),
    )


def remove_demo_benches(database) -> None:
    subquery = select(BenchEnrichment.bench_row_id).where(BenchEnrichment.pipeline_version.like("demo-%"))
    write(database, delete(Bench).where(Bench.row_id.in_(subquery)))


def replace_exact_imported_media(database, bench_row_id: int) -> None:
    write(
        database,
        delete(Media).where(
            Media.bench_row_id == bench_row_id,
            Media.relation == "exact",
            Media.provider.in_(("OpenStreetMap image", "Wikimedia Commons")),
        ),
    )


def remove_nearby_media(database, bench_row_id: int, provider: str) -> None:
    write(
        database,
        delete(Media).where(
            Media.bench_row_id == bench_row_id,
            Media.relation == "nearby",
            Media.provider == provider,
        ),
    )


def add_media(database, rows: Sequence[dict[str, object]]) -> None:
    if not rows:
        return
    rows = [Media.model_validate(row).model_dump(exclude_unset=True, exclude={"id"}) for row in rows]
    statement = insert(Media).values(list(rows)).on_conflict_do_nothing(
        index_elements=[Media.provider, Media.external_id, Media.bench_row_id]
    )
    write(database, statement)


def upsert_enrichment(database, values: dict[str, object], update_fields: Iterable[str] | None = None) -> None:
    values = BenchEnrichment.model_validate(values).model_dump(exclude_unset=True)
    statement = insert(BenchEnrichment).values(values)
    excluded = statement.excluded
    fields = tuple(update_fields or (key for key in values if key != "bench_row_id"))
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[BenchEnrichment.bench_row_id],
            set_={field: getattr(excluded, field) for field in fields},
        ),
    )


def invalidate_enrichment(database, *, environment: bool = False, bounds=None) -> None:
    values = {"pipeline_version": None}
    if environment:
        values.update({"environment_computed_at": None, "context_source_version": None})
    available = {row[1] for row in database.execute("PRAGMA table_info(bench_enrichments)")}
    values = {key: value for key, value in values.items() if key in available}
    if not values:
        return
    statement = update(BenchEnrichment).values(**values)
    if bounds:
        bench_ids = select(Bench.row_id).where(
            Bench.longitude.between(bounds[0], bounds[2]),
            Bench.latitude.between(bounds[1], bounds[3]),
        )
        statement = statement.where(BenchEnrichment.bench_row_id.in_(bench_ids))
    write(database, statement)


def update_enrichment(database, bench_row_id: int, **values: object) -> None:
    write(
        database,
        update(BenchEnrichment)
        .where(BenchEnrichment.bench_row_id == bench_row_id)
        .values(**values),
    )
