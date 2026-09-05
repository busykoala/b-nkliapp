# Mixed waterfront scene — September 5, 2026

The adaptive illustration previously treated water as an exclusive setting. That
preserved the lake but discarded the built environment. It now selects a painted
town waterfront when water evidence coexists with urban land context, at least
five buildings within 100 m, or building obstruction of at least 35%. The 35%
threshold is an illustrative design heuristic, not a new visibility measurement.
Unknown values alone do not produce a harbour scene. Snow selects its matching
winter asset. Buildings without water still select a settlement, not a harbour.

The reported 67% building obstruction and the 100 water score are different
measures. The water score is not the proportion of the view covered by water.
These paintings convey combined surroundings; they are not camera-calibrated
reconstructions or exact depictions of Spiez.

## Assets and generation

Created using the **built-in image-generation tool**, following the imagegen
skill, then resized/encoded locally with Sharp. No API/CLI generation fallback.

- `public/ui-art/v3/bench-scene-harbour.webp` — 576 × 432, WebP quality 56.
- `public/ui-art/v3/bench-scene-harbour-winter.webp` — same dimensions/encoding.
- `public/ui-art/v3/bench-scene-city.webp` — existing city painting flattened onto
  its ivory paper colour and re-encoded at quality 60, retaining 640 × 480.
  This makes room for the new scenes within the unchanged 800 KiB total budget.
  The original is preserved at
  `docs/reviews/watercolor-sources/bench-scene-city-v1.webp`.

The original generated PNGs remain in the image tool's generation directory
`01a06de2-5355-7930-8917-6e6ab3832528`, named
`exec-ec41e1a0-7be9-40e7-ac04-a6b4537b8aab.png` and
`exec-046332b7-7144-4edb-ae5a-73da5ffa5bb4.png` respectively.

### Final daytime prompt

Use case: illustration-story. Asset type: a reusable opaque background painting for an adaptive Swiss bench illustration, landscape 4:3 composition. Paint a small Swiss lakeside town harbour, evocative of Spiez, in loose authentic transparent watercolor on warm ivory paper. Buildings are the dominant surroundings: ochre, cream and pale terracotta town houses with gently sketched tiled roofs frame both sides and part of the middle distance, enclosing a narrow but clearly visible opening onto a teal-blue lake, with pale Alpine relief across the water. Sparse small greenery only, not a forest, not a wild meadow. A stone-paved waterfront promenade fills the lower third; its central area (x=30%-70%, y=60%-95%) is empty and calm for a separately composited bench. Leave a quiet central sky opening in the top quarter for a separately rendered sun/moon. Layered wet washes, soft drybrush, lost and found edges, restrained ink, architectural forms readable but not photorealistic, light atmospheric watercolor. Soft neutral daytime light, no directional cast shadows. No bench, no people, no text, no labels, no logos, no sun or moon disc. Full-bleed painting without frame. The illustrated setting should combine strong built environment, a limited opening, lake water and distant mountain relief rather than a broad unobstructed wilderness panorama. Image supplied is a palette/painting-medium reference only; replace its wilderness setting with the described town harbour.

Style reference: `public/ui-art/v2/bench-scene-lake.webp`.

### Final winter prompt

Use case: lighting-weather. Edit target: the supplied watercolor Swiss town harbour background. Create its snowy winter counterpart. Preserve the exact building arrangement, skyline, lake opening, perspective, framing and empty lower-centre promenade for a separately composited bench. Change only the season: softly painted snow on tiled roofs, steps, waterfront stone and foreground paving; sparse bare vegetation; cool blue-gray winter shadows and warm ivory paper highlights. The lake stays liquid teal, the distant Alpine slopes carry snow. Preserve the original loose watercolor texture, architectural washes and muted ink edges. Gentle neutral daylight without a sun or moon disc. No bench, no people, no text, no frame. Opaque full-bleed 4:3 background.

Edit target: the generated daytime PNG above.

## Verification

The deterministic visual-review script includes the dense harbour, its shaded
variant, wooded natural shoreline, the exact 67%/6% obstruction example with
missing land/building-count data, and a snowy harbour with a low moon. Unit tests
cover both scene selection and forwarding obstruction evidence from BenchDetail
through the actual React illustration.

The follow-up perspective adjustment calibrates the four ground-contact points
of all nine existing bench sprites. A scene-specific position/scale and modest
vertical shear align the long axis while preserving upright supports; the same
transform is applied to contact shadows and artwork. Backless benches no longer
inherit the ground height of taller backrest sprites. This is 2D composition
alignment, not a reconstructed 3D model or a new rear-facing view.

Final checks: 63 unit tests, production build and targeted lint passed. Thirty
scene combinations plus avatars/badges/stamps rendered without missing assets
in Chromium and WebKit. The published UI-art set is 813,176 bytes, below 800 KiB.
