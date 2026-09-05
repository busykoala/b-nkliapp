from __future__ import annotations

from typing import Optional

from pydantic import ConfigDict
from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class Bench(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "benches"
    __table_args__ = (UniqueConstraint("osm_type", "osm_id"),)

    row_id: Optional[int] = Field(default=None, primary_key=True)
    id: str
    osm_type: str
    osm_id: int
    latitude: float = Field(ge=45.7, le=47.9)
    longitude: float = Field(ge=5.7, le=10.7)
    backrest: Optional[int] = None
    armrest: Optional[int] = None
    covered: Optional[int] = None
    wheelchair: Optional[int] = None
    seats: Optional[int] = None
    material: Optional[str] = None
    direction_degrees: Optional[float] = None
    operator: Optional[str] = None
    description: Optional[str] = None
    raw_tags: str = "{}"
    active: int = 1
    source_updated_at: str
    imported_at: str
    name: Optional[str] = None
    dedication: Optional[str] = None
    location_name: Optional[str] = None
    location_key: Optional[str] = None
    location_postcode: Optional[str] = None
    location_canton: Optional[str] = None
    created_by_user_id: Optional[int] = None
    # The app migration owns the database default. Keeping it out of this model
    # lets imports remain compatible while a rolling deployment finishes.
    verification_status: Optional[str] = None
    verified_at: Optional[str] = None
    removed_at: Optional[str] = None


class BenchMetadataEdit(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bench_metadata_edits"

    id: Optional[int] = Field(default=None, primary_key=True)
    bench_row_id: int
    user_id: int
    field: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    created_at: str


class Media(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "media"
    __table_args__ = (UniqueConstraint("provider", "external_id", "bench_row_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    bench_row_id: int
    relation: str
    provider: str
    external_id: Optional[str] = None
    source_url: str
    thumbnail_url: str
    author: Optional[str] = None
    license: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    distance_meters: Optional[float] = None
    title: Optional[str] = None
    fetched_at: str


class BenchEnrichment(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bench_enrichments"

    bench_row_id: int = Field(primary_key=True)
    elevation_meters: Optional[float] = None
    in_forest: Optional[int] = None
    canopy_percent: Optional[float] = None
    distance_forest_meters: Optional[float] = None
    distance_water_meters: Optional[float] = None
    distance_path_meters: Optional[float] = None
    distance_major_road_meters: Optional[float] = None
    horizon_profile: Optional[str] = None
    sun_minutes_summer: Optional[int] = None
    sun_minutes_winter: Optional[int] = None
    sun_confidence: str = "niedrig"
    view_score: Optional[float] = None
    view_confidence: str = "niedrig"
    view_components: Optional[str] = None
    pipeline_version: Optional[str] = None
    computed_at: Optional[str] = None
    sun_minutes_spring: Optional[int] = None
    sun_minutes_autumn: Optional[int] = None
    terrain_horizon_profile: Optional[str] = None
    obstruction_types: Optional[str] = None
    obstruction_distances: Optional[str] = None
    building_obstruction_percent: Optional[float] = None
    vegetation_obstruction_percent: Optional[float] = None
    distance_building_meters: Optional[float] = None
    building_count_100m: Optional[int] = None
    view_labels: Optional[str] = None
    view_sectors: Optional[str] = None
    context_source_version: Optional[str] = None
    elevation_source: Optional[str] = None
    elevation_updated_at: Optional[str] = None
    land_context: Optional[str] = None
    waterfront: Optional[int] = None
    canopy_context: Optional[str] = None
    canopy_share_3m: Optional[float] = None
    canopy_share_10m: Optional[float] = None
    canopy_share_25m: Optional[float] = None
    vegetation_median_height: Optional[float] = None
    vegetation_max_height: Optional[float] = None
    environment_computed_at: Optional[str] = None
