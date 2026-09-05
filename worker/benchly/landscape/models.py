from __future__ import annotations

from typing import Optional

from pydantic import ConfigDict
from sqlmodel import Field, SQLModel


class LandscapeMetadata(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "metadata"
    __table_args__ = {"extend_existing": True}

    key: str = Field(primary_key=True)
    value: str


class LandscapeCell(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "cells"

    x: int = Field(primary_key=True)
    y: int = Field(primary_key=True)
    latitude: float
    longitude: float
    quiet: float
    nature: float
    water: float
    view: Optional[float] = None
    canopy: float
    horizon: Optional[str] = None
    updated_at: str
