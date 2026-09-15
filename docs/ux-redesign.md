# Benchly: map-first UX redesign

This is a task audit, not an analytics report. Source inspection and interactive local checks were performed on 15 September 2026 at 360, 390, 430, 768 and 1440 px. The local SQLite snapshot has 123,107 active benches and predates the latest production import; counts below describe **that snapshot only**. No usage telemetry or user interviews are available. Priority and expected effort are UX hypotheses to validate with users.

## Current journeys and diagnosis

| Severity | Observed problem | User consequence |
| --- | --- | --- |
| P0 | On a 390 px phone, the selected half-sheet starts with a tall panorama; the bench name appears near the bottom edge and suitability facts and directions are out of view. | Selection does not answer “is this the right bench?” quickly, despite covering almost half the map. |
| P0 | A generic **Beitragen** button opens eight contribution chapters in one modal. Name, photo, rating and properties are all several decisions away from their content. | Casual contributors must learn the data model before improving one obvious thing. |
| P0 | Directions, contribution and ratings compete in the identity area; rating also appears as an unlabeled star control on the panorama. | There is no unambiguous next action; an important rating action is easily mistaken for a display-only score. |
| P1 | Save is buried in the later “moments at this place” section, and photo upload is buried in the contribution hub rather than beside photos. | Ordinary users cannot predict where to find the actions. |
| P1 | The four-card “at a glance” grid gives unknown wheelchair/quietness the same visual weight as current light and a known backrest. | Decision-relevant facts are crowded by missing or secondary data. |
| P1 | `Accessibility` represents a specific wheelchair property while the copy also discusses an unverified access path. | The symbol can imply a broader accessibility guarantee than the data supports. |
| P1 | The menu gives adding a bench, walks, feed, statistics and about nearly identical treatment. | Project and expert functions compete with discovery. |
| P1 | Published estimates, OSM facts and user observations are exposed in separate panels; evidence is available but not consistently attached to the resolved answer. | Users may over-trust inferred facts or overlook provenance. |
| P2 | The local development server's stale HMR connection made the first screenshots non-interactive. A clean restart restored the sheet click state. | Rendering alone was not sufficient verification of the actual experience. |

Current important paths:

```text
Map → bench marker → half-sheet artwork → expand → facts → directions
Map → bench → generic contribution modal → choose one of eight chapters → edit/submit
Bench → scroll past facts and disclosures → place/moments → save
Bench → generic contribution modal → photos chapter → upload
Bench → generic contribution modal → rating chapter → four rating scales → submit
```

The local snapshot has ratings on 13 distinct benches, community photo moments on 1, confirmations on 12, light observations on 3, view observations on 8, and no correction rows. Missing values among active benches: backrest 48,327; armrest 117,810; wheelchair 116,633; material 84,980; covered 120,549. These are repository facts, not evidence that a particular UI placement caused low contribution counts. A production and analytics audit should repeat the measurement before interpreting conversion.

## Task hierarchy

1. **Visitor, primary:** find a bench on the map; decide from place, light, view and comfort; get there.
2. **Visitor, secondary:** compare nearby benches, explore a walk, inspect photos/reviews, understand whether a fact is measured, observed or estimated.
3. **Ordinary signed-in user:** save a bench; rate a visited bench; add a useful photo; confirm presence; fill a missing observable property or correct a wrong fact.
4. **Active contributor:** edit multiple fields, observe view/light, report removal/location issues, add a bench, review their activity.
5. **Rare/expert:** inspect full provenance and raw geography, statistics lab, project/about/legal, administrative moderation.

The product should encourage **photo evidence, confirmation that the bench exists, observable comfort facts (especially backrest/armrest), contextual correction of wrong facts, and a short overall rating**. More elaborate notes and experiments should remain possible but not become the default visitor journey.

## Contribution priority matrix

“Future value” includes usefulness to a later visitor and data-quality impact. “Missing” is from the local snapshot where measurable. Friction/error/moderation are qualitative inferences. No usage rate is invented.

| Contribution | Missing / existing source | Future value | User effort and error risk | Normal placement | Class |
| --- | --- | --- | --- | --- | --- |
| Confirm bench is still there | 12 benches confirmed; OSM presence can age | High: prevents wasted trips | One tap on site; off-site false confirmation possible, reversible | Bench identity / arrival context | High-value, low-friction |
| Photo of bench/view/access | One community photo bench; external media and imagery exist | High: shows condition and context; can corroborate corrections | Camera/upload + moderation, privacy and quality risk | Photo area; prompt only when useful | High-value, higher-friction |
| Backrest / armrests / covered / material | 48k / 118k / 121k / 85k missing; OSM may supply known values | High for suitability; observable on site | One choice, but wrong bench or ambiguous shape possible; reversible | The corresponding fact or missing-fact prompt | High-value, low-friction |
| Correct name, property or place | No correction rows in snapshot; OSM may disagree | High when a displayed answer is wrong | Requires explanation or evidence; moderation varies | Beside title, fact or map location | High-value, higher-friction |
| Short overall rating | 13 benches rated | Useful social proof, but subjective | Few taps; low data-integrity risk, easy to update | Rating summary / after visit | High-value, low-friction |
| View/light observation | 8 / 3 benches observed; app estimates already exist | High only when estimate is doubtful; time/location dependent | Medium effort; observation context matters | Beside the light/view answer, conditional | High-value, higher-friction |
| Add a missing bench | OSM and inventory supply the bulk | Very high when genuinely missing | Position, duplication check, details; moderation high | Map action, not a bench contribution menu | High-value, higher-friction |
| Wheelchair/access and direction | Mostly missing; OSM and published estimates may exist | Important for the right user, but must be precise | Higher ambiguity; avoid binary guarantee or guess | Detailed fact with explanation | High-value, higher-friction |
| Care status / memory / poem / local fact | Community activity exists | Low to medium discovery value | Easy for story; condition may be subjective | Community area or active-contributor tool | Low-value, low-friction |
| Place following / waste basket / fireplace / seat count | Existing OSM/context coverage varies | Situational | Low to medium; can confuse bench versus surroundings | Detail or saved-place area | Low-value, low-friction |
| Generic “correct something” form | No corrections yet | Potentially high, but unclear target | High decision cost and moderation | Expert overflow only | Low-value, high-friction in normal flow |

For every community action, the app continues to require an account. Visitor affordances should state the expected benefit before prompting for sign-in, and sign-in must return to the intended task.

## Competitive interaction research

These are transferable patterns, not visual references:

| Product / primary evidence | Pattern | Why it fits Benchly, and limit |
| --- | --- | --- |
| [Google Maps place updates](https://support.google.com/maps/answer/10028567?hl=en-gb), [contribution help](https://support.google.com/maps/answer/9678350?hl=EN) | A place is first selected; reviews and photo updates are reachable from that place as well as a global contributor area. | Attach rating/photo to the selected bench. Benchly should not copy a large global Contribute tab because its ordinary visitor task is narrower. |
| [SBB Mobile help](https://www.sbb.ch/content/internet/sbb/en/support/produkte-services/apps/sbb-mobile-sbb-preview/sbb-mobile-app.html) | Plan/select connection first; detailed trip exposes Save; share/calendar moves behind more. | Benchly's primary action is a route from a specific bench, Save belongs at the identity, and Share can be quieter. No ticket-like transaction step is needed. |
| [geo.admin map-viewer URL/feature info](https://docs.geo.admin.ch/map-viewer/url-parameters.html), [object information](https://www.geo.admin.ch/en/map-viewer-topics-and-data) | Mobile object info is a bottom panel; desktop uses a floating tooltip. Deeper metadata has an additional-information path. | Use one selected-object quick sheet on a phone and expanded detail on demand; keep technical provenance in a deeper disclosure. Its layer-control density would not suit casual bench discovery. |
| [OpenStreetMap iD presets](https://wiki.openstreetmap.org/wiki/Presets) | Human-labelled fields map to structured tags; expert tags need not be the novice interface. | Let users edit “backrest” or “material” as a fact, not choose a generic correction category. Benchly must still retain OSM provenance and community moderation. |
| [Mapillary mobile upload](https://help.mapillary.com/hc/en-us/articles/115001472029-How-can-I-upload-imagery-to-Mapillary) | Capture/upload lives in a camera workflow; bulk tools are separate. | A photo is high-value evidence at the bench, while bulk/expert capture should not burden a casual visitor. Benchly's moderation and privacy rules remain stricter than a simple photo picker. |

This comparison is based on official help/documentation, not a usability study of their current apps. Product-specific efficacy is an inference.

## Proposed interaction architecture and action hierarchy

```text
MAP: search, nearby markers, restrained filters
 └─ SELECTED BENCH: compact decision sheet (identity, light, one comfort/view cue)
     ├─ PRIMARY: Weg hierher
     ├─ SECONDARY: Merken; expand detail
     └─ FULL DETAIL: geographic panorama, grouped decisions, photos, ratings, evidence
         ├─ CONTEXT: rate at rating; photo at gallery; fact at fact; name at name
         └─ OVERFLOW: share, location/removal report, batch editing, technical sources
PERSONAL: saved benches and profile
EXPLORE: walks and community feed
PROJECT/EXPERT: statistics, about/legal, settings, advanced contribution
```

The map remains visible above the selected quick sheet. The quick sheet should answer the first three questions without loading an entire painting; full detail may show the panorama. Desktop can keep the expanded detail in a right rail. A route button is the single visually dominant action. Save and rating are distinct: Save is a personal collection action; Rating is social evidence after experience.

| Surface | Primary | Secondary | Contextual | Overflow |
| --- | --- | --- | --- | --- |
| Map | find/select bench | filters, walk discovery | add a missing bench at map position | list, project/expert destinations |
| Selected quick sheet | Weg hierher | Merken, expand | none until the relevant fact is shown | share/report |
| Full bench detail | Weg hierher | Merken | rate beside rating, upload beside photos, edit beside name/fact, confirm presence | share, general correction, batch editing |
| Rating area | one overall rating | optional breakdown/note | edit own rating | report another review |
| Properties | resolved value and uncertainty | further facts | add/correct that field | batch editor/source details |

## Before → after: important tasks

| Task | Before | After / expected complexity change |
| --- | --- | --- |
| Decide and navigate | select → artwork → expand → scroll facts → route | select → identity/light/comfort → route; one fewer mode change and no required scroll |
| Save | select → expand → scroll to moments → save | select → Merken; no scroll |
| Rate | select → generic modal → chapter → four mandatory scales | select → labeled rating summary → focused rating form; four mandatory scales remain until nullable data migration |
| Add photo | select → generic modal → photo chapter | select → photos → add photo; task is identified by content |
| Fix one fact | select → generic modal → features chapter → find row | select → backrest fact → single-field editor; other facts remain in the detailed batch editor |
| Correct location | select → generic modal → correction chapter → generic note | select → map/location action → point or report; remains a higher-friction verified task |

## Icon and terminology audit

| Current cue | Likely ambiguity | Recommendation |
| --- | --- | --- |
| Five empty stars painted over the panorama | Display-only rating versus action; impossible to tell whether existing reviews are present | Label “Bewerten” or show numeric score/count in the rating area; do not use the landscape as an action surface. |
| `Accessibility` for `wheelchair` | Implies broad accessible arrival/seating, while path and sitting/standing are different questions | Text “Rollstuhl am Bänkli: ja/nein/unbekannt” in details; separate “Zugangsweg nicht geprüft”. Do not claim universal suitability. |
| `MessageCircleHeart` for “Beitragen” | Conversation, like, report or generic edit | Replace ordinary entry with concrete verbs at content; expert overflow may retain text “Angaben ergänzen”. |
| `MapPin` for place-follow and location | Can look like location correction or navigation | Pair each with its distinct text; following a locality belongs in personal collections. |
| `Navigation` / “Weg hierher” | Clear only with text | Keep both; route is the primary selected-bench action. |
| `Share2` in a community header | Misplaces utility among moments | Move to identity overflow with “Teilen” label. |
| `Sun` with an estimate | Could imply actual sunshine through clouds | State “Sonne möglich / Schatten geschätzt / Nacht / unbekannt”, show uncertainty when decision-relevant. |

## Concrete proposals and implementation implications

| Priority | Surface | Proposed structural change |
| --- | --- | --- |
| P0 | Map selection (`BenchSheet`, `MapExplorer`) | Render a decision-first quick sheet with identity, light, one comfort/view cue, route and save; keep panorama/full facts in expanded detail. Reduce initial map occlusion. |
| P0 | Detail (`BenchDetailContent`, `BenchSummary`) | Order identity/decision/actions before panorama; remove equal-weight generic contribution/review controls; keep trust note near uncertain answers. |
| P0 | Contribution (`BenchContributionHub`, `BenchFeatureEditor`) | Focused entry modes for rating, photo, name and facts. Batch chapters become active-contributor overflow, not the ordinary path. |
| P1 | Rating (`RatingForm`, `Community`) | Place labeled action beside social proof; make overall the easy first answer and breakdown optional. |
| P1 | Photos (`PhotoStory`, `BenchPlaceCommunity`) | Show a photos section even when empty and attach the add-photo action there; do not duplicate galleries unnecessarily. |
| P1 | Saved (`BenchPlaceCommunity`) | Move bench save to the identity/quick sheet, retain place-following in personal/community area. |
| P1 | Source/evidence (`BenchPanel`, `KnowledgeDetails`) | Resolved answer first, uncertainty in line, full source details under an explicit technical disclosure. |
| P1 | Navigation (`AppMenu`) | Group discovery/personal destinations; move statistics/about/settings/advanced add into quieter sections. No permanent bottom navigation is needed while the map is primary. |
| P2 | Filters/search, feed, walks, routing | Keep their task-specific flows and audit duplication after the selected-bench redesign; avoid introducing another global nav mode. |

## Critical challenge before release

- Hiding all editing would reduce discoverability. Show one missing-fact prompt and visible contextual actions at photo/rating/name; keep batch editing in overflow for active contributors.
- The quick sheet must not pretend a light estimate knows cloud cover; copy and uncertainty must remain honest.
- Save prompts visitors to create an account, but the intended save should resume afterward. Verify this, not just modal visibility.
- A compact sheet must still leave 44 px targets, support screen readers and keyboard expansion, and not capture touches meant for the map.
- Do not remove provenance: move detailed attribution one level deeper, and keep decision-relevant uncertainty in line.
- Source counts are local snapshot facts; success needs measured task-completion time and real user feedback later.

## Implemented in this pass and honest limits

The selection sheet now presents place, light/backrest, route and Save before the large painting. Its full view moves route, Save, rating and two meaningful facts ahead of the panorama. Save resumes after account creation. Rating, photo, name/features and presence each have focused entry points; photo content and action now sit together, and community images are not duplicated in the moment list. The backrest fact opens a single-field editor. The menu groups Discover, Personal and More, with add-bench/statistics/about quieter than discovery. Existing detailed provenance remains in the bench and knowledge disclosures; uncertain light stays explicitly uncertain. The wheelchair cue no longer suggests universally accessible arrival.

The rating *entry* is simpler, but its four mandatory subscales are **not yet optional**. The database stores all four as non-null values; silently copying an overall score into view/comfort/quiet would fabricate dimensional evidence. A later change should make those columns nullable and adjust aggregation before reducing the form. Likewise, exact location correction and deep-linking every property editor remain a later pass; the generic correction flow is retained as a contributor escape hatch. These are not claimed as complete in the before/after table above.

Local screenshots verified the compact sheet at 360/390/430 px and a full rail at 768/1440 px. The downloaded panorama snapshot has missing media files, so painting fidelity is not judged from that local test. Authentication, photo capture, rating, focused backrest edit, filtering and navigation use a disposable seeded E2E database. Production screenshots and release state must be checked after deployment.

## Validation plan

Use an isolated seeded database for authenticated flows; never mutate the downloaded production snapshot. Exercise map selection, quick/full sheet, routing, saving, rating, photo and factual edit at 360/390/430 px plus tablet/desktop. Capture before/after screenshots, test focus/keyboard/escape/back behavior, reduced motion, document overflow, and screen-reader labels. Run Vitest, Playwright, lint and production build. After pushing to `main`, observe the release and production audit, then take mobile and desktop live screenshots and confirm the new actions function.
