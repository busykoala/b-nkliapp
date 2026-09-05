# Code boundaries

Keep refactors local to a real responsibility; do not add a shared abstraction
just because two pieces of JSX or SQL look similar.

- `src/app/` contains Next.js routes and Server Action entry points. Actions
  validate untrusted input and enforce permissions before invoking supporting code.
- `src/components/` contains UI and composition. The journey folder keeps its
  journal, request/map controller, and pure planner calculations together. Other
  small components stay flat until grouping offers the same concrete benefit.
- `src/integrations/` contains provider-specific clients and repositories. Each
  integration owns its transport validation and mapping into Benchly types;
  feature code never knows a provider URL. GeoAdmin and weather are the first
  slices; journey and walking adapters follow the same boundary while their
  existing feature modules are incrementally reduced.
- `src/lib/` contains provider-independent models, calculations, and map
  rendering. `map-renderer.ts` owns MapLibre layers and image registration;
  `watercolor-map.ts` owns the style, palettes, and artwork definitions.
- `src/db/migrations.ts` is the application schema's source of truth. All database
  callers use `better-sqlite3`; there is no parallel ORM schema to maintain.
- `worker/` owns ingestion, enrichment, and the separately imported transit data.
  `benchly_worker.py` is a thin command/job coordinator. Domain folders under
  `worker/benchly/` keep their models, repositories and rules together:
  `benches`, `context`, `enrichment`, `imagery`, `landscape`, `transit` and
  `weather`. Shared catalog, database, terrain and runtime modules sit directly
  below them, so domain slices depend inward and never on sibling pipelines.
- Worker writes use validated SQLModel models and typed SQLAlchemy statements in
  feature repositories. Explicit SQLite is retained only for analytical reads
  and spatial queries. `worker/benchly/db.py` is the common transaction boundary;
  orchestration and provider code do not contain handwritten write SQL.

`config/data-catalog.json` is the source of truth for external sources, provider
endpoints and collection IDs, runtime endpoints, artifact versions, job commands,
and refresh schedules. Run
`npm run data:catalog:generate` after changing it. The build checks both the
small generated runtime constants and Helm's generated job list for drift.

Dependencies flow from UI/controllers and actions toward models and utilities.
Provider modules stay server-only. Shared libraries must not import UI, and the
journey controller must not be imported by server-side journey providers. Avoid
barrel exports that accidentally pull providers into browser bundles.

Keep existing CSS tokens and illustrated primitives when their meaning matches.
Do not change artwork or layer geometry as a side effect of moving code.

## Artwork lifecycle

`CORE_MAP_ART`, `DECORATIVE_MAP_ART`, and `TRANSIT_MAP_ART`, plus the shared paper
texture, enumerate shipped map artwork. A test checks the inventory and budgets.
Retired map v1/v2 images and superseded v3 experiments are removed from `public/`;
Git history retains them. Current UI artwork still uses **all three** UI version
folders, so folder age alone is not evidence that an asset is unused.

Never overwrite an immutable artwork URL with new pixels. Restore an older
release's assets together with its code when rolling back. Clients running a
much older map version may need a refresh after retired assets are removed.
