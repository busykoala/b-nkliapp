import { describe, expect, it } from "vitest";
import { dailyRecordKeys, dateSeed, linearTrend, municipalityPersonality, pearsonCorrelation, ratio, statisticsRecordKeys } from "./model";

describe("Bänklilogie statistics", () => {
  it("keeps missing denominators unknown instead of turning them into zero", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 4)).toBe(.75);
  });

  it("calculates and bounds Pearson correlations", () => {
    expect(pearsonCorrelation({ count: 3, sumX: 6, sumY: 12, sumXX: 14, sumYY: 56, sumXY: 28 })).toBeCloseTo(1);
    expect(pearsonCorrelation({ count: 2, sumX: 3, sumY: 4, sumXX: 5, sumYY: 10, sumXY: 7 })).toBeNull();
    expect(pearsonCorrelation({ count: 3, sumX: 3, sumY: 6, sumXX: 3, sumYY: 14, sumXY: 6 })).toBeNull();
  });

  it("calculates an ordinary least-squares trend without inventing one for a flat input", () => {
    expect(linearTrend({ count: 3, sumX: 6, sumY: 12, sumXX: 14, sumXY: 28 })).toEqual({ slope: 2, intercept: 0 });
    expect(linearTrend({ count: 3, sumX: 3, sumY: 6, sumXX: 3, sumXY: 6 })).toBeNull();
  });

  it("assigns the strongest factual municipality personality", () => {
    expect(municipalityPersonality({ benchCount: 20, sunnyShare: .72, scenicShare: .3, watersideShare: .1, forestShare: .2, metadataKnownShare: .8 })).toBe("sunny");
    expect(municipalityPersonality({ benchCount: 120, sunnyShare: .2, scenicShare: .3, watersideShare: .1, forestShare: .2, metadataKnownShare: .8 })).toBe("collector");
    expect(municipalityPersonality({ benchCount: 20, sunnyShare: null, scenicShare: null, watersideShare: null, forestShare: null, metadataKnownShare: .2 })).toBe("mysterious");
  });

  it("selects the same daily candidate for the same Swiss date", () => {
    expect(dateSeed("2026-09-10")).toBe(dateSeed("2026-09-10"));
    expect(dateSeed("2026-09-10")).not.toBe(dateSeed("2026-09-11"));
  });

  it("rotates a small, unique selection from the larger record catalogue", () => {
    const today = dailyRecordKeys("2026-09-10");
    expect(statisticsRecordKeys.length).toBeGreaterThan(15);
    expect(today).toHaveLength(4);
    expect(new Set(today).size).toBe(4);
    expect(dailyRecordKeys("2026-09-10")).toEqual(today);
    expect(dailyRecordKeys("2026-09-11")).not.toEqual(today);
  });
});
