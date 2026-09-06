from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Field as SqlField, SQLModel


class SourceProbe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(pattern=r"^[a-z0-9-]+$")
    url: str
    checked_at: str
    status_code: int = Field(ge=100, le=599)
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    content_length: Optional[int] = Field(default=None, ge=0)
    fingerprint: str = Field(min_length=64, max_length=64)


class SourceVersion(SQLModel, table=True):
    __tablename__ = "external_source_versions"

    source_id: str = SqlField(primary_key=True)
    url: str
    checked_at: str
    status_code: int
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    content_length: Optional[int] = None
    fingerprint: str

