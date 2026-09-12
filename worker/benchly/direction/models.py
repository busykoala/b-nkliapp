from __future__ import annotations

from pydantic import ConfigDict
from sqlmodel import Field, SQLModel


class BenchDirectionEstimate(SQLModel, table=True):
    model_config = ConfigDict(extra="forbid")
    __tablename__ = "bench_direction_estimates"

    bench_row_id: int = Field(primary_key=True, foreign_key="benches.row_id")
    bench_id: str
    bench_latitude: float
    bench_longitude: float
    direction_degrees: float
    top_probability: float
    entropy: float
    probabilities_json: str
    signals_json: str
    source_versions_json: str
    analysis_run_id: str
    method_version: str
    computed_at: str
    published_at: str
