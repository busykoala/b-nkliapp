# Bänkli watercolor design system

The interface is an illustrated watercolor outing book. Paintings, feathered pigment edges and sparse drawn accents shape the composition; typography and interactive hit areas stay crisp on flat paper.

## Foundations

- Interface type: self-hosted Source Sans 3, weights 400/600/700. Place titles and restrained editorial headings use self-hosted Lora, weights 400/600/700. Both font directories contain their OFL license.
- Body text starts at 16/24 px. Secondary text uses 14/20 px; section headings use about 22/28 px; mobile place titles use 30–32 px and wrap naturally.
- Spacing tokens are 4, 8, 12, 16, 24, 32 and 48 px (`--space-1` through `--space-8`). Controls, surfaces, and sheets use the three shared radius tokens.
- Primary controls use at least 48 × 48 CSS px. Focus is a visible `--color-focus` outline; selected, warning, and unknown states also carry text or an icon.

The semantic palette lives in `src/app/globals.css`: paper and surface are the two reading layers; ink and muted text carry content; action is the shared interactive green; sage and sky are quiet washes; caution and danger are reserved for meaning; divider, control border, and focus support structure.

## Information and state semantics

Bench facts resolve to canonical `known`, `unknown`, or `conflicting` evidence before translation. UI copy must never infer meaning from translated strings. Weather observations, geometric light estimates, forecasts, and community impressions stay distinct. A renderer may use a neutral visual fallback, but the information UI continues to say “unknown.”

Access is split into three scopes: space directly at the bench, the mapped local approach, and the complete planned route. Missing route sections remain visible as partial coverage; known steps always produce a warning.

## Components

- Primary buttons use the action color, a small shared radius, a 48 px minimum target, and a verb matching the actual behavior.
- Icon buttons always have an accessible name. Lucide icons use the default outline convention; emoji are not production controls.
- `WeatherSummary` uses the weather feature’s shared condition resolver and compact/illustrated variants.
- `BenchSaveButton`, `StartPicker`, `MapSheetShell`, and route accessibility summaries are shared rather than restyled per flow.
- Bench sheets have exactly `preview | place` presentations; planners retain their independent shell. “Zur Karte” leaves the bench; “Vorschau” / “Zum Bänkli” changes its presentation without adding history. Hide the toggle when a useful preview cannot fit.
- Bench detail follows identity → painting and opening action → complete poem → up to three useful hints → closed “Gut zu wissen” → existing community content → contribution entry. Important access and presence warnings remain directly visible. Directions/save appear once in a reserved bottom area, including the standalone page. When chrome plus actions exceed 35% of the visual viewport, that single group and header join the scrolling document.
- The single visit disclosure contains seating/access, weather/sun, and nearby facilities. Unknown access is explicit inside it; known obstacles remain visible outside it. Its summary can announce known toilets and drinking water without distances. Empty secondary facts and empty ratings are omitted. Technical source/freshness/model/confidence displays are absent from visitor bench screens; the underlying evidence remains available internally. Existing map, project and photographic credits remain.
- Signed-in profiles begin with the person, saved-place entry and recent contributions. Counts, milestones, landscapes and badges live in an initially closed collection. Pending confirmations appear only when entries exist; invitations and avatar editing are secondary. Public collections expose earned items and exclude account tools and saved places.

## Data display grammar

The same card treatment is not reused for unrelated measurements. Each visual must answer one visitor question and retain an exact text equivalent.

| Data relationship | Visual form | Bench detail use |
| --- | --- | --- |
| State | Familiar icon + short value; shape/text as well as colour | backrest, level space, steps |
| Time | Shared 24-hour axis and interval tracks | sun/moon paths, direct sun and shade windows |
| Proportion | Segmented scale only when the bounded whole helps the decision; always include the exact percentage | cloud cover, assessed-route coverage |
| Magnitude | Exact rounded value and unit; add a chart only for a real comparison or time series | rain, wind, snow, slope |
| Distance | Exact rounded distance plus scope (“Luftlinie” or routed) | building, water, path, and facility proximity |
| Profile | Aligned small multiples only when several comparable samples exist | seasonal sun or canopy by radius |
| Status from people | One overall rating with an optional note | experience of the visit |
| Traffic noise | Short qualitative estimate from the current day/night model | low, noticeable or high modelled traffic; unknown if no data |

Do not normalize a lone measurement into an unexplained bar, ring, percentage, or score. Do not add a chart merely to decorate a single value. Keep technical provenance internal; use progressive disclosure for secondary visit details. Visual encodings use labels and accessible names, never colour alone.

This grammar was checked against:

- [GOV.UK data-visualisation principles](https://brand.design-system.service.gov.uk/data/), especially clarity, accessibility, accuracy, and choosing a chart from the data relationship.
- [GOV.UK chart guidance](https://brand.design-system.service.gov.uk/data/charts/), which favours concise titles, direct annotations, exact units, and non-interactive charts when they already communicate the point.
- [GOV.UK details guidance](https://design-system.service.gov.uk/components/details/), used only for secondary facts and provenance rather than information most visitors need.
- [W3C guidance for complex images](https://www.w3.org/WAI/tutorials/images/complex/), applied by pairing every visual with an equivalent accessible description.
- [MeteoSwiss forecast presentation](https://www.meteoswiss.admin.ch/dam/jcr%3A476d2d3b-eb36-40e8-8b0b-f9b8875ae40b/Praesentation-User-Consultation-2024.pdf), which groups time-dependent temperature, precipitation, sunshine, wind, and gust data into parameter-specific charts.

## Usage

Use grouped surfaces only when elements form one decision. Prefer a divider and whitespace over a card, shadow, or pill. Do not put texture behind dense text. Keep visit-critical warnings beside the painting; the lyric precedes routine visit facts. Avoid showing low-priority unknown facts; retain their evidence internally.

`src/features/bench-detail/bench-detail.css` owns the compact preview/detail layout; use `BenchHeader`, `BenchOverview`, and `NearbyAmenities` in both rather than making separate fact cards.

The development-only `/design-system` route shows palette, type, controls, states, and deterministic weather conditions. It intentionally returns 404 in production.

## Menu and reading

The menu separates being outdoors (walks and saved places), an optional literary pause,
and community/about destinations. Account and language preferences stay visible in the
scrolling area; its close control stays outside that area. Avoid a separate oversized card
for every destination. Keep familiar functional names and visible keyboard focus.

`src/components/app-menu.css` owns the menu. `src/features/reading/` owns Urs’s essay,
its four versions (de/fr/it/rm), and one reading component used in the menu dialog and at
`/gedanken/baenkli?lang=de`. The reading dialog keeps the underlying menu and map task
mounted. The small static essay ships with the menu, so opening it needs no extra
network request. Escape closes only the top dialog and returns focus to its opener. Reading does
not change the application's language preference or record reading activity.

Editorial prose uses Lora with a bounded line length on an untextured paper surface.
Reuse the existing watercolor bench as a quiet vignette; do not replace control icons
with miniature paintings. There is no autoplay, animation, progress score, or forced
reading detour. Language can be changed for this text independently of the interface.

The German contribution is author-supplied and must not be copy-edited or passed through
the location-dialect generator. Its wording is protected by a content hash test. Preserve
five paragraph boundaries and the supplied punctuation/spacing. French, Italian and
Rumantsch Grischun versions credit Urs and are labelled as AI translations; they have not received
independent native-speaker review. Review translations in their respective content files,
not by altering the German original. Do not add English as an application or essay option.

## Field-guide presentation

`src/app/field-guide.css` applies the shared reading surfaces and control grammar across map overlays, authentication, routes, contributions, journals, saved places, the feed and information pages. Source Sans 3 carries functional text; Lora identifies places and editorial headings. Use the existing palette and illustrations, restrained borders, 44 px controls and 16/24 px reading text. Avoid a separate card for each measurement. Routing controls collapse after a result so the recommendation leads; alternatives remain optional.

The contribution workspace keeps grouped task rows and one active task, including draft/discard and authentication continuation. A bench shows two moments initially, with an explicit expansion action. Personal collections never change earned progress. The source-bound supplied essay and user-written contributions retain their wording.

Reproduce the local desktop/phone visual tour with `e2e/platform/field-guide-review.spec.ts` against isolated test data. UI review captures may use an existing approved painting with synthetic bench facts and must be labelled accordingly. Keep capture output beneath an explicit subdirectory: the main `test-results` tree contains panorama evidence and active rollout checkpoints.

### What matters when choosing a bench

The painting conveys weather and scenery. At most three resolved hints remain: estimated sun/shade, known backrest/armrests, and modelled traffic noise. Exact weather, shelter, scenery descriptions and facilities belong in “Gut zu wissen”; omit unknown traffic rather than adding an empty status. Keep access obstacles and missing-bench reports visible. The disclosure supports different visitors without preference setup. Seat counts are omitted from the visit summary, details, filter controls, contribution editor and add-bench form.

Noise uses only valid current day/night road and rail model layers, using the same 06–22 h daytime convention as route evidence. Sunset does not switch the traffic model to nighttime. The highest available layer determines the qualitative product band (<45, 45–<60, ≥60 dB(A)); these are orientation labels, not legal or health thresholds. Never present them as a measurement of all sounds or infer quiet from absent layers. No raw decibels appear on visitor screens. Existing subjective quiet ratings and disturbance answers remain stored but do not inform the noise description. New ratings request only the overall impression and an optional note. New light/view questionnaires are retired. Concrete environment corrections remain available; earlier personal observations are inspectable and deletable in a closed private history inside visit details. No fabricated answers are written to satisfy historical database constraints.


## Outing-book composition and lyric voice

Use the shared `PaintingFrame` with typed hero, journal and thumbnail treatments. Three broad, deterministic 16px lower pigment edges leave the top/sides straight; thumbnails are unmasked. The expanded panorama retains its full rectangular viewport. The screen-anchored bench is hidden in static views and retained only in the expanded viewer. The single labelled opening action sits on the lower paper margin; do not overlay a large card on the painting.

Lora miniatures are an artistic part of the place, not extra weather metadata. The shipped catalogs contain 96 complete original passages per language: eight each for pause, sunlight, shade, rain, snowfall, night, mountains, water, forest and autumn; four each for spring, summer, winter and twilight. Use the existing dialect-generation workflow for local overlays, including the poetry namespace. Translations and generated regional variants have no claim of independent native-speaker review.

Selection uses bench ID, the scene timestamp’s Swiss calendar date and eligible scene context. Darkness and precipitation take precedence; sunshine requires known low cloud cover as well as potential direct sun. Do not concatenate sentences or infer quietness, tree species, guaranteed comfort, moonlight or snow cover from unrelated data. A mounted place/language retains its miniature across refreshes and dialogs. A later visit may choose another. Sparse scenes use complete reflective passages, without poetic “data missing” messages.

The contribution chooser has exactly three intentions: memory (moment first, photo and overall rating secondary), factual additions (core seating fields first, further fields/metadata closed), and a problem (correction first, care and presence contextual). Show one form at a time and preserve mounted drafts. New subjective light/view assessments and seat counts are absent. Existing content and progress remain intact.

Filters lead with backrest, sun/shade, toilets and drinking water; shelter, fireplaces and other preferences wait under “Weitere Wünsche”. Reuse flat paper, airy rows and colour washes for selected states, with an explicit check and text. Never mask a form or focus ring.

### Editorial composition and painted margins

The interface is a mobile watercolor atlas. Actual place paintings lead; repeated horizon ribbons and button underlines are retired. Keep one small relevant drawing per opening, ordinary controls on flat paper, and no decorative texture behind text. Menu and journal keep the original wordmark without the ochre underline. The reading invitation stacks its drawing below text when enlarged text or available width requires it.

Filters use explicit full-width choice buttons with icons, selected checkmarks and a flat wash; no hand-drawn checkbox outlines. Light is an exclusive “Egal / Sonne / Schatten” choice. Extra criteria remain in “Weitere Wünsche” and preserve selected values. Inputs, selected states and hit areas are rectangular and readable, independent of artwork.

Lora's real italic companion carries the lyrical miniatures and moment-writing field, while functional text remains upright Source Sans 3. The official font, its source, checksum and existing OFL license live in `public/fonts/lora`. Never substitute a handwriting font for controls or dense text. The moment form starts with writing; its four kinds live in a closed classification disclosure, and the character counter appears from 400 of 500 characters. Photo and overall rating remain secondary alternatives after the form.

Journal entries pair dates, personal writing and the existing painting of the relevant bench. Repeated entries for the same bench show its painting once. Favourites also use their own place paintings, not a repeated stock bench icon. `PlaceArtwork` reads the existing public panorama descriptor; `PlacePainting` uses the existing image optimizer and removes only the decoration if loading fails. User-written text and links remain visible. Saved places and account controls remain private; the public journal uses the existing public contribution boundary.

The retired horizon's exact prompt and retained original are recorded in `public/ui-art/field-guide/atelier-artwork.json`. It was generated with the built-in image tool, inspected, and encoded with its alpha preserved. The earlier `artwork.json` documents the retired object vignettes. The critical rationale, research references and iteration findings are in `docs/ui-art-direction-review.md`.

Container queries follow the available reading width. Narrow or text-enlarged toolbars keep 48 px filter/menu targets and reserve space for the search field; the search must never cover an adjacent action. Filters reflow to one column when their text needs more room. Check the inner scrolling area for horizontal overflow as well as the outer sheet. At 200% text size, preserve scrolling and full labels rather than reducing the font.

For local production-build visual reviews, use `playwright.art-production.config.ts` with `PLAYWRIGHT_PRODUCTION=1`. It selects the installed full Chromium in its current headless mode; the Safari project, viewport, assertions and timeouts stay unchanged. This allows the graphics backend to behave like the local browser rather than the software headless shell. The ordinary CI configuration remains separate. Keep a frozen isolated build and an explicit output directory for every run.

Search labels keep the supplied name intact and omit known locality/canton context already named in an earlier part. Compare complete comma-separated name parts, not substrings: “Zürichblick” still needs its locality. Equal bench and locality labels remain different choices. `placeLabel` and `distinctPlaceResults` own this presentation rule; stored names, coordinates and navigation targets stay unchanged.
## Implemented mobile atlas refinement

The complete local A–H refinement is documented in [atlas-refinement-progress.md](atlas-refinement-progress.md), with the [before/after report](../test-results/ui-watercolor-atlas-refinement/report.html). The previous [reference slice](mobile-atlas-review.md) remains historical evidence. User aesthetic approval and production deployment are separate.

- Design at 390 × 844, verify 320 × 568. Reading margins are 20px / 16px; enlarged text grows content, not those gutters. Titles use Lora medium 30/35px, journal title 32/38px, editorial headings 22/28px, group headings Source Sans 3 18/24px, poems Lora italic 20/30px and body/controls 16/24px. Use relative type units and natural wrapping.
- `BenchAtlasSheet` preserves mounted panorama, poem, disclosures, scroll and focus. `BenchPageFrame` applies the same hierarchy and measured footer behavior to standalone URLs. Covering tasks isolate background keyboard focus without unmounting content.
- Expanded viewer: visible 48px Schliessen top-right and a small compass/heading badge top-left. Opening the badge reveals navigation help. No panorama zoom or bottom toolbar. A discreet 48px edge arrow follows the shortest turn back to the recorded bank view, disappears within 12°, and stays absent for unknown directions. Opaque paper surfaces and blue focus with paper surround. Heading/pitch survive reopening the same place; changing benches initializes them.
- Journal: compact identity, one saved-place row, real entry opening within about 320px on the standard 390 fixture. Account/collections are initially closed. Static `PlacePainting` uses measured projection bounds and known direction; repeated horizontally wrapped copies preserve the render aspect ratio. No per-entry WebGL. Failed images leave text and links.
- Routes lead with destination/origin and recommendation; adjustments/alternatives are disclosures, route limitations remain visible. Contributions retain three intentions and one active form, drafts, discard, feedback and contextual photo/rating tasks.
- Below 640px, phone composition; 640–1023px, centered reading areas up to 640px; from 1024px, application-shell navigation above the map and a 440–520px place panel. The map resizes to its real available area. Journal/reading remain approximately 680px single-column.
- Fixed palette: paper #F7F5EF, ink #203D36, muted #52665E, spruce #285B4B, lake #386B80, terracotta #A64F38. Ochre remains decorative. One visible 3px lake-blue focus outline; forced-colors retains native meaningful states.
- Source files, protected literary/data content, raw tests, image checksums and actual performance comparisons are linked from the report. Real-device keyboard/browser chrome and outdoor readability remain separate verification.

### Error and return feedback

A failed panorama remains in the accessible retry state through refreshes of the same immutable artwork/mask URLs. Reset it only for genuinely changed artwork or explicit retry; a weather/detail refresh must not briefly restore an unmasked preview.

Unavailable saved places keep Undo feedback in the surrounding client session, outside the row removed by server revalidation. The feedback has one visible next action and ordinary document space; pagination, private ownership and source-return focus remain intact.

At 200% text, the wish sheet keeps fixed 12px outer gutters and the shared reading margin. Decorative subject icons can disappear in constrained controls; the selected check and full word remain visible. Do not accept a one-letter wrap merely because the overflow test passes.
