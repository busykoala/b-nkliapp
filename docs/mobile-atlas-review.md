# Mobile watercolor atlas · reference slice

This implements the first visual acceptance stage of the agreed mobile-first plan. It is not a declaration that the whole redesign is finished. Review: `test-results/ui-watercolor-atlas/report.html`.

## Composition

- Start with the map, search and More. Karte / Unterwegs / Mein Buch share one bottom navigation. Wishes and the list live in one discovery control above it. Selecting a bench replaces navigation with the visit actions.
- Bench preview and place view are two presentations of the same mounted content. There is no third minimized bench state. A preview that exceeds 55% of available screen height automatically opens as a place view. Expansion changes local presentation, not history.
- Place title: Lora medium 30/35 px; poem: Lora italic 20/30 px; reading and controls: Source Sans 3 16/24 px. Use relative units and wrapping. Compact preview titles are 24/30 px.
- The painting reaches both page edges. The original lower-edge SVG mask varies only its bottom boundary. The top and side edges are not feathered. Artwork and literary content are unchanged.
- Spruce is the primary action; lake blue indicates links and navigation. Paper surfaces stay opaque. Ochre is decoration, never small text or a required control boundary.
- Directions and saving occupy a dedicated footer with one action instance. They sit side by side at ordinary phone text sizes and stack only when enlarged text leaves insufficient space.
- The journal uses the actual place painting, the person's words and the date. It has no repeated horizon ribbon. Collections remain initially closed and private/public account rules remain unchanged.

## Original material

`src/components/atlas-art.tsx` contains newly drawn SVG lettering and three coordinated line illustrations for walking, remembering and reading. These are code-native vector drawings, not raster generations, traced font outlines or copied reference graphics. The lower edge is `public/ui-art/field-guide/atlas-lower-edge.svg`. The walking drawing is available for the subsequent routing stage; the reference slice uses remembering and reading.

Design derivation: [Neue's Norwegian landscapes](https://neue.no/work/norwegian-passports/) for a landscape-led identity; [Garden Museum](https://www.pentagram.com/work/garden-museum) for a coherent form system; [Cyreal's Lora](https://cyreal.org/fonts/lora/) and [Adobe's Source Sans](https://github.com/adobe-fonts/source-sans) for the retained font roles. Their material has not been imported into the app.

## State and verification boundaries

The dedicated bench shell persists a typed `BenchAtlasPresentation` (preview/place, reading position, disclosure state, focus key). The older `data-snap` values remain only as an internal compatibility attribute for existing automation. Route planners retain the existing shared shell and drafts. The reference slice does not change their visual composition.

Focused search uses the visual viewport height when it is available, so its results can scroll above the software keyboard. A shortened viewport is a layout test, not a claim of physical keyboard/device validation. Registration after saving resumes the save; cancelling returns focus. Opening the anonymous book introduction does not open authentication automatically.

The three landscape examples use their actual OSM bench IDs, public snapshot facts and their own reviewed C30 renders. The isolated close-zoom preview map shows paper and markers with little geographic detail even after camera/network settling; these frames assess overlay composition and do not establish detailed map rendering quality. Their snapshot category labels are not independently verified geography. The historical Lindenhof comparison retains the pre-existing synthetic functional fixture and its comparison painting; it is not evidence of what Lindenhof looks like. Test data and paintings are installed only in Playwright's temporary database/cache.

Browser traces, initial infrastructure errors and failed earlier checks remain under the report directory. The final report must distinguish successful checks from pending visual acceptance. All normal interface languages and generated dialect packs receive the navigation labels. The lyrical catalogs, supplied essay, renderer, migrations and public endpoints are untouched.

## Acceptance and remaining work

The local reference slice must be visually reviewed on the phone before extending the design to the complete menu, filters, contribution forms, routes, favourite-place layouts, supporting pages and larger-screen compositions. Their existing functionality remains available. A green test result does not grant design acceptance or production deployment.

## Development build note

Tailwind source detection is explicitly limited to `src`, following its documented `source()` option. This avoids parsing review artifacts and tooling as UI utility classes. The workspace dev server was observed returning a generated calendar CSS parse error; it returned HTTP 200 after this scope correction, without restarting it. Production review builds run in the isolated `/private/tmp/benchly-field-guide-source` copy with temporary test data.
