from __future__ import annotations

from typing import Optional

from pydantic import ConfigDict
from sqlalchemy import Index, UniqueConstraint
from sqlmodel import Field, SQLModel


class ImageDiscoveryCell(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "image_discovery_cells"

    provider: str = Field(primary_key=True)
    cell_id: str = Field(primary_key=True)
    min_latitude: float
    max_latitude: float
    min_longitude: float
    max_longitude: float
    status: str
    image_count: int = 0
    attempts: int = 0
    last_error: Optional[str] = None
    discovered_at: Optional[str] = None
    retry_after: Optional[str] = None


class ImageObservation(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "image_observations"
    __table_args__ = (
        UniqueConstraint("provider", "provider_image_id"),
        Index("image_observations_status_idx", "analysis_status", "discovered_at"),
        Index("image_observations_group_idx", "provider", "capture_group_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    provider: str
    provider_image_id: str
    capture_group_id: str
    source_url: str
    fetch_url: str
    latitude: float
    longitude: float
    heading: Optional[float] = None
    captured_at: Optional[str] = None
    author: Optional[str] = None
    license: Optional[str] = None
    image_sha256: Optional[str] = None
    analysis_status: str = "pending"
    relevance_probability: Optional[float] = None
    predictions: Optional[str] = None
    model_version: Optional[str] = None
    prompt_version: Optional[str] = None
    analyzed_at: Optional[str] = None
    attempts: int = 0
    last_error: Optional[str] = None
    discovered_at: str


class BenchImageEvidence(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bench_image_evidence"

    bench_row_id: int = Field(primary_key=True)
    image_observation_id: int = Field(primary_key=True)
    distance_meters: float
    direct_view_eligible: int = 0
    evidence_weight: float = 1


class BenchLikelyMetadata(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bench_likely_metadata"

    bench_row_id: int = Field(primary_key=True)
    land_context: Optional[str] = None
    land_context_probability: Optional[float] = None
    canopy_context: Optional[str] = None
    canopy_probability: Optional[float] = None
    lake_view_probability: Optional[float] = None
    mountain_view_probability: Optional[float] = None
    open_view_probability: Optional[float] = None
    limited_view_probability: Optional[float] = None
    buildings_probability: Optional[float] = None
    road_rail_probability: Optional[float] = None
    confidence: str = "low"
    evidence_group_count: int = 0
    evidence_summary: str = "[]"
    model_version: Optional[str] = None
    reconciler_version: str
    updated_at: str
