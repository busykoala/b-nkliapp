# Bänkli-centred walks

The map's **Spaziergang entdecken** action opens a separate lazy-loaded journal.
Defaults: 50 minutes walking, round trip, normal pace, easy mapped paths, no light
preference. Bench pauses are extra; one-way routes exclude the return journey.
The existing journey planner handles a separately requested return to the origin.

## Ownership and prerequisites

- Benchly owns the app, landscape worker, data evidence and provider adapters.
- GraphHopper runtime/configuration/storage/deployment lives only in
  `../server/deploy/graphhopper`; inference in `../server/deploy/inference`.
- Configure `WALK_ROUTER_URL` on the server; native local development defaults to
  `http://127.0.0.1:8989`. Containerized development uses `host.docker.internal`.
- Production expects `http://graphhopper.routing.svc.cluster.local:8989`.
  **Provision and validate that service before deploying this app version.**
  Existing journey foot legs now use it too; there is no external fallback.

The adapter follows the [GraphHopper 11.0 API](https://github.com/graphhopper/graphhopper/blob/11.0/docs/web/api-doc.md).
Requests use POST, geographic coordinates remain unaltered, and slope-aware
reference times are adjusted consistently for pace. Public foot geometry caches
last seven days; personal endpoints use a separate bounded five-minute RAM cache.
No coordinate logging, history or browser URLs; route searches have a 15-second
deadline, at most 24 routing calls, and two concurrent routing requests per process.

## Offline evidence

Run the separate worker, never from a web request:

```bash
PYTHONPATH=worker .venv/bin/python worker/benchly_worker.py refresh-landscape \
  --database data/benchly.sqlite --landscape-database data/landscape.sqlite \
  --limit 2000 --bounds 7.60 46.65 7.75 46.72
```

Omit bounds for resumable national batches. Benchly's landscape CronJob runs hourly
in batches of 10,000 paths/roads. The working artifact records progress, and integrity-checked SQLite
snapshots replace the public artifact atomically. Failed runs retain the previous
snapshot. Source age remains visible; cells older than 30 days are not evidence.

Existing path, road, forest, tree, water and official land-cover geometries feed
the approximately 25m index. Road proximity is a traffic proxy, not measured noise.
The source database must have the OSM exact-geometry import/backfill: old rows
with no `geometry_wkb` cannot build landscape evidence. The production OSM backfill
on 5 September 2026 imported 106,306 benches and 8,210,592 context objects. Regional
landscape snapshots are prepared before the app rollout; national coverage progresses
in bounded batches. Each adjacent grid cell is evaluated independently, not extrapolated
from a bench or neighbouring path. Spatial-first joins avoid scanning millions of
environment objects for each sample.
For terrain/building horizons, provide local EPSG:2056 rasters with
`--terrain-raster` and `--surface-raster`; no raster download occurs during a search.
Without both rasters, horizon evidence is unknown. Seasonal foliage is a proxy.
Only temporally matching stored cloud snapshots influence light scores. Less than
80% usable evidence suppresses confident landscape/light claims.

This first horizon sampler has a 2km range and sampled near-surface rays; it is not
the full national high-resolution visibility model. Thin obstacles and distant
ridges remain limitations requiring regional review. Viewpoint POI ingestion,
measured-noise calibration and community-rated stop quality are not
yet part of this first evidence pipeline.

## Bänkli copy and access

Individual names are preserved. Generic names fall back to “Bänkli” or a supported
“Uferbänkli”. One stop is planned in V1. Further benches are counted only after a
routed access of at most 25m with endpoint snaps within 1m; planned stops and repeated
segments are deduplicated. Counts are verified discoveries, not an exhaustive
inventory: candidate and request budgets can leave other nearby benches untested.

## Release checks and remaining quality work

Automated tests cover journal controls, privacy, routing failures, transfer timing,
pace, naming/counting, source uncertainty and provider-shaped route responses.
The real Swiss GraphHopper graph has also been exercised with 30 combinations of
place, duration and route shape using `scripts/check-walk-routes.ts`. This caught
and fixed generated round-trip waypoint validation and city-centre candidate
truncation. These automated comparisons are not an independent scenic-quality review.

Before activating in production, compare at least 30 shortest/recommended route
pairs: Spiez shore (6), Zürich urban (6), forest routes (6), Wimmis bridges (6),
and mountain destinations (6). For each group use 30/50/120 minutes with loop and
one-way modes. Record actual duration, repeated path share, traffic exposure,
verified bench access, difficulty, source coverage, and an independent visual
assessment. Repeat light comparisons where valid terrain/surface/weather data exist.
Do not rate success using the algorithm's own score. These 30 manual comparisons
have **not** been completed. Warm single-user routing checks are below one second;
the production p95 target still needs load measurement with landscape/light coverage.

Check input PBF age, landscape coverage/age, router error/latency metadata and disk
capacity. Keep the previous graph/image for rollback. No routing runtime or
inference deployment is included in a Benchly application release.
