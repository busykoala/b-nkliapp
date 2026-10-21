"use client";

import { BenchPanorama } from "@/features/bench-panorama/components/bench-panorama";
import type { BenchDetail } from "@/lib/types";

export function ArtReviewViewer({ bench, hideBench }: { bench: BenchDetail; hideBench: boolean }) {
  return <section className={hideBench ? "art-review-viewer hide-review-bench" : "art-review-viewer"}>
    <style>{`.art-review-viewer{max-width:1100px;margin:20px auto}.art-review-viewer .bench-panorama.is-static{height:660px;aspect-ratio:auto}.hide-review-bench .bench-panorama-foreground{display:none} @media(max-width:600px){.art-review-viewer .bench-panorama.is-static{height:560px}}`}</style>
    <BenchPanorama bench={bench} />
  </section>;
}
