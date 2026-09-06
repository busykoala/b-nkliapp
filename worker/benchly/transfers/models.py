from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


TableName = Literal[
    "environment_features",
    "land_cover_features",
    "bench_enrichments",
    "official_context_sources",
]


class TransferHeader(BaseModel):
    model_config = ConfigDict(extra="allow")
    format: Literal["benchly-geography-v1"]


class TransferRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    table: TableName
    row: dict[str, Any]


class TransferFooter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    complete: Literal[True]
    counts: dict[TableName, int]


class TransferResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    imported: dict[str, int] = Field(default_factory=dict)
    skipped: dict[str, int] = Field(default_factory=dict)

