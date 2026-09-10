export type BenchFact = {
  id: string;
  title: string | null;
  place: string | null;
  metric: number | null;
};

export type MunicipalitySummary = {
  id: string;
  name: string;
  canton: string | null;
  benchCount: number;
  averageElevation: number | null;
  sunnyShare: number | null;
  scenicShare: number | null;
  watersideShare: number | null;
  forestShare: number | null;
};

export type CorrelationPoint = {
  id: string;
  title: string | null;
  winterSunMinutes: number;
  viewScore: number;
};

export type StatisticsDashboard = {
  totalBenches: number;
  enrichedBenches: number;
  locatedBenches: number;
  municipalityCount: number;
  benchOfTheDay: BenchFact | null;
  records: Array<{ key: StatisticsRecordKey; fact: BenchFact }>;
  municipalities: MunicipalitySummary[];
  correlation: {
    coefficient: number | null;
    sampleSize: number;
    points: CorrelationPoint[];
  };
};

export type MunicipalityPortrait = MunicipalitySummary & {
  sunnyKnown: number;
  scenicKnown: number;
  watersideKnown: number;
  forestKnown: number;
  wheelchairShare: number | null;
  wheelchairKnown: number;
  metadataKnownShare: number;
  audit: {
    missingBackrest: number;
    missingSeats: number;
    missingDirection: number;
    unknownFreshness: number;
    staleMapping: number;
    unverified: number;
  };
  records: {
    highest: BenchFact | null;
    sunniestWinter: BenchFact | null;
    bestView: BenchFact | null;
  };
  personality: MunicipalityPersonality;
};

export type MunicipalityPersonality = "sunny" | "scenic" | "waterside" | "forest" | "collector" | "mysterious";
export type RouletteMode = "beautiful" | "sunny" | "wild";
export type StatisticsRecordKey = "highest" | "lowest" | "sunniestWinter" | "shadiestWinter" | "sunniestSummer" | "shadiestSummer"
  | "bestView" | "closestWater" | "furthestWater" | "densestCanopy" | "clearestCanopy" | "closestPath" | "furthestPath"
  | "mostSeats" | "mostBuildings" | "fewestBuildings" | "mostBlockedView" | "wildest" | "remotest";

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function pearsonCorrelation(values: { count: number; sumX: number; sumY: number; sumXX: number; sumYY: number; sumXY: number }): number | null {
  const { count, sumX, sumY, sumXX, sumYY, sumXY } = values;
  if (count < 3) return null;
  const varianceX = count * sumXX - sumX * sumX;
  const varianceY = count * sumYY - sumY * sumY;
  if (varianceX <= 0 || varianceY <= 0) return null;
  return Math.max(-1, Math.min(1, (count * sumXY - sumX * sumY) / Math.sqrt(varianceX * varianceY)));
}

export function municipalityPersonality(municipality: Pick<MunicipalitySummary, "benchCount" | "sunnyShare" | "scenicShare" | "watersideShare" | "forestShare"> & { metadataKnownShare: number }): MunicipalityPersonality {
  const candidates: Array<[MunicipalityPersonality, number]> = [
    ["sunny", municipality.sunnyShare ?? -1],
    ["scenic", municipality.scenicShare ?? -1],
    ["waterside", municipality.watersideShare ?? -1],
    ["forest", municipality.forestShare ?? -1],
  ];
  const [best, score] = candidates.sort((a, b) => b[1] - a[1])[0];
  if (score >= .5) return best;
  if (municipality.metadataKnownShare < .35) return "mysterious";
  return municipality.benchCount >= 100 ? "collector" : "mysterious";
}

export function dateSeed(date: string): number {
  let value = 2166136261;
  for (const character of date) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export const statisticsRecordKeys: StatisticsRecordKey[] = ["highest", "lowest", "sunniestWinter", "shadiestWinter", "sunniestSummer", "shadiestSummer",
  "bestView", "closestWater", "furthestWater", "densestCanopy", "clearestCanopy", "closestPath", "furthestPath", "mostSeats", "mostBuildings",
  "fewestBuildings", "mostBlockedView", "wildest", "remotest"];

export function dailyRecordKeys(date: string, count = 4): StatisticsRecordKey[] {
  const keys = [...statisticsRecordKeys];
  let state = dateSeed(date) || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  for (let index = keys.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [keys[index], keys[other]] = [keys[other], keys[index]];
  }
  return keys.slice(0, Math.max(0, Math.min(count, keys.length)));
}
