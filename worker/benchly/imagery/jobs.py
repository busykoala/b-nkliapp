"""User-facing jobs for open-image discovery and scene evidence."""

from __future__ import annotations

import json
import os
import time
from argparse import Namespace
from pathlib import Path

from benchly.db import connect_database
from benchly.enrichment.service import reconcile_deterministic_context
from benchly.imagery.evaluation import benchmark_models
from benchly.imagery.evidence import audit_environment, reconcile_environment
from benchly.runs.repository import begin_run, finish_run
from benchly.imagery.service import (
    analyze_scenes,
    discover_open_images,
)


def discover_open_images_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "discover-open-images")
    try:
        stats = discover_open_images(
            connection,
            args.max_cells,
            args.cell_degrees,
            args.requests_per_second,
            tuple(args.bounds) if args.bounds else None,
            args.include_resolved,
        )
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def analyze_scenes_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "analyze-scenes", os.environ.get("BENCHLY_VISION_MODEL", "benchly-vision"))
    try:
        used_seconds = float(
            connection.execute(
                """
                SELECT coalesce(sum((julianday(finished_at)-julianday(started_at))*86400),0)
                FROM pipeline_runs WHERE kind='analyze-scenes' AND status IN ('completed','failed')
                  AND finished_at IS NOT NULL AND date(started_at)=date('now')
                """
            ).fetchone()[0]
        )
        remaining_seconds = max(0.0, min(args.max_runtime_hours * 3600, 7200 - used_seconds))
        stats = analyze_scenes(
            connection,
            args.limit,
            time.monotonic() + remaining_seconds,
            args.requests_per_second,
            tuple(args.bounds) if args.bounds else None,
        )
        stats["daily_runtime_remaining_seconds"] = round(remaining_seconds)
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def reconcile_environment_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "reconcile-environment")
    try:
        bounds = tuple(args.bounds) if args.bounds else None
        stats = reconcile_deterministic_context(connection, args.limit, bounds)
        stats.update(
            {
                f"visual_{key}": value
                for key, value in reconcile_environment(connection, args.limit, bounds, args.max_total).items()
            }
        )
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def audit_environment_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    try:
        result = audit_environment(connection)
        print(json.dumps(result, indent=2))
        if args.require_production and (
            result["sqlite_quick_check"] != "ok"
            or int(result["active_benches"]) < 100_000
            or int(result["raw_image_columns"]) != 0
            or int(result["image_files_on_data_volume"]) != 0
            or int(result["likely_rows_without_provenance"]) != 0
        ):
            raise RuntimeError("production data audit failed")
    finally:
        connection.close()


def benchmark_vision_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "vision-benchmark")
    try:
        result = benchmark_models(Path(args.dataset), args.models, args.allow_small, args.requests_per_second)
        finish_run(connection, run_id, "completed", result)
        print(json.dumps(result, separators=(",", ":")))
        if result["recommended"] is None and not args.report_only:
            raise RuntimeError("No vision model met the acceptance thresholds")
    except Exception as error:
        current = connection.execute("SELECT status FROM pipeline_runs WHERE id=?", (run_id,)).fetchone()
        if current and current["status"] == "running":
            finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()
