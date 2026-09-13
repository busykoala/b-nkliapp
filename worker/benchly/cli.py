"""Benchly worker command line interface.

The parser wires feature-owned jobs together. Business logic belongs to the
feature modules, keeping this module intentionally boring.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from benchly.knowledge.municipal import import_zurich_benches
from benchly.knowledge.jobs import backfill_knowledge, refresh_places, import_municipal, refresh_noise_job, prepare_benchmark
from benchly.benches.jobs import (
    import_osm_job,
    inventory_job,
    refresh_commons_job,
)
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
from benchly.imagery.photo_source import analyze_bank_photos
from benchly.imagery.photo_import import import_photo_checkpoint_job, reconcile_stored_photos_job
from benchly.imagery.physical_estimates import review_job
from benchly.refresh import refresh_job
from benchly.runtime import exclusive_worker_lock
from benchly.settings import DEFAULT_OSM_PBF_URL
from benchly.sources.service import run_check_source_versions
from benchly.sources.artifacts import run_refresh_sonbase
from benchly.landscape.service import refresh as refresh_landscape
from benchly.transit.service import refresh as refresh_transit
from benchly.transfers.service import run_import_geography
from benchly.weather.jobs import refresh_weather_job
from benchly.direction.jobs import analyze_directions_job, import_direction_reviews_job, prepare_direction_review_job, publish_direction_estimates_job, remove_direction_estimates_job
from benchly.panorama.jobs import panorama_batch_job, panorama_worker_job
from benchly.panorama.fixtures import render_fixture_job


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import and enrich Swiss benches into Benchly's database.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    knowledge = subparsers.add_parser("backfill-knowledge", help="Resume geography, evidence, amenities, approaches and separate noise enrichment")
    _database_argument(knowledge)
    knowledge.add_argument("--limit", type=int, default=1000)
    knowledge.add_argument("--after-row-id", type=int)
    knowledge.add_argument("--queued-only", action="store_true")
    knowledge.add_argument("--until-complete", action="store_true", help="Continue resumable batches until every eligible active bench has an outcome")
    knowledge.add_argument("--max-runtime-minutes", type=float, help="Stop between benches, preserving the checkpoint for the next scheduled run")
    knowledge.add_argument("--report-only", action="store_true")
    knowledge.add_argument("--bounds", type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    knowledge.add_argument("--terrain-dir")
    knowledge.add_argument("--noise-dir", default="./data/sources")
    knowledge.set_defaults(function=backfill_knowledge, uses_lock=True)

    places = subparsers.add_parser("refresh-official-places", help="Cache and import official boundaries and locality names")
    _database_argument(places)
    places.add_argument("--boundaries", type=Path)
    places.add_argument("--names", type=Path)
    places.add_argument("--source-version")
    places.add_argument("--cache-dir", default="./data/sources/places")
    places.set_defaults(function=refresh_places, uses_lock=True)

    zurich_benches = subparsers.add_parser("import-zurich-benches", help="Import the official CC0 municipal inventory with conservative matching")
    zurich_benches.add_argument("--database", default="./data/benchly.sqlite")
    zurich_benches.add_argument("--cache-dir", default="./data/sources/municipal")
    zurich_benches.add_argument("--input", help="Use a previously downloaded official GeoJSON response")
    zurich_benches.set_defaults(function=import_zurich_benches, uses_lock=True)

    municipal = subparsers.add_parser("import-municipal-inventory", help="Import WGS84 GeoJSON/JSONL while preserving ambiguous source records")
    _database_argument(municipal)
    municipal.add_argument("input", type=Path)
    municipal.add_argument("--source", required=True)
    municipal.add_argument("--source-version", required=True)
    municipal.add_argument("--id-field", default="id")
    municipal.add_argument("--updated-field", default="updated_at")
    municipal.set_defaults(function=import_municipal, uses_lock=True)

    noise = subparsers.add_parser("refresh-noise-rasters", help="Cache official road and rail noise for day and night")
    noise.add_argument("--directory", default="./data/sources")
    noise.set_defaults(function=refresh_noise_job, uses_lock=True)

    benchmark = subparsers.add_parser("prepare-vision-benchmark", help="Add available source strata and report independently reviewed benchmark coverage")
    _database_argument(benchmark)
    benchmark.add_argument("input", type=Path)
    benchmark.add_argument("--output", required=True, type=Path)
    benchmark.set_defaults(function=prepare_benchmark, uses_lock=False)

    review = subparsers.add_parser("review-photo-attributes", help="Blind physical-feature review queue and independent validation")
    _database_argument(review)
    mode = review.add_mutually_exclusive_group(required=True)
    mode.add_argument("--export", help="Local, untracked JSONL review queue; do not publish source URLs")
    mode.add_argument("--import-reviews", help="Completed human labels bound to original image hashes")
    review.add_argument("--reviewer")
    review.add_argument("--limit", type=int, default=100)
    review.set_defaults(function=review_job, uses_lock=True)

    bank_photos = subparsers.add_parser(
        "analyze-source-photos", help="Analyze source-linked photos in RAM into a separate resumable evidence DB"
    )
    bank_photos.add_argument("--output", required=True)
    bank_photos.add_argument("--index", help="Previously downloaded public /benches metadata JSON")
    bank_photos.add_argument("--model", default="qwen35-general")
    bank_photos.add_argument("--source-ids", type=int, nargs="+")
    bank_photos.add_argument("--priority-source-ids", type=int, nargs="+", help="Process these sources first, then the remainder")
    bank_photos.add_argument("--discover-comments", action="store_true")
    bank_photos.add_argument("--limit", type=int, default=0, help="Zero processes all outstanding photos")
    bank_photos.add_argument("--max-attempts", type=int, default=3)
    bank_photos.set_defaults(function=analyze_bank_photos, uses_lock=False)

    photo_rematch = subparsers.add_parser("reconcile-source-photos", help="Recheck stored photo identity and evidence after inventory changes; no downloads")
    _database_argument(photo_rematch)
    photo_rematch.set_defaults(function=reconcile_stored_photos_job, uses_lock=True)

    photo_import = subparsers.add_parser("import-bank-photo-evidence", help="Validate, match and merge a photo checkpoint")
    _database_argument(photo_import)
    photo_import.add_argument("input", type=Path)
    photo_import.add_argument("--apply", action="store_true")
    photo_import.add_argument("--reviews", type=Path, help="Content-hash-bound visual review decisions")
    photo_import.set_defaults(function=import_photo_checkpoint_job, uses_lock=True)

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
    landscape.add_argument("--max-runtime-minutes", type=float, default=40,
        help="Publish sampled cells before the deadline and resume unfinished paths next time")
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
    landscape.add_argument("--noise-dir", help="Separate official road/rail day/night rasters")
    landscape.add_argument("--terrain-cache", help="Shared versioned DTM/DSM tile cache")
    landscape.set_defaults(function=refresh_landscape, uses_lock=False)

    osm_import = subparsers.add_parser("import-osm", help="Download and import the current national OSM extract")
    _database_argument(osm_import)
    osm_import.add_argument("--pbf", help="Use an existing Switzerland .osm.pbf instead of downloading")
    osm_import.add_argument("--pbf-url", default=DEFAULT_OSM_PBF_URL)
    osm_import.add_argument("--work-dir", help="Persistent download/staging directory; defaults to sources/osm beside the database")
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
    enrich.add_argument("--work-dir", help="Shared 160 GiB raster cache; defaults to terrain-cache-v1 beside the database")
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
    profile.add_argument("--lock-wait-seconds", type=float, default=0,
                         help="Wait at most this long for another writer to finish")
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
    audit.add_argument(
        "--release-smoke", action="store_true",
        help="Run bounded release-critical checks; the scheduled production audit remains exhaustive",
    )
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

    directions = subparsers.add_parser("analyze-directions", help="Build a resumable local probability model for bench facing directions")
    _database_argument(directions)
    directions.add_argument("--analysis-database", default="./data/direction-analysis.sqlite")
    directions.add_argument("--report-directory", default="./data/direction-reports")
    directions.add_argument("--cache-dir", default="./data/sources/bench-direction/v1")
    directions.add_argument("--terrain-dir")
    directions.add_argument("--pbf", help="Previously downloaded Switzerland OSM PBF")
    directions.add_argument("--pbf-url", default=DEFAULT_OSM_PBF_URL)
    directions.add_argument("--download-pbf", action="store_true")
    directions.add_argument("--skip-imagery", action="store_true")
    directions.add_argument("--fail-on-image-error", action="store_true")
    directions.add_argument("--requests-per-second", type=float, default=.5)
    directions.add_argument("--mode", choices=("labelled", "unlabelled", "all"), default="all")
    directions.add_argument("--run-id", help="Stable run identifier; reuse it to resume an interrupted analysis")
    directions.add_argument("--limit", type=int)
    _bounds_argument(directions)
    directions.set_defaults(function=analyze_directions_job, uses_lock=False)

    direction_review = subparsers.add_parser("prepare-direction-review", help="Cache a stratified SWISSIMAGE review sample for a completed direction run")
    direction_review.add_argument("--analysis-database", default="./data/direction-analysis.sqlite")
    direction_review.add_argument("--report-directory", default="./data/direction-reports")
    direction_review.add_argument("--cache-dir", default="./data/sources/bench-direction/v1")
    direction_review.add_argument("--run-id", required=True)
    direction_review.add_argument("--sample-size", type=int, default=300)
    direction_review.add_argument("--requests-per-second", type=float, default=.5)
    direction_review.set_defaults(function=prepare_direction_review_job, uses_lock=False)

    review_import = subparsers.add_parser("import-direction-reviews", help="Import plausible/unclear/implausible verdicts from a review CSV")
    review_import.add_argument("csv")
    review_import.add_argument("--analysis-database", default="./data/direction-analysis.sqlite")
    review_import.add_argument("--report-directory", default="./data/direction-reports")
    review_import.add_argument("--run-id", required=True)
    review_import.add_argument("--reviewer", required=True)
    review_import.set_defaults(function=import_direction_reviews_job, uses_lock=False)

    publish_directions = subparsers.add_parser("publish-direction-estimates", help="Validate and optionally publish one completed direction-analysis run")
    _database_argument(publish_directions)
    publish_directions.add_argument("--analysis-database", default="./data/direction-analysis.sqlite")
    publish_directions.add_argument("--run-id", required=True)
    publish_directions.add_argument("--minimum-probability", type=float, default=.8)
    publish_directions.add_argument(
        "--include-no-signal-fallback", action="store_true",
        help="Also publish a stable, explicitly uninformative direction for analyzed benches without any signal",
    )
    publish_directions.add_argument("--apply", action="store_true")
    publish_directions.add_argument("--backup", help="Required new SQLite backup path when --apply is used")
    publish_directions.set_defaults(function=publish_direction_estimates_job, uses_lock=True)

    remove_directions = subparsers.add_parser("remove-direction-estimates", help="Dry-run or remove estimates from exactly one analysis run")
    _database_argument(remove_directions)
    remove_directions.add_argument("--run-id", required=True)
    remove_directions.add_argument("--apply", action="store_true")
    remove_directions.add_argument("--backup", help="Required new SQLite backup path when --apply is used")
    remove_directions.set_defaults(function=remove_direction_estimates_job, uses_lock=True)

    panorama = subparsers.add_parser("panorama-batch", help="Precompute versioned geographic panoramas for existing benches")
    _database_argument(panorama)
    panorama.add_argument("--terrain-dir", required=True, help="Indexed swissALTI3D GeoTIFF directory")
    panorama.add_argument("--regional-terrain-dir", help="Optional prepared lower-resolution terrain overview for the far field")
    panorama.add_argument("--border-terrain-dir", help="Optional cross-border DEM used only where Swiss terrain has no coverage")
    panorama.add_argument("--high-resolution-distance-meters", type=float, default=20_000)
    panorama.add_argument("--cache-dir", default="./data/panorama-cache-v1")
    panorama.add_argument("--limit", type=int, default=10)
    panorama.add_argument("--max-runtime-hours", type=float, default=2)
    panorama.add_argument("--angular-resolution", type=float, default=.1)
    panorama.add_argument("--maximum-distance-meters", type=float, default=150_000)
    panorama.add_argument("--semantic-radius-meters", type=float, default=20_000)
    panorama.add_argument("--building-radius-meters", type=float, default=2_000)
    panorama.add_argument("--preview-fov", type=float, default=360, help="Deprecated; full 360 degree renders are always produced")
    panorama.add_argument("--preview-width", type=int, default=4096, help="Full panorama width")
    panorama.add_argument("--preview-height", type=int, default=1024, help="Full panorama height")
    panorama.add_argument("--shard-index", type=int, default=0, help=argparse.SUPPRESS)
    panorama.add_argument("--shard-count", type=int, default=1, help=argparse.SUPPRESS)
    panorama.set_defaults(function=panorama_batch_job, uses_lock=True)

    panorama_worker = subparsers.add_parser("panorama-worker", help="Continuously render requested and backfill panoramas")
    _database_argument(panorama_worker)
    panorama_worker.add_argument("--terrain-dir", required=True)
    panorama_worker.add_argument("--regional-terrain-dir")
    panorama_worker.add_argument("--border-terrain-dir")
    panorama_worker.add_argument("--high-resolution-distance-meters", type=float, default=20_000)
    panorama_worker.add_argument("--cache-dir", default="./data/panorama-cache-v1")
    panorama_worker.add_argument(
        "--limit",
        type=int,
        default=1,
        help="Benches leased per shard cycle; one keeps interactive requests responsive during backfill",
    )
    panorama_worker.add_argument("--max-runtime-hours", type=float, default=.04)
    panorama_worker.add_argument("--angular-resolution", type=float, default=.1)
    panorama_worker.add_argument("--maximum-distance-meters", type=float, default=150_000)
    panorama_worker.add_argument("--semantic-radius-meters", type=float, default=20_000)
    panorama_worker.add_argument("--building-radius-meters", type=float, default=2_000)
    panorama_worker.add_argument("--preview-fov", type=float, default=360)
    panorama_worker.add_argument("--preview-width", type=int, default=4096)
    panorama_worker.add_argument("--preview-height", type=int, default=1024)
    panorama_worker.add_argument("--processes", type=int, default=4, choices=range(1, 9))
    panorama_worker.add_argument("--idle-seconds", type=float, default=2)
    panorama_worker.set_defaults(function=panorama_worker_job, uses_lock=False)

    panorama_fixtures = subparsers.add_parser(
        "render-panorama-fixtures", help="Render cached geographic geometry into a local art-review matrix"
    )
    _database_argument(panorama_fixtures)
    panorama_fixtures.add_argument("--fixture", action="append", required=True, help="BENCH_ID=GEOMETRY_PATH")
    panorama_fixtures.add_argument("--cache-dir", default="./data/panorama-cache-v1")
    panorama_fixtures.add_argument("--output-dir", default="./data/panorama-fixtures/v19/rendered")
    panorama_fixtures.add_argument("--season", choices=("spring", "summer", "autumn", "winter"), default="autumn")
    panorama_fixtures.add_argument("--width", type=int, default=4096)
    panorama_fixtures.add_argument("--height", type=int, default=1024)
    panorama_fixtures.add_argument("--at", help="ISO timestamp for the installed local light map")
    panorama_fixtures.set_defaults(function=render_fixture_job, uses_lock=False)
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
        with exclusive_worker_lock(
            Path(args.database).resolve(), timeout_seconds=getattr(args, "lock_wait_seconds", 0)
        ) as acquired:
            if not acquired:
                print("Another Benchly worker owns the SQLite writer lock; skipping this run.")
                return 0
            args.function(args)
        return 0
    except Exception as exception:
        print(f"Benchly worker failed: {exception}", file=sys.stderr)
        return 1
