import type { JourneyPoint } from "@/lib/journey";
import type { Translator } from "./types";

/** Generated labels follow the viewer's language; names stay exactly as supplied. */
export function pointLabel(point: JourneyPoint, t: Translator) {
  if (point.labelKind === "location") return t("routing.origin.current");
  if (point.labelKind === "station") return t("routing.origin.station");
  if (point.labelKind === "bench") return t("common.values.bench");
  if (point.labelKind === "waypoint") return t("routing.labels.waypoint");
  return point.label;
}
