# Benchly data worker

All sources, output artifacts, versions and production refresh frequencies live
in `config/data-catalog.json`. Python validates it with Pydantic at worker start;
the same file generates Helm CronJobs and the app's acknowledgements page.

The worker is an application with the same architectural care as the web UI.
`benchly_worker.py` only parses commands and coordinates bounded jobs. The
`benchly/` package is sliced by domain: `benches/`, `context/`, `enrichment/`,
`imagery/`, `landscape/`, `transit/` and `weather/`. Each persistent feature owns
small SQLModel tables and a repository; reusable geographic, terrain, catalog and
runtime code stays one level lower. The few root `*_pipeline.py` files are the
executable provider workflows, not a second domain layer.

Productive writes are typed SQLModel/SQLAlchemy statements. Analytical GIS reads
remain explicit SQLite queries because they are local, complex and easier to
audit that way. `benchly/db.py` provides the single transaction boundary for
both without hiding either model behind a generic framework.

The worker is deliberately separate from the web image. It downloads or reads a Geofabrik Switzerland PBF, imports every `amenity=bench` plus spatial building/tree/water/forest/path context, optionally computes terrain/surface evidence, and optionally stores nearby Wikimedia Commons metadata. Its only durable output is the same SQLite file used by the app.

Forest, water and building decisions use exact LV95 WKB geometry. R*Tree bounds only select
candidates. A surface-height peak is measured across 3 m, 10 m and 25 m neighborhoods and
classified as canopy; it never proves that a bench is inside a forest.

Run a small local pilot after starting the app once (which creates the schema):

```bash
uv sync
uv run python worker/benchly_worker.py refresh \
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
uv run python worker/benchly_worker.py import-osm --database /data/benchly.sqlite
uv run python worker/benchly_worker.py enrich-batch --database /data/benchly.sqlite \
  --limit 1000 --max-runtime-hours 8 --max-download-gib 80
uv run python worker/benchly_worker.py enrich-profile-batch --database /data/benchly.sqlite \
  --limit 1000 --requests-per-second 1 --max-runtime-minutes 45
uv run python worker/benchly_worker.py refresh-commons --database /data/benchly.sqlite --limit 500
uv run python worker/benchly_worker.py import-official-context --database /data/benchly.sqlite
uv run python worker/benchly_worker.py discover-open-images --database /data/benchly.sqlite --max-cells 500
uv run python worker/benchly_worker.py analyze-scenes --database /data/benchly.sqlite --limit 300
uv run python worker/benchly_worker.py reconcile-environment --database /data/benchly.sqlite --limit 5000
uv run python worker/benchly_worker.py audit-environment --database /data/benchly.sqlite
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

Enrichment is resumable and skips rows already produced by the current pipeline version. Use `--recompute` only after the terrain/surface inputs change. Use `inventory` for current counts and `audit-environment --require-production` to check production readiness.

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
uv run python worker/benchly_worker.py benchmark-vision --dataset evaluation.jsonl \
  --models benchly-vision general
```

The production worker container uses `/data/benchly.sqlite`; mount the same single-writer PVC as the web container and avoid overlapping refresh jobs.

## Knowledge pipeline

Migrations `0018`–`0026` add these features without replacing canonical benches or rebuilding the
large context table. New data remains optional while bounded batches progress. The queue gives
new/moved benches and verification responses priority; `knowledge_progress` remembers the
sweep cursor, wraps at the end and commits each bench separately. Repeating a batch is safe.
The worker lock is shared with the existing imports. Example commands (use a disposable/local
path for experiments; these commands do not fetch a production database):

```bash
uv run python worker/benchly_worker.py import-osm --database /data/benchly.sqlite
uv run python worker/benchly_worker.py refresh-official-places --database /data/benchly.sqlite --cache-dir /data/sources/places
uv run python worker/benchly_worker.py backfill-knowledge --database /data/benchly.sqlite --noise-dir /data/sources --limit 500
uv run python worker/benchly_worker.py import-zurich-benches --database /data/benchly.sqlite --cache-dir /data/sources/municipal
uv run python worker/benchly_worker.py refresh-noise-rasters --directory /data/sources
```

`--queued-only` restricts a knowledge batch to changed benches; `--after-row-id` restricts
the selection to larger row IDs. Recorded outcomes, rather than a fragile cursor, drive resumption. `--terrain-dir` can supply cached swissALTI3D tiles. The existing raster
`enrich-batch` also computes approach slopes while the relevant DEM is loaded, avoiding a
second download. Later batches without tiles preserve slopes only for identical route evidence.

| Feature | Source and exact method | Stored result/version |
| --- | --- | --- |
| OSM freshness | Geofabrik Swiss PBF, OSM XML or complete OSM/Overpass JSON snapshots. Read original object version, timestamp and changeset from osmium; absent timestamps stay unknown. Import time is separate. | `benches.osm_*`, `source_updated_at`, `imported_at`; original tags and OSM source record |
| Administrative location | [swissBOUNDARIES3D](https://www.swisstopo.admin.ch/de/landschaftsmodell-swissboundaries3d), latest LV95 GeoPackage from the official STAC collection. RTree candidates followed by exact polygon containment; canton and district queried independently. Border ambiguity stays unknown. | `bench_geography`: municipality/BFS, canton/district IDs and names; `official-places-3` and dataset version |
| Local place label | [swissNAMES3D](https://www.swisstopo.admin.ch/de/landschaftsmodell-swissnames3d), cached GeoPackage. Suitable objects within 2.5 km, ranked by distance + 100 m per type rank: quarter/subdivision 0, smaller quarter 1, town 2, local field name 3. Prefer the local official name over translated variants sharing the same geometric UUID, independent of file order. This label is separate from the political municipality. | Locality ID/name/distance in `bench_geography` |
| Evidence resolution | Original OSM tags, official inventory assertions, geometric results, matched imagery and community observations. Latest assertion per independent source; source weights community 1, official .9, OSM .8, GIS .65, imagery .4, multiplied by evidence reliability. Confidence is independent of freshness: source age is recent/old/unknown (730 days, presence 180). Exact, unambiguous administrative joins have strong support even without an object date. Image self-confidence capped .5. A lead below 1.5× a contradictory runner-up stays unresolved. | Append-only `bench_attribute_evidence`, materialized `bench_attribute_state`, `attribute-resolution-2`. Support grades are not probabilities. Old spatial evidence remains historical after moves. |
| Completeness | Count usable values separately in physical/location/accessibility/imagery/surroundings/amenities/environment/recent-verification categories, listing missing and uncertain attributes. | `bench_completeness`; no combined quality score |
| Amenities | Local OSM geometry with RTree prefilter and exact LV95 distance within 500 m. Separate toilets, drinking water, fountains, shelters, picnic tables, playgrounds, waste baskets and fireplaces; mapped counts within 100/250/500 m. | `bench_amenities`, source ID/version, `nearby-amenities-2`. No nearby mapped object means unknown, not an assertion that none exists. |
| Approach | OSM pedestrian graph using shared node IDs and vertices; visual line crossings do not connect. Snap within 25 m, trace up to 200 m, prefer fewer steps/barriers and sufficiently long routes. Sample DEM every 10 m; grade is `100*abs(height delta)/horizontal distance`, mean weighted by distance, ascent measured toward the bench. Explicit positive tags are needed for a possible step-free path. | `bench_approaches`: steps, barrier evidence, surface/smoothness/width, max/mean grade, ascent, confidence, route coordinates, source IDs and DEM asset/version/resolution evidence; `pedestrian-approach-2`. Unmapped final metres, incomplete tags and missing DEM prevent a complete accessibility claim. Bridge/tunnel gradients remain unknown with bare-earth inputs. |
| Active verification | One question selected by user value × uncertainty × staleness × usefulness × ease; recent own answers suppressed for 30 days. Authenticated, rate-limited yes/no/unknown responses append evidence and queue resolution. Repeated answers from the same person do not become independent votes. | `bench_verification_answers` + evidence history, `verification-1` |
| Canonical inventories | [Zürich Sitzbankkataster](https://data.stadt-zuerich.ch/dataset/geo_sitzbankkataster_ogd), CC0 WFS, stable `objid`, WGS84, original model/address fields. No modification dates are supplied: content SHA-256 identifies each dataset. Compare canonical neighbours within 15 m; auto-match within 6 m with a compatible attribute, or within 2 m with two attributes and 5 m separation from alternatives in dense areas. Contradictions or ambiguous neighbours remain review records. | `bench_source_records`, independent source geometry/timestamps/raw attributes, `inventory-match-1`. New canonical IDs are stable hashes, existing OSM IDs remain valid. |
| Road and railway noise | [BAFU sonBASE](https://www.bafu.admin.ch/de/sonbase), official `ch.bafu.laerm-strassenlaerm_tag`, `_nacht`, `ch.bafu.laerm-bahnlaerm_tag`, `_nacht` single-band LV95 rasters. Point sample with scale/offset, masked NoData, ETag/Last-Modified version. Road-day reuses the existing landscape raster. The rail-day asset's equivalent WKT without an EPSG identifier is accepted only after an LV95 CRS match and three coordinate checks within 1 mm. | `bench_noise_exposure`: four separate channels in `dB(A) Lr`, `sonbase-point-1`. Day 06–22, night 22–06. Modelled assessment levels, not live measurements or an unexplained combined quietness score. |

The OSM importer treats its PBF/XML/JSON input as a complete inventory snapshot: do not feed it a partial Overpass excerpt against the national database. JSON way geometry or an explicit centre is supported; missing source metadata remains unknown.

Supply offline GeoPackages with `refresh-official-places --boundaries ... --names ... --source-version ...`.
Generic municipal adapters can produce RFC 7946 point GeoJSON or normalized JSONL:

```bash
uv run python worker/benchly_worker.py import-municipal-inventory inventory.geojson \
  --database /data/benchly.sqlite --source 'Municipality inventory' --source-version '2026-09' \
  --id-field id --updated-field updated_at
```

Unmatched review records have `bench_row_id=NULL`, `match_status='review'` and the scored
candidate IDs/distances in `candidates_json`; no automatic merge is performed. Reimports retain
source identity. Disappearing source records do not automatically remove a community bench.
Source dates must refer to the source observation, never the local download clock.

The catalog schedules the official places and municipal inventory monthly, knowledge hourly
and noise downloads weekly. On a fresh deployment, run the first source jobs explicitly before
the knowledge backfill if results are needed before the next schedule. The UI remains useful
with partial coverage and does not claim all nationwide results are already present.

## Growing and calibrating the image benchmark

The existing benchmark gate remains compatible with its 100-location seed. The expanded JSONL
format accepts `canton`, `region`, `elevation_meters`/`elevation_band`, `landscape_type`, `provider`,
`imagery_distance_meters`/`distance_band`, `season`, `capture_date` and `image_quality`. Missing
strata are explicitly `unknown`; ground truth must still be labelled by people. There is no
mandatory sample target: the coverage report describes the actual reviewed examples without generating labels.

```bash
uv run python worker/benchly_worker.py prepare-vision-benchmark evaluation.jsonl \
  --output evaluation-stratified.jsonl --database /data/benchly.sqlite
uv run python worker/benchly_worker.py benchmark-vision --dataset evaluation-stratified.jsonl \
  --models benchly-vision general
```

The report includes precision, recall, F1, TP/FP/TN/FN, Brier score, ten-bin reliability/ECE and
provider/region/other subgroup breakdowns. Shared images, canonical IDs and .01° geographic
cells are grouped before a deterministic 20% calibration / 80% test split. Platt calibration
requires at least 30 calibration observations and five of each class; otherwise it reports
insufficient data. Calibration parameters are fitted only on the calibration partition and
metrics evaluated on the held-out test partition. The existing model gate is not automatically
relaxed by this report. Runtime image hints remain qualitative until a validated, model/version
specific calibration is explicitly deployed; raw classifier scores are never displayed as
calibrated percentages. Expand geographically diverse human labels before interpreting sparse
subgroup metrics or making deployment decisions.


## Reliable coverage and publication

The knowledge worker prepares geometry, raster samples and evidence statements before opening a
write transaction. Publication checks both the source revision and the bench input revision under
`BEGIN IMMEDIATE`, then commits one bench. An edit during computation leaves the queue intact.
Derived states, completeness and outcomes use bounded typed batches within that transaction.
Approach calculations retain at most 512 immutable path structures, keyed by geometry and tags;
each bench still performs its own exact distance and connectivity checks. These optimizations
preserve assertions and checkpoints while reducing CPU work and writer-lock duration.
Creates, moves, source changes, contributions, withdrawals and terrain updates invalidate work;
algorithm/source manifests and a weekly refresh window invalidate the nationwide sweep.
`bench_knowledge_outcomes` records each category as `current`, `missing_source`,
`unresolved` or `retryable_failure`, with generation, revision, attempts and processing time.
A recorded outcome does not imply that all attributes are known. Failures keep the previous usable
publication and retry after 30 minutes; successful work is not repeated after a crash.

```bash
uv run python worker/benchly_worker.py backfill-knowledge --database /data/benchly.sqlite \
  --noise-dir /data/sources --terrain-dir /data/terrain-cache-v1/swissalti3d \
  --limit 2500 --until-complete
uv run python worker/benchly_worker.py backfill-knowledge --database /data/benchly.sqlite \
  --noise-dir /data/sources --terrain-dir /data/terrain-cache-v1/swissalti3d --report-only
```

Use `--bounds WEST SOUTH EAST NORTH` for pilots before the national sweep. Compare changed
assertions as well as counts in Spiez harbour/river, a dense city and an alpine area. Unknown
coverage is an acceptable outcome; unexpected new claims need investigation.

OSM parsing is staged in a separate scratch database under `/data/sources/osm`, containing only
normalized source batches. No production database is copied. Download/parse failure leaves the
published generation intact. Publication commits bounded batches and resumes idempotently;
retirement of old source objects happens only after successful publication. A suspicious loss of
more than 20% of a national inventory is rejected before publication. The input must be a complete
country extract. [Geofabrik public downloads](https://www.geofabrik.de/data/download.html) omit
changeset IDs; these remain null, while supplied versions and timestamps are retained.

Raster jobs share `/data/terrain-cache-v1`, capped at **160 GiB** across DTM and DSM. The existing
80 GiB per-job download limit remains. Versioned asset URLs, source sidecars and persistent RTree
footprints identify tiles; only eight raster handles are open per collection. Recently used tiles
are retained, and the current batch is pinned during eviction. Bench horizons, approaches and walk
context reuse this cache. Horizon metadata records actual/expected terrain and surface samples
per bearing. Missing samples never produce a complete horizon; incomplete attempts preserve the
last usable values. Approach metadata records sample counts and unmapped final metres. Bridges
and tunnels cannot obtain gradients from bare-earth samples: [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d)
excludes vegetation and development.

Walk cells retain all four sonBASE channels with their versions. Route details show separate
coverage and time-weighted mean assessment levels; these are spatial summaries, not an acoustic
sum or a live exposure measurement. For internal preference ranking only, the matching local
06–22 / 22–06 period contributes the lesser of the road-proximity preference and each available
noise preference `clamp((70 - Lr) / 30, 0, 1)`. Rail noise can therefore lower a railway-adjacent
route's rank without inventing a combined peacefulness measurement. Missing channels remain
unknown. Landscape v3 versions every cell and spatial checkpoint by source generation, raster
inputs and algorithm. Same-day source changes restart affected sweeps; a source publication
during sampling leaves the previous published snapshot intact. Facilities use straight-line
geometry distances, not walking distances or access claims.

## Physical photo estimates and independent review

`bench_photo_estimates` is deliberately separate from factual attributes and filters. Current
unique matches within 5 m, visible benches and non-conflicting content hashes are required.
Close-ups may support backrest/armrest/material estimates, but do not establish permanent shade,
accessibility, a seated distant outlook or an unseen viewing direction. Contrary confirmed
attributes suppress publication. Duplicate photos and capture groups never become extra votes.

The review queue is blind to model predictions and bound to original image hashes. Keep its
source URLs and any downloaded bytes in ignored operator storage. Human reviewers inspect the
original hash-verified image, fill `labels` with booleans/material or null, then import the JSONL:

```bash
uv run python worker/benchly_worker.py review-photo-attributes --database /data/benchly.sqlite \
  --export /data/imports/physical-review.jsonl --limit 100
uv run python worker/benchly_worker.py review-photo-attributes --database /data/benchly.sqlite \
  --import-reviews /data/imports/physical-review.jsonl --reviewer independent-reviewer
```

Validation is specific to attribute, model and prompt. It requires at least 30 independently
reviewed benches, at least five examples per predicted class (two boolean classes or three
material classes), and a 95% Wilson accuracy lower bound of at least .8. Repeated bench images and
disagreeing labels do not count as independent examples. Until these conditions hold, estimates
remain unpublished and can only inform a short on-site verification question. No human ground
truth is generated by the model. Raw outputs, validation accuracy and calibrated probabilities
are different quantities; this publication has no per-image probability.

After an OSM refresh, run `reconcile-source-photos --database /data/benchly.sqlite` before
knowledge pilots. This reuses stored predictions and hashes, recomputes unique current matches,
withdraws obsolete photo projections and downloads no images. Photo fusion v6 requires an actual
`outlook` photograph for seated water/distant-view estimates; source sight tags cannot override
photograph perspective. Physical estimates additionally
check current neighbours at publication preparation, so a newly mapped adjacent bench can make
an old match ineligible. Terrain batches record missing-source attempts and advance to other
spatial cells; incomplete cells retry weekly rather than blocking nationwide progress.

The 100-location benchmark now includes the available production metadata: 29 locations in
Genève, 62 in Valais and 9 in Bern; 4 stored elevations, 99 matched imagery distances and all
provider/content-hash metadata. Orthophotos have an `overhead` distance band, not a ground-camera
distance class. Visual quality and unavailable capture information remain unknown. This reveals
limited geographic validation coverage; the scene benchmark does not validate physical features.
Original human labels and image hashes are unchanged.
