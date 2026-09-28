import type { BenchDetail, BenchProperty } from "@/lib/types";

export type EvidenceState = "known" | "unknown" | "conflicting";
export type PresentedBenchFact<T> = {
  value: T | null;
  state: EvidenceState;
  source: BenchProperty["source"] | null;
  confidence: BenchProperty["confidence"];
  validAt: string | null;
  coverage: string | null;
};

type PropertyValues = {
  backrest: boolean; armrest: boolean; covered: boolean; wheelchair: boolean;
  fireplaceNearby: boolean; wasteBasketNearby: boolean; material: string; seats: number;
};

export function benchFact<K extends keyof PropertyValues>(bench: Pick<BenchDetail, "properties">, key: K): PresentedBenchFact<PropertyValues[K]> {
  const property = bench.properties.find(item => item.key === key);
  const expected = key === "material" ? "string" : key === "seats" ? "number" : "boolean";
  const valid = property != null && typeof property.canonicalValue === expected
    && (expected !== "number" || Number.isFinite(property.canonicalValue));
  const state = property?.evidenceState === "conflicting" ? "conflicting"
    : property?.evidenceState === "unknown" || !valid ? "unknown" : "known";
  return {
    value: state === "known" ? property!.canonicalValue as PropertyValues[K] : null,
    state, source: property?.source ?? null, confidence: property?.confidence,
    validAt: property?.validAt ?? null, coverage: property?.coverage ?? null,
  };
}
