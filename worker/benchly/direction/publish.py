"""Validated import of an explicitly selected local direction-analysis run."""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3

from benchly.db import connect_database
from benchly.runs.repository import begin_run, finish_run
from benchly.runtime import now_iso
from .analysis import open_analysis
from .model import DIRECTIONS, METHOD_VERSION
from .repository import delete_analysis_run, upsert_estimates


def publish(args) -> dict[str, object]:
    if not 0 <= args.minimum_probability <= 1:
        raise RuntimeError("--minimum-probability must be between 0 and 1")
    database_path = Path(args.database).resolve()
    analysis_path = Path(args.analysis_database).resolve()
    database = connect_database(database_path)
    analysis = open_analysis(analysis_path)
    try:
        if not database.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bench_direction_estimates'").fetchone():
            raise RuntimeError("Migration 0030 is missing; run `npm run db:migrate` before publishing")
        run = analysis.execute("SELECT * FROM direction_analysis_runs WHERE run_id=? AND status='completed'", (args.run_id,)).fetchone()
        if not run:
            raise RuntimeError(f"Completed direction analysis run not found: {args.run_id}")
        if run["method_version"] != METHOD_VERSION:
            raise RuntimeError(
                f"Analysis uses {run['method_version']}; this worker publishes only {METHOD_VERSION}"
            )
        candidates = analysis.execute("""
          SELECT b.*,p.direction_degrees,p.top_probability,p.entropy
          FROM direction_analysis_benches b JOIN direction_predictions p USING(run_id,bench_row_id)
          WHERE b.run_id=? AND p.top_probability>=? ORDER BY b.bench_row_id
        """, (args.run_id, args.minimum_probability)).fetchall()
        stats: dict[str, object] = {
            "analysis_run_id": args.run_id, "minimum_probability": args.minimum_probability,
            "selected": len(candidates), "eligible": 0, "observed_skipped": 0,
            "identity_skipped": 0, "published": 0, "apply": bool(args.apply),
        }
        eligible = []
        for candidate in candidates:
            current = database.execute("SELECT id,latitude,longitude,direction_degrees FROM benches WHERE row_id=? AND active=1",
                                       (candidate["bench_row_id"],)).fetchone()
            if not current or current["id"] != candidate["bench_id"] or current["latitude"] != candidate["latitude"] or current["longitude"] != candidate["longitude"]:
                stats["identity_skipped"] = int(stats["identity_skipped"]) + 1
                continue
            if current["direction_degrees"] is not None:
                stats["observed_skipped"] = int(stats["observed_skipped"]) + 1
                continue
            probabilities = dict(analysis.execute(
                "SELECT direction_degrees,probability FROM direction_probabilities WHERE run_id=? AND bench_row_id=?",
                (args.run_id, candidate["bench_row_id"]),
            ))
            signals = [dict(row) for row in analysis.execute(
                "SELECT name,weight,details_json FROM direction_signals WHERE run_id=? AND bench_row_id=? ORDER BY name",
                (args.run_id, candidate["bench_row_id"]),
            )]
            eligible.append((candidate, probabilities, signals))
        stats["eligible"] = len(eligible)
        stats["direction_counts"] = {
            str(direction): sum(1 for candidate, _probabilities, _signals in eligible if candidate["direction_degrees"] == direction)
            for direction in DIRECTIONS
        }
        stats["examples"] = [
            {
                "bench_id": candidate["bench_id"], "latitude": candidate["latitude"], "longitude": candidate["longitude"],
                "new_direction": candidate["direction_degrees"], "probability": candidate["top_probability"],
            }
            for candidate, _probabilities, _signals in eligible[:25]
        ]
        if not args.apply:
            return stats
        if not args.backup:
            raise RuntimeError("--backup is required with --apply")
        backup_path = Path(args.backup).resolve()
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        if backup_path.exists():
            raise RuntimeError(f"Refusing to overwrite backup: {backup_path}")
        target = sqlite3.connect(backup_path)
        try:
            database.backup_to(target)
        finally:
            target.close()
        pipeline_run = begin_run(database, "publish-direction-estimates", args.run_id)
        try:
            published_at = now_iso()
            analysis_stats = json.loads(run["stats_json"])
            database.begin_immediate()
            values = []
            for candidate, probabilities, signals in eligible:
                source_versions = {
                    **analysis_stats.get("source_versions", {}),
                    "analysis_method": run["method_version"],
                    "source_updated_at": candidate["source_updated_at"],
                    "swissimage_assets": sorted({
                        json.loads(signal["details_json"]).get("asset_checksum") for signal in signals
                        if signal["name"] == "image_axis" and json.loads(signal["details_json"]).get("asset_checksum")
                    }),
                }
                values.append({
                    "bench_row_id": candidate["bench_row_id"], "bench_id": candidate["bench_id"],
                    "bench_latitude": candidate["latitude"], "bench_longitude": candidate["longitude"],
                    "direction_degrees": candidate["direction_degrees"], "top_probability": candidate["top_probability"],
                    "entropy": candidate["entropy"],
                    "probabilities_json": json.dumps({str(direction): probabilities[direction] for direction in DIRECTIONS}, separators=(",", ":")),
                    "signals_json": json.dumps(signals, separators=(",", ":"), ensure_ascii=False),
                    "source_versions_json": json.dumps(source_versions, separators=(",", ":")),
                    "analysis_run_id": args.run_id, "method_version": METHOD_VERSION,
                    "computed_at": run["finished_at"] or run["started_at"], "published_at": published_at,
                })
            upsert_estimates(database, values)
            database.commit()
            stats["published"] = len(eligible)
            finish_run(database, pipeline_run, "completed", stats)
        except Exception as error:
            database.rollback()
            finish_run(database, pipeline_run, "failed", {**stats, "error": str(error)})
            raise
        return stats
    finally:
        analysis.close()
        database.close()


def remove_published_run(args) -> dict[str, object]:
    database_path = Path(args.database).resolve()
    database = connect_database(database_path)
    try:
        count = int(database.execute(
            "SELECT count(*) FROM bench_direction_estimates WHERE analysis_run_id=?", (args.run_id,)
        ).fetchone()[0])
        result: dict[str, object] = {"analysis_run_id": args.run_id, "selected": count, "removed": 0, "apply": bool(args.apply)}
        if not args.apply:
            return result
        if not args.backup:
            raise RuntimeError("--backup is required with --apply")
        backup_path = Path(args.backup).resolve()
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        if backup_path.exists():
            raise RuntimeError(f"Refusing to overwrite backup: {backup_path}")
        target = sqlite3.connect(backup_path)
        try:
            database.backup_to(target)
        finally:
            target.close()
        pipeline_run = begin_run(database, "remove-direction-estimates", args.run_id)
        try:
            database.begin_immediate()
            removed = delete_analysis_run(database, args.run_id)
            database.commit()
            result["removed"] = removed
            finish_run(database, pipeline_run, "completed", result)
        except Exception as error:
            database.rollback()
            finish_run(database, pipeline_run, "failed", {**result, "error": str(error)})
            raise
        return result
    finally:
        database.close()
