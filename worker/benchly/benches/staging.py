"""Validate an entire OSM input before touching the published inventory.

This scratch database contains only normalized source batches, never a copy of
user data. Completed batches resume after interruption. The previous generation
is pruned only after every staged batch has been committed to the live database.
"""
from __future__ import annotations
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
from typing import Optional
from sqlalchemy import delete, update
from sqlalchemy.dialects.sqlite import insert
from sqlmodel import Field, SQLModel
from benchly.db import open_database, write
import zlib
from benchly.runtime import now_iso


class StageBatch(SQLModel, table=True):
    __tablename__ = "osm_stage_batches"
    id: Optional[int] = Field(default=None, primary_key=True)
    kind: str
    count: int
    payload: bytes
    published: int = 0


class StageMetadata(SQLModel, table=True):
    __tablename__ = "osm_stage_metadata"
    key: str = Field(primary_key=True)
    value: str


class OsmStage:
    def __init__(self, path: Path, source_version: str):
        stat = path.stat()
        key = hashlib.sha256(f"{path.resolve()}:{stat.st_size}:{stat.st_mtime_ns}:{source_version}".encode()).hexdigest()[:24]
        directory = path.parent / ".osm-stage-v1"
        directory.mkdir(exist_ok=True)
        self.path = directory / f"{key}.sqlite"
        self.database = open_database(self.path)
        self.database.create_tables([StageBatch, StageMetadata])
        self.database.commit()
        self.complete = bool(self.database.execute("SELECT 1 FROM osm_stage_metadata WHERE key='complete'").fetchone())
        if not self.complete:
            write(self.database, delete(StageBatch))
            self.metadata("imported_at", now_iso())
            self.database.commit()
        self.imported_at = self.database.execute("SELECT value FROM osm_stage_metadata WHERE key='imported_at'").fetchone()[0]

    def metadata(self, key, value):
        statement = insert(StageMetadata).values(key=key, value=value)
        write(self.database, statement.on_conflict_do_update(index_elements=["key"], set_={"value": value}))

    def append(self, kind, records):
        rows = []
        for record in records:
            row = asdict(record)
            if row.get("geometry_wkb") is not None:
                row["geometry_wkb"] = row["geometry_wkb"].hex()
            rows.append(row)
        payload = zlib.compress(json.dumps(rows, separators=(",", ":"), allow_nan=False).encode(), level=1)
        write(self.database, insert(StageBatch).values(kind=kind, count=len(rows), payload=payload, published=0))
        self.database.commit()

    def counts(self):
        return dict(self.database.execute("SELECT kind,sum(count) FROM osm_stage_batches GROUP BY kind"))

    def validate(self, previous_count):
        counts = self.counts()
        if not counts.get("bench") or (previous_count > 1000 and counts["bench"] < previous_count * .8):
            raise ValueError(f"Incomplete OSM inventory ({counts.get('bench', 0)} benches); previous source generation retained")
        self.metadata("complete", "1")
        self.database.commit()
        self.complete = True

    def remaining(self):
        for row in self.database.execute("SELECT id,kind,payload FROM osm_stage_batches WHERE published=0 ORDER BY id"):
            records = json.loads(zlib.decompress(row[2]))
            for record in records:
                if record.get("geometry_wkb") is not None:
                    record["geometry_wkb"] = bytes.fromhex(record["geometry_wkb"])
            yield row[0], row[1], records

    def acknowledge(self, batch_id):
        write(self.database, update(StageBatch).where(StageBatch.id == batch_id).values(published=1))
        self.database.commit()

    def close(self):
        self.database.close()
