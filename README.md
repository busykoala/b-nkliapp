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

Copy `.env.example` and replace every secret before production. Moderation uses the preview-first worker CLI (`benchly moderation list`, `benchly moderation hide --type moment --id ID --apply`); there is no web admin login. Recentring the map uses location in the browser. Explicitly requesting a route sends coordinates to our server. Footrouting is self-hosted; address and nearby-station searches use GeoAdmin and transport.opendata.ch. A planned walk is kept for seven days in SQLite and identified only by a random HttpOnly cookie in the same browser; ending the walk removes it. Providers have their own request-retention policies. Anonymous contribution and daily IP identifiers are HMAC hashes, and raw IP addresses are not stored.

The illustrated journey planner is available via **Weg hierher** in a bench's map details. **Spaziergang entdecken** offers walks with optional maximum intervals of 5, 10 or 15 minutes between benches. GraphHopper and inference deployments live exclusively in the sibling server repository; Benchly releases use the [application chart](deploy/charts/README.md).

For an artwork-only refresh, `panorama-fetch-index` obtains the current production binding and `panorama-repaint-fetch-capsules --bench-index PATH` downloads only missing `.bpc` view capsules over SSH, then writes `data/panorama-repaint/current-index.tsv`. Use that index with `panorama-repaint --bench-index PATH` and `panorama-repaint-seal --bench-index PATH`; older sealed indices may contain stale geometry keys. `panorama-repaint-seal` checks complete groups of at most 512 benches and seals their checksums; `panorama-repaint-upload --chunk PATH` transfers one group by resumable SSH to `busykoala@api.blizzard.busykoala.io` by default (the approved LAN target remains available with `--target`). On the server, `panorama-repaint-activate --chunk-id HASH` previews the coordinate-bound changes; `--apply` switches that chunk to the new painting and removes unreferenced old images. Local SQLite-WAL checkpoints survive interruptions, and neither geography nor a server rollback generation is regenerated.

App state changes use Server Actions. Same-origin media route handlers stream panorama and other stored image assets; there are no public terrain-data endpoints. The browser talks directly to the public swisstopo WMTS only for map tiles.

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

Use `python3 worker/benchly_worker.py inventory` for current totals and field completeness. See the [worker commands](worker/README.md) for imports and bounded enrichment jobs.

## Data labels and licenses

- Observed properties are labelled OpenStreetMap and retain their original tags and timestamps.
- Sun/view/environment fields are labelled Benchly estimates with confidence. “Sonne jetzt” describes geometric direct sun, not cloud cover.
- Corrections appear immediately as community suggestions and never silently overwrite OSM.
- Nearby Commons images are explicitly labelled as nearby and may not depict the bench.

The interface includes attribution to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [swisstopo](https://www.swisstopo.admin.ch/en/terms-of-use-swisstopo-app), and individual Wikimedia media authors/licenses.

## About, privacy and community

The menu's project page (`/danke`) explains sources and calculations with expandable examples
and an interactive map/account/photo data-flow view. `/lieblingsplaetze` is the signed-in
owner's private saved-bench list. The feed groups each bench's activity by Swiss calendar day
and loads further pages with a stable timestamp/event-ID cursor. Photos open in a swipeable,
keyboard-accessible modal that keeps the current bench in place.

Configure the public operator's name and contact email before publishing the privacy/contact
pages. `.env.example` lists `BENCHLY_OPERATOR_NAME`, `BENCHLY_OPERATOR_EMAIL`, optional postal
address, hosting country and infrastructure/retention statements. Production reads matching
optional fields from `benchly-secrets`; those public details must be accurate, even though the
configuration travels through a Kubernetes Secret. The app does not invent operator details
from Git credentials. The legal text describes this free community service, not an online shop:
Swiss [privacy information duties](https://www.edoeb.admin.ch/de/faq-datenschutz) still apply;
SECO's [identification rules for online commerce](https://www.seco.admin.ch/de/onlinehandel)
should be reassessed if payments or commercial ordering are introduced. Verify actual hosting,
international recipients and retention when configuring the deployment.

## Evidence and gradual enrichment

The existing `benches` row stays the canonical identity. Additive tables hold official location,
source records, per-attribute evidence, nearby facilities, local approaches and separate noise
channels. Conflicts remain in the evidence history; uncertain or missing values stay unknown.
The detail page shows resolved physical attributes and an expandable explanation of sources,
confidence and completeness by category. Direct edits stay visible while resolution is queued.

See [the worker's source and method notes](worker/README.md#knowledge-pipeline) for the complete
import/backfill commands. Migration `0018` clears the old import-clock OSM freshness values;
the next OSM import supplies the actual object timestamp/version/changeset. No full database
rebuild or production-to-local database copy is required for this release.
