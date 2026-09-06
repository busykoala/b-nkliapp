"""Validated response shapes for swisstopo STAC endpoints."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class StacAsset(BaseModel):
    model_config = ConfigDict(extra="ignore")

    href: HttpUrl
    title: str = ""
    type: str = ""


class StacProperties(BaseModel):
    model_config = ConfigDict(extra="ignore")

    datetime: str | None = None


class StacItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    bbox: list[float] | None = None
    properties: StacProperties = Field(default_factory=StacProperties)
    assets: dict[str, StacAsset] = Field(default_factory=dict)


class StacLink(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rel: str
    href: HttpUrl


class StacPage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    features: list[StacItem] = Field(default_factory=list)
    links: list[StacLink] = Field(default_factory=list)


class VectorFeature(BaseModel):
    """The stable GeoJSON subset emitted by ogr2ogr for imported source features."""

    model_config = ConfigDict(extra="ignore")

    id: str | int | None = None
    geometry: dict[str, object]
    properties: dict[str, object] = Field(default_factory=dict)
