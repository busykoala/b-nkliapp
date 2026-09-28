import type { RouteAccessibility } from "@/features/journey/model";

export type RouteAccessibilityCoverage = "none" | "partial" | "complete";
export type RouteAccessibilityAssessment = {
  expectedSections: number;
  assessedSections: number;
  coverage: RouteAccessibilityCoverage;
  steps: "present" | "none" | "unknown";
  stepsDistanceMeters: number;
  maximumSlopePercent: number | null;
  surfaces: string[];
};

export function aggregateRouteAccessibility(values: Array<RouteAccessibility | undefined>): RouteAccessibilityAssessment {
  const known = values.filter((value): value is RouteAccessibility => value !== undefined);
  const hasSteps = known.some((value) => value.steps === "present");
  const fullyAssessed = values.length > 0 && known.length === values.length && known.every((value) => value.steps !== "unknown");
  const slopes = known.flatMap((value) => value.maximumSlopePercent === null ? [] : [value.maximumSlopePercent]);
  return {
    expectedSections: values.length,
    assessedSections: known.length,
    coverage: known.length === 0 ? "none" : known.length === values.length ? "complete" : "partial",
    steps: hasSteps ? "present" : fullyAssessed ? "none" : "unknown",
    stepsDistanceMeters: known.reduce((sum, value) => sum + value.stepsDistanceMeters, 0),
    maximumSlopePercent: slopes.length ? Math.max(...slopes) : null,
    surfaces: [...new Set(known.flatMap((value) => value.surfaces))].slice(0, 3),
  };
}
