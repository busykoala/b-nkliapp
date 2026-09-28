import { expect, it } from "vitest";
import { aggregateRouteAccessibility } from "./accessibility";
import type { RouteAccessibility } from "@/features/journey/model";

it("retains missing walking sections and prioritizes known steps", () => {
  const clear: RouteAccessibility = { steps: "none", stepsDistanceMeters: 0, maximumSlopePercent: 4, surfaces: ["asphalt"] };
  const steps: RouteAccessibility = { steps: "present", stepsDistanceMeters: 18, maximumSlopePercent: null, surfaces: ["steps"] };
  expect(aggregateRouteAccessibility([clear, undefined])).toMatchObject({ coverage: "partial", steps: "unknown", assessedSections: 1, expectedSections: 2 });
  expect(aggregateRouteAccessibility([undefined, steps])).toMatchObject({ coverage: "partial", steps: "present", stepsDistanceMeters: 18 });
  expect(aggregateRouteAccessibility([clear])).toMatchObject({ coverage: "complete", steps: "none" });
  expect(aggregateRouteAccessibility([undefined])).toMatchObject({ coverage: "none", steps: "unknown" });
});
