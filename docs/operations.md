# Local data and operations

## Configuration and security

Copy `.env.example` and replace every secret before production. Moderation uses the preview-first worker CLI (`benchly moderation list`, `benchly moderation hide --type moment --id ID --apply`); there is no web admin login. Recentring the map uses location in the browser. Explicitly requesting a route sends coordinates to our server. Footrouting is self-hosted; address and nearby-station searches use GeoAdmin and transport.opendata.ch. A planned walk is kept for seven days in SQLite and identified only by a random HttpOnly cookie in the same browser; ending the walk removes it. Providers have their own request-retention policies. Anonymous contribution and daily IP identifiers are HMAC hashes, and raw IP addresses are not stored.

The illustrated journey planner is available via **Weg planen** in a bench's map details. **Spaziergang entdecken** offers walks with optional maximum intervals of 5, 10 or 15 minutes between benches. GraphHopper and inference deployments live exclusively in the sibling server repository; Benchly releases use the [application chart](../deploy/charts/README.md).

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

Use `python3 worker/benchly_worker.py inventory` for current totals and field completeness. See the [worker commands](../worker/README.md) for imports and bounded enrichment jobs.

## Data labels and licenses

- Observed properties are labelled OpenStreetMap and retain their original tags and timestamps.
- Sun/view/environment fields are labelled Benchly estimates with confidence. “Sonne jetzt” describes geometric direct sun, not cloud cover.
- Corrections appear immediately as community suggestions and never silently overwrite OSM.
- Nearby Commons images are explicitly labelled as nearby and may not depict the bench.

The interface includes attribution to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [swisstopo](https://www.swisstopo.admin.ch/en/terms-of-use-swisstopo-app), and individual Wikimedia media authors/licenses.


For public operator/privacy configuration, see `.env.example` and the deployment chart. Keep production databases, archives, secrets and geodata outside source control.
