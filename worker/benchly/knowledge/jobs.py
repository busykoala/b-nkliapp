"""Resumable jobs for the additive knowledge pipeline; no per-bench network requests."""
from __future__ import annotations
import hashlib
import json
import urllib.request
from pathlib import Path
from benchly.context.sources import download_file, safe_extract_zip
from benchly.db import connect_database
from benchly.knowledge.amenities import enrich_amenities, nearby_context
from benchly.knowledge.approaches import enrich_approach, terrain_metadata
from benchly.knowledge.evidence import collect_existing, refresh_states
from benchly.knowledge.geography import enrich_geography, import_places
from benchly.knowledge.inventories import import_inventory, retain_osm_source
from benchly.knowledge.models import KnowledgeProgress
from benchly.knowledge.noise import NoiseRasters, refresh_noise
from benchly.knowledge.repository import finish_queue, record_evidence, upsert
from benchly.runtime import now_iso
from benchly.terrain import RasterCollection


def backfill_knowledge(args):
    database = connect_database(Path(args.database))
    terrain = RasterCollection(Path(args.terrain_dir) if args.terrain_dir else None)
    noise = NoiseRasters(args.noise_dir)
    terrain_inputs = terrain_metadata(terrain)
    processed = 0
    try:
        checkpoint = database.execute("SELECT after_row_id FROM knowledge_progress WHERE job='knowledge-1'").fetchone()
        after = args.after_row_id if args.after_row_id is not None else checkpoint[0] if checkpoint else 0
        limit = max(1, min(5000, args.limit))
        queued = database.execute("""SELECT b.* FROM bench_knowledge_queue q JOIN benches b ON b.row_id=q.bench_row_id
          WHERE b.active=1 ORDER BY q.requested_at,b.row_id LIMIT ?""", (limit,)).fetchall()
        remaining = limit - len(queued)
        sweep = database.execute("SELECT * FROM benches WHERE active=1 AND row_id>? ORDER BY row_id LIMIT ?", (after, remaining)).fetchall() if remaining and not args.queued_only else []
        seen = set()
        for raw in [*queued, *sweep]:
            bench = dict(raw)
            if bench["row_id"] in seen:
                continue
            seen.add(bench["row_id"])
            collect_existing(database, bench)
            geography = enrich_geography(database, bench)
            if geography:
                for kind in ("municipality", "canton", "district", "locality"):
                    record_evidence(database, bench["row_id"], kind, geography.get(f"{kind}_name"), "official", f"swiss-place:{kind}",
                        confidence=.9 if kind != "locality" else .6, method=geography["method_version"],
                        metadata={"source_version": geography["source_version"], "latitude": bench["latitude"], "longitude": bench["longitude"]})
            context = nearby_context(database, bench)
            enrich_amenities(database, bench, context)
            enrich_approach(database, bench, context, terrain.sample if terrain.datasets else None, dem_inputs=terrain_inputs)
            retain_osm_source(database, bench)
            noise.enrich(database, bench)
            refresh_states(database, bench)
            finish_queue(database, bench["row_id"])
            database.commit()
            processed += 1
            if processed % 100 == 0:
                print(json.dumps({"processed": processed, "last_bench_row_id": bench["row_id"]}), flush=True)
        next_after = sweep[-1]["row_id"] if sweep else 0 if remaining and not args.queued_only else after
        upsert(database, KnowledgeProgress, dict(job="knowledge-1", after_row_id=next_after, updated_at=now_iso()), ["job"])
        database.commit()
        print(json.dumps({"processed": processed, "next_after_row_id": next_after, "queued": len(queued), "method": "knowledge-1"}))
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
            row = database.execute("""SELECT g.canton_name,e.elevation_meters FROM bench_spatial_index s
              JOIN benches b ON b.row_id=s.row_id LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id
              LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE s.min_latitude BETWEEN ? AND ?
              AND s.min_longitude BETWEEN ? AND ? ORDER BY abs(b.latitude-?)+abs(b.longitude-?) LIMIT 1""",
              (record["latitude"]-.0001, record["latitude"]+.0001, record["longitude"]-.00015, record["longitude"]+.00015, record["latitude"], record["longitude"])).fetchone()
            if row:
                record.update(canton=row["canton_name"] or record.get("canton", "unknown"), elevation_meters=row["elevation_meters"])
            enriched.append({**record, **sample_strata(record)})
        Path(args.output).write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in enriched) + "\n")
        print(json.dumps(benchmark_coverage(enriched), ensure_ascii=False, indent=2))
    finally:
        database.close()
