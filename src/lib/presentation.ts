import type { BenchDetail, BenchProperty, PrecipitationType } from "./types";

export type EvidenceState = "known" | "unknown" | "conflicting";
export type PresentedBenchFact<T> = {
  value: T | null;
  state: EvidenceState;
  source: BenchProperty["source"] | null;
  confidence: BenchProperty["confidence"];
  validAt: string | null;
  coverage: string | null;
};

export function benchFact<T extends boolean | string | number>(bench: Pick<BenchDetail, "properties">,
  key: BenchProperty["key"]): PresentedBenchFact<T> {
  const property = bench.properties.find((item) => item.key === key);
  if (!property || property.canonicalValue === undefined || property.canonicalValue === null) {
    return { value: null, state: property?.evidenceState === "conflicting" ? "conflicting" : "unknown",
      source: property?.source ?? null, confidence: property?.confidence, validAt: property?.validAt ?? null,
      coverage: property?.coverage ?? null };
  }
  return { value: property.canonicalValue as T, state: property.evidenceState ?? "known", source: property.source,
    confidence: property.confidence, validAt: property.validAt ?? null, coverage: property.coverage ?? null };
}

export type WeatherCondition = "unknown" | "clear" | "partly-cloudy" | "cloudy" | "overcast" |
  Exclude<PrecipitationType, "none" | "unknown">;

export function resolveWeatherCondition(weather: BenchDetail["weather"]): WeatherCondition {
  if (!weather) return "unknown";
  if (["rain", "snow", "mixed"].includes(weather.precipitationType)) {
    return weather.precipitationType as "rain" | "snow" | "mixed";
  }
  if (weather.cloudCover === null) return "unknown";
  if (weather.cloudCover >= .88) return "overcast";
  if (weather.cloudCover >= .55) return "cloudy";
  if (weather.cloudCover >= .12) return "partly-cloudy";
  return "clear";
}

/** Neutral atmosphere for art only; never expose this as an observation. */
export function panoramaCloudCover(weather: BenchDetail["weather"]) {
  if (weather?.cloudCover !== null && weather?.cloudCover !== undefined) return weather.cloudCover;
  if (weather && ["rain", "snow", "mixed"].includes(weather.precipitationType)) return .9;
  return .2;
}

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

export function aggregateRouteAccessibility(values: Array<import("./journey").RouteAccessibility | undefined>): RouteAccessibilityAssessment {
  const known = values.filter((value): value is import("./journey").RouteAccessibility => value !== undefined);
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
