"""Benchly worker command line interface.

The parser wires feature-owned jobs together. Business logic belongs to the
feature modules, keeping this module intentionally boring.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from benchly.benches.jobs import import_osm_job, inventory_job, refresh_commons_job
from benchly.context.jobs import import_official_context_job, import_swissbuildings_job
from benchly.context.regional_trees import import_basel_trees_job, import_zurich_trees_job
from benchly.enrichment.jobs import enrich_batch_job, enrich_profile_batch_job
from benchly.imagery.jobs import (
    analyze_scenes_job,
    audit_environment_job,
    benchmark_vision_job,
    discover_open_images_job,
    reconcile_environment_job,
)
from benchly.refresh import refresh_job
from benchly.runtime import exclusive_worker_lock
from benchly.settings import DEFAULT_OSM_PBF_URL
from benchly.sources.service import run_check_source_versions
from benchly.sources.artifacts import run_refresh_sonbase
from benchly.landscape.service import refresh as refresh_landscape
from benchly.transit.service import refresh as refresh_transit
from benchly.transfers.service import run_import_geography
from benchly.weather.jobs import refresh_weather_job


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import and enrich Swiss benches into Benchly's database.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    source_versions = subparsers.add_parser(
        "check-source-versions", help="Record bounded version signals for catalog sources"
    )
    source_versions.add_argument(
        "--database", default=os.environ.get("SOURCE_STATUS_DATABASE_PATH", "./data/source-status.sqlite")
    )
    source_versions.add_argument("--sources", nargs="+", required=True)
    source_versions.add_argument("--timeout-seconds", type=float, default=20)
    source_versions.set_defaults(function=run_check_source_versions, uses_lock=False)

    sonbase = subparsers.add_parser("refresh-sonbase", help="Atomically refresh the official daytime road-noise COG")
    sonbase.add_argument("--target", default="./data/sources/sonbase-day.tif")
    sonbase.set_defaults(function=run_refresh_sonbase, uses_lock=False)

    geography = subparsers.add_parser("import-geography", help="Validate and optionally merge a cluster geography export")
    geography.add_argument("input", type=Path)
    geography.add_argument(
        "--database", type=Path, default=Path(os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    )
    geography.add_argument("--apply", action="store_true")
    geography.add_argument("--backup", type=Path)
    geography.set_defaults(function=run_import_geography, uses_lock=False)

    zurich_trees = subparsers.add_parser("import-zurich-trees", help="Import the official Zurich tree cadastre")
    _database_argument(zurich_trees)
    zurich_trees.set_defaults(function=import_zurich_trees_job, uses_lock=True)

    basel_trees = subparsers.add_parser("import-basel-trees", help="Import the official Basel-Stadt tree cadastre")
    _database_argument(basel_trees)
    basel_trees.set_defaults(function=import_basel_trees_job, uses_lock=True)

    transit = subparsers.add_parser("refresh-transit", help="Refresh a separate Swiss GTFS stop/transfer index")
    transit.add_argument("--transit-database", default=os.environ.get("TRANSIT_DATABASE_PATH", "./data/transit.sqlite"))
    transit.add_argument("--gtfs-zip", help="Import a previously downloaded official GTFS archive")
    transit.set_defaults(function=refresh_transit, uses_lock=False)

    landscape = subparsers.add_parser("refresh-landscape", help="Build a resumable offline walking landscape index")
    landscape.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))
    landscape.add_argument(
        "--landscape-database", default=os.environ.get("LANDSCAPE_DATABASE_PATH", "./data/landscape.sqlite")
    )
    landscape.add_argument("--limit", type=int, default=2000)
    landscape.add_argument(
        "--bounds",
        type=float,
        nargs=4,
        metavar=("WEST", "SOUTH", "EAST", "NORTH"),
        help="Optional regional coverage pilot",
    )
    landscape.add_argument("--terrain-raster", help="Optional local LV95 DTM GeoTIFF")
    landscape.add_argument("--surface-raster", help="Optional local LV95 DSM GeoTIFF")
    landscape.add_argument("--noise-raster", help="Optional local LV95 sonBASE daytime-noise GeoTIFF")
    landscape.set_defaults(function=refresh_landscape, uses_lock=False)

    osm_import = subparsers.add_parser("import-osm", help="Download and import the current national OSM extract")
    _database_argument(osm_import)
    osm_import.add_argument("--pbf", help="Use an existing Switzerland .osm.pbf instead of downloading")
    osm_import.add_argument("--pbf-url", default=DEFAULT_OSM_PBF_URL)
    osm_import.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    osm_import.set_defaults(function=import_osm_job, uses_lock=True)

    official = subparsers.add_parser(
        "import-official-context", help="Import exact swissTLM3D geometries when the official version changes"
    )
    _database_argument(official)
    _official_import_arguments(official, "swissTLM3D GeoPackage ZIP")
    official.set_defaults(function=import_official_context_job, uses_lock=True)

    buildings = subparsers.add_parser(
        "import-swissbuildings3d", help="Import swissBUILDINGS3D Solid footprints and roof heights"
    )
    _database_argument(buildings)
    _official_import_arguments(buildings, "national swissBUILDINGS3D FileGDB ZIP")
    buildings.add_argument("--cell-degrees", type=float, default=0.05)
    buildings.add_argument("--max-cells", type=int, default=3)
    buildings.set_defaults(function=import_swissbuildings_job, uses_lock=True)

    weather = subparsers.add_parser("refresh-weather", help="Refresh compact MeteoSwiss ICON and precipitation rasters")
    _database_argument(weather)
    weather_mode = weather.add_mutually_exclusive_group()
    weather_mode.add_argument("--radar-only", action="store_true")
    weather_mode.add_argument("--icon-only", action="store_true")
    weather.set_defaults(function=refresh_weather_job, uses_lock=True)

    enrich = subparsers.add_parser("enrich-batch", help="Enrich one resumable spatial cell with bounded downloads")
    _database_argument(enrich)
    enrich.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    enrich.add_argument("--cell-degrees", type=float, default=0.05)
    enrich.add_argument("--limit", type=int, default=1000)
    enrich.add_argument("--max-geodata-tiles", type=int, default=3000)
    enrich.add_argument("--max-download-gib", type=float, default=80)
    enrich.add_argument("--max-runtime-hours", type=float, default=8)
    enrich.add_argument("--recompute", action="store_true")
    enrich.set_defaults(function=enrich_batch_job, uses_lock=True)

    profile = subparsers.add_parser("enrich-profile-batch", help="Compute near and 20 km horizons through GeoAdmin profiles")
    _database_argument(profile)
    profile.add_argument("--limit", type=int, default=1000)
    profile.add_argument("--requests-per-second", type=float, default=1.0)
    profile.add_argument("--max-runtime-minutes", type=float, default=45)
    profile.set_defaults(function=enrich_profile_batch_job, uses_lock=True)

    commons = subparsers.add_parser("refresh-commons", help="Refresh a bounded number of nearby Commons results")
    _database_argument(commons)
    commons.add_argument("--limit", type=int, default=500)
    commons.set_defaults(function=refresh_commons_job, uses_lock=True)

    discovery = subparsers.add_parser("discover-open-images", help="Discover open imagery once per spatial cell")
    _database_argument(discovery)
    discovery.add_argument("--max-cells", type=int, default=500)
    discovery.add_argument("--cell-degrees", type=float, default=0.02)
    discovery.add_argument("--requests-per-second", type=float, default=1.0)
    _bounds_argument(discovery)
    discovery.add_argument(
        "--include-resolved",
        action="store_true",
        help="Include already classified benches inside an explicit pilot area",
    )
    discovery.set_defaults(function=discover_open_images_job, uses_lock=True)

    analysis = subparsers.add_parser("analyze-scenes", help="Analyze temporary open images without storing their bytes")
    _database_argument(analysis)
    analysis.add_argument("--limit", type=int, default=300)
    analysis.add_argument("--max-runtime-hours", type=float, default=2)
    analysis.add_argument("--requests-per-second", type=float, default=0.25)
    _bounds_argument(analysis)
    analysis.set_defaults(function=analyze_scenes_job, uses_lock=True)

    reconcile = subparsers.add_parser("reconcile-environment", help="Fuse deterministic context and visual evidence")
    _database_argument(reconcile)
    reconcile.add_argument("--limit", type=int, default=5000)
    _bounds_argument(reconcile)
    reconcile.add_argument("--max-total", type=int, default=1000, help="Keep the visual pilot capped until its quality gate passes")
    reconcile.set_defaults(function=reconcile_environment_job, uses_lock=True)

    audit = subparsers.add_parser("audit-environment", help="Report environment evidence coverage and conflicts")
    _database_argument(audit)
    audit.add_argument("--require-production", action="store_true")
    audit.set_defaults(function=audit_environment_job, uses_lock=False)

    benchmark = subparsers.add_parser("benchmark-vision", help="Evaluate vision models against a labelled JSONL set")
    _database_argument(benchmark)
    benchmark.add_argument("--dataset", required=True)
    benchmark.add_argument("--models", nargs="+", default=["benchly-vision", "general"])
    benchmark.add_argument("--allow-small", action="store_true", help="Allow a development fixture below 100 locations")
    benchmark.add_argument("--requests-per-second", type=float, default=0.25)
    benchmark.add_argument("--report-only", action="store_true", help="Emit rejected metrics without failing the job")
    benchmark.set_defaults(function=benchmark_vision_job, uses_lock=True)

    refresh = subparsers.add_parser("refresh", help="Run the resumable national refresh pipeline")
    _database_argument(refresh)
    refresh.add_argument("--pbf", help="Use an existing Switzerland .osm.pbf instead of downloading")
    refresh.add_argument("--pbf-url", default=DEFAULT_OSM_PBF_URL)
    refresh.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    refresh.add_argument("--terrain-dir", help="Directory containing swissALTI3D GeoTIFF tiles")
    refresh.add_argument("--surface-dir", help="Directory containing swissSURFACE3D GeoTIFF tiles")
    refresh.add_argument("--download-geodata", action="store_true", help="Download required STAC tiles")
    refresh.add_argument("--max-geodata-tiles", type=int, help="Safety cap for a pilot STAC download")
    refresh.add_argument("--commons-limit", type=int, default=0, help="Fetch Commons metadata for this many benches")
    refresh.add_argument("--limit", type=int, help="Limit terrain enrichment for a pilot run")
    refresh.add_argument("--recompute", action="store_true", help="Recompute current enrichments after source changes")
    refresh.set_defaults(function=refresh_job, uses_lock=True)

    inventory = subparsers.add_parser("inventory", help="Report bench totals and data completeness")
    _database_argument(inventory)
    inventory.set_defaults(function=inventory_job, uses_lock=False)
    return parser


def _database_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--database", default=os.environ.get("DATABASE_PATH", "./data/benchly.sqlite"))


def _bounds_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--bounds", nargs=4, type=float, metavar=("WEST", "SOUTH", "EAST", "NORTH"))


def _official_import_arguments(parser: argparse.ArgumentParser, archive_description: str) -> None:
    parser.add_argument("--archive", help=f"Use an existing {archive_description}")
    parser.add_argument("--source-version", help="Version label for a local archive")
    parser.add_argument("--work-dir", help="Keep downloads in this directory; otherwise temporary files are deleted")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--first-sunday-only", action="store_true")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if not args.uses_lock:
            args.function(args)
            return 0
        with exclusive_worker_lock(Path(args.database).resolve()) as acquired:
            if not acquired:
                print("Another Benchly worker owns the SQLite writer lock; skipping this run.")
                return 0
            args.function(args)
        return 0
    except Exception as exception:
        print(f"Benchly worker failed: {exception}", file=sys.stderr)
        return 1
