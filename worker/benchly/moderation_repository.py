"""Typed, auditable production writes for the preview-first moderation CLI."""

from __future__ import annotations

from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert
from sqlmodel import Field, SQLModel

from benchly.db import write


class RatingVisibility(SQLModel, table=True):
    __tablename__ = "ratings"
    id: int | None = Field(default=None, primary_key=True)
    contributor_hash: str
    visible: bool = True


class CorrectionVisibility(SQLModel, table=True):
    __tablename__ = "corrections"
    id: int | None = Field(default=None, primary_key=True)
    contributor_hash: str
    visible: bool = True


class BlockedContributor(SQLModel, table=True):
    __tablename__ = "blocked_contributors"
    contributor_hash: str = Field(primary_key=True)
    reason: str | None = None
    created_at: str


class ModerationAudit(SQLModel, table=True):
    __tablename__ = "moderation_audit"
    id: int | None = Field(default=None, primary_key=True)
    action: str
    target_type: str
    target_id: str
    detail: str | None = None
    created_at: str


def change_visibility(database, target_type: str, target_id: int, visible: bool) -> None:
    model = RatingVisibility if target_type == "rating" else CorrectionVisibility
    write(database, update(model).where(model.id == target_id).values(visible=visible))


def block_contributor(database, contributor_hash: str, reason: str | None, now: str) -> None:
    statement = insert(BlockedContributor).values(
        contributor_hash=contributor_hash, reason=reason, created_at=now,
    )
    write(database, statement.on_conflict_do_update(
        index_elements=[BlockedContributor.contributor_hash], set_={"reason": statement.excluded.reason},
    ))
    for model in (RatingVisibility, CorrectionVisibility):
        write(database, update(model).where(model.contributor_hash == contributor_hash).values(visible=False))


def record_moderation(database, action: str, target_type: str, target_id: int,
                      detail: str | None, now: str) -> None:
    write(database, insert(ModerationAudit).values(
        action=action, target_type=target_type, target_id=str(target_id), detail=detail, created_at=now,
    ))
