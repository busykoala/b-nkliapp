# Ferry stops in the watercolor map

## Data check

On 2026-09-05, the official swisstopo base vector tile
`https://vectortiles0.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/14/8541/5783.pbf`
contained `Spiez Schiffstation` at longitude 7.6898932456970215,
latitude 46.68847823652703, station ID 8507154, subclass `ferry_terminal`.
The existing custom transit filter omitted this class while hiding the original
POI symbols. No new data source or local database change was necessary.

The local transit filter now includes `ferry_terminal`, `ferry`, and `car_ferry`,
the boat-stop classes supported by the official lightbasemap style. Generic
marinas are intentionally not classified as public-transport stops. Boat symbols
use the existing local-stop zoom threshold (14.5); names appear from zoom 16.

## Artwork

- Saved asset: `public/map-art/v3/transit-ferry.png` (112 × 112, alpha PNG, 2×).
- Created using the built-in image generation tool, with the existing
  `public/map-art/v3/transit-bus.png` as a style reference only.
- Resized and palette-compressed with Sharp, preserving transparency.
- Loaded with the existing deferred transit assets, not the initial map bundle.

Final generation prompt:

> Use case: stylized-concept. Asset type: small watercolor public-transport map icon on genuine transparent background. Image 1 is STYLE REFERENCE ONLY (existing painted bus icon); create a NEW matching passenger ferry boat icon, not a bus. Subject: one compact Swiss lake passenger boat with an ivory hull, muted teal windows, small warm ochre cabin details, recognizable two-deck silhouette, gentle three-quarter side view. Style: delicate hand-painted watercolor and restrained pencil details matching the reference, softly feathered pigment edges, readable when reduced to 40 pixels. Composition: entire boat centered, fills width, no cropping, narrow transparent margin. A tiny pale teal wash immediately below hull is okay. No scenery, pier, badge, circle, text, logos, shadow backdrop, or checkerboard. Preserve genuine alpha transparency around the boat.

## Regression coverage

The unit test evaluates the actual MapLibre filter, icon and scale expressions
against the Spiez stop properties and the other supported boat-stop classes.
It also checks exclusion of generic marinas and safe behavior when the ferry
asset is missing. The existing initial/full map-art budget test includes the
new asset.
