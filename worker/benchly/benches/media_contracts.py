"""Validated subset of the Wikimedia Commons API used by bench media."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class CommonsMetadataValue(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: str | None = None


class CommonsCoordinate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    lat: float
    lon: float


class CommonsImageInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    url: HttpUrl | None = None
    thumburl: HttpUrl | None = None
    descriptionurl: HttpUrl | None = None
    extmetadata: dict[str, CommonsMetadataValue] = Field(default_factory=dict)


class CommonsPage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    pageid: int | str
    title: str = ""
    coordinates: list[CommonsCoordinate] = Field(default_factory=list)
    imageinfo: list[CommonsImageInfo] = Field(default_factory=list)


class CommonsQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")

    pages: dict[str, dict[str, object]] = Field(default_factory=dict)


class CommonsResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    query: CommonsQuery = Field(default_factory=CommonsQuery)
