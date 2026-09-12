"""Versioned contracts between geographic analysis and watercolor painting.

The geometry contract is deliberately circular and contains no viewing
direction, field of view, image dimensions, weather, or palette. A direction
change therefore never invalidates the expensive geographic calculation.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from sqlalchemy import Column, Text
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlmodel import Field as SqlField, SQLModel


GEOMETRY_VERSION = "panorama-geometry-1"
RENDER_VERSION = "panorama-watercolor-16"
EARTH_RADIUS_METERS = 6_371_008.8


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SemanticClass(str, Enum):
    SKY = "sky"
    WATER = "water"
    RIVER = "river"
    FOREST = "forest"
    OPEN_GRASSLAND = "open_grassland"
    ROCK = "rock"
    SNOW_OR_GLACIER = "snow_or_glacier"
    SETTLEMENT = "settlement"
    BUILDING = "building"
    UNKNOWN_TERRAIN = "unknown_terrain"


class SourceEvidence(Contract):
    source: str
    version: str | None = None
    confidence: float = Field(ge=0, le=1)


class TerrainSample(Contract):
    distance_meters: float = Field(gt=0)
    elevation_meters: float
    semantic: SemanticClass = SemanticClass.UNKNOWN_TERRAIN
    confidence: float = Field(default=1, ge=0, le=1)
    source: str = "unknown"


class TerrainRay(Contract):
    azimuth_degrees: float = Field(ge=0, lt=360)
    samples: tuple[TerrainSample, ...]
    expected_sample_count: int | None = Field(default=None, ge=0)

    @field_validator("samples")
    @classmethod
    def ordered_samples(cls, value: tuple[TerrainSample, ...]) -> tuple[TerrainSample, ...]:
        distances = [sample.distance_meters for sample in value]
        if distances != sorted(distances) or len(distances) != len(set(distances)):
            raise ValueError("terrain samples must have unique ascending distances")
        return value

    @property
    def has_complete_coverage(self) -> bool:
        expected = self.expected_sample_count
        return bool(self.samples) and (expected is None or len(self.samples) == expected)


class BuildingGeometry(Contract):
    """A rendering-efficient building mass in local east/north metres."""

    source_id: str
    footprint: tuple[tuple[float, float], ...] = Field(min_length=3)
    ground_elevation_meters: float
    eaves_elevation_meters: float
    roof_elevation_meters: float
    source: str
    source_version: str | None = None
    confidence: float = Field(ge=0, le=1)
    roof_kind: Literal["known-pitched", "flat-or-unknown"] = "flat-or-unknown"

    @model_validator(mode="after")
    def valid_heights(self):
        if self.eaves_elevation_meters < self.ground_elevation_meters:
            raise ValueError("building eaves must not be below ground")
        if self.roof_elevation_meters < self.eaves_elevation_meters:
            raise ValueError("building roof must not be below eaves")
        return self


class VisibleSpan(Contract):
    lower_angle_degrees: float
    upper_angle_degrees: float
    distance_meters: float = Field(gt=0)
    semantic: SemanticClass
    source: str
    confidence: float = Field(ge=0, le=1)
    object_id: str | None = None

    @model_validator(mode="after")
    def valid_interval(self):
        if self.upper_angle_degrees <= self.lower_angle_degrees:
            raise ValueError("visible span must have positive angular height")
        return self


class PanoramaColumn(Contract):
    azimuth_degrees: float = Field(ge=0, lt=360)
    skyline_angle_degrees: float
    spans: tuple[VisibleSpan, ...]


class PanoramaConfig(Contract):
    # Coarse resolutions remain useful for tiny synthetic fixtures; production
    # commands enforce their own high-resolution ceiling.
    angular_resolution_degrees: float = Field(default=.1, gt=0, le=180)
    minimum_elevation_angle: float = Field(default=-32, ge=-89, lt=0)
    maximum_elevation_angle: float = Field(default=58, gt=0, le=89)
    observer_height_meters: float = Field(default=1.1, ge=.5, le=2.5)
    maximum_distance_meters: float = Field(default=150_000, ge=1_000, le=250_000)
    refraction_coefficient: float = Field(default=.13, ge=0, le=.3)

    @model_validator(mode="after")
    def divides_circle(self):
        count = 360 / self.angular_resolution_degrees
        if abs(count - round(count)) > 1e-7:
            raise ValueError("angular resolution must divide 360 degrees")
        return self

    @property
    def column_count(self) -> int:
        return round(360 / self.angular_resolution_degrees)


class GeometryIdentity(Contract):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    ground_elevation_meters: float
    observer_height_meters: float = Field(default=1.1, ge=.5, le=2.5)
    terrain_version: str
    semantic_version: str
    building_version: str
    surface_version: str | None = None
    algorithm_version: str = GEOMETRY_VERSION
    maximum_distance_meters: float = Field(default=150_000, gt=0)
    angular_resolution_degrees: float = Field(default=.1, gt=0)
    semantic_radius_meters: float = Field(default=20_000, gt=0)
    building_radius_meters: float = Field(default=2_000, gt=0)


class RenderIdentity(Contract):
    geometry_key: str
    center_azimuth_degrees: float = Field(ge=0, lt=360)
    horizontal_fov_degrees: float = Field(default=360, ge=30, le=360)
    width: int = Field(default=1600, ge=320, le=8192)
    height: int = Field(default=720, ge=180, le=4096)
    style_version: str = RENDER_VERSION
    weather_bucket: str
    solar_lunar_bucket: str
    bench_variant: str
    covered: bool | None


class PanoramaGeometry(Contract):
    version: str = GEOMETRY_VERSION
    identity_key: str
    latitude: float
    longitude: float
    ground_elevation_meters: float
    eye_elevation_meters: float
    config: PanoramaConfig
    columns: tuple[PanoramaColumn, ...]
    sources: tuple[SourceEvidence, ...]
    complete: bool
    warnings: tuple[str, ...] = ()

    @model_validator(mode="after")
    def complete_circle(self):
        if len(self.columns) != self.config.column_count:
            raise ValueError("panorama must contain one column for the full configured circle")
        return self


class BenchPanoramaGeometryState(SQLModel, table=True):
    """Typed mirror of migration 0031; artifact bytes live in the file cache."""

    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bench_panorama_geometry"

    bench_row_id: int = SqlField(primary_key=True, foreign_key="benches.row_id")
    bench_id: str
    bench_latitude: float
    bench_longitude: float
    geometry_key: str
    artifact_path: str | None = None
    status: str
    complete: bool = False
    source_versions_json: str = SqlField(sa_column=Column(Text, nullable=False))
    algorithm_version: str
    warnings_json: str = SqlField(default="[]", sa_column=Column(Text, nullable=False))
    artifact_bytes: int | None = None
    started_at: str | None = None
    generated_at: str | None = None
    updated_at: str
    error: str | None = SqlField(default=None, sa_column=Column(Text))


class BenchPanoramaRenderState(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bench_panorama_renders"

    id: int | None = SqlField(default=None, primary_key=True)
    bench_row_id: int = SqlField(foreign_key="benches.row_id")
    geometry_key: str
    render_key: str
    artifact_path: str | None = None
    status: str
    style_version: str
    center_azimuth_degrees: float
    horizontal_fov_degrees: float
    width: int
    height: int
    weather_bucket: str
    solar_lunar_bucket: str
    bench_variant: str
    covered: bool | None = None
    artifact_bytes: int | None = None
    generated_at: str | None = None
    updated_at: str
    error: str | None = SqlField(default=None, sa_column=Column(Text))


class BenchPanoramaRequestState(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bench_panorama_requests"

    bench_row_id: int = SqlField(primary_key=True, foreign_key="benches.row_id")
    requested_at: str
    attempts: int = 0
    last_attempt_at: str | None = None
    last_error: str | None = SqlField(default=None, sa_column=Column(Text))
