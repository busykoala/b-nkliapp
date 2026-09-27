# Terrain depth review

These captures use the real local bench nearest `46.554764, 8.005809` (`community-01fc1243-4721-4b44-8f81-9fd698926d21`, Mönchsjochhüttebänkli), not an illustrative landscape.

## Diagnosis

The observer height came from the local 2 m swissALTI3D tile, but near rays were sampled from a derived 10 m pyramid immediately beside the observer. At heading 45° and a 2 m distance, the 2 m surface is about 3651.05 m while the coarse cell is 3654.3 m. That discontinuity became a false rock span from −32° to +41.99°, producing the large gray wall.

The corrected generation uses the local 2 m terrain for the first 120 m, bilinear interpolation with nodata renormalization and tile-boundary support, and a separately documented physical observer height. At the selected 45°/0° ray the corrected skyline is −0.84° and the ray is sky. The real steep terrain at headings 270° and 315° remains visible.

`before/` and `after/` contain resting views and interactive headings at 45°, 90°, 180°, 270°, and 315° for mobile and desktop. `diagnostic-*/` contain the painting, logarithmic depth, exact semantic classes, and a machine-readable selected-ray report.

## Reproduction

Capture an already-running isolated application with:

```sh
npx tsx scripts/review-terrain-depth.ts \
  --base-url http://localhost:3102 \
  --bench-id community-01fc1243-4721-4b44-8f81-9fd698926d21 \
  --output-dir docs/terrain-depth-review/after
```

Regenerate a selected-ray diagnostic with the `panorama-diagnose` worker command and the capsule, painting, material texture, optional lightmap, and the four terrain directories from the same generation. The report records hashes for pairing evidence.

## Usability review script

Use the actual application at mobile portrait, 320 CSS px, mobile landscape, tablet, desktop, and 200% text size. Ask a participant to:

1. Decide whether a bench has shelter and back support and whether the approach is sufficiently assessed.
2. State the current temperature and light without treating missing cloud evidence as clear weather.
3. Plan a journey arriving at a chosen time and explain its walking and transfer limitations.
4. Plan a roughly 50-minute return walk, inspect one stop, and resume the same plan.
5. Distinguish a confirmed fact from missing or conflicting evidence without opening technical metadata.

Record task outcome, the participant’s own words, observed hesitation, viewport/browser, and assistive setup. Human participant validation is pending; no participant findings or timings are claimed here.
