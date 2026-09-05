# Benchly

Benchly is a German, mobile-first PWA for discovering Swiss benches by location, sun exposure, view evidence, observed OpenStreetMap properties and anonymous community ratings.

## Run locally

Requirements: Node.js 24 and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The first request creates `data/benchly.sqlite`, applies migrations and inserts twelve clearly identifiable demo records if the database is empty. Set `BENCHLY_SEED_DEMO=false` when building a database exclusively from the national worker. This workspace currently contains a git-ignored national SQLite build with 106,146 real OSM benches.

Useful commands:

```bash
npm run db:migrate
npm run test
npm run lint
npm run build
python3 -m unittest discover -s worker -p 'test_*.py'
```

## Configuration and security

Copy `.env.example` and replace every secret before production. Generate an admin password hash with:

```bash
npx tsx scripts/hash-password.ts 'a-long-admin-password'
```

Put the resulting `scrypt$...` value in `ADMIN_PASSWORD_HASH`. Without it, the development-only password is `benchly-admin`; production refuses that fallback. Recentring the map uses location in the browser. Explicitly requesting a route in the journey planner sends its coordinates to the server and external routing providers. Personal-origin routes remain in bounded server memory for at most five minutes; no journey history is stored. Providers have their own request-retention policies. Anonymous contribution and daily IP identifiers are HMAC hashes, and raw IP addresses are not stored.

The illustrated journey planner is always available via **Weg hierher** in a bench's map details. See [journey setup and rollout](docs/journey-planner.md) for the daily GTFS worker, provider limits and privacy notes.

All app reads and writes use Server Actions. There are no custom route handlers or `/api` endpoints. The browser talks directly to the public swisstopo WMTS only for map tiles.

## One-file deployment

The runtime has one durable artifact: `/data/benchly.sqlite`. Run exactly one web replica and mount a ReadWriteOnce PVC. SQLite uses WAL, foreign keys, a five-second busy timeout and an R*Tree index.

```bash
docker compose up --build web
```

`deploy/kubernetes.yaml` contains a local one-replica example. The production Helm chart lives in `deploy/charts/benchly` and is released by this repository's GitHub Actions workflow; `busykoala/server` manages the shared infrastructure and runner. Put HTTPS in front of the service; browsers require a secure context for geolocation and service workers. Back up with SQLite's online backup command rather than copying only the main file while WAL is active:

```bash
sqlite3 /data/benchly.sqlite ".backup '/backup/benchly-$(date +%F).sqlite'"
```

## National data refresh

The heavy worker is isolated from the web image. It imports all `amenity=bench` nodes and ways from Geofabrik, updates rather than duplicates OSM identities, and stores millions of building/tree/water/forest/path features in an R*Tree-backed context index. It calculates directional roof/canopy/terrain obstruction profiles from official height models, derives today's actual direct-sun windows plus four seasonal summaries, classifies mountain/lake/open/limited views, and can fetch attributed Commons metadata.

```bash
docker compose --profile data run --rm worker refresh \
  --database /data/benchly.sqlite \
  --download-geodata \
  --commons-limit 500
```

Start with `--limit 100 --max-geodata-tiles 10`. A full Swiss terrain analysis downloads substantial official raster data and should run as a non-overlapping weekly job. See `worker/README.md` for local datasets and pilot usage.

Production uses the separate `import-osm`, `enrich-batch` and `refresh-commons` commands so every network-heavy stage is bounded and resumable.

Use `python3 worker/benchly_worker.py inventory` for current totals and field completeness. The detailed source and batching strategy is documented in [`docs/data-pipeline.md`](docs/data-pipeline.md).

## Data labels and licenses

- Observed properties are labelled OpenStreetMap and retain their original tags and timestamps.
- Sun/view/environment fields are labelled Benchly estimates with confidence. “Sonne jetzt” describes geometric direct sun, not cloud cover.
- Corrections appear immediately as community suggestions and never silently overwrite OSM.
- Nearby Commons images are explicitly labelled as nearby and may not depict the bench.

The interface includes attribution to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [swisstopo](https://www.swisstopo.admin.ch/en/terms-of-use-swisstopo-app), and individual Wikimedia media authors/licenses.
