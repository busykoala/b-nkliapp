# Benchly data pipeline

The operational inventory is [`config/data-catalog.json`](../config/data-catalog.json).
It lists every external/community source, computed artifact, version, CronJob
command and human-readable refresh frequency in one place. Helm schedules and
the public `/danke` page are derived from that catalog, so this document does not
duplicate schedules that inevitably go stale.

Worker persistence follows the same feature boundaries as the imports. Each
domain under `worker/benchly/` owns its Pydantic-validated SQLModel tables and a
small repository. Pipelines compose those repositories; they do not embed schema
creation or write SQL. Spatial and aggregate reads stay explicit where an ORM
would make their intent harder to see.

## Reliable environment evidence

Environment features retain exact geometry in LV95. Candidate selection still uses geographic
R*Tree bounds, but containment and distance decisions use Shapely against the WKB geometry.
The deterministic dimensions are independent: land context, waterfront and canopy can coexist,
for example “Am See, unter einzelnen Bäumen.” Only exact forest-polygon containment sets
`in_forest=true`.

Open imagery is progressive and never blocks a page request. Discovery, temporary scene
analysis, evidence reconciliation and auditing are separate bounded commands. Images are never
persisted; `image_observations`, `bench_image_evidence` and `bench_likely_metadata` contain only
provenance and structured predictions. Same-sequence frames count as one evidence group, and
only high-confidence reconciled values participate in map filters.

## Current national inventory

The local development database was built from the 1 September 2026 Geofabrik Switzerland extract. It contains 106,146 active `amenity=bench` objects. The temporary 544 MB PBF is deleted after a successful run. The SQLite database also contains the OSM context required for later enrichment:

| Context | Records |
| --- | ---: |
| Buildings | 2,819,074 |
| Trees | 1,029,328 |
| Paths | 1,125,572 |
| Forest areas | 97,551 |
| Major roads | 135,331 |
| Water areas | 24,908 |

Run `python3 worker/benchly_worker.py inventory` to obtain the current counts and OSM field completeness from any database.

## Collection layers

1. **National base inventory:** the weekly Geofabrik Switzerland PBF is the authoritative bulk input for bench identities and observed tags. Importing the extract is deterministic, upserts OSM identities and deactivates disappeared objects.
2. **Local geometry context:** the same PBF pass stores spatially indexed building extents, individual trees, forests, water, paths and major roads. This avoids millions of network requests and lets enrichment work entirely against the PVC.
3. **3D surface and terrain:** swissSURFACE3D supplies 0.5 m roofs and canopy surfaces to 300 m; the 2 m swissALTI3D raster supplies bare terrain to 20 km. Only the required GeoTIFF resolution is selected from the official swisstopo STAC catalog and downloaded to temporary storage.
4. **Photos:** exact OSM `image`/`wikimedia_commons` links are retained. Nearby Commons searches are refreshed after 30 days, limited to six results within 300 m, and keep author, license, source coordinates and calculated distance.
5. **Coverage gaps:** cantonal and municipal open-data inventories can be added as separate sources after their licenses and stable identifiers are verified. They should first be matched to OSM within 3–5 m; unmatched records must stay visibly attributed to their original inventory instead of being disguised as OSM objects.

## Directional sun model

For every bench, the worker observes from a seated eye height of 1.1 m above terrain. It samples 72 azimuths at 5° intervals:

- Dense surface samples every 2 m close to the bench and progressively coarser samples to 300 m detect roofs, walls and vegetation.
- Logarithmic terrain samples continue to 20 km for mountain horizons.
- OSM building footprints distinguish a raised swissSURFACE3D sample caused by a building from vegetation.
- Each direction stores obstruction angle, type and distance. The web app compares the current apparent solar altitude and azimuth against this profile.
- Every direct-sun and daylight-shade interval for today is sampled at five-minute resolution. Astronomical sunrise/sunset remain separately labelled, and sun plus shade always equals the astronomical daylight duration.

Clouds, moving objects and short-term vegetation changes remain outside the model. A full recomputation is required when raster versions change: pass `--recompute`.

## Directional view model

The viewing cone follows OSM `direction` ±45° when known; otherwise all directions are considered at reduced confidence. Water counts as visible only when it is in the viewing cone and the modeled horizon is open. Benchly classifies the result as `Bergblick`, `Seeblick`, `Wasserblick`, `Weitsicht`, `Waldblick`, `Eingeschränkte Aussicht` or `Keine besondere Aussicht`, then applies the versioned weighted score.

For national operation, run stages independently as configured in the catalog.
Do not overlap two writers on the same SQLite file; all write commands share the
same filesystem lock.
