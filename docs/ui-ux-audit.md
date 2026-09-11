# Mobile-first UI/UX audit — 30 priority improvements

The audit covers the live site and the local implementation at 320 × 568, 390 × 844, 768 × 1024, and 1440 × 900. Public coverage includes the map, search, filters, nearby list, bench details, walk planning, navigation, feed, statistics, and the about/data-source page. Authenticated coverage uses disposable local accounts and includes registration, the signed-in menu, profile and avatar, favourites, contributions, ratings, photos, and adding a bench.

## Public discovery and navigation

| Priority | Finding | Implemented improvement |
| ---: | --- | --- |
| 1 | At 320 px the map search prompt was truncated to “Ort o”. | Shortened the prompt in every language and made the filter control icon-only only where space is genuinely scarce. |
| 2 | The map’s two primary discovery actions wrapped into an accidental two-row layout on a narrow phone. | Added a compact “Spaziergang” label and keep both actions together on one row. |
| 3 | The filter looked modal but the map behind it was neither dimmed nor protected from pointer input. | Added a full-viewport dismissible backdrop while retaining trapped keyboard focus and Escape behaviour. |
| 4 | On a short phone, “Karte ansehen” began below the filter’s fold. | Split the panel into an independently scrolling body and a persistent action footer. |
| 5 | A half-open bench sheet showed only artwork on a short phone; the bench identity was below the viewport. | Changed the short-height snap point so the bench name and place are visible immediately. |
| 6 | The sheet’s chevron alone did not explain how to reveal details or return to the map. | Added visible, translated “Details zeigen” / “Karte zeigen” labels to the handle. |
| 7 | Programmatically focusing the walk title produced a heavy rectangular outline around a non-interactive heading. | Kept focus for assistive technology but removed the misleading visual control outline from that heading only. |
| 8 | Navigation disappeared on the feed, statistics, profile, about, and standalone bench pages during long scrolls. | Added a quiet translucent sticky navigation surface with correct anchor scroll offset. |
| 9 | The menu on non-map pages had no explicit route back to the main map. | Added a translated “Zur Karte” row on every non-map page without duplicating it on the map itself. |
| 10 | A bench back button always returned to the feed, even when the bench was opened from statistics or favourites. | Source links now carry explicit return context and direct visits fall back to the map. |
| 11 | The about page’s 24 source rows dominated the page and hid its explanation and credits. | Grouped the complete source catalogue behind one clear, count-labelled disclosure with correct open/closed wording. |

## Account and authenticated space

| Priority | Finding | Implemented improvement |
| ---: | --- | --- |
| 12 | Login and registration were switched by a single link at the bottom of the sheet, making the current mode easy to miss. | Added a persistent two-option mode switch with an explicit selected state. |
| 13 | Passwords could not be checked for typing mistakes on a phone. | Added an accessible show/hide-password control without changing password-manager semantics. |
| 14 | The eight-character requirement only appeared after an invalid submission. | Shows the requirement beside a new password before submission and links it to the input description. |
| 15 | The signed-in menu represented the person as one ordinary navigation row. | Added a compact account card with avatar, username, and a direct profile affordance. |
| 16 | Profile and favourites did not show their current location in the signed-in menu. | Added visible current-page styling and `aria-current` where appropriate. |
| 17 | “Abmelden” sat between primary destinations and was easy to hit while navigating. | Moved sign-out to a separated, quieter account footer. |
| 18 | The expanded signed-in menu could outgrow a short phone once account controls were present. | Constrained it to the dynamic viewport and made its own content safely scrollable. |
| 19 | A valid long username overwhelmed the portrait and wrapped into oversized fragments. | Reduced the narrow-screen type scale while retaining the profile’s editorial character. |
| 20 | Four activity counters became cramped, with labels breaking awkwardly at 320 px. | Switches the activity overview to a readable two-column grid on the smallest phones. |
| 21 | The long “Wanderbuch” had no orientation or shortcut between activity, trail, and collections. | Added a compact horizontally scrollable section navigation immediately after the portrait. |
| 22 | Opening the avatar editor could pull the mobile document sideways when a control was scrolled into view. | Contained the editor and journal widths and verified zero document-level horizontal overflow. |
| 23 | Avatar choices are long, while their save action was only at the very end. | Moved the save/status bar before the choices and keep it below the sticky page navigation while editing. |
| 24 | Empty favourites explained how to save a bench but offered no way to do it. | Replaced the loose paragraph with a calm empty-state card and direct “Zur Karte” action. |
| 25 | Eight contribution accordions formed a visually undifferentiated wall. | Added restrained category icons and a clear active treatment without adding decorative noise. |
| 26 | Several contribution chapters could stay open and create a very long, confusing task sheet. | Made chapters mutually exclusive so one contribution task is active at a time. |
| 27 | Opening a lower chapter left its form beginning partly below the viewport. | The selected chapter now scrolls to the nearest useful position after opening. |
| 28 | Tapped rating stars had no textual confirmation of the current score. | Added a live, visible “n Sterne” output beside every rating row. |
| 29 | The add-bench details sheet did not show how it related to the preceding map-position step. | Added a compact two-step indicator that confirms Position and marks Details as current. |
| 30 | The add-bench submit action lived after a potentially long form and duplicate review. | Split the sheet into a scrollable body and a persistent submit/status footer. |

Additional polish completed during the same pass: favourites show their current count; unknown bench attributes sort ahead of already-known ones; and a selected photo can be explicitly removed instead of only replaced.

## Verification

Regression coverage lives primarily in `e2e/mobile-map.spec.ts` and `e2e/authenticated-ux.spec.ts`, with photo, community, feed, acknowledgement, and observation coverage in their feature suites. The authenticated screenshots are generated with disposable users and a disposable SQLite database; no production account or user data is used.
