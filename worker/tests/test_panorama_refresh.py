"""Repaint checkpoints and bounded forward-only activation, without remote access."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from argparse import Namespace
from pathlib import Path

import pytest

from benchly.panorama import refresh
from benchly.panorama.builder import SERVER, _production_index_query, _require_upload_target


def test_public_ssh_target_is_approved_and_unknown_targets_are_rejected() -> None:
    assert SERVER == "busykoala@api.blizzard.busykoala.io"
    _require_upload_target(SERVER)
    _require_upload_target("busykoala@192.168.1.206")
    with pytest.raises(RuntimeError, match="approved SSH targets"):
        _require_upload_target("busykoala@unverified.example")


def test_repaint_checks_logical_pv_capacity_not_only_host_disk() -> None:
    gib = 1024**3
    refresh._require_logical_headroom(58 * gib, gib, 80)
    with pytest.raises(RuntimeError, match="logical panorama PV headroom"):
        refresh._require_logical_headroom(61 * gib, gib, 80)


def test_production_index_accepts_only_sub_meter_coordinate_roundoff() -> None:
    database = sqlite3.connect(":memory:")
    database.execute("CREATE TABLE benches(row_id INTEGER,id TEXT,latitude REAL,longitude REAL,active INTEGER)")
    database.execute("CREATE TABLE bench_panorama_geometry(bench_row_id INTEGER,bench_id TEXT,"
                     "bench_latitude REAL,bench_longitude REAL,status TEXT,geometry_key TEXT)")
    for row, drift in ((1, 1e-14), (2, 1e-7)):
        database.execute("INSERT INTO benches VALUES(?,?,?,?,1)", (row, f"osm-node-{row}", 47.0, 8.0))
        database.execute("INSERT INTO bench_panorama_geometry VALUES(?,?,?,?,?,?)",
                         (row, f"osm-node-{row}", 47.0 + drift, 8.0, "ready", "a" * 64))
    rows = database.execute(_production_index_query()).fetchall()
    assert rows[0][0] == "a" * 64
    assert rows[1][0] == ""


def test_remote_capsule_path_is_confined_to_matching_active_artifact() -> None:
    key = "a" * 64
    assert refresh._remote_capsule_path(f"/panorama/active/current/capsules/aa/{key}.bpc", key) == f"active/current/capsules/aa/{key}.bpc"
    for path in (f"/panorama/incoming/current/capsules/aa/{key}.bpc",
                 f"/panorama/active/current/capsules/ab/{key}.bpc",
                 f"/panorama/active/current/capsules/aa/{'b' * 64}.bpc"):
        with pytest.raises(ValueError, match="capsule path"):
            refresh._remote_capsule_path(path, key)


def test_capsule_fetch_skips_missing_geography_without_remote_calls(tmp_path: Path, monkeypatch) -> None:
    key = "a" * 64
    capsules = tmp_path / "capsules"
    source = capsules / "aa" / f"{key}.bpc"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"cached")
    index = tmp_path / "production.tsv"
    index.write_text(f"{key}\t1\tosm-node-1\t47\t8\n\t2\tosm-node-2\t46\t9\n")
    monkeypatch.setattr(refresh.subprocess, "run", lambda *_args, **_kwargs: pytest.fail("unexpected remote access"))
    output = tmp_path / "current.tsv"
    refresh.fetch_repaint_capsules_job(Namespace(target=SERVER, capsule_root=str(capsules), bench_index=str(index),
                                                output=str(output), remote_database="/does-not-matter"))
    assert output.read_text() == f"{key}\t1\tosm-node-1\t47.0000000000\t8.0000000000\n"


def _seal(folder: Path, record: dict, painter: str = "painter") -> dict:
    content = {"format": refresh.FORMAT, "schema": refresh.SCHEMA, "painter_key": painter,
               "season": "autumn", "group": 0, "records": [record], "artifact_bytes": record["bytes"]}
    chunk_id = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    manifest = {**content, "chunk_id": chunk_id}
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
    (folder / "manifest.sha256").write_text(refresh._digest(folder / "manifest.json") + "  manifest.json\n")
    return manifest


def test_corrupt_chunk_is_rejected(tmp_path: Path) -> None:
    folder = tmp_path / "chunk"
    folder.mkdir()
    picture = folder / "renders" / "1-good.webp"
    picture.parent.mkdir()
    picture.write_bytes(b"original image")
    record = {"bench_row_id": 1, "bench_id": "osm-node-1", "latitude": 47.0, "longitude": 8.0,
              "geometry_key": "a" * 64, "relative_path": "renders/1-good.webp",
              "sha256": refresh._digest(picture), "bytes": picture.stat().st_size}
    manifest = _seal(folder, record)
    refresh._verify_chunk(folder, manifest)
    picture.write_bytes(b"corrupt image!")
    with pytest.raises(ValueError, match="invalid paint artifact"):
        refresh._verify_chunk(folder, manifest)


def test_repaint_index_uses_sealed_capsules_not_an_older_tsv(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    records = [{"kind": kind, "bench_row_id": 5, "bench_id": "osm-node-5",
                "bench_latitude": 47.1, "bench_longitude": 8.2, "geometry_key": "c" * 64}
               for kind in ("capsule", "render", "material")]
    manifest.write_text(json.dumps({"format": "benchly-panorama-generation", "schema": 1,
                                    "artifact_count": 3, "artifacts": records}))
    output = tmp_path / "index.tsv"
    refresh.repaint_index_job(Namespace(manifest=str(manifest), output=str(output)))
    assert output.read_text() == f"{'c' * 64}\t5\tosm-node-5\t47.1000000000\t8.2000000000\n"


def test_interrupted_repaint_reuses_completed_image(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "repaint"
    capsules = tmp_path / "capsules"
    index = tmp_path / "index.tsv"
    lines = []
    for row, letter in ((1, "a"), (2, "b")):
        key = letter * 64
        source = capsules / key[:2] / f"{key}.bpc"
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(f"source-{row}".encode())
        lines.append(f"{key}\t{row}\tosm-node-{row}\t47\t8\n")
    index.write_text("".join(lines))
    painter = "checked-in-source-hash"
    monkeypatch.setattr(refresh, "_painter_key", lambda: painter)
    calls: list[int] = []
    interrupt = [True]

    def fake_render(task):
        row, bench_id, lat, lon, key, source, season, destination = task
        calls.append(row)
        image = f"painted-{row}".encode()
        sha = hashlib.sha256(image).hexdigest()
        relative = Path("chunks") / str(row // 512) / "renders" / f"{row}-{sha}.webp"
        refresh._atomic(destination / relative, image)
        stat = source.stat()
        return {"bench_row_id": row, "bench_id": bench_id, "latitude": lat, "longitude": lon,
                "geometry_key": key, "source_size": stat.st_size, "source_mtime_ns": stat.st_mtime_ns,
                "season": season, "relative_path": str(relative), "sha256": sha,
                "artifact_bytes": len(image), "finished_at": "2026-09-15"}

    class FakePool:
        def __init__(self, **_kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def submit(self, function, task):
            class FakeFuture:
                def result(self):
                    if interrupt[0] and task[0] == 2:
                        raise KeyboardInterrupt()
                    return function(task)
            return FakeFuture()

    monkeypatch.setattr(refresh, "_render", fake_render)
    monkeypatch.setattr(refresh.concurrent.futures, "ProcessPoolExecutor", FakePool)
    monkeypatch.setattr(refresh.concurrent.futures, "as_completed", lambda futures: futures)
    args = Namespace(root=str(root), capsule_root=str(capsules), bench_index=str(index),
                     season="autumn", cpu_workers=1, limit=0)
    with pytest.raises(KeyboardInterrupt):
        refresh.repaint_job(args)
    interrupt[0] = False
    refresh.repaint_job(args)
    assert calls == [1, 2]
    refresh.seal_repaint_job(args)
    manifest = json.loads((root / "chunks" / "0" / "manifest.json").read_text())
    assert len(manifest["records"]) == 2
    key = "c" * 64
    source = capsules / key[:2] / f"{key}.bpc"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"source-513")
    index.write_text(index.read_text() + f"{key}\t513\tosm-node-513\t47\t8\n")
    args.group = 1
    refresh.repaint_job(args)
    refresh.seal_repaint_job(args)
    assert calls == [1, 2, 513]
    assert [record["bench_row_id"] for record in json.loads((root / "chunks" / "1" / "manifest.json").read_text())["records"]] == [513]


def test_chunk_rejects_duplicate_benches_and_oversize_manifest(tmp_path: Path) -> None:
    folder = tmp_path / "chunk"
    image = folder / "renders" / "1-good.webp"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"watercolor")
    record = {"bench_row_id": 1, "bench_id": "osm-node-1", "latitude": 47.0, "longitude": 8.0,
              "geometry_key": "a" * 64, "relative_path": "renders/1-good.webp",
              "sha256": refresh._digest(image), "bytes": image.stat().st_size}
    manifest = _seal(folder, record)
    manifest["records"] = [record, record]
    manifest["artifact_bytes"] = 2 * record["bytes"]
    content = {key: value for key, value in manifest.items() if key != "chunk_id"}
    manifest["chunk_id"] = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    (folder / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
    (folder / "manifest.sha256").write_text(refresh._digest(folder / "manifest.json") + "  manifest.json\n")
    with pytest.raises(ValueError, match="duplicate"):
        refresh._verify_chunk(folder, manifest)
    manifest = _seal(folder, record)
    manifest["artifact_bytes"] = 513 * 1024 * 1024
    content = {key: value for key, value in manifest.items() if key != "chunk_id"}
    manifest["chunk_id"] = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    (folder / "manifest.json").write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
    (folder / "manifest.sha256").write_text(refresh._digest(folder / "manifest.json") + "  manifest.json\n")
    with pytest.raises(ValueError, match="512-MiB"):
        refresh._verify_chunk(folder, manifest)


def test_activation_previews_then_replaces_only_the_old_image(tmp_path: Path, monkeypatch) -> None:
    painter = "checked-in-source-hash"
    monkeypatch.setattr(refresh, "_painter_key", lambda: painter)
    monkeypatch.setattr(refresh, "MINIMUM_FREE_BYTES", 1)
    root = tmp_path / "server"
    alias = tmp_path / "media-alias"
    old = root / "active" / "old" / "renders" / "1-old.webp"
    old.parent.mkdir(parents=True)
    old.write_bytes(b"old image")
    database_path = tmp_path / "app.sqlite"
    database = sqlite3.connect(database_path)
    database.executescript("""
      CREATE TABLE benches(row_id INTEGER PRIMARY KEY,id TEXT,latitude REAL,longitude REAL,active INTEGER);
      CREATE TABLE bench_panorama_geometry(bench_row_id INTEGER,geometry_key TEXT,status TEXT);
      CREATE TABLE bench_panorama_renders(bench_row_id INTEGER,geometry_key TEXT,status TEXT,
        artifact_path TEXT,render_key TEXT,style_version TEXT,artifact_bytes INTEGER,
        artifact_sha256 TEXT,generated_at TEXT,updated_at TEXT);
    """)
    database.execute("INSERT INTO benches VALUES(1,'osm-node-1',47,8,1)")
    database.execute("INSERT INTO bench_panorama_geometry VALUES(1,?,'ready')", ("a" * 64,))
    database.execute("INSERT INTO bench_panorama_renders VALUES(1,?,'ready',?,'old','old',9,'old','yesterday','yesterday')",
                     ("a" * 64, str(alias / "active" / "old" / "renders" / "1-old.webp")))
    database.commit()
    database.close()
    image = b"new watercolor"
    record = {"bench_row_id": 1, "bench_id": "osm-node-1", "latitude": 47.0, "longitude": 8.0,
              "geometry_key": "a" * 64, "relative_path": "renders/1-new.webp",
              "sha256": hashlib.sha256(image).hexdigest(), "bytes": len(image)}
    staging = root / "incoming" / "paint" / "staging"
    staging.mkdir(parents=True)
    (staging / "renders").mkdir()
    (staging / "renders" / "1-new.webp").write_bytes(image)
    manifest = _seal(staging, record, painter)
    staging.rename(staging.parent / manifest["chunk_id"])
    args = Namespace(server_root=str(root), artifact_root=str(alias), database=str(database_path),
                     chunk_id=manifest["chunk_id"], apply=False)
    refresh.activate_repaint_job(args)
    assert old.exists()
    assert (root / "incoming" / "paint" / manifest["chunk_id"]).exists()
    args.apply = True
    refresh.activate_repaint_job(args)
    assert not old.exists()
    assert (root / "active" / "render-chunks" / manifest["chunk_id"] / record["relative_path"]).read_bytes() == image
    database = sqlite3.connect(database_path)
    assert database.execute("SELECT render_key FROM bench_panorama_renders").fetchone()[0] == record["sha256"]
    database.close()
