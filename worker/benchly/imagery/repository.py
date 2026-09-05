from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert

from benchly.db import write
from benchly.imagery.models import (
    BenchImageEvidence,
    BenchLikelyMetadata,
    ImageDiscoveryCell,
    ImageObservation,
)


def upsert_observation(database, values: dict[str, object]) -> int:
    observation = ImageObservation.model_validate(values)
    statement = insert(ImageObservation).values(observation.model_dump(exclude_unset=True, exclude={"id"}))
    excluded = statement.excluded
    fields = (
        "capture_group_id", "source_url", "fetch_url", "latitude", "longitude",
        "heading", "captured_at", "author", "license", "discovered_at",
    )
    result = write(
        database,
        statement.on_conflict_do_update(
            index_elements=[ImageObservation.provider, ImageObservation.provider_image_id],
            set_={field: getattr(excluded, field) for field in fields},
        ).returning(ImageObservation.id),
    )
    row = result.fetchone()
    if not row:
        raise RuntimeError("Image observation upsert returned no id")
    return int(row[0])


def upsert_evidence(database, values: dict[str, object]) -> None:
    evidence = BenchImageEvidence.model_validate(values)
    statement = insert(BenchImageEvidence).values(evidence.model_dump())
    excluded = statement.excluded
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[BenchImageEvidence.bench_row_id, BenchImageEvidence.image_observation_id],
            set_={
                "distance_meters": excluded.distance_meters,
                "direct_view_eligible": excluded.direct_view_eligible,
                "evidence_weight": excluded.evidence_weight,
            },
        ),
    )


def record_discovery(database, values: dict[str, object]) -> None:
    cell = ImageDiscoveryCell.model_validate(values)
    statement = insert(ImageDiscoveryCell).values(cell.model_dump())
    excluded = statement.excluded
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[ImageDiscoveryCell.provider, ImageDiscoveryCell.cell_id],
            set_={
                "status": excluded.status,
                "image_count": excluded.image_count,
                "attempts": ImageDiscoveryCell.attempts + 1,
                "last_error": excluded.last_error,
                "discovered_at": excluded.discovered_at,
                "retry_after": excluded.retry_after,
            },
        ),
    )


def mark_analyzed(database, observation_id: int, values: dict[str, object]) -> None:
    write(
        database,
        update(ImageObservation)
        .where(ImageObservation.id == observation_id)
        .values(**values, attempts=ImageObservation.attempts + 1, last_error=None),
    )


def mark_grouped(database, observation_ids: Sequence[int], model: str, prompt: str, analyzed_at: str) -> None:
    if observation_ids:
        write(
            database,
            update(ImageObservation)
            .where(ImageObservation.id.in_(observation_ids))
            .values(analysis_status="grouped", model_version=model, prompt_version=prompt, analyzed_at=analyzed_at),
        )


def mark_retry(database, observation_ids: Sequence[int], error: str) -> None:
    if observation_ids:
        write(
            database,
            update(ImageObservation)
            .where(ImageObservation.id.in_(observation_ids))
            .values(analysis_status="retry", attempts=ImageObservation.attempts + 1, last_error=error[:500]),
        )


def upsert_likely_metadata(database, values: dict[str, object]) -> None:
    metadata = BenchLikelyMetadata.model_validate(values)
    statement = insert(BenchLikelyMetadata).values(metadata.model_dump())
    excluded = statement.excluded
    write(
        database,
        statement.on_conflict_do_update(
            index_elements=[BenchLikelyMetadata.bench_row_id],
            set_={
                field: getattr(excluded, field)
                for field in BenchLikelyMetadata.model_fields
                if field != "bench_row_id"
            },
        ),
    )
