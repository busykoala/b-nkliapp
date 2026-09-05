from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict
from sqlmodel import Field, SQLModel


class PipelineRun(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "pipeline_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str
    status: str
    source_version: Optional[str] = None
    pipeline_version: Optional[str] = None
    stats: Optional[str] = None
    started_at: str
    finished_at: Optional[str] = None


class PipelineCompletion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["completed", "failed", "skipped"]
    stats: dict[str, object]
