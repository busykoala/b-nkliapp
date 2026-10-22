# Bänkli

Watercolor map, bench details, journeys and walks in Switzerland. Node.js 24; npm.

```sh
nvm install && nvm use
npm ci
cp .env.example .env.local
# Replace the three *_SECRET placeholders with distinct random values.
npm run dev
```

Open http://localhost:3000. The first request migrates the local database and seeds demo benches when empty. Set `BENCHLY_SEED_DEMO=false` for an imported database.

```sh
npm run check            # Generated files, TypeScript, lint, unit tests
npm run test:bench       # Bench presentation/data regressions
npx playwright install chromium webkit
npm run test:e2e:bench   # Bench and navigation flows; isolated test database
npm run test:e2e         # Complete browser suite
npm run build           # Migrates DATABASE_PATH, then builds
npm start
npm run test:worker     # Python worker tests (requires uv)
```

Use a disposable `DATABASE_PATH` for review builds; never point tests at production.

Capture and review 20 live Bänkliview panoramas (Node 24 and Chromium required):

```sh
npm run panorama:review -- --output test-results/panorama-review
npm run panorama:review -- --output test-results/panorama-review --resume
# Reuse exactly the successful locations in a fresh run:
npm run panorama:review -- --sample test-results/panorama-review/selection.json --output test-results/panorama-repeat
npm run panorama:review:check
```

The command reads `data/benchly.sqlite` without migrations or writes, filters candidates against the repository’s Swiss territory (the source snapshot includes cross-border benches), selects four geographically spread benches per setting (urban, forest, waterfront, alpine, countryside), and browses production sequentially. Use `--database PATH`, `--origin URL`, `--count 1` for a smoke test, `--timeout 20000`, or `--max-candidates 12` per setting. Candidates have two attempts; failures retain screenshots and same-setting replacements. An explicit sample never substitutes different locations. Stop with Ctrl-C to finish the current bench and save progress, then resume with the same options. Existing evidence is verified before reuse.

Open `report.html` in the output directory for zoomable PNGs, untouched screenshots, diagnostics and coverage. Each panorama covers 360° and all reachable up/down angles at 1×; the measured vertical range is reported, rather than claiming a spherical photograph. Clean stitching inputs hide screen-anchored controls/foreground/precipitation and pause CSS animations only in the capture browser. Original screenshots preserve those layers. The live app and its assets are unchanged; normal site browsing may trigger its existing background generation behavior.

Visual review starts as **pending**. After inspecting every panorama and original overlaps, write `findings.json` as an array of findings with `id`, `title`, `severity`/`confidence` (`high`, `medium`, `low`), `observation`, `likelyCause`, `improvement`, `acceptance`, and `evidence`. Each evidence entry has `benchId`, a captured `file` path relative to the output directory, `angles`, and a pixel `box: { x, y, width, height }` within that image. Rebuild the annotated exports and report with:

```sh
npm run panorama:review -- --output test-results/panorama-review --report-only --reviewed
```

The capture command exits unsuccessfully unless the requested number of distinct panoramas is complete. Capture completion and visual-review completion are tracked separately in `manifest.json`. Geographic inaccuracies need independent reference evidence; capture joins caused by screen-space overlays or live lighting must be distinguished from renderer defects using original overlaps.

The [full artist-review implementation plan](docs/panorama-artist-review-plan.md)
covers all nine review themes, the 20 location-specific checks and delivery gates.
The local [artist-review guide](docs/panorama-artist-review.md) covers reproducing
the cluster snapshot, painting iterations, seasonal/weather captures and offline
report packaging. The local report retains all 20 complete panoramas and individual
assessments with documented source limits. The root `panoramas.zip` was deleted
after review at the user’s request; the review folders and staged archive remain.

The [current local report](test-results/panorama-artist-review/candidate-v30/delivery-reviewed-v1/report.html) contains 20 current panoramas,
matched C29 comparisons, original live context, numbered evidence and an improvement
backlog. Long contours retain their slower hand-painted drift; broad paper reserves
and restrained cool pools now give large walls quieter plane variation. Measured
roofs, source-bound openings and silhouettes remain. Bench legs stay below frame,
without a soil patch or detached shadow.

All 20 existing geometry capsules and 1,540 material/light fields are reused exactly.
The 1,620-field generation includes four raw seasonal palette studies. All 20 fresh
full-range captures pass coverage, horizontal wrap, vertical limits and overlap
checks. Native review covers 45 fresh non-pilot changed-region crops and 12 crops
whose final panoramas exactly match the reviewed current pilots; unchanged pixels
retain the preceding native review. Every location has an individual assessment.

Unknown facade features remain deliberately simple, as the plan requires. Large
anonymous walls are less descriptive than buildings with qualified references;
unseen bases and unqualified details are explicitly limited. The separate small
Cossonay corner bump remains in the backlog. These limits are visible in the report.

The [local report](test-results/panorama-artist-review/candidate-v30/delivery-reviewed-v1/report.html)
retains every picture and interactive comparison. The generated root ZIP has been
removed after review. [Independent archive verification](test-results/panorama-artist-review/candidate-v30/delivery-reviewed-v1-verification.json)
records 6,727 content hashes, 5,914 local references and successful desktop/mobile
checks. Historical source snapshots and staged archives remain available locally.

The matrix covers 1,248 unique weather/device combinations for the current artwork:
768 fresh current captures and 480
explicitly retained C29 captures with identical artwork, material, lighting,
scenario and frontend inputs. It includes all 912 six-pilot combinations and 336
other-location representatives, plus 12 matched facade cases. Manual weather
inspection is representative and separately recorded. Twelve current GPU/Canvas
pairs pass; 60 fields reproduce from independently extracted source and capsules.

511 worker tests pass (one skipped, nine subtests). The 427 frontend tests,
typecheck and lint carry through exact frontend/config/assets/lockfile compatibility.
Matched local painting medians, C29 → C30: 1: 3.576 → 3.589s; 15: 4.892 → 4.938s; 14: 4.594 → 4.658s. These development timings do
not establish production throughput. Historical database-checksum uncertainty
remains documented. The reviewed changes are deployed from `main`. A subsequent full-catalogue repaint covers all 125,080 active panoramas, with matching masks and resumable batch publication. See the [rollout record](test-results/production-rollout/release.json) for progress; the first 20 have passed live checks.

[Development & structure](docs/development.md) · [Design system](docs/design-system.md) · [Data/operations](docs/operations.md) · [Worker](worker/README.md) · [Deployment](deploy/charts/README.md)


The mobile watercolor atlas refinement now covers discovery, visiting, journal, saved places, filters, menu, routes, authentication, contributions and supporting pages locally. Review the [matched before/after evidence](test-results/ui-watercolor-atlas-refinement/report.html) and [execution record](docs/atlas-refinement-progress.md). The three pigment edges, explicit wishes, preserved literary voice and measured short-screen layouts share one system. The approved interface is released from `main` through the existing verified container workflow. The panorama now uses a small on-image heading and a discreet return-to-bench direction cue, without a zoom toolbar. Earlier material remains in the [original mobile reference](test-results/ui-watercolor-atlas/report.html), [art-direction review](test-results/ui-art-direction/report.html) and [lyrical review](test-results/ui-watercolor-guide/report.html).
