# Contribution workspace

`BenchContributionHub` is one native modal, not another map sheet. The underlying
bench, map camera and planner stay mounted; this workspace does not change URLs
or browser history. Existing photo, feature and rating entry points still open
the corresponding task directly, including after sign-in.

## Information architecture

The chooser groups eight tasks without nested accordions:

| Group | Tasks |
| --- | --- |
| Den Platz zeigen | Describe the bench; add a photo |
| Gerade vor Ort | Report current light; describe the view |
| Deine Pause | Leave a moment; rate the pause |
| Helfen & melden | Record care/presence; report a problem |

Keep functional icons and labels crisp. Small irregular watercolor washes,
existing paper colors and Lora/Source Sans typography provide the visual identity.
Do not add a completeness score or require completing every task.

## Input and saving

- Features: choose a field, answer a concrete question, explicitly save. Unknown
  or conflicting values start unselected. “Weiss ich nicht” returns without
  publishing anything. Back retains a staged field answer for this session.
- The level-space question concerns the area beside the bench, not the full route.
- Unknown direction is not silently submitted as north. The preview is only a
  reference until a direction is explicitly chosen.
- Name/dedication, moments, ratings and corrections have explicit save/publish
  actions. A field save must not clear an independent metadata draft.
- View corrections keep four short steps; all seven answers must be deliberately
  provided before publication. Do not seed unobserved answers. Existing view
  labels provide context for the agreement action.
- Current light is intentionally a one-tap report with visible guidance and Undo.
  At night, explain why this task is unavailable instead of collecting sunlight.
- Care buttons describe an action already taken, not an intention. Server-side
  permissions, duplicate checks and evidence handling are unchanged.
- Photo preparation, upload, moderation and accepted-submission recovery keep
  their existing implementation; the workspace only tracks unsent work/pending.

## Session and return contract

Visited tasks mount lazily and remain mounted while hidden. This retains written
text, choices, and selected photo objects when changing tasks. Do not store these
new drafts in local storage, a URL or a backend before explicit publication.

`useContributionWork` registers dirty/pending child state. `useContributionSave`
prevents double submission and catches transport failures. Failed saves retain
the draft; successful saves clear only the committed work. Failure to refresh
an already accepted contribution is reported separately, not as a failed save.

Close and Escape close a clean workspace. With a draft they open a discard choice
inside the same dialog. Continue editing restores the previous task, scroll and
focus. Discard does not delete already saved contributions. Switching tasks is
not discarding. Pending saves temporarily block task switching and dismissal.

Closing returns focus to the invoking control when it remains connected. The
chooser restores its scroll and selected task focus. Reloading/closing the page
warns while work is dirty or pending; abandoned unsent work is otherwise ephemeral.

## Viewport and accessibility

Use `showModal()` so the browser provides top-layer placement and an inert
background. Do not reintroduce DaisyUI `modal-bottom`/`modal-box` positioning here.
The mobile surface fills the available viewport; desktop uses a bounded centered
panel. One body scrolls; the top Back/Close toolbar remains available.

`useContributionViewport` follows visual-viewport height/offset for keyboards,
cleans up its listeners, and releases its size overrides during pinch zoom. In a
short keyboard viewport the redundant footer hides, not the close control. Long
headings remain in the scroll area so 200% text does not swallow the whole form.

## Regression checks

Run `npm run check` and `npm run test:e2e`. Contribution-specific browser scenarios
are in `e2e/community/contributions.spec.ts`, `e2e/community/observations.spec.ts`
and `e2e/account/authenticated.spec.ts`. They retain authentication, actual saves,
photo moderation, rating and return flows, and add draft/discard, explicit-save,
failed-request recovery and short-viewport assertions. Pure field/answer contracts
are beside their models. No increased timeouts or new skips are required.

Manual release checks still include an actual iOS/Android keyboard, screen reader,
real photo upload and review by native speakers for translated UI additions.

## Design references

- [StreetComplete](https://streetcomplete.app/): small on-site questions rather
  than a general-purpose map-data form.
- [Mapy place detail](https://help.mapy.com/place-detail/): place-specific photos,
  reviews and correction actions remain separate purposes.
- [GOV.UK question headings](https://design-system.service.gov.uk/get-started/labels-legends-headings/):
  ask the question directly and focus each step on one decision.
- [WAI modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/):
  labelled dialog, deliberate initial focus, inert background and focus return.
