# Watercolor artwork review — 5 September 2026

[Open the screenshot gallery](index.html) · [All bench combinations](contact-sheet.png) · [Avatars, badges and stamps](21-avatars-and-badges.png) · [Safari comparison](safari-contact-sheet.png)

## Scope and method

The actual `BenchLandscape`, `TrailAvatar`, `BadgeIllustration`, `LandscapeStamp` and `SeasonStamp` components were rendered in Playwright with deterministic presentation data. Twenty core bench combinations cover five settings × four season/light/weather combinations. Five additional cases cover daylight shade, a snowy alpine overlook, a low moon near city roofs, shelter and missing weather/metadata. Ten composed portraits cover every skin tone, hairstyle and landscape, with different hats and companions. All nine badge kinds and all landscape/season stamps are included.

The first 20-case review exposed solid vector hills, repeated road ribbons, geometric clouds, noisy weather overlays, near-blank winter scenes and flat avatar/badge artwork. Four composition passes and targeted asset corrections followed. Final captures use only the compiled production CSS, at a 440 px viewport. Images and fonts finish loading before capture. Separate identifier prefixes prevent duplicate SVG definitions when individual renders are assembled into a contact sheet. All 25 cases were also captured in WebKit; the Safari sheets and manifest are retained alongside the Chromium evidence.

The scenes are contextual illustrations, not reconstructions of the exact view or architecture at a particular bench. Biome, observed snow, bench construction and celestial/weather inputs drive their composition. Actual sun/view measurements remain in the detail UI.

## Critical review and resulting decisions

| Cases | Problem found | Final visual check |
| --- | --- | --- |
| 01–02 Meadow, spring dawn / summer sun | Painted background was hidden behind opaque hills, hard path and a spotlight cone. | Layered landscape now supplies the ground and horizon. Warm dawn and higher midday sun remain subtle; the bank sits within the meadow. |
| 03 Meadow, autumn rain | Clouds and wind marks dominated the scene. | Sparse fine rain and a restrained cool wash leave the hills and backless stone bench readable. |
| 04 Meadow, winter night | Seasonal overlay erased the entire place. | Snowy terrain and bare trees remain readable in blue-grey moonlight. Moon illumination changes its painted disc. |
| 05–06 Lake, dawn / sun | Original lake image had large broken pigment holes; the stone backrest showed the horizon through it. | Regenerated continuous lake painting, open shore, softer mountains. Bench blending corrected so stone is opaque. |
| 07–08 Lake, rain / winter night | Water detail competed with weather; night flattened the landscape. | Turquoise water and shore are clear by day; snowy bank, peaks and reflected water remain distinguishable at night. |
| 09–10 Forest, dawn / sun | Individual pasted trees and smooth vector hills broke perspective. | One painted forest clearing provides integrated trunks, canopy and depth. Sun is masked away from the tree line. |
| 11–12 Forest, rain / winter night | Repeated weather graphics covered trees; winter looked blank. | Fine rain respects the forest texture; a separate snow-dusted forest gives winter depth without large white overlays. |
| 13–14 Village, dawn / sun | A checkerboard was baked into the source asset. | Repainted opaque warm paper eliminates the pattern. The clearing and houses read as one painting. |
| 15–16 Village, rain / winter night | Weak distinction between light moods and no convincing snow on houses. | Rain stays quiet; winter roofs and surroundings are painted with snow. Buildings remain readable at night. |
| 17–18 City, dawn / sun | Smooth foreground hills obscured the city; buildings showed through the stone bench. | Painted square is visible. Bench pigment is softened with color/contrast, without transparent backrests. |
| 19–20 City, rain / winter night | Flat clouds, visual noise and celestial discs crossing roofs. | Architectural drawing remains the setting. Sky masks prevent celestial overlap; the snowy square stays visible. |
| 22 Forest, daylight shade | Needed a daytime comparison with the sunny clearing. | Cooler bench and restrained ground/atmosphere tint distinguish shade without darkening the whole forest. |
| 23 Alpine snow, daylight | Snow needed depth rather than a flat white layer. | Painted ledge, mountain shadows and readable foreground bench. Snow selection follows observed coverage and elevation. |
| 24 City, low moon | Low-altitude celestial objects could appear on roofs. | The disc is hidden below the conservative sky mask; buildings stay intact. |
| 25 Sheltered village | Simple vector roof looked out of place, then the generated asset had fake transparency. | Painted timber shelter with an explicit silhouette mask; no generated checkerboard is displayed. Roof and bench have consistent visual scale. |
| 26 Missing weather/metadata | Unknown values must not break the illustration. | Quiet default landscape and neutral bench render without weather layers. |
| Portraits | Solid geometric fills and identical vector hills looked like cartoons. | Painted landscapes, static pigment variation and softer facial strokes; component choices remain interactive and persisted. |
| Badges and stamps | Heavy repeated polygons and a thick flat bench dominated. | Reused small painted landscapes/benches, fine achievement emblems and watercolor seasonal marks. All nine badges retain distinct symbols. |

## Production evidence

- Production build, TypeScript and lint pass; the full unit suite passes (52 tests).
- Full mobile suite against the actual standalone build over local HTTPS: **26 passed, 2 platform-specific skips**. The skips are Chromium-only CPU/network throttling and Safari-only installation guidance on the opposite browser.
- The initial HTTP production run caused Safari to drop Secure session cookies. Local TLS was added to the test harness; application cookie security was not weakened. Registration, contributions and avatar persistence then passed in both browsers.
- After the final bench-blending correction, the production build and both-browser bench/avatar smoke tests were rerun: **4 passed**.
- Production browser checks verify the scene asset returns successfully and has immutable cache headers. The existing Fast-4G / 4× CPU mobile check passes.
- Final Chromium and WebKit manifests report **no missing artwork** and `productionCSS: true`.
- Shipped UI raster assets total **790,562 bytes** (772 KiB), below both 800,000 bytes and the tested 800 KiB ceiling. Only the context's selected scene, bench and conditional overlays are requested. No animated filters, per-frame texture generation or extra client-side scene fetching were added.
- Superseded v1 lake/village and large weather/light/profile textures were removed from the shipped asset set; recoverable copies are in `/tmp/benchly-retired-ui-art/`.

## Reproduce

```sh
npm run build
npx tsx scripts/review-watercolor.tsx docs/reviews/watercolor chromium --production
npx tsx scripts/review-watercolor.tsx /tmp/benchly-watercolor-safari webkit --production
PLAYWRIGHT_PRODUCTION=1 npx playwright test e2e/mobile-map.spec.ts
```

The review script has no production route and does not alter a database. The E2E harness uses an isolated temporary database and a one-day local self-signed certificate. Generated-art prompts, source paths and retained/retired assets are recorded in [the asset provenance document](../../watercolor-ui-assets.md).
