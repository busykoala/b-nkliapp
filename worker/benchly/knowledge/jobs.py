"""Resumable jobs for the additive knowledge pipeline; no per-bench network requests."""
from __future__ import annotations
import hashlib
import json
import time
import urllib.request
from pathlib import Path
from benchly.context.sources import download_file, safe_extract_zip
from benchly.db import PreparedWrites, connect_database
from benchly.knowledge.amenities import enrich_amenities, nearby_context
from benchly.knowledge.approaches import enrich_approach, terrain_metadata
from benchly.knowledge.evidence import collect_existing, refresh_states
from benchly.knowledge.geography import enrich_geography, import_places
from benchly.knowledge.inventories import import_inventory, retain_osm_source
from benchly.knowledge.noise import NoiseRasters, refresh_noise
from benchly.knowledge.repository import finish_queue, record_evidence
from benchly.knowledge import progress
from benchly.runtime import now_iso
from benchly.terrain import RasterCollection
from benchly.imagery.physical_estimates import PhysicalEstimates


def prepare_bench(database, bench, terrain, noise, terrain_inputs, estimates=None):
    prepared = PreparedWrites(database)
    collect_existing(prepared, bench)
    geography = enrich_geography(prepared, bench)
    if geography:
        for kind in ("municipality", "canton", "district", "locality"):
            record_evidence(prepared, bench["row_id"], kind, geography.get(f"{kind}_name"), "official", f"swiss-place:{kind}",
                confidence=.9 if kind != "locality" else .6, method=geography["method_version"],
                metadata={"source_version": geography["source_version"], "latitude": bench["latitude"], "longitude": bench["longitude"]})
    context = nearby_context(database, bench)
    enrich_amenities(prepared, bench, context)
    enrich_approach(prepared, bench, context, terrain.sample if terrain.datasets else None, dem_inputs=terrain_inputs)
    retain_osm_source(prepared, bench)
    noise.enrich(prepared, bench)
    if estimates:
        estimates.enrich(prepared, bench)
    return prepared


def backfill_knowledge(args):
    minutes = getattr(args, "max_runtime_minutes", None)
    if minutes is not None and minutes <= 0:
        raise ValueError("Knowledge runtime must be positive")
    deadline = time.monotonic() + minutes * 60 if minutes is not None else float("inf")
    database = connect_database(Path(args.database))
    terrain = RasterCollection(Path(args.terrain_dir) if args.terrain_dir else None)
    noise = NoiseRasters(args.noise_dir)
    terrain_inputs = terrain_metadata(terrain)
    estimates = PhysicalEstimates(database)
    processed = failed = superseded = 0
    try:
        work_generation = progress.generation(database, terrain_inputs, noise)
        sources = progress.source_revision(database)
        if getattr(args, "report_only", False):
            print(json.dumps(progress.report(database, work_generation)), flush=True)
            return
        limit = max(1, min(5000, args.limit))
        # Current outcomes are the checkpoint. This survives a crash after any
        # bench, includes newly inserted lower IDs, and invalidates on source changes.
        while True:
            if time.monotonic() >= deadline:
                break
            parameters = [work_generation]
            selection = ""
            if args.queued_only:
                selection += " AND q.bench_row_id IS NOT NULL"
            if args.after_row_id is not None:
                selection += " AND b.row_id>?"
                parameters.append(args.after_row_id)
            bounds = getattr(args, "bounds", None)
            if bounds:
                selection += " AND b.longitude BETWEEN ? AND ? AND b.latitude BETWEEN ? AND ?"
                parameters.extend([bounds[0], bounds[2], bounds[1], bounds[3]])
            parameters.append(limit)
            rows = database.execute("""SELECT b.*,COALESCE(r.revision,0) input_revision FROM benches b
              LEFT JOIN bench_knowledge_revisions r ON r.bench_row_id=b.row_id
              LEFT JOIN bench_knowledge_queue q ON q.bench_row_id=b.row_id
              LEFT JOIN bench_knowledge_outcomes o ON o.bench_row_id=b.row_id AND o.category='physical'
              WHERE b.active=1 AND (o.bench_row_id IS NULL OR o.generation!=? OR o.input_revision!=COALESCE(r.revision,0)
                OR (o.status='retryable_failure' AND julianday(o.processed_at)<julianday('now','-30 minutes')))
              """ + selection + """ ORDER BY CASE q.reason WHEN 'created' THEN 0 WHEN 'moved' THEN 0 WHEN 'source' THEN 2 ELSE 1 END,
              CASE WHEN q.bench_row_id IS NULL THEN 1 ELSE 0 END,q.requested_at,
              coalesce(o.processed_at,''),b.row_id LIMIT ?""", parameters).fetchall()
            if not rows:
                break
            for raw in rows:
                if time.monotonic() >= deadline:
                    break
                bench = dict(raw)
                input_revision = bench.pop("input_revision")
                try:
                    prepared = prepare_bench(database, bench, terrain, noise, terrain_inputs, estimates)
                    database.begin_immediate()
                    if progress.revision(database, bench["row_id"]) != input_revision or progress.source_revision(database) != sources:
                        database.rollback()
                        superseded += 1
                        continue
                    prepared.publish()
                    refresh_states(database, bench)
                    progress.outcomes(database, bench, work_generation, input_revision)
                    # The revision is checked while holding the writer lock. A
                    # later edit requeues itself instead of being acknowledged here.
                    finish_queue(database, bench["row_id"])
                    database.commit()
                    processed += 1
                except Exception as error:
                    database.rollback()
                    database.begin_immediate()
                    if progress.revision(database, bench["row_id"]) == input_revision:
                        progress.outcomes(database, bench, work_generation, input_revision, error=f"{type(error).__name__}: {error}"[:500])
                    database.commit()
                    failed += 1
                    print(json.dumps({"bench_row_id": bench["row_id"], "status": "retryable_failure", "error": str(error)[:500]}), flush=True)
                if (processed + failed + superseded) % 100 == 0:
                    print(json.dumps({"processed": processed, "failed": failed, "superseded": superseded, "last_bench_row_id": bench["row_id"]}), flush=True)
            if not getattr(args, "until_complete", False) or progress.source_revision(database) != sources:
                break
        print(json.dumps({"processed_this_run": processed, "failed_this_run": failed, "superseded_this_run": superseded,
            "time_limit_reached": time.monotonic() >= deadline,
            **progress.report(database, work_generation)}), flush=True)
        if failed:
            raise RuntimeError(f"{failed} benches recorded retryable failures; prior usable results retained")
    finally:
        terrain.close()
        noise.close()
        database.close()


def cached_place_asset(collection, cache):
    url = f"https://data.geo.admin.ch/api/stac/v0.9/collections/{collection}/items?limit=100"
    request = urllib.request.Request(url, headers={"User-Agent": "Benchly/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    candidates = []
    for item in payload.get("features", []):
        for asset in item.get("assets", {}).values():
            href = asset.get("href", "")
            if href.endswith((".gpkg", ".gpkg.zip")) and "2056" in href:
                candidates.append((str(item["id"]), href))
    if not candidates:
        raise ValueError(f"No official LV95 GeoPackage found for {collection}")
    version, href = sorted(candidates)[-1]
    target = cache / collection / hashlib.sha256(href.encode()).hexdigest()[:16]
    marker = target / "complete.json"
    if marker.exists():
        stored = json.loads(marker.read_text())
        path = target / stored["file"]
        if path.exists():
            return path, version
    target.mkdir(parents=True, exist_ok=True)
    archive = target / ("download.zip" if href.endswith(".zip") else "dataset.gpkg")
    download_file(href, archive)
    if href.endswith(".zip"):
        safe_extract_zip(archive, target)
    packages = list(target.rglob("*.gpkg"))
    if len(packages) != 1:
        raise ValueError(f"Expected one GeoPackage, found {len(packages)}")
    marker.write_text(json.dumps({"url": href, "version": version, "file": str(packages[0].relative_to(target))}))
    if href.endswith(".zip"):
        archive.unlink()
    return packages[0], version


def refresh_places(args):
    database = connect_database(Path(args.database))
    try:
        for argument, source, collection in (("boundaries", "swissBOUNDARIES3D", "ch.swisstopo.swissboundaries3d"), ("names", "swissNAMES3D", "ch.swisstopo.swissnames3d")):
            supplied = getattr(args, argument)
            if supplied and not args.source_version:
                raise ValueError("--source-version is required for supplied datasets")
            path, version = (Path(supplied), args.source_version) if supplied else cached_place_asset(collection, Path(args.cache_dir))
            count = import_places(database, path, source, version)
            print(json.dumps({"source": source, "version": version, "features": count}), flush=True)
    finally:
        database.close()


def import_municipal(args):
    database = connect_database(Path(args.database))
    try:
        print(json.dumps(import_inventory(database, Path(args.input), args.source, args.source_version, args.id_field, args.updated_field)))
    finally:
        database.close()


def refresh_noise_job(args):
    print(json.dumps(refresh_noise(Path(args.directory)), indent=2))


def prepare_benchmark(args):
    from benchly.imagery.calibration import benchmark_coverage, sample_strata
    from benchly.imagery.evaluation import validate_evaluation_dataset
    records = validate_evaluation_dataset([json.loads(line) for line in Path(args.input).read_text().splitlines() if line.strip()], allow_small=True)
    database = connect_database(Path(args.database))
    try:
        enriched = []
        for record in records:
            row = database.execute("""SELECT b.row_id,b.id,b.latitude,b.longitude,g.canton_name,e.elevation_meters FROM bench_spatial_index s
              JOIN benches b ON b.row_id=s.row_id LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id
              LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE s.min_latitude BETWEEN ? AND ?
              AND s.min_longitude BETWEEN ? AND ? ORDER BY abs(b.latitude-?)+abs(b.longitude-?) LIMIT 1""",
              (record["latitude"]-.0001, record["latitude"]+.0001, record["longitude"]-.00015, record["longitude"]+.00015, record["latitude"], record["longitude"])).fetchone()
            if row:
                from benchly.geo import distance_meters
                if distance_meters(row["latitude"], row["longitude"], record["latitude"], record["longitude"]) <= 15:
                    record.update(bench_id=row["id"], canton=row["canton_name"] or record.get("canton", "unknown"), elevation_meters=row["elevation_meters"])
            if record.get("canton") in {None, "unknown"}:
                # Exact boundary lookup works even before the nationwide backfill;
                # this read-only benchmark preparation must not publish bench state.
                place = enrich_geography(PreparedWrites(database), {"row_id": 0, "latitude": record["latitude"], "longitude": record["longitude"]})
                if place:
                    record["canton"] = place.get("canton_name") or "unknown"
            first = record["images"][0]
            image = database.execute("SELECT latitude,longitude,captured_at FROM image_observations WHERE image_sha256=? OR fetch_url=? LIMIT 1",
                (first.get("sha256"), first["url"])).fetchone()
            if image:
                from benchly.geo import distance_meters
                record["imagery_distance_meters"] = round(distance_meters(image["latitude"], image["longitude"], record["latitude"], record["longitude"]), 1)
                record["capture_date"] = image["captured_at"] or "unknown"
            if first.get("provider") == "SWISSIMAGE":
                record["distance_band"] = "overhead"  # map-centred orthophoto, not a ground camera at zero metres
            # Available quality metadata describes integrity, not invented visual labels.
            record["image_integrity"] = "hash_recorded" if first.get("sha256") else "unknown"
            enriched.append({**record, **sample_strata(record)})
        Path(args.output).write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in enriched) + "\n")
        print(json.dumps(benchmark_coverage(enriched), ensure_ascii=False, indent=2))
    finally:
        database.close()
