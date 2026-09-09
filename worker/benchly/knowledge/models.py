from __future__ import annotations
from typing import Optional
from pydantic import ConfigDict
from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class KnowledgeModel(SQLModel):
    model_config = ConfigDict(extra="forbid")


class PlaceFeature(KnowledgeModel, table=True):
    __tablename__ = "official_place_features"
    __table_args__ = (UniqueConstraint("source", "source_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    source: str
    source_id: str
    kind: str
    name: str
    municipality_id: Optional[str] = None
    canton_id: Optional[str] = None
    district_id: Optional[str] = None
    rank: int = 0
    geometry_wkb: bytes
    min_lon: float
    max_lon: float
    min_lat: float
    max_lat: float
    source_version: str
    source_updated_at: Optional[str] = None
    imported_at: str


class Geography(KnowledgeModel, table=True):
    __tablename__ = "bench_geography"
    bench_row_id: int = Field(primary_key=True)
    municipality_id: Optional[str] = None
    municipality_name: Optional[str] = None
    canton_id: Optional[str] = None
    canton_name: Optional[str] = None
    district_id: Optional[str] = None
    district_name: Optional[str] = None
    locality_id: Optional[str] = None
    locality_name: Optional[str] = None
    locality_distance_meters: Optional[float] = None
    confidence: str
    source_version: str
    method_version: str
    computed_at: str


class Evidence(KnowledgeModel, table=True):
    __tablename__ = "bench_attribute_evidence"
    id: Optional[int] = Field(default=None, primary_key=True)
    bench_row_id: int
    attribute: str
    value_json: str
    source_type: str
    source_id: str
    observed_at: Optional[str] = None
    source_updated_at: Optional[str] = None
    imported_at: str
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    method_version: str
    metadata_json: str = "{}"
    evidence_key: str = Field(unique=True)


class AttributeState(KnowledgeModel, table=True):
    __tablename__ = "bench_attribute_state"
    bench_row_id: int = Field(primary_key=True)
    attribute: str = Field(primary_key=True)
    value_json: Optional[str] = None
    confidence: str
    conflicting: int = 0
    evidence_count: int
    source_types_json: str
    latest_at: Optional[str] = None
    method_version: str
    resolved_at: str


class Completeness(KnowledgeModel, table=True):
    __tablename__ = "bench_completeness"
    bench_row_id: int = Field(primary_key=True)
    category: str = Field(primary_key=True)
    known_count: int
    total_count: int
    uncertain_count: int
    missing_json: str
    computed_at: str
    method_version: str


class Amenity(KnowledgeModel, table=True):
    __tablename__ = "bench_amenities"
    bench_row_id: int = Field(primary_key=True)
    category: str = Field(primary_key=True)
    nearest_source_id: Optional[str] = None
    distance_meters: Optional[float] = None
    count_100m: Optional[int] = None
    count_250m: Optional[int] = None
    count_500m: Optional[int] = None
    source: str
    source_version: Optional[str] = None
    method_version: str
    computed_at: str


class Approach(KnowledgeModel, table=True):
    __tablename__ = "bench_approaches"
    bench_row_id: int = Field(primary_key=True)
    source_id: Optional[str] = None
    distance_meters: Optional[float] = None
    length_meters: Optional[float] = None
    average_slope_percent: Optional[float] = None
    maximum_slope_percent: Optional[float] = None
    elevation_gain_meters: Optional[float] = None
    steps: Optional[int] = None
    barriers_json: str = "[]"
    surface: Optional[str] = None
    smoothness: Optional[str] = None
    width_meters: Optional[float] = None
    step_free_possible: Optional[int] = None
    confidence: str
    evidence_json: str = "{}"
    method_version: str
    computed_at: str


class KnowledgeQueue(KnowledgeModel, table=True):
    __tablename__ = "bench_knowledge_queue"
    bench_row_id: int = Field(primary_key=True)
    reason: str
    requested_at: str


class SourceRecord(KnowledgeModel, table=True):
    __tablename__ = "bench_source_records"
    __table_args__ = (UniqueConstraint("source", "external_id"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    bench_row_id: Optional[int] = None
    source: str
    external_id: str
    latitude: float = Field(ge=45.7, le=47.9)
    longitude: float = Field(ge=5.7, le=10.7)
    source_version: Optional[str] = None
    source_updated_at: Optional[str] = None
    imported_at: str
    raw_attributes_json: str
    match_confidence: Optional[float] = Field(default=None, ge=0, le=1)
    match_status: str
    candidates_json: str = "[]"
    method_version: str


class NoiseExposure(KnowledgeModel, table=True):
    __tablename__ = "bench_noise_exposure"
    bench_row_id: int = Field(primary_key=True)
    mode: str = Field(primary_key=True)
    period: str = Field(primary_key=True)
    value: Optional[float] = None
    unit: str
    source: str
    dataset_version: str
    method_version: str
    computed_at: str


class KnowledgeProgress(KnowledgeModel, table=True):
    __tablename__ = "knowledge_progress"
    job: str = Field(primary_key=True)
    after_row_id: int
    updated_at: str
