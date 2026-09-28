# Professional review handoff — September 2026

## Review baseline and fixtures

- Baseline revision for the navigation/data audit: `cdbd5e8`.
- Primary deterministic fixture: `osm-node-101` (Lindenhof, Zürich), plus seeded sparse/unknown, conflicting-evidence, saved, journey, and walk states from the Playwright database.
- Rendered sizes: Pixel 7 (412 × 839 CSS px) and iPhone 14 mobile Chromium/WebKit, 320 CSS px with 200% text, tablet, landscape, and desktop layouts. Tests load the actual self-hosted Source Sans 3 and Lora fonts.
- The user-supplied “Ganz öffnen / Minimieren / Karte” capture records the original noisy sheet-bar problem. A reproducible baseline from `cdbd5e8` and clean production-build after screens are retained in [`professional-review/`](professional-review/README.md); older bundled review images are not treated as proof of this revision.

Representative reproducible captures:

- [`professional-review/after/minimized-detail-bar.png`](professional-review/after/minimized-detail-bar.png): compact task bar and expansion affordance.
- [`professional-review/after/bench-task-200-percent-text.png`](professional-review/after/bench-task-200-percent-text.png): 320 CSS px with 200% text.
- [`professional-review/after/structured-bench-detail.png`](professional-review/after/structured-bench-detail.png): decision-first bench detail.
- [`professional-review/after/sparse-missing-direction.png`](professional-review/after/sparse-missing-direction.png) and [`conflicting-evidence.png`](professional-review/after/conflicting-evidence.png): missing and conflicting evidence in production components.
- [`professional-review/after/saved-places-restored.png`](professional-review/after/saved-places-restored.png): saved list after inspection/return.
- [`professional-review/after/journey-input.png`](professional-review/after/journey-input.png) and [`journey-result.png`](professional-review/after/journey-result.png): route input/result, access scope, and transfers.
- [`professional-review/after/walk-input.png`](professional-review/after/walk-input.png), [`walk-options.png`](professional-review/after/walk-options.png), and [`walk-resumed-after-bench.png`](professional-review/after/walk-resumed-after-bench.png): walk setup, choice and in-app resumption.
- [`professional-review/after/map-raster-fallback.png`](professional-review/after/map-raster-fallback.png): explicit recovery from a failed vector style.
- `sky-mock-gallery/after/`: deterministic day/night, rain/snow, stars, and moon-phase panorama regressions.

## Implemented decisions

- Sheet chrome now has one contextual return action, a central tap/drag handle, and one quiet minimize control. The minimized state becomes a named bar; competing X/chevrons/text buttons were removed.
- The compact bench state leads with identity, current condition, material comfort/access facts, route, save, and explicit details. Full detail follows visit questions rather than database groups; provenance remains secondary.
- Wheelchair symbolism was replaced with a standing-person/access cue and precise scope text: at the bench, last local approach, and assessed route are separate claims.
- Weather uses shared truthful icons and exact units. Decorative rain/wind/slope gauges and logarithmic distance tracks were removed.
- Map/list/source/history return paths, facilities, planner suspension, walk stop inspection, return journeys, saves after authentication, and queued draft deletion have explicit recovery behavior.
- Active, last-inspected, and saved bench states no longer share one visual or meaning.
- The minimized task bar preserves the detail reading position. At 320 CSS px and 200% text it allocates the available width to the task name and changes the return label to a conventional, accessibly named arrow instead of truncating both actions.

## Executed validation

- `npm run lint` and `npx tsc --noEmit`: passed.
- `npm test -- --run`: 68 files, 335 tests passed.
- `npm run test:worker`: 263 tests passed; only existing dependency deprecation warnings were reported.
- Disposable-database `npm run build`: all 39 migrations applied and the Next.js 16.3.4 production build completed.
- Full `npx playwright test --workers=2`: 166 passed, 7 intentionally skipped; one Chromium add-bench scenario hit the local 30-second suite timeout before its authentication dialog, while the WebKit copy passed. The exact Chromium scenario then passed in isolation in 8.3 seconds. The new sheet/200%-text/contrast coverage passed in both engines, and a production-build review subset passed 7/7.
- The native-size files under `professional-review/` were opened and visually inspected. No physical touch device was available, so none is claimed.

## Remaining uncertainties for human review

- Whether the short “Karte” return label is sufficiently clear in every dialect at first encounter; its destination is conventional but should be observed with non-technical participants.
- Whether the current amount of route evidence is right for people with walking difficulties. The scope is now honest, but importance and phrasing still need field validation.
- How long a time-sensitive restored journey should remain usable before the product actively requests refresh. Its fetch time is visible; no unvalidated expiry threshold was invented.
- The best prominence for the quiet last-inspected marker at low zoom. It is intentionally suppressed outside the current filtered visible result scope.

No participant feedback, completion rate, or usability validation is claimed.

## Short usability script

1. Find a bench matching one need (sun/shade, backrest, or level space), open it, and explain whether it suits a visit. Close it and describe what remained unchanged.
2. Open a result from the list, scroll/read it, return, and locate the same row. Repeat from saved places or feed.
3. Explain the difference between “Direkt am Bänkli”, “Letztes Wegstück”, and the route assessment. Ask what is known versus uncertain.
4. Plan a journey, alter start and transfer buffer, close it accidentally, reopen it, and recover the work.
5. Build a one-way walk, inspect a stop, return to the walk, open the return journey, then return again. Finally end the walk and verify it is gone.
6. Trigger and recover from one mistake: cancel an edited origin, dismiss suggestions with Escape, retry a failed request, or authenticate while saving.

Record observed wording, hesitation, wrong assumptions, focus/touch problems, and whether the person can recover without coaching. Do not turn facilitator interpretation into invented metrics.
