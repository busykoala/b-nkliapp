import { normalizePanoramaHeading } from "@/lib/panorama-scene";

/** Shortest turn towards the recorded bench view, with a quiet arrival zone. */
export function benchBearingTurn(heading: number, recorded: number | null | undefined): "left" | "right" | null {
  if (recorded == null || !Number.isFinite(recorded) || !Number.isFinite(heading)) return null;
  const delta = normalizePanoramaHeading(recorded - heading + 180) - 180;
  return Math.abs(delta) <= 12 ? null : delta < 0 ? "left" : "right";
}
