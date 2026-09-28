# Interaction and state contract

This contract describes production behavior, not a proposal. The typed task and return models live in `src/features/map/navigation.ts`; planner snapshots stay in the map screen and the walk draft store.

## Foreground task

Exactly one semantic map task is in front: browse, list, bench inspection, journey, walk, return journey, facility inspection, or add-bench. Temporary dialogs and combobox suggestions sit above that task in a coordinated LIFO dismissal stack. One Escape dismisses one layer.

## Back, close, minimize, and end

- **Back** returns to the task named by the control: list, walk, bench, or map. Browser Back/Forward follows the same bench history entries.
- **Close** suspends a journey or walk. Its committed origin, settings, selected result, active leg, sheet size, and reading position remain resumable in this browser visit.
- **Minimize** keeps the task active and exposes the map. The bar names the task; “Ganz öffnen” restores the previous useful height.
- **End walk** waits for queued writes, deletes the resumable draft, and prevents an older save from resurrecting it.

## Lifetimes

| Lifetime | Examples | Cleared when |
| --- | --- | --- |
| Transient presentation | sheet snap/scroll, list scroll/focus, camera return snapshot, active facility, last-inspected marker | source task ends, filter scope excludes it, or browser visit ends |
| Resumable task | committed origin, journey/walk settings, result timestamp, selected option/leg, walk route | explicit end/discard; a walk may additionally expire in its private server-side draft store |
| Durable user data | saved benches, contributions, account preferences | explicit user action according to that feature |

Precise origins are not put in share URLs or local storage. A restored result retains its original fetch timestamp. Editing a valid start is separate from committing it; cancelling the edit restores the previous origin.

## Camera and overlays

Opening a marker records the preceding camera and pans only when content would be hidden. Camera restoration is skipped after deliberate map interaction. Journey and walk overlays claim an owner token; cleanup from an obsolete planner cannot erase a newer route or restore its camera. Route fitting uses measured toolbar and sheet bounds and always leaves MapLibre a valid drawable area.

Active selection, last inspected, and saved are distinct. Last inspected is a single quiet session marker, never a visit record, and disappears when it no longer matches the visible filter/result scope.

## Return contexts

- Map → bench → map: filters/search remain; eligible automatic camera changes are undone.
- List → bench → list: camera, scroll, row focus, and result state return.
- Feed/favorites/statistics → standalone bench → source: a session token restores scroll and focus without exposing private state in the URL.
- Bench → journey → bench: bench sheet and reading position return; reopening the planner resumes its query/result.
- Walk → bench → walk: chosen route, options, and presentation return in-app.
- Walk → return journey → walk: closing the subtask returns to the originating walk.
- Bench → facility → bench: sheet presentation and prior camera return.

Direct shared bench links remain canonical. Closing a direct entry removes the stale selection without trapping browser Back; internal selections use versioned native history entries.
