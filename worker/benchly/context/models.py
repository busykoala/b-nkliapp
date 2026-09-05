from __future__ import annotations

from typing import Optional

from pydantic import ConfigDict
from sqlalchemy import Column, LargeBinary, UniqueConstraint
from sqlmodel import Field, SQLModel


class EnvironmentFeature(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "environment_features"
    __table_args__ = (UniqueConstraint("source", "source_id", "kind"),)

    row_id: Optional[int] = Field(default=None, primary_key=True)
    source: str
    source_id: str
    kind: str
    subtype: Optional[str] = None
    center_latitude: float
    center_longitude: float
    min_latitude: float
    max_latitude: float
    min_longitude: float
    max_longitude: float
    height_meters: Optional[float] = None
    raw_tags: str = "{}"
    imported_at: str
    geometry_wkb: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary))
    geometry_crs: int = 2056
    source_version: Optional[str] = None
    source_updated_at: Optional[str] = None
    ground_elevation_meters: Optional[float] = None
    eaves_elevation_meters: Optional[float] = None
    roof_elevation_meters: Optional[float] = None


class LandCoverFeature(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "land_cover_features"
    __table_args__ = (UniqueConstraint("source", "source_id", "class"),)

    row_id: Optional[int] = Field(default=None, primary_key=True)
    source: str
    source_id: str
    cover_class: str = Field(sa_column=Column("class"))
    geometry_wkb: bytes = Field(sa_column=Column(LargeBinary))
    geometry_crs: int = 2056
    min_latitude: float
    max_latitude: float
    min_longitude: float
    max_longitude: float
    source_version: str
    source_updated_at: Optional[str] = None
    imported_at: str


class OfficialContextSource(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "official_context_sources"

    source: str = Field(primary_key=True)
    version: str
    asset_url: str
    asset_checksum: Optional[str] = None
    imported_at: str
    stats: str = "{}"


class BuildingImportCell(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "building_import_cells"

    cell_key: str = Field(primary_key=True)
    bounds: str
    imported_at: str
    stats: str = "{}"


class BuildingSourceAsset(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "building_source_assets"

    asset_id: str = Field(primary_key=True)
    source_version: str
    asset_url: str
    imported_at: str
    stats: str = "{}"
