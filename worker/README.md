# Benchly data worker

The worker is deliberately separate from the web image. It downloads or reads a Geofabrik Switzerland PBF, imports every `amenity=bench` plus spatial building/tree/water/forest/path context, optionally computes terrain/surface evidence, and optionally stores nearby Wikimedia Commons metadata. Its only durable output is the same SQLite file used by the app.

Forest, water and building decisions use exact LV95 WKB geometry. R*Tree bounds only select
candidates. A surface-height peak is measured across 3 m, 10 m and 25 m neighborhoods and
classified as canopy; it never proves that a bench is inside a forest.

Run a small local pilot after starting the app once (which creates the schema):

```bash
python3 -m venv .venv
.venv/bin/pip install -r worker/requirements.txt
.venv/bin/python worker/benchly_worker.py refresh \
  --pbf /path/to/switzerland-latest.osm.pbf \
  --terrain-dir /path/to/swissALTI3D-tifs \
  --surface-dir /path/to/swissSURFACE3D-tifs \
  --limit 100 --commons-limit 25
```

Alternatively, add `--download-geodata` to discover official swisstopo STAC items and download only items intersecting at least one imported bench. Use `--max-geodata-tiles 10` for the first pilot; a complete national refresh is a large one-off job.

Official GeoTIFF tiles can be downloaded from the swissALTI3D and swissSURFACE3D product downloads. The worker searches the supplied directories recursively. It samples the surface model densely near a seated eye point out to 300 m and the terrain model to 20 km in 72 directions. Each horizon bin retains its angle, distance and cause (`building`, `vegetation` or `terrain`). A run without raster directories still performs the complete OSM and context import.

Inspect coverage at any time:

```bash
python3 worker/benchly_worker.py inventory --database ./data/benchly.sqlite
```

Production automation should run the bounded stages separately. They share a non-blocking
writer lock next to the database, so overlapping CronJobs safely skip instead of competing:

```bash
python3 worker/benchly_worker.py import-osm --database /data/benchly.sqlite
python3 worker/benchly_worker.py enrich-batch --database /data/benchly.sqlite \
  --limit 1000 --max-runtime-hours 8 --max-download-gib 80
python3 worker/benchly_worker.py enrich-profile-batch --database /data/benchly.sqlite \
  --limit 1000 --requests-per-second 1 --max-runtime-minutes 45
python3 worker/benchly_worker.py refresh-commons --database /data/benchly.sqlite --limit 500
python3 worker/benchly_worker.py import-official-context --database /data/benchly.sqlite
python3 worker/benchly_worker.py discover-open-images --database /data/benchly.sqlite --max-cells 500
python3 worker/benchly_worker.py analyze-scenes --database /data/benchly.sqlite --limit 300
python3 worker/benchly_worker.py reconcile-environment --database /data/benchly.sqlite --limit 5000
python3 worker/benchly_worker.py audit-environment --database /data/benchly.sqlite
```

`enrich-batch` chooses the next stale geographic cell, requests only intersecting STAC
assets (including the required terrain and surface buffers), checkpoints results and removes
its temporary files. Repeated runs therefore make national coverage progress without a
single unbounded download.

`enrich-profile-batch` is the lightweight complement to the raster pipeline. One
official GeoAdmin profile request per bench supplies 72 terrain directions with
logarithmic samples out to 20 km. Benchly merges those samples with OSM buildings,
individual trees and forest in the first 350 m, then caches elevation, sun windows
and the complete view score. The request rate and runtime are deliberately capped.

Enrichment is resumable and skips rows already produced by the current pipeline version. Use `--recompute` only after the terrain/surface inputs change. See `docs/data-pipeline.md` for national counts, the staged update strategy and limitations.

`import-official-context` follows the official swissTLM3D STAC collection and only downloads
the GeoPackage archive when its version changes. It streams selected layers through GDAL and
deletes the archive when the temporary work directory closes.

The visual pipeline searches Panoramax, Commons and KartaView per spatial cell. A centered
SWISSIMAGE crop is used only when a cell has no ground-level candidates. At most four diverse
frames from one capture group are downloaded into memory, analyzed through the internal
OpenAI-compatible inference service, and immediately released. No image is written to disk,
SQLite, `media`, or a container layer. Only source/license metadata, an image hash and structured
probabilities remain. Only a camera heading and a compatible recorded bench direction can
produce a bench-view claim; other images may describe only the surroundings.

Before enabling public AI labels, run the pinned models against a labelled 100-location JSONL
set. Every location has an `id`, Swiss coordinates, one of `true_forest`, `forest_edge`, `park`,
`urban`, `alpine_open`, `waterfront` or `irrelevant`, and complete image provenance
(`url`, `source_url`, `provider`, `license`). `expected` contains booleans for `forest`,
`lake_view`, `mountain_view`, `open_view` and `limited_view`. At least five locations from each
category are required.

```bash
python3 worker/benchly_worker.py benchmark-vision --dataset evaluation.jsonl \
  --models benchly-vision general
```

The production worker container uses `/data/benchly.sqlite`; mount the same single-writer PVC as the web container and avoid overlapping refresh jobs.
