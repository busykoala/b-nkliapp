"""Validated scene-model contract shared by analysis and reconciliation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


PROBABILITY_KEYS = (
    "relevance_probability", "forest_probability", "park_probability", "open_probability", "urban_probability",
    "canopy_probability", "water_probability", "lake_view_probability", "mountain_view_probability",
    "open_view_probability", "limited_view_probability", "buildings_probability", "road_rail_probability",
    "bench_visible_probability",
)


class ScenePrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relevance_probability: float = Field(ge=0, le=1)
    forest_probability: float = Field(ge=0, le=1)
    park_probability: float = Field(ge=0, le=1)
    open_probability: float = Field(ge=0, le=1)
    urban_probability: float = Field(ge=0, le=1)
    canopy_probability: float = Field(ge=0, le=1)
    water_probability: float = Field(ge=0, le=1)
    lake_view_probability: float = Field(ge=0, le=1)
    mountain_view_probability: float = Field(ge=0, le=1)
    open_view_probability: float = Field(ge=0, le=1)
    limited_view_probability: float = Field(ge=0, le=1)
    buildings_probability: float = Field(ge=0, le=1)
    road_rail_probability: float = Field(ge=0, le=1)
    bench_visible_probability: float = Field(ge=0, le=1)
    rejection_reason: Literal["none", "blurred", "indoor", "close_object", "historical", "unrelated"]
    canopy_context: Literal["none", "partial", "dense", "unknown"]


def prediction_schema() -> dict[str, object]:
    return {
        "type": "object", "additionalProperties": False,
        "properties": {
            **{key: {"type": "number", "minimum": 0, "maximum": 1} for key in PROBABILITY_KEYS},
            "rejection_reason": {"type": "string", "enum": ["none", "blurred", "indoor", "close_object", "historical", "unrelated"]},
            "canopy_context": {"type": "string", "enum": ["none", "partial", "dense", "unknown"]},
        },
        "required": [*PROBABILITY_KEYS, "rejection_reason", "canopy_context"],
    }


def validate_scene_prediction(value: object) -> dict[str, object]:
    return ScenePrediction.model_validate(value).model_dump()
