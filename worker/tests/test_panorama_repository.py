from __future__ import annotations

import sqlite3

from benchly.panorama.models import RenderIdentity
from benchly.panorama.repository import mark_generating, mark_ready, mark_render_ready, pending_benches


def database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript("""
      CREATE TABLE benches(
        row_id INTEGER PRIMARY KEY,id TEXT,latitude REAL,longitude REAL,material TEXT,
        backrest INTEGER,armrest INTEGER,covered INTEGER,active INTEGER,direction_degrees REAL
      );
      INSERT INTO benches VALUES(7,'osm-node-7',47,8,'wood',1,0,0,1,180);
      CREATE TABLE bench_enrichments(bench_row_id INTEGER PRIMARY KEY,elevation_meters REAL);
      INSERT INTO bench_enrichments VALUES(7,500);
      CREATE TABLE bench_direction_estimates(
        bench_row_id INTEGER PRIMARY KEY,bench_id TEXT,bench_latitude REAL,
        bench_longitude REAL,direction_degrees REAL
      );
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
    assert connection.execute("SELECT count(*) FROM bench_panorama_requests").fetchone()[0] == 1
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


def test_pending_selection_tracks_source_render_and_bench_versions():
    connection = database()
    versions = {
        "terrain": "t", "semantic": "s", "building": "b", "algorithm": "a",
        "angular_resolution_degrees": "0.1", "maximum_distance_meters": "150000",
        "observer_height_meters": "1.1", "semantic_radius_meters": "20000",
        "building_radius_meters": "2000",
    }
    row = dict(connection.execute("SELECT * FROM benches WHERE row_id=7").fetchone())
    mark_generating(connection, row, "g" * 64, versions)
    mark_ready(connection, 7, "g" * 64, "/cache/geometry.json.gz", 123, True, ())
    identity = RenderIdentity(
        geometry_key="g" * 64, center_azimuth_degrees=0, horizontal_fov_degrees=360,
        width=3600, height=900, weather_bucket="phase-b-neutral", solar_lunar_bucket="phase-b-neutral",
        bench_variant="wood-back", covered=False,
    )
    mark_render_ready(connection, 7, identity, "/cache/render.svg.gz", 456)

    def selected(current_versions=versions, style=identity.style_version):
        return pending_benches(connection, "a", current_versions, style, 3600, 900, 10)

    assert selected() == []
    assert [item["id"] for item in selected({**versions, "building": "new"})] == ["osm-node-7"]
    assert [item["id"] for item in selected(style="panorama-watercolor-next")] == ["osm-node-7"]

    connection.execute("UPDATE benches SET direction_degrees=275")
    connection.commit()
    assert selected() == []

    connection.execute("UPDATE benches SET material='metal',covered=1")
    connection.commit()
    assert [item["id"] for item in selected()] == ["osm-node-7"]
