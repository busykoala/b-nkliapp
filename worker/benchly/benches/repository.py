from __future__ import annotations

from collections.abc import Iterable, Sequence

from sqlalchemy import case, delete, exists, func, literal, select, update
from sqlalchemy.dialects.sqlite import insert

from benchly.benches.models import Bench, BenchEnrichment, BenchMetadataEdit, Media
from benchly.context.models import EnvironmentFeature
from benchly.db import write


EDITED_FIELDS = {
    "backrest": "backrest",
    "armrest": "armrest",
    "covered": "covered",
    "wheelchair": "wheelchair",
    "fireplace_nearby": "fireplaceNearby",
    "waste_basket_nearby": "wasteBasketNearby",
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


def refresh_nearby_amenities(database) -> None:
    """Legacy 75m hints; geometry outside writes and bounded publication.

    Rich facilities (including unknown coverage) live in bench_amenities. These
    two editable legacy hints are retained for existing clients.
    """
    from shapely.geometry import Point
    from shapely import from_wkb
    from benchly.context.geometry import WGS84_TO_LV95
    available_columns = {row[1] for row in database.execute("PRAGMA table_info(benches)")}
    for kind, column, edit_field in (
        ("fireplace", Bench.fireplace_nearby, "fireplaceNearby"),
        ("waste_basket", Bench.waste_basket_nearby, "wasteBasketNearby"),
    ):
        if column.key not in available_columns:
            continue
        positives = set()
        for feature in database.execute("SELECT * FROM environment_features WHERE kind=?", (kind,)):
            shape = from_wkb(feature["geometry_wkb"]) if feature["geometry_wkb"] else Point(*WGS84_TO_LV95.transform(feature["center_longitude"], feature["center_latitude"]))
            candidates = database.execute("""SELECT b.row_id,b.longitude,b.latitude FROM bench_spatial_index s JOIN benches b ON b.row_id=s.row_id
                WHERE s.min_longitude<=? AND s.max_longitude>=? AND s.min_latitude<=? AND s.max_latitude>=? AND b.active=1""",
                (feature["max_longitude"]+.0011, feature["min_longitude"]-.0011, feature["max_latitude"]+.0007, feature["min_latitude"]-.0007))
            for bench in candidates:
                if shape.distance(Point(*WGS84_TO_LV95.transform(bench["longitude"], bench["latitude"]))) <= 75:
                    positives.add(bench["row_id"])
        edited = exists(select(BenchMetadataEdit.id).where(BenchMetadataEdit.bench_row_id == Bench.row_id, BenchMetadataEdit.field == edit_field))
        after = 0
        while True:
            ids = [row[0] for row in database.execute("SELECT row_id FROM benches WHERE row_id>? ORDER BY row_id LIMIT 500", (after,))]
            if not ids:
                break
            matched = [row_id for row_id in ids if row_id in positives]
            value = case((Bench.row_id.in_(matched), 1), else_=None)
            write(database, update(Bench).where(Bench.row_id.in_(ids), ~edited).values({column.key: value}))
            database.commit()
            after = ids[-1]


def upsert_inventory_benches(database, rows: Sequence[dict[str, object]], preserve_edits: bool) -> None:
    if not rows:
        return
    available_columns = {row[1] for row in database.execute("PRAGMA table_info(benches)")}
    rows = [{key: value for key, value in row.items() if key in available_columns} for row in rows]
    rows = [Bench.model_validate(row).model_dump(exclude_unset=True, exclude={"row_id"}) for row in rows]
    statement = insert(Bench).values(list(rows))
    excluded = statement.excluded
    available_columns = {row[1] for row in database.execute("PRAGMA table_info(benches)")}
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
    for key in ("osm_version", "osm_timestamp", "osm_changeset"):
        if key in available_columns:
            direct[key] = getattr(excluded, key)
    for column_name, edit_field in EDITED_FIELDS.items():
        if column_name not in available_columns:
            continue
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
    while True:
        ids = [row[0] for row in database.execute("SELECT row_id FROM benches WHERE active=1 AND imported_at!=? AND id LIKE 'osm-%' LIMIT 500", (imported_at,))]
        if not ids:
            return
        write(database, update(Bench).where(Bench.row_id.in_(ids)).values(active=0))
        database.commit()


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
    from benchly.imagery.photo_repository import project_enrichment_with_photos

    if update_fields is None:
        values = project_enrichment_with_photos(database, values)
    supplied_fields = tuple(values)
    validated = BenchEnrichment.model_validate(values)
    values = {field: getattr(validated, field) for field in supplied_fields}
    available = {row[1] for row in database.execute("PRAGMA table_info(bench_enrichments)")}
    for field in ("sun_confidence", "view_confidence"):
        if field in available and field not in values:
            values[field] = getattr(validated, field)
    statement = insert(BenchEnrichment).values(values)
    excluded = statement.excluded
    # Defaults are needed for a new row, but a partial context refresh must not
    # reset the confidence of previously measured sun/view data.
    fields = tuple(update_fields or (key for key in supplied_fields if key != "bench_row_id"))
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[BenchEnrichment.bench_row_id],
            set_={field: getattr(excluded, field) for field in fields},
        ),
    )


def invalidate_enrichment(database, *, environment: bool = False, bounds=None, publish_batches=False) -> None:
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
    if publish_batches:
        after = 0
        while True:
            ids = [row[0] for row in database.execute("SELECT bench_row_id FROM bench_enrichments WHERE bench_row_id>? ORDER BY bench_row_id LIMIT 500", (after,))]
            if not ids:
                break
            write(database, statement.where(BenchEnrichment.bench_row_id.in_(ids)))
            database.commit()
            after = ids[-1]
    else:
        write(database, statement)


def update_enrichment(database, bench_row_id: int, **values: object) -> None:
    write(
        database,
        update(BenchEnrichment)
        .where(BenchEnrichment.bench_row_id == bench_row_id)
        .values(**values),
    )


def invalidate_environment_for_benches(database, bench_row_ids: Iterable[int]) -> None:
    ids = tuple(bench_row_ids)
    if not ids:
        return
    write(
        database,
        update(BenchEnrichment)
        .where(BenchEnrichment.bench_row_id.in_(ids))
        .values(environment_computed_at=None),
    )
