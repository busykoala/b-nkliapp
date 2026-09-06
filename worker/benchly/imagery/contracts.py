"""Validated provider responses used only during temporary image discovery."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class ImageAsset(BaseModel):
    model_config = ConfigDict(extra="ignore")

    href: HttpUrl


class PointGeometry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    coordinates: list[float] = Field(min_length=2)


class PanoramaxProperties(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | int | None = None
    assets: dict[str, ImageAsset] = Field(default_factory=dict)
    sequence: str | int | None = None
    sequence_id: str | int | None = None
    heading: float | str | None = None
    compass_angle: float | str | None = None
    view_azimuth: float | str | None = Field(default=None, validation_alias="view:azimuth")
    datetime: str | None = None
    author: str | None = None
    producer: str | None = Field(default=None, validation_alias="geovisio:producer")
    license: str | None = None
    view_url: HttpUrl | None = None


class PanoramaxFeature(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | int | None = None
    collection: str | int | None = None
    geometry: PointGeometry
    properties: PanoramaxProperties = Field(default_factory=PanoramaxProperties)
    assets: dict[str, ImageAsset] = Field(default_factory=dict)


class PanoramaxResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    features: list[dict[str, object]] = Field(default_factory=list)


class KartaViewPhoto(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | int
    lat: float | str
    lng: float | str | None = None
    lon: float | str | None = None
    lth_name: str | None = None
    th_name: str | None = None
    name: str | None = None
    sequence_id: str | int | None = None
    sequence_index: int | str = 0
    heading: float | str | None = None
    headers: float | str | None = None
    shot_date: str | None = None
    date_added: str | None = None
    username: str | None = None


class KartaViewResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    currentPageItems: list[dict[str, object]] = Field(default_factory=list)


class InferenceMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content: str | list[dict[str, object]]


class InferenceChoice(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message: InferenceMessage


class InferenceResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    choices: list[InferenceChoice] = Field(min_length=1)
