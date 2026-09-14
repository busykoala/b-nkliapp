from __future__ import annotations

import sqlite3

from benchly.panorama.models import LightMapIdentity, RenderIdentity
from benchly.panorama.repository import (
    activate_generation,
    delete_fulfilled_requests,
    mark_failed,
    mark_generating,
    mark_lightmap_ready,
    mark_ready,
    mark_render_ready,
    mark_request_retry,
    pending_benches,
)


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
        updated_at TEXT NOT NULL,error TEXT,generation_id TEXT,capsule_format TEXT DEFAULT 'npz-json',artifact_sha256 TEXT
      );
      CREATE TABLE bench_panorama_renders(
        id INTEGER PRIMARY KEY AUTOINCREMENT,bench_row_id INTEGER NOT NULL,geometry_key TEXT NOT NULL,
        render_key TEXT NOT NULL UNIQUE,artifact_path TEXT,status TEXT NOT NULL,style_version TEXT NOT NULL,
        center_azimuth_degrees REAL NOT NULL,horizontal_fov_degrees REAL NOT NULL,width INTEGER NOT NULL,
        height INTEGER NOT NULL,weather_bucket TEXT NOT NULL,solar_lunar_bucket TEXT NOT NULL,
        bench_variant TEXT NOT NULL,covered INTEGER,artifact_bytes INTEGER,generated_at TEXT,
        updated_at TEXT NOT NULL,error TEXT,season_bucket TEXT NOT NULL DEFAULT 'summer',
        artifact_format TEXT NOT NULL DEFAULT 'webp',manifest_path TEXT,
        source_completeness TEXT NOT NULL DEFAULT 'partial',generation_id TEXT,artifact_sha256 TEXT,
        material_key TEXT,material_path TEXT,material_sha256 TEXT,material_bytes INTEGER
      );
      CREATE TABLE bench_panorama_requests(
        bench_row_id INTEGER PRIMARY KEY,requested_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,last_error TEXT,status TEXT NOT NULL DEFAULT 'pending',priority INTEGER NOT NULL DEFAULT 100,
        lease_owner TEXT,lease_until TEXT,next_attempt_at TEXT
      );
      CREATE TABLE bench_panorama_lightmaps(
        id INTEGER PRIMARY KEY AUTOINCREMENT,bench_row_id INTEGER NOT NULL,geometry_key TEXT NOT NULL,
        light_key TEXT NOT NULL UNIQUE,solar_bucket TEXT NOT NULL,sun_azimuth_degrees REAL NOT NULL,
        sun_altitude_degrees REAL NOT NULL,artifact_path TEXT,status TEXT NOT NULL,artifact_bytes INTEGER,
        generated_at TEXT,expires_at TEXT,updated_at TEXT NOT NULL,error TEXT
      );
      CREATE TABLE panorama_generations(
        id TEXT PRIMARY KEY,git_commit TEXT NOT NULL,state TEXT NOT NULL,source_versions_json TEXT NOT NULL,
        manifest_sha256 TEXT,artifact_count INTEGER NOT NULL DEFAULT 0,artifact_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,verified_at TEXT,activated_at TEXT,error TEXT
      );
      CREATE TABLE panorama_generation_artifacts(
        generation_id TEXT NOT NULL,artifact_key TEXT NOT NULL,kind TEXT NOT NULL,relative_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,artifact_bytes INTEGER NOT NULL,bench_row_id INTEGER,bench_id TEXT,
        bench_latitude REAL,bench_longitude REAL,created_at TEXT NOT NULL,
        PRIMARY KEY(generation_id,artifact_key,kind)
      );
      INSERT INTO bench_panorama_requests(bench_row_id,requested_at) VALUES(7,'2026-09-12');
    """)
    return connection


def test_repository_upserts_geometry_and_full_circle_render_state():
    connection = database()
    row = {"row_id": 7, "id": "osm-node-7", "latitude": 47.0, "longitude": 8.0}
    versions = {"terrain": "t", "semantic": "s", "building": "b", "algorithm": "a"}
    mark_generating(connection, row, "g" * 64, versions)
    mark_ready(connection, 7, "g" * 64, "/cache/geometry-v4.npz", 123, True, ())
    assert connection.execute("SELECT count(*) FROM bench_panorama_requests").fetchone()[0] == 1
    identity = RenderIdentity(
        geometry_key="g" * 64, center_azimuth_degrees=0, horizontal_fov_degrees=360,
        width=4096, height=1024, season_bucket="dynamic",
    )
    light = LightMapIdentity(geometry_key="g" * 64, solar_bucket="2026-09-12T10:00:00+00:00",
        sun_azimuth_degrees=180, sun_altitude_degrees=30)
    mark_lightmap_ready(connection, 7, light, "l" * 64, "/cache/light.webp", 64)
    mark_render_ready(connection, 7, identity, "/cache/render.webp", 456)

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
    mark_ready(connection, 7, "g" * 64, "/cache/geometry-v4.npz", 123, True, ())
    connection.execute("""INSERT INTO panorama_generations(
      id,git_commit,state,source_versions_json,created_at
    ) VALUES('active-generation','abcdef0','active','{}','2026-09-13')""")
    identity = RenderIdentity(
        geometry_key="g" * 64, center_azimuth_degrees=0, horizontal_fov_degrees=360,
        width=4096, height=1024, season_bucket="dynamic",
    )
    mark_render_ready(connection, 7, identity, "/cache/render.webp", 456, generation_id="active-generation")

    def selected(current_versions=versions, style=identity.style_version):
        return pending_benches(connection, "a", current_versions, style, 4096, 1024, "dynamic", 10)

    assert selected() == []
    assert [item["id"] for item in selected({**versions, "building": "new"})] == ["osm-node-7"]
    assert [item["id"] for item in selected(style="panorama-watercolor-next")] == ["osm-node-7"]

    connection.execute("UPDATE benches SET direction_degrees=275")
    connection.commit()
    assert selected() == []

    connection.execute("UPDATE benches SET material='metal',covered=1")
    connection.commit()
    assert selected() == []

    connection.execute("UPDATE benches SET longitude=longitude+5e-10")
    connection.commit()
    assert selected() == []

    # A UI request must not force the expensive geographic pipeline when the
    # active browser-consumable painting is already ready.
    connection.execute("INSERT INTO bench_panorama_requests(bench_row_id,requested_at) VALUES(7,'2026-09-13')")
    connection.commit()
    assert selected() == []
    assert pending_benches(connection, "a", versions, identity.style_version, 4096, 1024, "dynamic", 10, 0, 4) == []
    assert pending_benches(
        connection, "a", versions, identity.style_version, 4096, 1024, "dynamic", 10, 3, 4,
    ) == []
    assert delete_fulfilled_requests(connection) == 1
    assert connection.execute("SELECT count(*) FROM bench_panorama_requests").fetchone()[0] == 0

    connection.execute("UPDATE bench_panorama_requests SET status='retry',next_attempt_at='2099-01-01'")
    connection.commit()
    assert selected() == []

    connection.execute("UPDATE bench_panorama_requests SET status='leased',next_attempt_at=NULL,lease_until='2099-01-01'")
    connection.commit()
    assert selected() == []


def test_backfill_failures_create_a_delayed_retry_instead_of_hot_looping():
    connection = database()
    connection.execute("DELETE FROM bench_panorama_requests")
    connection.commit()
    mark_request_retry(connection, 7, "terrain unavailable")
    retry = connection.execute(
        "SELECT status,attempts,next_attempt_at,last_error FROM bench_panorama_requests WHERE bench_row_id=7"
    ).fetchone()
    assert retry["status"] == "retry"
    assert retry["attempts"] == 1
    assert retry["next_attempt_at"] is not None
    assert retry["last_error"] == "terrain unavailable"

    row = dict(connection.execute("SELECT * FROM benches WHERE row_id=7").fetchone())
    versions = {"algorithm": "a"}
    connection.execute("DELETE FROM bench_panorama_requests")
    connection.commit()
    mark_generating(connection, row, "g" * 64, versions)
    mark_failed(connection, 7, "g" * 64, "error", "render failure")
    retry = connection.execute(
        "SELECT status,attempts,next_attempt_at,last_error FROM bench_panorama_requests WHERE bench_row_id=7"
    ).fetchone()
    assert retry["status"] == "retry"
    assert retry["attempts"] == 1
    assert retry["next_attempt_at"] is not None
    assert retry["last_error"] == "render failure"


def test_activation_publishes_verified_content_with_typed_models():
    connection = database()
    geometry_key = "a" * 64
    records = []
    for kind, digest, path in (
        ("capsule", "b" * 64, "capsules/aa/file.bpc"),
        ("render", "c" * 64, "renders/aa/file.webp"),
        ("material", "d" * 64, "materials/aa/file.webp"),
    ):
        records.append({
            "geometry_key": geometry_key, "kind": kind, "relative_path": path,
            "sha256": digest, "bytes": 10, "bench_row_id": 7, "bench_id": "osm-node-7",
            "bench_latitude": 47.0, "bench_longitude": 8.0,
        })
    manifest = {
        "generation_id": "abcdef123456-content", "git_commit": "abcdef1234567890",
        "geometry_implementation": "geometry-hash", "render_implementation": "render-hash",
        "artifact_count": 3, "artifact_bytes": 30, "created_at": "2026-09-13", "artifacts": records,
    }
    activate_generation(connection, manifest, "e" * 64, "/panorama/active/abcdef123456-content")
    connection.commit()
    assert tuple(connection.execute(
        "SELECT id,git_commit,state,artifact_count FROM panorama_generations"
    ).fetchone()) == ("abcdef123456-content", "abcdef1234567890", "active", 3)
    assert connection.execute("SELECT count(*) FROM panorama_generation_artifacts").fetchone()[0] == 3
    assert tuple(connection.execute(
        "SELECT generation_id,capsule_format,algorithm_version FROM bench_panorama_geometry"
    ).fetchone()) == ("abcdef123456-content", "benchly-view-capsule", "geometry-hash")
    assert tuple(connection.execute(
        "SELECT generation_id,style_version,material_key FROM bench_panorama_renders"
    ).fetchone()) == ("abcdef123456-content", "render-hash", "d" * 64)


def test_activation_binds_shared_geometry_to_each_colocated_bench():
    connection = database()
    connection.execute("INSERT INTO benches VALUES(8,'osm-node-8',47,8,'wood',1,0,0,1,180)")
    geometry_key = "a" * 64
    records = []
    for bench_row_id in (7, 8):
        for kind, digest, path in (
            ("capsule", "b" * 64, "capsules/aa/file.bpc"),
            ("render", "c" * 64, "renders/aa/file.webp"),
            ("material", "d" * 64, "materials/aa/file.webp"),
        ):
            records.append({
                "geometry_key": geometry_key, "kind": kind, "relative_path": path,
                "sha256": digest, "bytes": 10, "bench_row_id": bench_row_id,
                "bench_id": f"osm-node-{bench_row_id}", "bench_latitude": 47.0,
                "bench_longitude": 8.0,
            })
    manifest = {
        "generation_id": "abcdef123456-shared", "git_commit": "abcdef1234567890",
        "geometry_implementation": "geometry-hash", "render_implementation": "render-hash",
        "artifact_count": 6, "artifact_bytes": 60, "created_at": "2026-09-13", "artifacts": records,
    }
    activate_generation(connection, manifest, "e" * 64, "/panorama/active/abcdef123456-shared")
    connection.commit()
    assert connection.execute("SELECT count(*) FROM panorama_generation_artifacts").fetchone()[0] == 6
    assert connection.execute("SELECT count(*) FROM bench_panorama_geometry").fetchone()[0] == 2
    assert connection.execute("SELECT count(DISTINCT render_key) FROM bench_panorama_renders").fetchone()[0] == 2
