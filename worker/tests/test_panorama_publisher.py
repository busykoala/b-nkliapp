"""The long-running repaint publisher is offline-testable and forward-only."""

from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest


def _publisher():
    path = Path(__file__).resolve().parents[2] / "scripts/publish-panorama-repaint.py"
    spec = importlib.util.spec_from_file_location("panorama_publisher", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sparse_bench_rows_keep_exact_group_counts(tmp_path: Path) -> None:
    publisher = _publisher()
    index = tmp_path / "index.tsv"
    index.write_text("a\t13\tosm-node-13\t47\t8\n"
                     "b\t511\tosm-node-511\t47\t8\n"
                     "c\t512\tosm-node-512\t47\t8\n")
    assert publisher._groups(index) == {0: 2, 1: 1}


def test_ready_group_requires_current_painter_and_all_benches() -> None:
    publisher = _publisher()
    database = sqlite3.connect(":memory:")
    database.execute("CREATE TABLE painted(bench_row_id INTEGER,painter_key TEXT)")
    database.executemany("INSERT INTO painted VALUES(?,?)",
                         [(13, "new"), (511, "new"), (512, "old")])
    assert publisher._ready(database, 0, "new", 2)
    assert not publisher._ready(database, 1, "new", 1)
    assert not publisher._ready(database, 0, "new", 3)


def test_publication_ledger_is_durable(tmp_path: Path) -> None:
    publisher = _publisher()
    database = publisher.refresh.publication_ledger(tmp_path)
    publisher.refresh.publication_mark(database, 5, "a" * 64, "uploaded")
    database.close()
    database = publisher.refresh.publication_ledger(tmp_path)
    assert database.execute("SELECT chunk_id,status FROM published WHERE group_id=5").fetchone() == ("a" * 64, "uploaded")
    publisher.refresh.publication_mark(database, 5, "a" * 64, "applied")
    assert database.execute("SELECT status FROM published WHERE group_id=5").fetchone() == ("applied",)
    database.close()


def test_worker_selection_and_remote_binding_are_conservative(monkeypatch) -> None:
    publisher = _publisher()
    payload = {"items": [
        {"metadata": {"name": "benchly-panorama-reconcile-old"},
         "status": {"phase": "Running", "containerStatuses": [{"ready": True}]}},
        {"metadata": {"name": "benchly-panorama-new"},
         "status": {"phase": "Running", "containerStatuses": [{"ready": True}]}},
        {"metadata": {"name": "benchly-panorama-unready"},
         "status": {"phase": "Running", "containerStatuses": [{"ready": False}]}},
    ]}
    monkeypatch.setattr(publisher, "_run", lambda *_args, **_kwargs: json.dumps(payload))
    assert publisher._pod() == "benchly-panorama-new"
    monkeypatch.setattr(publisher, "_run", lambda *_args, **_kwargs: "1 3")
    assert publisher._remote_applied("benchly-panorama-new", "a" * 64, 3)
    monkeypatch.setattr(publisher, "_run", lambda *_args, **_kwargs: "1 2")
    with pytest.raises(RuntimeError, match="partial production binding"):
        publisher._remote_applied("benchly-panorama-new", "a" * 64, 3)
    monkeypatch.setattr(publisher, "_run", lambda *_args, **_kwargs: "1 0")
    with pytest.raises(RuntimeError, match="image/DB mismatch"):
        publisher._remote_applied("benchly-panorama-new", "a" * 64, 3)


def test_remote_activation_never_applies_without_explicit_flag(monkeypatch) -> None:
    publisher = _publisher()
    commands = []
    monkeypatch.setattr(publisher, "_run", lambda argv, **_kwargs: commands.append(argv) or "{}")
    publisher._remote_worker("benchly-panorama-new", "a" * 64, apply=False)
    publisher._remote_worker("benchly-panorama-new", "a" * 64, apply=True)
    assert " --apply" not in commands[0][-1]
    assert commands[1][-1].endswith(" --apply")
