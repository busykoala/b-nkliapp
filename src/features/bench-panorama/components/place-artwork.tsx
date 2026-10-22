import { readPanoramaDescriptor } from "../repository";
import { PlacePainting } from "./place-painting";
import { sqlite } from "@/db/client";
import type { PaintingTreatment } from "@/components/painting-frame";
import { panoramaRasterBounds } from "@/lib/panorama-scene";

/** An actual place's existing painting, never stock scenery for a saved place. */
export function PlaceArtwork({ benchId, treatment = "journal" }: { benchId: string; treatment?: PaintingTreatment }) {
  const descriptor = readPanoramaDescriptor(benchId);
  if (!descriptor.artifactUrl) return null;
  const framing = sqlite.prepare(`SELECT pr.width,pr.height,
    CASE WHEN b.direction_degrees IS NOT NULL THEN b.direction_degrees
      WHEN de.bench_id=b.id AND de.bench_latitude=b.latitude AND de.bench_longitude=b.longitude THEN de.direction_degrees
      ELSE 0 END heading
    FROM benches b JOIN bench_panorama_renders pr ON pr.bench_row_id=b.row_id
    LEFT JOIN bench_direction_estimates de ON de.bench_row_id=b.row_id
    WHERE b.id=? AND pr.render_key=? LIMIT 1`).get(benchId, descriptor.renderKey) as { width: number; height: number; heading: number } | undefined;
  if (!framing || framing.width <= 0 || framing.height <= 0) return null;
  return <PlacePainting key={descriptor.artifactUrl} benchId={benchId} src={descriptor.artifactUrl}
    treatment={treatment} framing={{ ...framing, bounds: panoramaRasterBounds(descriptor.rasterBounds) }} />;
}
