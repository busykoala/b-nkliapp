# Implementation plan for the full panorama artist review

## Outcome and scope

Improve all 20 artist-numbered Bänkliview landscapes while preserving their muted
palette, quiet atmosphere and simplified painting style. Shapes, tonal structure,
selective details and overlaps should explain the subject before texture is added.
Review each panorama as a sequence of viewing directions, including resting views.

The fixed sample is [the review catalogue](../config/panorama-artist-review.json).
Its stable IDs and artist numbering remain authoritative. The six pilots are
02, 05, 07, 14, 15 and 18; passing them is an iteration gate, not completion.

Work remains local on `codex/panorama-artist-review`. Preserve the downloaded
cluster snapshot and original captures. Do not push, release, publish paintings,
or activate a production generation. Final delivery includes a self-contained
report and its pictures in `./panoramas.zip`.

## User refinement: bench framing

The user subsequently asked to hide bench legs and remove the distracting soil.
Frame the existing backrest/seat at the lower viewport edge across all13variants;
keep legs below the viewport and remove the full-width ground wash and detached
shadow. This replaces the earlier proposed soil/contact treatment. Preserve source
sprites, material/backrest/armrest distinctions, and responsive/navigation behavior.
Review desktop/mobile day, snow and moonlight crops, including backless variants.
The panorama landscape and the wider artist-review scope remain unchanged.

## Starting point

The repository already contains the catalogue, an isolated review database,
downloaded geographic context, local rendering/capture tools, renderer and asset
iterations, and preliminary review evidence. These are candidate changes, not a
claim of artistic completion. The tracked review log explicitly leaves full-sample
acceptance open. Existing captures from different stages must retain their stage
labels; they cannot stand in for captures of the final source and renderer.

[The reproduction guide](panorama-artist-review.md) describes the existing tools.
[The findings log](../config/panorama-art-review-log.json) records findings and
evidence; [asset provenance](../config/panorama-art-provenance.json) records prompts
and generated assets. Keep these records consistent with the final implementation.

## Execution order and decision gates

| Milestone | Work to complete | Decision before proceeding |
| --- | --- | --- |
| M0 — Reproducible baseline | Verify downloaded inputs, catalogue, original captures and comparison settings | Every original view can be traced to its bench and source versions |
| M1 — Trustworthy forms | Correct terrain sampling, material coverage, measured roofs, occlusion and building bases | Synthetic checks pass and native pilot comparisons preserve factual shapes |
| M2 — Purposeful painting | Resolve silhouettes, broad values, material marks and connected depth | The six pilots improve visibly in colour and grayscale; rejected trials stay recorded |
| M3 — Local character and cohesion | Verify principal-building references; refine supported structure, sky grouping and all bench variants | Specificity improves without invented architecture or loss of quiet passages |
| M4 — Full-sample acceptance | Freeze a candidate, capture all 20, review all angles and run the seasonal/weather matrix | Every location has an evidence-linked decision; no required revision remains silently open |
| M5 — Delivery | Reconcile findings, rebuild the offline report and verify the replacement ZIP | Extracted report opens locally, pictures and annotations resolve, and archive integrity passes |

Iterate back to the relevant milestone whenever a later review finds a regression.
Run small, comparable trials before broad captures; regenerate final evidence
after any change that affects its appearance. Existing successful captures and
experimental paintings remain historical evidence until the final candidate passes.

## Coverage of the supplied artist review

The [complete supplied review](panorama-artist-review-source.txt) is the source of
scope. The six examples on the supplied artist-review sheet illustrate priorities;
they do not replace the written assessment of all 20 locations.

| Review theme | Planned work | Evidence required |
| --- | --- | --- |
| 1. Purposeful painting marks | Broad forms before texture; material-specific marks in sections 2 and 4 | Native-resolution and reduced/grayscale comparisons showing that marks explain form |
| 2. Subject-specific silhouettes | Source/projection diagnosis and compatible painted/material contours in section 2 | Natural edges at 07, 11 and 19; preserved asymmetric summit at 18 |
| 3. Colour and value relationships | Separate light/dark masses, near/far and small accents in sections 2 and 3 | Grayscale depth checks; preserved roof/green contrasts at 15 and 20 and airy sky at 14 |
| 4. Descriptive architecture | Source-supported tops, bases, planes and selective structure in section 3 | Principal-building comparisons at 01, 02 and 13, with reference provenance |
| 5. Connected depth | Terrain contact, overlaps, ground direction and quieter distance in section 3 | Bench-hidden views retaining a readable foreground, middle ground and distance |
| 6. Materials and edge hierarchy | Distinct foliage, rock, wall, ground and water treatment in section 4 | Material crops, boundary checks and source-backed blue-passage assessment at 05 |
| 7. Panoramic and sky composition | Successive focal, supporting and resting directions; unequal cloud groups in section 5 | All-angle review, protected quiet views at 03, 10 and 12, plus weather/night evidence |
| 8. Bench/landscape drawing language | Simplify all 13 foreground variants in section 5 | Transparent-edge checks and actual in-scene desktop/mobile comparisons |
| 9. Individual location assessments | Preserve/revise criteria for every location in section 6 | Twenty separate evidence-linked acceptance records |

The sheet's six priorities map directly to these passes: natural silhouettes
(section 2), architectural scale (section 3), material readability (section 4),
one drawing language (section 5), expressive landforms (sections 2 and 4), and air
and distance (sections 2, 3 and 5).

## 1. Establish comparable evidence

1. Preserve the original 20 panoramas, directional screenshots and existing ZIP.
   Record source versions, geometry hashes, painting hashes, projection bounds,
   viewport, headings, time, weather and season for every comparison.
2. Use the downloaded cluster data through the isolated local database. Never
   substitute an ordinary development database or mutate the baseline snapshot.
3. Freeze time and weather for before/after comparisons. Retain both screenshots
   with bench/controls and clean screenshots. Record browser-only adjustments.
4. Map supplied highlights to finding IDs and catalogue entries. The written
   assessment describes a 35-highlight review; reconcile that count against the
   available annotated originals, recording any unavailable evidence rather than
   inventing highlight coordinates. Keep “preserve” highlights as regression
   requirements alongside defects.
5. Separate source corrections from painting changes. Retain the old geometry,
   corrected geometry and relevant source evidence so their effects can be judged.

**Gate:** every location and available supplied highlight has a stable identity,
an evidence link, a preserve/revise note and an explicit acceptance check. List
missing original annotation evidence separately.

## 2. Correct silhouettes and broad values first

Primary areas: `worker/benchly/panorama/watercolor.py`, terrain classification and
projection in `datasets.py`/`visibility.py`, and viewer material filtering.

- Trace staircase contours to sampling, compaction, projection or paint coverage.
  Fix source/projection errors before introducing decorative contour variation.
- Derive painted silhouettes and material coverage from compatible geometry.
  Keep categorical material IDs discrete; interpolate coverage, depth, lighting
  and normals as continuous channels.
- Retain both sides of visible material transitions during terrain compaction.
  Prevent narrow surfaces from being stretched into entire depth bands.
- Preserve actual cliffs, architectural straight edges, distinctive peaks and
  asymmetric summits. Avoid smoothing every subject into the same outline.
- Establish connected light and dark masses. Reduce distant contrast, edge
  emphasis and texture progressively without applying a universal saturation lift.
- Keep distant texture subordinate after its detail passes; an early atmospheric
  wash must not be undone by later material marks. Verify the final colour and
  grayscale hierarchy with the bench hidden.
- Check blurred-mask composition for internal alpha dips, false shorelines,
  halos and depth-layer seams, including the horizontal wrap boundary.

**Gate:** principal forms read in small grayscale views; false stair steps and
internal bands disappear without erasing measured landmarks or material boundaries.
GPU and canvas paths agree on the corrected coverage.

## 3. Explain architecture and connect spatial layers

Primary areas: building import, `models.py`, `binary.py`, `visibility.py`, and
building/atmosphere painting in `watercolor.py`. The reference-led wall painter
is `facades.py`; [curated face bindings](../config/panorama-facade-references.json)
and [their validator](../scripts/panorama-art/facade-references.py) make the adopted
photographic details reviewable before local import.

- Preserve source XYZ roof geometry, facade orientation, terrain elevation and
  measured extents through import and projection. Validate roof heights and ground
  references before assessing apparent building scale.
- Paint only visible measured roof surfaces. Test setbacks, disconnected wings,
  flat roofs and self-occlusion so a roof colour cannot fill intervening wall space.
- Retain independently mapped houses within an aggregated 3D building where
  source footprints establish them. Deduplicate equivalent source ways/areas and
  keep actual outer dimensions; do not divide a block into arbitrary equal units.
- Correct floating bases, occlusion and clipping. Use restrained base accents and
  broad plane shading to establish ground contact and volume.
- Render principal buildings with more explanatory structure than distant support
  buildings. Use verified roof transitions, openings, entrances or floor rhythms
  where evidence exists. Do not invent distinguishing facade features.
- Where facade references are absent, use supported planes, edges and ground
  relationships; document the limitation. Do not shrink a real facade solely
  because it dominates the view.
- Verify the exact building and visible face before transferring photographic or
  documentary details. Store source URL, date, checksum, building identity and
  orientation with each adopted feature. Registered storey totals are contextual
  metadata: they do not establish above-ground floor bands, windows or entrances.
- Organise near land, middle settlement and distant slopes through overlap,
  selective edge sharpness and quieter distant values. Check with the bench hidden.

**Gate:** principal buildings have credible tops, bases and scale; the landscape
still communicates depth without the foreground bench. Geographic accuracy remains
unverified wherever the available evidence cannot establish it.

## 4. Give materials purposeful, distinct marks

Retain a common pigment character while varying the marks that describe subjects.

| Material | Implementation direction | Acceptance |
| --- | --- | --- |
| Foliage | Connected, unequal crown groups, recesses and occasional broken edges; quieter distance | Woodland reads as grouped masses rather than dots or a wall filled with mottling |
| Rock | Oblique planes and selective fractures following supported terrain | Rock differs from foliage through direction and value, preserving summit character |
| Walls | Broad quiet washes, deliberate plane changes and supported structural edges | Texture does not substitute for architectural form |
| Ground | Restrained marks following slope and recession | Ground connects buildings and terrain without uniform visual noise |
| Water | Source-backed connected coverage, readable banks and calm horizontal marks | Blue passages read as bounded surfaces; no vertical columns or internal seams |

For 05, verify water identity against downloaded source features before applying
water treatment. Exclude underground waterways from surface-water depiction.
Clip rock/land strokes to appropriate materials and avoid bridging mapped clearings
or other genuine material changes merely to conceal rendering defects.

**Gate:** material identity survives desaturation and reduced texture. Inspect
full-resolution overlaps for repeated stamps, grid lines and preserved defects.

## 5. Compose sky, panoramic sequence and foreground together

Primary areas: `cloud-field.ts`, `panorama-clouds.tsx`, the viewer, foreground styles
and all 13 assets under `public/ui-art/panorama/benches/`.

- Keep focal passages, supporting passages and quiet intervals around each 360°
  panorama. Protect Lugnez's openness, 10's valley and 12's minimal horizon.
- Group clouds into unequal larger masses with quiet intervals and subtle luminous
  openings. Preserve the specified cloud coverage, overcast character and wrap.
- Preserve astronomical placement and terrain occlusion of sun/moon. Verify stars,
  moonlit clouds and night palettes independently of daylight painting quality.
- Simplify engraving, grain and hardware across all 13 bench variants while
  retaining material identity, backrests, armrests, perspective and alpha edges.
  Preserve frame dimensions, foot baselines and placement.
- Connect the bench to the ground with restrained contact treatment. Check night
  and snow ground colours, mobile instructions and control overlap in the viewer.
- Keep snow cover independent of falling snow. Use coherent, slope-aware surface
  response without rectangular towers, water whitening or categorical corruption.

**Gate:** the bench belongs to the illustrated landscape, quiet scenes remain quiet,
and weather/night effects support the same visual language without hiding defects.

## 6. Accept every location individually

Use source-supported features for the checks below. When evidence cannot establish
a feature, retain the simpler form and record the limitation. Documentation alone
does not establish artistic acceptance: an unresolved required revision stays open.
In particular, confirm material identity at 11 before giving its ochre mass rocky
marks; the artwork alone does not establish exposed rock.

| # | Location | Preserve | Required revision and acceptance |
| --- | --- | --- | --- |
| 01 | Cossonay | Ochre/rose palette and principal mass | Explain the dominant facade's scale with supported structure and ground contact |
| 02 | Platta | Warm landmark against green hills | Verify geometry; clarify top, base and supported opening rhythm |
| 03 | Lugnez | Solitary warm form and open space | Strengthen focal building identity and ground relationship without filling the emptiness |
| 04 | Grossaffoltern | Small-to-large building progression | Establish principal/supporting hierarchy and a connecting ground plane |
| 05 | OSM 10942762655 | Cool counterpoints and valley opening | Resolve blue-material identity; establish evidenced water, banks and continuous surface |
| 06 | OSM 12710786178 | Framing green slope and warm settlement | Group foliage unequally and quieten the distant town |
| 07 | OSM 12945467215 | Rising mass and light/dark variation | Remove artificial staircase contours while retaining the measured form |
| 08 | OSM 13713577262 | Restrained ochre and gentle landforms | Separate near, middle and distant slopes through values and edges |
| 09 | Sion | Ascending houses and summit accent | Clarify the green plateau without losing the directional movement |
| 10 | OSM 4573435249 | Expressive ridge and resting valley | Connect valley depth, resolve ground gaps and balance architectural emphasis |
| 11 | OSM 473679626 | Ochre mass against pale sky | Resolve the false fortress-like contour; verify exposed rock versus pasture before choosing directional material marks |
| 12 | OSM 5859724001 | Low horizon, spaciousness and calm | Compose unequal sky masses without adding miscellaneous objects |
| 13 | OSM 6046386898 | Varied skyline and rose/ochre planes | Give the tall landmark source-supported identity and credible scale |
| 14 | OSM 645436489 | Open blue sky and airy colour | Quiet the far settlement and define near land without losing openness |
| 15 | OSM 693547093 | Red-roof rhythm against green hill | Preserve roof geometry/contrast and unify bench/landscape drawing language |
| 16 | OSM 724971650 | Gable and opening toward town | Separate buildings from ground with supported structure and base relationships |
| 17 | OSM 767658293 | Settlement rhythm along the slope | Ground buildings and clarify hillside structure without stage-like stacking |
| 18 | OSM 8068577652 | Asymmetric summit, pale rock, green shoulder | Develop directional rock and connected foliage; preserve the summit gesture |
| 19 | OSM 8911154098 | Enclosure and opening into distance | Correct wall-like natural contours while preserving enclosure |
| 20 | OSM 9159327028 | Warm village-to-valley sequence and red roofs | Separate houses from warm ground and explain the prominent facade |

## 7. Iterate and validate the final candidate

Use immutable, named render stages with source snapshots and asset hashes. Do not
edit captured sources during a render. Reuse cached geometry for paint-only changes;
invalidate affected caches and preserve capsule compatibility for geometry changes.
Keep a location's pigment seed stable across metadata/cache revisions so a geometry
or lighting comparison cannot be confounded by shuffled washes. When adding terrain
orientation, verify unchanged projected geometry across the complete fixed sample.

1. Render the six pilots with identical comparison conditions. Inspect at full
   resolution, record rejected approaches and fix causes before broadening.
2. Render all 20 after each accepted shared change. Review every panorama through
   its full horizontal extent, tile overlaps, both vertical limits and 0°/360°.
3. Capture 20 distinct complete panoramas in Chromium at 1440×900, scale factor 1,
   1× viewer zoom. Measure viewer bounds and actual projection. Use at least 30%
   tile overlap, verify movement/wrap/endpoints, and retain both screenshot passes.
   Report measured reachable vertical limits rather than claiming a full sphere.
4. Run all 20 through a baseline daylight browser smoke check. Run the six pilots
   through four seasons × 19 conditions × desktop/mobile: 912 cases. Conditions
   cover dawn, sunrise, morning, clear noon, light/broken/overcast cloud, light/heavy
   rain, snowfall, snow cover, mixed precipitation, sunset, dusk, stars, full moon,
   crescent moon, cloudy night and overcast night. Use 1440×900 and 390×844.
5. Manually review representative evidence from every season and condition, plus
   every discovered failure. Verify visible sun/moon cases where the measured
   skyline permits them; do not classify legitimate occlusion as a rendering bug.
6. Test GPU/canvas agreement, material boundaries, roof projection/occlusion,
   foreground placement, zoom, keyboard navigation, high-angle clipping and margins.
7. Retain synthetic angular-marker/seam tests, missing-artwork and timeout evidence,
   interrupted-run resume, and failed-location replacement tests. A failed fixed
   artist location remains unresolved even if a replacement passes capture tooling.
8. Compare painting CPU/wall time and viewer readiness on the same machine,
   dimensions, geometry and conditions. Separate warm rendering from compilation
   and cold loading. Re-run measurements after final renderer changes.

Automated success is necessary but does not establish painting quality. The visual
gate requires readable forms, connected space, deliberate marks, cohesive foreground
and preserved quiet passages. Record each location as accepted, unresolved or
regressed with evidence; do not silently average away a failing location.

## 8. Report, backlog and package

Create an offline HTML report with zoomable final panoramas, aligned before/after
views, bench-visible views, location links, capture coverage and numbered overlays.
Include annotated image exports and a browsable season/weather evidence gallery.

Each finding must contain its evidence coordinates/angles, affected locations,
severity, confidence, likely cause, implemented or proposed change, acceptance
criteria and observed result. Separate confirmed rendering defects from unverified
geographic concerns. Group recurring unresolved findings into a prioritized backlog:

| Priority | Work | Completion evidence |
| --- | --- | --- |
| P0 | Incorrect geometry, coverage, clipping, seams, loading and material assignment | Corrected full-range captures and targeted regression evidence |
| P1 | Silhouettes, broad values, building structure, ground contact and depth | All 20 location checks with aligned visual comparisons |
| P2 | Material marks, cloud composition and bench cohesion | Full-resolution material/foreground reviews and weather evidence |
| P3 | Remaining polish and performance improvements | Measured benefit without regressions in accepted compositions |

Build the package in a staging directory, verify relative report links and annotation
placement, then ZIP the report, manifest, final panoramas, original directional
screenshots, annotated exports and supporting comparisons. Include source/asset
provenance and reproduction instructions; exclude raw database/terrain caches.
Preserve the original ZIP before atomically replacing `./panoramas.zip`. Verify ZIP
integrity and open the extracted report offline.

**Completion gate:** 20 distinct final panoramas have verified full reachable
coverage; all supplied review notes have evidence-linked outcomes; the final
candidate passes technical checks and visual review; unresolved limitations are
explicit; the report and pictures are present in the verified ZIP. Leave the run
incomplete if these conditions are unmet. No production publication is included.

The archive must contain an entry-point `report.html`, a machine-readable manifest,
20 final full-range PNGs, original directional screenshots, clean stitching inputs,
annotated exports, aligned comparisons, the findings/backlog, individual acceptance
records and reproduction/provenance documents. The manifest must identify the
candidate and distinguish capture completion from artistic acceptance. Do not label
the package final while a required artistic revision remains unresolved.
