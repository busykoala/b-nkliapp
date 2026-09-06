from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field as PydanticField, HttpUrl
from sqlalchemy import Column, LargeBinary
from sqlmodel import Field, SQLModel


class WeatherSnapshot(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "weather_snapshots"

    source: str = Field(primary_key=True)
    parameter: str = Field(primary_key=True)
    reference_at: str
    valid_at: str
    origin_easting: float
    origin_northing: float
    resolution_meters: float
    width: int
    height: int
    values_blob: bytes = Field(sa_column=Column(LargeBinary, nullable=False))
    nodata_value: Optional[float] = None
    imported_at: str


class RadarAsset(BaseModel):
    model_config = ConfigDict(extra="ignore")

    href: HttpUrl


class RadarItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    assets: dict[str, RadarAsset] = PydanticField(default_factory=dict)
