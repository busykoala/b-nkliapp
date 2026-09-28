# Development

## Ownership

- `src/app`: route composition, layouts and public Server Action entry points. Preserve their stable endpoints.
- `src/features/<feature>`: domain models/selectors, repositories/services, components, and colocated unit tests for that feature. For example `bench-detail/{facts,overview,service}.ts` and `bench-detail/components/` own bench reading; `bench-community` owns contribution entry points; `bench-panorama` owns rendering.
- `src/components`: genuinely shared interface elements, including the map sheet, navigation and watercolor primitives. Do not add feature-specific screens here.
- `src/lib`: cross-feature utilities and shared serializable contracts. It must not depend on feature UI/services.
- `src/integrations`, `src/db`, `src/i18n`, `src/data`: provider adapters, storage, translations and generated catalog bindings.
- `worker`: bounded offline geospatial/data pipeline. Its tests and deployment remain separate from the web application.

Import the concrete owning module with `@/features/...`; avoid compatibility barrels or re-export chains. Keep client components away from repository modules. Extract cohesive models/components, not one-line wrappers. `map-explorer` remains the map/task orchestrator; do not change its history/camera semantics during cosmetic work.

## Bench detail

`bench-header` is the shared route/save/share/edit row. `bench-overview` uses typed pure selectors for weather, sunlight, comfort, local access, view and quietness. Nearby facilities, the short poem, panorama/photos, and contribution actions follow. Detailed source/evidence panels live inside the single, closed-by-default `bench-sources` disclosure. Reading never requires expanding those panels.

Missing data is not zero or a positive claim. Conflicting facts are excluded from the compact overview and remain available in sources. Bench-adjacent space is not a whole-route accessibility guarantee. Quietness reviews are distinct from per-channel modeled noise. Ordinary fountains must not be labelled drinking water. Maintain these contracts when changing the layout.

Feature CSS is owned by `src/features/bench-detail/bench-detail.css`; global tokens and shared surfaces remain in `src/app/globals.css`. Avoid reintroducing superseded summary/title selectors.

## Tests

```sh
npm test                       # Colocated models, services and repositories
npm run test:bench              # Focused presentation/data contract tests
npm run test:e2e:bench
npm run test:e2e -- e2e/map      # Other groups: routing, community, account, platform
npm run typecheck
npm run lint
npm run dialects:generate       # After changing source-language messages
npm run dialects:check
npm run data:catalog:generate   # After changing config/data-catalog.json
npm run test:worker
```

`e2e/support` contains reusable fixtures; browser suites are grouped by user task. Keep one focused owner for each regression rather than copying screenshots/locators across suites. Preserve authentication, save/draft state, storage, route coverage and geographic rendering checks even when reducing cosmetic assertions. Unit calculations do not need a rendered React component.

Playwright config supplies a disposable database, media cache and photo store. Tests must not rely on a private production database or live weather. Save review screenshots in Playwright's ignored output directory or an external review artifact, not in source control. Historical one-off screenshot galleries have been removed; the portable panorama fixture and regressions remain in `e2e/bench/panorama.spec.ts` and `e2e/support/panorama-fixture.ts`.

Before merging: `npm run check`, an isolated production build, and the complete browser suite. Open actual screenshots at native sizes, including long titles, sparse data, all supported languages and 200% text. A passing assertion is not visual acceptance.

## Dependencies and scripts

`package-lock.json` is authoritative. This cleanup does not upgrade runtime dependencies. Keep container-build, migration, catalog, translation and worker commands: release automation and operations use them. Change versions in a separate audited update, with lockfile and full build/browser verification. Node 24 is declared in `.nvmrc` and package engines to match CI.
