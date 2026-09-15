"""Confined, recoverable cleanup of only unreferenced active panorama files."""

from __future__ import annotations

import importlib.util
import os
import sqlite3
import time
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "prune-panorama-orphans.py"
SPEC = importlib.util.spec_from_file_location("panorama_orphan_pruner", SCRIPT)
assert SPEC and SPEC.loader
pruner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pruner)


def test_preview_and_apply_move_only_old_unbound_files(tmp_path: Path) -> None:
    root = tmp_path / "panorama"
    active = root / "active" / "current"
    folder = active / "capsules" / "aa"
    folder.mkdir(parents=True)
    manifest_file = folder / "manifest.bpc"
    bound_file = folder / "bound.bpc"
    orphan = folder / "orphan.bpc"
    young = folder / "young.bpc"
    for file in (manifest_file, bound_file, orphan, young):
        file.write_bytes(file.name.encode())
    old = time.time() - 48 * 3600
    for file in (manifest_file, bound_file, orphan):
        os.utime(file, (old, old))
    database = tmp_path / "state.sqlite"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE panorama_generations(id TEXT,state TEXT,activated_at TEXT)")
        connection.execute("INSERT INTO panorama_generations VALUES('current','active','2026-09-15')")
        connection.execute("CREATE TABLE panorama_generation_artifacts(generation_id TEXT,relative_path TEXT)")
        connection.execute("INSERT INTO panorama_generation_artifacts VALUES('current','capsules/aa/manifest.bpc')")
        for table in ("bench_panorama_geometry", "bench_panorama_renders", "bench_panorama_lightmaps"):
            connection.execute(f"CREATE TABLE {table}(artifact_path TEXT)")
        connection.execute("INSERT INTO bench_panorama_geometry VALUES('/panorama/active/current/capsules/aa/bound.bpc')")
    quarantine = tmp_path / "panorama-orphan-quarantine"
    preview = pruner.run(root, database, quarantine, 24, False)
    assert preview["counts"] == {"capsules": 1}
    assert all(file.is_file() for file in (manifest_file, bound_file, orphan, young))
    applied = pruner.run(root, database, quarantine, 24, True)
    assert applied["counts"] == {"capsules": 1}
    assert not orphan.exists()
    assert (quarantine / "current" / "capsules" / "aa" / "orphan.bpc").read_bytes() == b"orphan.bpc"
    assert all(file.is_file() for file in (manifest_file, bound_file, young))
