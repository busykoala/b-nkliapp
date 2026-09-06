"""Explicit orchestration of the legacy all-in-one refresh command."""

from __future__ import annotations

import json
import tempfile
from argparse import Namespace
from pathlib import Path

from benchly.benches.importer import import_osm
from benchly.benches.media import commons_metadata
from benchly.context.sources import download_file, download_stac_tiles
from benchly.db import connect_database
from benchly.enrichment.service import enrich_terrain
from benchly.runs.repository import begin_run, finish_run, set_source_version
from benchly.settings import PROVIDERS


def refresh_job(args: Namespace) -> None:
    connection = connect_database(Path(args.database).resolve())
    temporary_context = tempfile.TemporaryDirectory(prefix="benchly-") if not args.work_dir else None
    work_dir = Path(args.work_dir or temporary_context.name)
    pbf = Path(args.pbf).resolve() if args.pbf else work_dir / "switzerland-latest.osm.pbf"
    source_version = "local"
    run_id = begin_run(connection, "refresh")
    stats: dict[str, int] = {}
    try:
        if not args.pbf:
            source_version = download_file(args.pbf_url, pbf)
        stats["imported"], stats["context_features"] = import_osm(connection, pbf, source_version)
        terrain_dir = Path(args.terrain_dir) if args.terrain_dir else work_dir / "swissalti3d"
        surface_dir = Path(args.surface_dir) if args.surface_dir else work_dir / "swisssurface3d"
        if args.download_geodata:
            stats["terrain_tiles"] = download_stac_tiles(
                connection,
                PROVIDERS.swissAltiCollection,
                terrain_dir,
                args.max_geodata_tiles,
            )
            stats["surface_tiles"] = download_stac_tiles(
                connection,
                PROVIDERS.swissSurfaceCollection,
                surface_dir,
                args.max_geodata_tiles,
            )
        stats["enriched"] = enrich_terrain(
            connection,
            terrain_dir,
            surface_dir,
            args.limit,
            args.recompute,
        )
        stats["media"] = commons_metadata(connection, args.commons_limit) if args.commons_limit else 0
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
