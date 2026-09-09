"""Resumable source-linked photo analysis; never stores image bytes."""

from typing import Optional

from pydantic import ConfigDict
from sqlalchemy import Index
from sqlmodel import Field, SQLModel


class BankPhotoSource(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bank_photo_sources"
    __table_args__ = (Index("bank_photo_sources_bench_idx", "bench_id"),)

    source_id: int = Field(primary_key=True)
    latitude: float
    longitude: float
    source_url: str
    source_metadata: str
    discovered_at: str
    comments_discovered_at: Optional[str] = None
    discovery_error: Optional[str] = None
    bench_id: Optional[str] = None
    match_method: Optional[str] = None
    match_distance_meters: Optional[float] = None


class BankPhotoObservation(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bank_photo_observations"
    __table_args__ = (Index("bank_photo_observations_hash_idx", "image_sha256"),)

    source_id: int = Field(primary_key=True)
    image_id: int = Field(primary_key=True)
    fetch_url: str
    captured_at: Optional[str] = None
    status: str = "pending"
    image_sha256: Optional[str] = None
    prediction: Optional[str] = None
    model_version: Optional[str] = None
    prompt_version: Optional[str] = None
    analyzed_at: Optional[str] = None
    attempts: int = 0
    last_error: Optional[str] = None


class BankPhotoEvidence(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bank_photo_evidence"

    bench_row_id: int = Field(primary_key=True)
    bench_id: str
    bench_latitude: float
    bench_longitude: float
    signals: str
    observation_count: int
    model_version: str
    prompt_version: str
    rule_version: str
    evaluated_at: str
    # These snapshots allow a new analysis/match to retract only its own
    # previous changes, while preserving subsequent measurements or edits.
    base_enrichment: Optional[str] = None
    applied_enrichment: Optional[str] = None


class BankPhotoReview(SQLModel, table=True):
    """A visual review follows the original bytes, not a mutable source URL."""
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bank_photo_reviews"

    image_sha256: str = Field(primary_key=True)
    exclude_view: bool
    reason: str
    reviewed_at: str
