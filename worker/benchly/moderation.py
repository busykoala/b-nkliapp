"""Audited, preview-first moderation without an exposed web administrator."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from benchly.moderation_repository import block_contributor, change_visibility, record_moderation


def moderate_job(args) -> None:
    path = Path(args.database).resolve()
    if not path.is_file():
        raise RuntimeError(f"Database does not exist: {path}")
    with sqlite3.connect(path, timeout=30) as database:
        database.row_factory = sqlite3.Row
        database.execute("PRAGMA foreign_keys=ON")
        database.execute("PRAGMA busy_timeout=30000")
        if args.action == "list":
            rows = database.execute("""
                SELECT type,id,bench_id,visible,created_at,report_count FROM (
                  SELECT 'rating' type,r.id,b.id bench_id,r.visible,r.created_at,
                    (SELECT count(*) FROM reports p WHERE p.target_type='rating' AND p.target_id=r.id) report_count
                  FROM ratings r JOIN benches b ON b.row_id=r.bench_row_id
                  UNION ALL
                  SELECT 'correction' type,c.id,b.id bench_id,c.visible,c.created_at,
                    (SELECT count(*) FROM reports p WHERE p.target_type='correction' AND p.target_id=c.id) report_count
                  FROM corrections c JOIN benches b ON b.row_id=c.bench_row_id
                ) ORDER BY report_count DESC,created_at DESC LIMIT ?
            """, (args.limit,)).fetchall()
            print(json.dumps([dict(row) for row in rows], ensure_ascii=False, indent=2))
            return
        if not args.type or not args.id or args.id < 1:
            raise RuntimeError("--type rating|correction and a positive --id are required")
        table = {"rating": "ratings", "correction": "corrections"}[args.type]
        target = database.execute(
            f"SELECT id,contributor_hash,visible FROM {table} WHERE id=?", (args.id,)
        ).fetchone()
        if target is None:
            raise RuntimeError(f"{args.type} #{args.id} does not exist")
        preview = {"action": args.action, "type": args.type, "id": args.id,
                   "current_visible": bool(target["visible"]), "apply": args.apply}
        if args.action == "block":
            preview["affected_ratings"] = database.execute(
                "SELECT count(*) FROM ratings WHERE contributor_hash=?", (target["contributor_hash"],)
            ).fetchone()[0]
            preview["affected_corrections"] = database.execute(
                "SELECT count(*) FROM corrections WHERE contributor_hash=?", (target["contributor_hash"],)
            ).fetchone()[0]
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        if not args.apply:
            return
        now = datetime.now(timezone.utc).isoformat()
        database.execute("BEGIN IMMEDIATE")
        try:
            # Validate the exact target again under the writer lock.
            locked = database.execute(
                f"SELECT contributor_hash FROM {table} WHERE id=?", (args.id,)
            ).fetchone()
            if locked is None or locked["contributor_hash"] != target["contributor_hash"]:
                raise RuntimeError("Target changed during moderation preview")
            if args.action == "block":
                block_contributor(database, locked["contributor_hash"], args.reason, now)
                detail = locked["contributor_hash"]
            else:
                change_visibility(database, args.type, args.id, args.action == "show")
                detail = None
            record_moderation(database, args.action, args.type, args.id, detail, now)
            database.commit()
        except Exception:
            database.rollback()
            raise
