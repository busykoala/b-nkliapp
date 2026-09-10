export type AttributeKnowledge = { attribute: string; value: unknown; confidence: "unknown" | "low" | "medium" | "high"; conflicting: boolean; evidenceCount: number; sourceTypes: string[]; latestAt: string | null; resolvedAt?: string };
export type BenchKnowledge = {
  attributes: AttributeKnowledge[];
  geography: { municipalityName: string | null; municipalityId: string | null; cantonName: string | null; districtName: string | null; localityName: string | null; confidence: string; sourceVersion: string } | null;
  amenities: Array<{ category: string; distanceMeters: number | null; sourceId: string | null; count100m: number | null; count250m: number | null; count500m: number | null }>;
  approach: { lengthMeters: number | null; maximumSlopePercent: number | null; averageSlopePercent: number | null; elevationGainMeters: number | null; steps: boolean | null; surface: string | null; smoothness: string | null; widthMeters: number | null; stepFreePossible: boolean | null; confidence: string } | null;
  noise: Array<{ mode: "road" | "rail"; period: "day" | "night"; value: number | null; unit: string; datasetVersion: string }>;
  completeness: Array<{ category: string; known: number; total: number; uncertain: number; missing: string[] }>;
  question: VerificationQuestion | null;
};
export const verificationQuestions = [
  { attribute: "backrest", value: 1, ease: 1 },
  { attribute: "armrest", value: .8, ease: 1 },
  { attribute: "covered", value: .8, ease: 1 },
  { attribute: "approach_steps", value: 1, ease: .8 },
] as const;
export type VerificationAttribute = typeof verificationQuestions[number]["attribute"];
export type VerificationQuestion = { attribute: VerificationAttribute; reason: "conflicting" | "missing" | "stale" };

export function chooseVerificationQuestion(attributes: AttributeKnowledge[], answered: string[], now = Date.now()): VerificationQuestion | null {
  return verificationQuestions.filter((question) => !answered.includes(question.attribute)).map((question) => {
    const state = attributes.find((item) => item.attribute === question.attribute);
    const days = state?.latestAt ? Math.max(0, (now - Date.parse(state.latestAt)) / 86_400_000) : 730;
    const age = Number.isFinite(days) ? days : 730;
    const unknown = !state || state.value === null || state.confidence === "unknown";
    const uncertainty = unknown || state?.conflicting ? 1 : state?.confidence === "low" ? .8 : .2;
    const staleness = Math.min(2, (state?.conflicting ? 1 : .5) + age / 365);
    const usefulness = state?.conflicting ? 2 : unknown ? 1.2 : 1;
    const priority = question.value * uncertainty * staleness * usefulness * question.ease;
    return { question, priority, reason: state?.conflicting ? "conflicting" as const : unknown ? "missing" as const : "stale" as const };
  }).filter((item) => item.priority >= .3).sort((a, b) => b.priority - a.priority)
    .map(({ question, reason }) => ({ attribute: question.attribute, reason }))[0] ?? null;
}
