from __future__ import annotations

import sqlite3
from argparse import Namespace

from benchly.moderation import moderate_job


def test_moderation_is_preview_first_and_audited(tmp_path, capsys):
    path = tmp_path / "moderation.sqlite"
    with sqlite3.connect(path) as db:
        db.executescript("""
            CREATE TABLE benches(row_id INTEGER PRIMARY KEY,id TEXT);
            CREATE TABLE ratings(id INTEGER PRIMARY KEY,bench_row_id INTEGER,contributor_hash TEXT,visible INTEGER,created_at TEXT);
            CREATE TABLE corrections(id INTEGER PRIMARY KEY,bench_row_id INTEGER,contributor_hash TEXT,visible INTEGER,created_at TEXT);
            CREATE TABLE reports(target_type TEXT,target_id INTEGER);
            CREATE TABLE blocked_contributors(contributor_hash TEXT PRIMARY KEY,reason TEXT,created_at TEXT);
            CREATE TABLE moderation_audit(id INTEGER PRIMARY KEY,action TEXT,target_type TEXT,target_id TEXT,detail TEXT,created_at TEXT);
            INSERT INTO benches VALUES(1,'osm-node-1');
            INSERT INTO ratings VALUES(1,1,'same-person',1,'2026-09-15');
            INSERT INTO corrections VALUES(2,1,'same-person',1,'2026-09-15');
        """)
    args = Namespace(database=str(path), action="hide", type="rating", id=1, limit=200, reason="test", apply=False)
    moderate_job(args)
    assert '"apply": false' in capsys.readouterr().out
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT visible FROM ratings").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM moderation_audit").fetchone()[0] == 0
    args.apply = True
    moderate_job(args)
    args.action = "block"
    moderate_job(args)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT visible FROM ratings").fetchone()[0] == 0
        assert db.execute("SELECT visible FROM corrections").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM blocked_contributors").fetchone()[0] == 1
        assert [row[0] for row in db.execute("SELECT action FROM moderation_audit")] == ["hide", "block"]
