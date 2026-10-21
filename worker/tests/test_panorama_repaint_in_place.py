"""In-place repaint selection stays inside existing production geometry."""
import hashlib
import sqlite3
from pathlib import Path

import pytest

from benchly.panorama.repaint_in_place import bound_count, prepare


def fixture(tmp_path):
    root = tmp_path / "panorama"
    key = "a" * 64
    capsule = root / "active" / "generation" / "capsules" / "aa" / (key + ".bpc")
    capsule.parent.mkdir(parents=True)
    capsule.write_bytes(b"sealed local capsule")
    database = tmp_path / "app.sqlite"
    with sqlite3.connect(database) as c:
        c.executescript("""CREATE TABLE benches(row_id INTEGER,id TEXT,latitude REAL,longitude REAL,active INTEGER);
            CREATE TABLE panorama_generations(id TEXT,state TEXT);
            CREATE TABLE bench_panorama_geometry(bench_row_id INTEGER,bench_id TEXT,bench_latitude REAL,
            bench_longitude REAL,status TEXT,generation_id TEXT,geometry_key TEXT,artifact_path TEXT,artifact_sha256 TEXT);
            CREATE TABLE bench_panorama_renders(artifact_path TEXT,material_path TEXT,style_version TEXT,status TEXT);
            INSERT INTO benches VALUES(7,'osm-node-7',47,8,1);
            INSERT INTO panorama_generations VALUES('generation','active');""")
        c.execute("INSERT INTO bench_panorama_geometry VALUES(7,'osm-node-7',47,8,'ready','generation',?,?,?)",
                  (key, str(capsule), hashlib.sha256(capsule.read_bytes()).hexdigest()))
    return database, root, capsule


def test_prepare_reuses_existing_capsule_and_requires_exact_resume_selection(tmp_path):
    database, root, capsule = fixture(tmp_path)
    work = root / "working" / "repaint"
    index = prepare(database, root, work, [7])
    key = "a" * 64
    assert index.read_text() == f"{key}\t7\tosm-node-7\t47.0000000000\t8.0000000000\n"
    assert (work / "capsules" / "aa" / (key + ".bpc")).resolve() == capsule
    assert prepare(database, root, work, [7]) == index
    with pytest.raises(ValueError, match="different selection"):
        prepare(database, root, work, [8])
    with pytest.raises(ValueError, match="distinct positive"):
        prepare(database, root, work, [7, 7])


def test_prepare_rejects_changed_location_and_capsule_corruption(tmp_path):
    database, root, capsule = fixture(tmp_path)
    work = root / "working" / "repaint"
    capsule.write_bytes(b"corrupt geometry")
    with pytest.raises(ValueError, match="checksum"):
        prepare(database, root, work, [7])
    with sqlite3.connect(database) as c:
        c.execute("UPDATE benches SET latitude=46")
    with pytest.raises(ValueError, match="current production geography"):
        prepare(database, root, work, [7])
    assert not (work / "index.tsv").exists()


def test_bound_count_requires_both_assets_and_current_painter(tmp_path):
    database, root, _ = fixture(tmp_path)
    prefix = root / "active" / "render-chunks" / "checked"
    with sqlite3.connect(database) as c:
        c.executemany("INSERT INTO bench_panorama_renders VALUES(?,?,?,?)", [
            (str(prefix / "renders/1.webp"), str(prefix / "materials/1.webp"), "current", "ready"),
            (str(prefix / "renders/2.webp"), "/old/material.webp", "current", "ready"),
            (str(prefix / "renders/3.webp"), str(prefix / "materials/3.webp"), "old", "ready"),
        ])
    assert bound_count(database, prefix, "current") == 1
