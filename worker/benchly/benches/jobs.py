"""CLI jobs owned by the benches feature."""

from __future__ import annotations

import json
import tempfile
from argparse import Namespace
from pathlib import Path

from benchly.benches.importer import import_osm
from benchly.benches.media import commons_metadata
from benchly.context.sources import download_file
from benchly.db import connect_database
from benchly.runs.repository import begin_run, finish_run, set_source_version


def import_osm_job(args: Namespace) -> None:
    database = Path(args.database).resolve()
    connection = connect_database(database)
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-osm-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    pbf = Path(args.pbf).resolve() if args.pbf else work_dir / "switzerland-latest.osm.pbf"
    run_id = begin_run(connection, "import-osm")
    stats: dict[str, object] = {}
    try:
        source_version = "local" if args.pbf else download_file(args.pbf_url, pbf)
        stats["imported"], stats["context_features"] = import_osm(connection, pbf, source_version)
        set_source_version(connection, run_id, source_version)
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error), **stats})
        raise
    finally:
        connection.close()
        if temporary_context:
            temporary_context.cleanup()


def refresh_commons_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    run_id = begin_run(connection, "refresh-commons")
    try:
        stats = {"media": commons_metadata(connection, args.limit)}
        finish_run(connection, run_id, "completed", stats)
        print(json.dumps(stats, indent=2))
    except Exception as error:
        finish_run(connection, run_id, "failed", {"error": str(error)})
        raise
    finally:
        connection.close()


def inventory_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    try:
        total = connection.execute("SELECT count(*) count FROM benches WHERE active=1").fetchone()["count"]
        enriched = connection.execute(
            "SELECT count(*) count FROM benches b JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE b.active=1"
        ).fetchone()["count"]
        context = {
            row["kind"]: row["count"]
            for row in connection.execute("SELECT kind,count(*) count FROM environment_features GROUP BY kind")
        }
        fields = {
            field: connection.execute(
                f"SELECT count(*) count FROM benches WHERE active=1 AND {field} IS NOT NULL"
            ).fetchone()["count"]
            for field in ("backrest", "armrest", "covered", "wheelchair", "material", "direction_degrees")
        }
        print(
            json.dumps(
                {
                    "active_benches": total,
                    "enriched_benches": enriched,
                    "context_features": context,
                    "observed_field_counts": fields,
                },
                indent=2,
            )
        )
    finally:
        connection.close()
