"""Resumable spatial terrain work, including honest missing-source outcomes."""
from sqlmodel import Field, SQLModel
from benchly.knowledge.repository import compact, upsert
from benchly.runtime import now_iso


class TerrainAttempt(SQLModel, table=True):
    __tablename__ = "bench_terrain_attempts"
    bench_row_id: int = Field(primary_key=True)
    latitude: float
    longitude: float
    method_version: str
    status: str
    coverage_json: str
    attempted_at: str


def record_attempt(database, bench, method, status, coverage=None):
    upsert(database, TerrainAttempt, dict(bench_row_id=bench["row_id"], latitude=bench["latitude"], longitude=bench["longitude"],
        method_version=method, status=status, coverage_json=compact(coverage or {}), attempted_at=now_iso()), ["bench_row_id"])


# Missing border tiles must not hold the national spatial sweep on its first cell.
# Retry them weekly, or immediately after an algorithm change or bench move.
RETRY_ELIGIBLE_SQL = """NOT EXISTS(SELECT 1 FROM bench_terrain_attempts a WHERE a.bench_row_id=b.row_id
    AND a.latitude=b.latitude AND a.longitude=b.longitude AND a.method_version=?
    AND a.status='missing_source' AND julianday(a.attempted_at)>julianday('now','-7 days'))"""
