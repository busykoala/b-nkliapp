# Bänkli watercolor design system

The interface is a calm illustrated field guide. Watercolor belongs in panoramas, maps, and occasional larger illustrations; reading surfaces remain quiet, flat, and legible.

## Foundations

- Interface type: self-hosted Source Sans 3, weights 400/600/700. Place titles and restrained editorial headings use self-hosted Lora, weights 400/600/700. Both font directories contain their OFL license.
- Body text starts at 16/24 px. Secondary text uses 14/20 px; section headings use about 22/28 px; mobile place titles use 30–32 px and wrap naturally.
- Spacing tokens are 4, 8, 12, 16, 24, and 32 px (`--space-1` through `--space-8`). Controls, surfaces, and sheets use the three shared radius tokens.
- Product touch targets aim for 44 × 44 CSS px. Focus is a visible `--color-focus` outline; selected, warning, and unknown states also carry text or an icon.

The semantic palette lives in `src/app/globals.css`: paper and surface are the two reading layers; ink and muted text carry content; action is the shared interactive green; sage and sky are quiet washes; caution and danger are reserved for meaning; divider, control border, and focus support structure.

## Information and state semantics

Bench facts resolve to canonical `known`, `unknown`, or `conflicting` evidence before translation. UI copy must never infer meaning from translated strings. Weather observations, geometric light estimates, forecasts, and community impressions stay distinct. A renderer may use a neutral visual fallback, but the information UI continues to say “unknown.”

Access is split into three scopes: space directly at the bench, the mapped local approach, and the complete planned route. Missing route sections remain visible as partial coverage; known steps always produce a warning.

## Components

- Primary buttons use the action color, a small shared radius, a 44 px minimum target, and a verb matching the actual behavior.
- Icon buttons always have an accessible name. Lucide icons use the default outline convention; emoji are not production controls.
- `WeatherSummary` uses the weather feature’s shared condition resolver and compact/illustrated variants.
- `BenchSaveButton`, `StartPicker`, `MapSheetShell`, and route accessibility summaries are shared rather than restyled per flow.
- Map sheets have peek, preview, and full states. In an open sheet the chrome is reduced to “Karte”, a central drag/tap handle, and “Minimieren”; the minimized bar names the sheet and exposes “Ganz öffnen”.
- Bench detail follows identity and a compact action row → six concise visit facts and a rating link → nearby facilities → a short lyrical sentence → panorama/photos → contribution actions. Technical provenance is collected in one closed “Quellen & Datenstand” disclosure at the very bottom. Missing values use an accessible dash; verification/confidence labels stay in the detailed sources rather than crowding the visitor summary.

## Data display grammar

The same card treatment is not reused for unrelated measurements. Each visual must answer one visitor question and retain an exact text equivalent.

| Data relationship | Visual form | Bench detail use |
| --- | --- | --- |
| State | Familiar icon + short value; shape/text as well as colour | backrest, level space, steps |
| Time | Shared 24-hour axis and interval tracks | sun/moon paths, direct sun and shade windows |
| Proportion | Segmented scale only when the bounded whole helps the decision; always include the exact percentage | cloud cover, assessed-route coverage |
| Magnitude | Exact rounded value and unit; add a chart only for a real comparison or time series | rain, wind, snow, slope, noise |
| Distance | Exact rounded distance plus scope (“Luftlinie” or routed) | building, water, path, and facility proximity |
| Profile | Aligned small multiples only when several comparable samples exist | seasonal sun or canopy by radius |
| Status from people | Five fixed marks plus score and response count | quietness and ratings |
| Provenance | Compact description list behind a disclosure | source, freshness, coverage, conflicts |

Do not normalize a lone measurement into an unexplained bar, ring, percentage, or score. Do not add a chart merely to decorate a single value. Use progressive disclosure for provenance, not for visit-critical information. Visual encodings use labels and accessible names, never colour alone.

This grammar was checked against:

- [GOV.UK data-visualisation principles](https://brand.design-system.service.gov.uk/data/), especially clarity, accessibility, accuracy, and choosing a chart from the data relationship.
- [GOV.UK chart guidance](https://brand.design-system.service.gov.uk/data/charts/), which favours concise titles, direct annotations, exact units, and non-interactive charts when they already communicate the point.
- [GOV.UK details guidance](https://design-system.service.gov.uk/components/details/), used only for secondary facts and provenance rather than information most visitors need.
- [W3C guidance for complex images](https://www.w3.org/WAI/tutorials/images/complex/), applied by pairing every visual with an equivalent accessible description.
- [MeteoSwiss forecast presentation](https://www.meteoswiss.admin.ch/dam/jcr%3A476d2d3b-eb36-40e8-8b0b-f9b8875ae40b/Praesentation-User-Consultation-2024.pdf), which groups time-dependent temperature, precipitation, sunshine, wind, and gust data into parameter-specific charts.

## Usage

Use grouped surfaces only when elements form one decision. Prefer a divider and whitespace over a card, shadow, or pill. Do not put texture behind dense text. Keep poetic copy below visit-critical conditions and access information. Avoid showing low-priority unknown facts; preserve their evidence in the source view.

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
