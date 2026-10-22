# Watercolor atlas refinement · execution record

Objective: implement packages A–H from the supplied refinement goal, deliver locally at `test-results/ui-watercolor-atlas-refinement/report.html`. Existing poetry, essay, landscapes, account data, URLs and attribution are protected. No production deployment.

| Package | State | Evidence / remaining work |
| --- | --- | --- |
| A · Baseline and close-zoom map | Complete locally | `baseline-settled/results.json`: four Chromium cases passed; 56 tour screen captures plus three performance samples. Preview shows actual streets/buildings/river; tile responses 200, no page errors. Earlier report lacked settled painted detail. |
| B · Shared composition and bench | Complete locally | `package-b-reviewed/results.json`: four cases passed across Chromium/WebKit. Native screenshots inspected at 390 and 320/200%; further final matrix pending. |
| C · Panorama and discovery | Complete locally | `package-c-reviewed/results.json`: Chromium/WebKit pose, 48px controls, Escape/focus and search return pass. Captures inspected; obsolete viewer styles removed. |
| D · Journal and saved places | Complete locally | `package-d-fixed/results.json`: four Chromium/WebKit cases pass including public/private boundaries, first-entry placement and journal focus return. Journal and favourites captures inspected. |
| E · Filters and menu | Complete locally | `package-e/results.json`: six Chromium/WebKit cases pass, including all four languages without map remount. Menu/filter captures inspected. |
| F · Routes and walks | Complete locally | Full route/walk suites: 20 pass. After a CSS scope correction, `package-f-reviewed/results.json`: eight cases pass with matched phone tour; route, walk and result captures inspected. Capture waits now also cover map rendering in every map-based screen. |
| G · Authentication and contributions | Complete locally | `package-g/results.json`: 32 behavior cases pass. After a field specificity correction, `package-g-fixed/results.json`: four phone tours pass, all editor forms/authentication captured and inspected. |
| H · Supporting pages and larger screens | Complete locally | Shared document typography, adding-bench forms, desktop application header/map split, tablet reading width and full-viewport viewer. Final matrix, manual review and delivery report complete. |

## Verification rules

Use the isolated source/build copy and temporary Playwright database; never run migration-bearing build scripts against the workspace snapshot. Preserve baseline screenshots and all prior review directories. Record actual command outcomes, defects and unavailable physical-device checks separately from aesthetic acceptance.

## User steering

Replace sketchy filter checkboxes with explicit choice buttons; sun/shade has an “Egal” choice. Remove the ochre wordmark underline. These supersede the checkbox detail in the initial plan.

## Capture limitations identified during implementation

The initial baseline reading URL `/gedanken` returned the not-found screen; use `/gedanken/baenkli` for the essay. Preserve the erroneous raw frame but do not present it as a reading-page design comparison. All screenshot waits now account for map readiness/camera/network settling and image clipping; the earlier package-D capture was intentionally interrupted after its helper waited for off-crop lazy images. No application or test evidence was replaced with a backdrop.

## Final verification and delivery

- Review: `test-results/ui-watercolor-atlas-refinement/report.html`; source build, full file inventory, raw logs, original PNGs, manual visual checks, commands and performance comparison are linked there.
- `delivery-final`: 26 Chromium/WebKit matrix checks pass. `verification-final`: 196 retained behavior checks pass, with two platform-specific skips (iOS installation in Chromium; CDP throttling in WebKit). `night`: two pass. `performance-repeat`: three cases / nine timing samples pass.
- The final native-size visual inspection found a one-letter wrap in the 200% filter label. Only its media-layout CSS changed afterward. `large-text-final`: four Chromium/WebKit cases pass, including a real one-line-label assertion. Total final browser checks: 231 passed, two platform skips. The application TypeScript is byte-identical to the complete regression run; `source-verification.json` records the exact carry-through and matches all 602 source/config/asset files to the isolated checkout.
- 131 targeted Vitest cases pass across 17 files. Isolated production build, TypeScript, targeted lint, dialect generation/check and diff whitespace checks pass. All 55 protected literary, essay, action, database, renderer and foreground-art files match the frozen baseline.
- Visually inspected every named surface: discovery, bench, preview, search, viewer, journal, favourites, filters, menu, routes, authentication, contributions, adding benches and supporting pages. The report records eight separate visual checks and numbered correction overlays; functional passes do not substitute for these observations.
- Fixed during validation: stale background focus, a delayed WebKit contribution-heading focus that could interrupt input, Undo feedback lost when its saved row revalidated away, mobile journal nav containment, enlarged-menu composition and a panorama error cleared by an unchanged parent descriptor. Failed mask state now stays visible through refresh until a real asset change or explicit retry.
- Main matched Chromium performance: ready median 275→288ms, opening 109→115ms, 47 image-resource entries and three font entries in both, transfer 897824→899003 bytes. No repeatable >10% median regression. The separate nine-sample fresh-database run has one fewer community graphic and is treated as exploratory variation, not an improvement claim.
- Remaining verification: physical keyboard/browser chrome and outdoor readability unavailable; user aesthetic acceptance remains separate. Baseline essay URL error and automatic avatar variation are disclosed. No production rollout, schema migration, endpoint change, literary rewrite or landscape repaint.


## Approved release follow-up

The user requested release on main and production deployment after one final panorama adjustment. Remove panorama zoom and the large bottom control surface. Show a small compass/heading directly over the picture; keep help behind that badge. Show a left/right edge cue towards the recorded bank view only when more than 12° away, taking the shortest turn across north; hide it for unknown directions. Clicking the cue returns to the bank view and focuses the scene. Preserve panning, pitch, Home, Escape, fallback and pose on reopening.

Release verification and untouched before/after screenshots are recorded in `test-results/ui-watercolor-atlas-refinement/viewer-release/`. The full unit suite passes 442 cases, root lint passes, catalog/dialect checks pass, and the isolated production build/typecheck passes. The release uses the existing main-branch GitHub Actions workflow; actual rollout status is recorded separately from local checks. Four byte-identical approved C30 painting/mask pairs are now versioned as lightweight test fixtures, with provenance and checksums, so CI does not depend on ignored local review directories.

The complete pre-release browser run also exposed a production-only update banner behind the new bottom navigation. Its position now reserves navigation space, its stacking order is above map controls, and its dismiss target is 48px. The retained service-worker behavior test now additionally checks the actual notice/navigation rectangles before dismissing. Failed pre-fix evidence remains in `release-regression`; the correction is verified separately against the rebuilt production application.

## Release dependency correction

The first main-branch release was correctly blocked by the production dependency audit: Next.js 16.3.8 is included in GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r and GHSA-673q-mjm6-r5xr. Pin Next.js and @next/env to 16.4.2 in a separate security commit, preserving the audit gate. Only these packages and their matching SWC packages change in the lockfile. The existing running development installation is left intact; installation, production build and regression validation use the isolated source copy. `npm audit --omit=dev` there reports zero vulnerabilities. Upstream references: https://github.com/advisories/GHSA-2464-fhr4-w9xw and https://github.com/vercel/next.js/releases/tag/v16.4.2 .

The first Linux Safari CI shard also surfaced two dev-only differences: the late-mounted “Open Next.js Dev Tools” button entered the otherwise isolated tab sequence, and the full C30 artwork had fetched successfully (HTTP 200) but was not rendered within the default five-second assertion budget. CI now disables only the framework indicator using the documented `devIndicators` setting (compile/runtime errors still surface), and full-artwork readiness has a bounded 15-second CI budget. The actual ready canvas remains mandatory; artwork and assertions are retained. Original screenshots, traces and request evidence remain under `ci-first-safari`. Production-code/browser regression and focused CI-mode dev checks are recorded separately.
