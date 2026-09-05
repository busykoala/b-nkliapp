from __future__ import annotations

from typing import Optional

from pydantic import ConfigDict
from sqlalchemy import Index
from sqlmodel import Field, SQLModel


class TransitMetadata(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "metadata"
    __table_args__ = {"extend_existing": True}

    key: str = Field(primary_key=True)
    value: str


class TransitStop(SQLModel, table=True):
    __tablename__ = "stops"
    __table_args__ = (Index("stops_public", "public_id"),)
    model_config = ConfigDict(extra="forbid")

    id: str = Field(primary_key=True)
    public_id: str
    parent: str
    platform: str
    name: str
    lat: Optional[float] = Field(default=None, ge=45, le=48)
    lon: Optional[float] = Field(default=None, ge=5, le=11)


class TransitTransfer(SQLModel, table=True):
    __tablename__ = "transfers"
    __table_args__ = (Index("transfers_pair", "from_stop", "to_stop"),)
    model_config = ConfigDict(extra="forbid")

    row_id: Optional[int] = Field(default=None, primary_key=True)
    from_stop: str
    to_stop: str
    type: int = Field(ge=0, le=5)
    minimum: Optional[int] = Field(default=None, ge=0)
    from_route: str
    to_route: str
    from_trip: str
    to_trip: str
