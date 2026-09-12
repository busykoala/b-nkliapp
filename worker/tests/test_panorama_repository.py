from __future__ import annotations

import sqlite3

from benchly.panorama.models import RenderIdentity
from benchly.panorama.repository import mark_generating, mark_ready, mark_render_ready


def database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript("""
      CREATE TABLE benches(row_id INTEGER PRIMARY KEY);
      INSERT INTO benches(row_id) VALUES(7);
      CREATE TABLE bench_panorama_geometry(
        bench_row_id INTEGER PRIMARY KEY,bench_id TEXT NOT NULL,bench_latitude REAL NOT NULL,
        bench_longitude REAL NOT NULL,geometry_key TEXT NOT NULL,artifact_path TEXT,status TEXT NOT NULL,
        complete INTEGER NOT NULL,source_versions_json TEXT NOT NULL,algorithm_version TEXT NOT NULL,
        warnings_json TEXT NOT NULL,artifact_bytes INTEGER,started_at TEXT,generated_at TEXT,
        updated_at TEXT NOT NULL,error TEXT
      );
      CREATE TABLE bench_panorama_renders(
        id INTEGER PRIMARY KEY AUTOINCREMENT,bench_row_id INTEGER NOT NULL,geometry_key TEXT NOT NULL,
        render_key TEXT NOT NULL UNIQUE,artifact_path TEXT,status TEXT NOT NULL,style_version TEXT NOT NULL,
        center_azimuth_degrees REAL NOT NULL,horizontal_fov_degrees REAL NOT NULL,width INTEGER NOT NULL,
        height INTEGER NOT NULL,weather_bucket TEXT NOT NULL,solar_lunar_bucket TEXT NOT NULL,
        bench_variant TEXT NOT NULL,covered INTEGER,artifact_bytes INTEGER,generated_at TEXT,
        updated_at TEXT NOT NULL,error TEXT
      );
      CREATE TABLE bench_panorama_requests(
        bench_row_id INTEGER PRIMARY KEY,requested_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,last_error TEXT
      );
      INSERT INTO bench_panorama_requests(bench_row_id,requested_at) VALUES(7,'2026-09-12');
    """)
    return connection


def test_repository_upserts_geometry_and_full_circle_render_state():
    connection = database()
    row = {"row_id": 7, "id": "osm-node-7", "latitude": 47.0, "longitude": 8.0}
    versions = {"terrain": "t", "semantic": "s", "building": "b", "algorithm": "a"}
    mark_generating(connection, row, "g" * 64, versions)
    mark_ready(connection, 7, "g" * 64, "/cache/geometry.json.gz", 123, True, ())
    identity = RenderIdentity(
        geometry_key="g" * 64, center_azimuth_degrees=0, horizontal_fov_degrees=360,
        width=3600, height=900, weather_bucket="neutral", solar_lunar_bucket="neutral",
        bench_variant="wood-back", covered=False,
    )
    mark_render_ready(connection, 7, identity, "/cache/render.svg.gz", 456)

    geometry = connection.execute("SELECT status,complete,artifact_bytes FROM bench_panorama_geometry").fetchone()
    render = connection.execute("SELECT status,horizontal_fov_degrees,artifact_bytes FROM bench_panorama_renders").fetchone()
    assert tuple(geometry) == ("ready", 1, 123)
    assert tuple(render) == ("ready", 360.0, 456)
    assert connection.execute("SELECT count(*) FROM bench_panorama_requests").fetchone()[0] == 0
