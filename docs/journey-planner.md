# Dein Weg zum Bänkli

An always-available illustrated map journal. Routing starts only when requested. No tickets, GPS tracking, driving or cycling.

## Enable and prepare

1. Build the web and worker images together. Journey planning is always available: select a bench on the map and choose **Weg hierher**. No feature flag or environment variable is needed.
2. Provision the shared GraphHopper service from `../server/deploy/graphhopper` first. Configure `WALK_ROUTER_URL`; native development defaults to localhost:8989. There is no public routing fallback.
3. Run `python3 worker/transit_pipeline.py --transit-database ./data/transit.sqlite` once from the repository root (standard library only). The container uses the equivalent established command `benchly_worker.py refresh-transit`. An already downloaded official ZIP can instead be supplied with `--gtfs-zip /path/to/feed.zip`.
4. Keep `TRANSIT_DATABASE_PATH` pointing at that separate SQLite artifact. No bench/account migration is required. Missing, expired or >14-day-old data produces an uncertain assessment, not a guessed minimum.
5. The `transit` CronJob refreshes daily at `workers.transitSchedule`, using the shared data volume and an atomic replacement. It never downloads national data during a web request.

The authoritative Benchly chart is in this repository at `deploy/charts/benchly`. The server repository manages the shared infrastructure and repository-scoped runner. Application releases build and deploy through `.github/workflows/container.yml`; they do not redeploy the shared inference stack.

Feed selection discovers catalogue entries and checks `feed_info` validity, not a hardcoded timetable year. If CKAN's API denies access, the worker discovers ZIP links on the public dataset pages. Upstream download failures retain the previous index. Current SLOID stops map to timetable IDs using the explicit `didok` column; older numeric stop IDs are also supported.

## Routing contract

- [transport.opendata.ch](https://transport.opendata.ch/docs.html): up to four station pairs, six results per pair; up to three complete-trip alternatives displayed. Prognosis and scheduled timestamps are distinct.
- [GeoAdmin](https://api3.geo.admin.ch/services/sdiservices.html#search): typed address search. Choosing a result is explicit, with a station/address discriminator.
- Self-hosted GraphHopper 11.0: pedestrian geometry and slope-aware travel time through the common walking adapter. Runtime and deployment are owned exclusively by the server repository.
- [Swiss GTFS](https://opentransportdata.swiss/en/cookbook/timetable-cookbook/gtfs/): directional stop/platform minima and parent station rules. Route/trip-qualified and through-service rules are preserved in the artifact but **not applied without a reliable identity match**. The current timetable API adapter does not supply that mapping. It never claims “im Fahrzeug bleiben” from a name or vehicle number alone.

Transit lines are schematic connections through known stops, never navigation. Walking lookups that fail retain explicit unknown chapters, not invented straight paths. A snap gap over 15 metres at either end is marked; even a shorter gap is not proof of access. Access/egress candidates are limited to two reachable stops per end, each within 60 minutes at the chosen pace. The nearby provider shortlist is bounded; this is not an exhaustive national routing engine.

Transfers use the greater of an applicable official minimum and known walking time, then compare remaining time with the chosen extra buffer. Missing geometry/evidence is labelled. A zero timetable `walk.duration` is unverified and triggers a walking lookup. Known infeasible connections are removed rather than cosmetically changing their displayed time. No-result screens offer an explicit later/earlier search. The standard pedestrian profile excludes known mountain paths above T1. Missing difficulty tags, stairs, current closures and accessibility remain uncertain.

The Swiss datetime input uses Europe/Zurich even in a browser set to another zone. Spring DST gaps are rejected; an ambiguous autumn time selects its first occurrence. Predicted platforms are shown alongside an explicit change notice where available.

## Resource limits and privacy

- Open the shell immediately; the journal and route-layer code are dynamically imported only when requested. No new image files: it reuses existing watercolor transport and bench assets (0 additional artwork bytes).
- Every journey has a 15-second server deadline. One web process owns the pedestrian queue, with at most two routing and three timetable requests in flight. Queue overload and 429/503 cooldowns fail softly without retries.
- The established deployment uses a single web process/replica. Before scaling, coordinate router concurrency and provider cooldowns across replicas.
- A conservative application-wide timetable budget allows 900 connection lookups/day, recorded using the existing rate limiter without station pairs. Per anonymous IP hash: 8 plans/minute, 40 searches/minute.
- A memory cache capped at 400 entries and 16 MB of upstream payloads holds public station searches for 24 hours, station-pair connections for 30 seconds ; a separate foot-geometry cache is capped at 100 entries/8 MB, with public geometry retained seven days. Personal-origin geometry/nearby-stop queries expire and are deleted within five minutes. Eviction cancels expiry timers as well. No personal route is placed in Next's persistent fetch cache. Address search also bypasses that cache.
- Browser storage contains only pace and buffer preferences. Precise origins are absent from URLs and application logs. Geolocation is requested only on the explicit location action. Search text and nearby-station coordinates go to GeoAdmin/transport.opendata.ch; walking coordinates stay within our infrastructure. External providers have independent retention policies. This is disclosed beside the route action and in the README.
- Logs contain only provider name, HTTP status and latency. Monitor provider errors/latency, the existing timetable quota counter, CronJob failures and the artifact's `metadata.updated_at`; alert when refresh fails or the feed ages beyond 48 hours. Do not add request URLs/coordinates to monitoring.

## Verification and rollout checklist

Automated coverage includes Swiss midnight/DST, transfer minima and buffers, platform/parent matching, uncertain/qualified rules, Spiez harbour's zero-duration walking section, missing geometry, endpoint gaps, provider deadlines and an atomic import retaining old data. The mobile suite checks planner expansion, keyboard controls, explicit/denied location, fallback map and returning to the selected bench. Provider tests use fixtures to avoid burdening public services.

Before deploying, perform a live smoke test with the imported current feed: Bern → Spiez harbour, a Zürich HB interchange, an urban bus and a mountain railway. Inspect whole-route and leg views on a real phone; confirm live GTFS downloads, provider quota headroom, and transfer-data freshness in the target environment. Visual or fixture checks cannot establish actual platform accessibility.

The mobile suite uses isolated server-side provider fixtures; production does not import them. See [walk setup and release acceptance](walks.md) for the shared routing migration, current evidence limitations and outstanding regional quality checks.
