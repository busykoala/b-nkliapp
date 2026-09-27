import { describe, expect, it } from "vitest";
import { aggregateRouteAccessibility, benchFact, panoramaCloudCover, resolveWeatherCondition } from "./presentation";
import type { BenchDetail } from "./types";
import type { RouteAccessibility } from "./journey";

describe("truthful presentation models", () => {
  it("uses canonical facts and preserves unknown and conflicting evidence", () => {
    const bench = { properties: [
      { key: "backrest", label: "translated yes", value: "Ja", canonicalValue: false, evidenceState: "known", source: "OpenStreetMap" },
      { key: "covered", label: "roof", value: "Ja", canonicalValue: true, evidenceState: "conflicting", source: "Mehrere Quellen" },
      { key: "armrest", label: "arms", value: "Nein", source: "OpenStreetMap" },
    ] } as Pick<BenchDetail, "properties">;
    expect(benchFact<boolean>(bench, "backrest")).toMatchObject({ value: false, state: "known" });
    expect(benchFact<boolean>(bench, "covered")).toMatchObject({ value: true, state: "conflicting" });
    expect(benchFact<boolean>(bench, "armrest")).toMatchObject({ value: null, state: "unknown" });
  });

  it("does not turn missing cloud or precipitation evidence into clear and dry", () => {
    const weather = { cloudCover: null, precipitationType: "unknown" } as NonNullable<BenchDetail["weather"]>;
    expect(resolveWeatherCondition(weather)).toBe("unknown");
    expect(panoramaCloudCover(weather)).toBe(.2);
    expect(resolveWeatherCondition({ ...weather, precipitationType: "rain" })).toBe("rain");
    expect(panoramaCloudCover({ ...weather, precipitationType: "rain" })).toBe(.9);
  });

  it("keeps missing walking sections visible and never hides known steps", () => {
    const clear: RouteAccessibility = { steps: "none", stepsDistanceMeters: 0, maximumSlopePercent: 4, surfaces: ["asphalt"] };
    const steps: RouteAccessibility = { steps: "present", stepsDistanceMeters: 18, maximumSlopePercent: null, surfaces: ["steps"] };
    expect(aggregateRouteAccessibility([clear, undefined])).toMatchObject({ coverage: "partial", steps: "unknown", assessedSections: 1, expectedSections: 2 });
    expect(aggregateRouteAccessibility([undefined, steps])).toMatchObject({ coverage: "partial", steps: "present", stepsDistanceMeters: 18 });
    expect(aggregateRouteAccessibility([clear])).toMatchObject({ coverage: "complete", steps: "none" });
    expect(aggregateRouteAccessibility([undefined])).toMatchObject({ coverage: "none", steps: "unknown" });
  });
});
