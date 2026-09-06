import { describe, expect, it } from "vitest";
import { blendedViewEstimate, directionalOpenness, lightTrend, scoreViewComponents, type ViewEvidence } from "./model";

describe("community environment evidence", () => {
  it("does not publish light trends before three distinct people contributed", () => {
    expect(lightTrend([
      { userId: 1, choice: "sun", observedAt: "2026-09-05T10:00:00Z" },
      { userId: 1, choice: "shade", observedAt: "2026-09-05T11:00:00Z" },
      { userId: 2, choice: "sun", observedAt: "2026-09-05T10:00:00Z" },
    ])).toBeNull();
  });

  it("counts each person's newest comparable light observation once", () => {
    const result = lightTrend([
      { userId: 1, choice: "sun", observedAt: "2026-09-05T10:00:00Z" },
      { userId: 1, choice: "shade", observedAt: "2026-09-05T11:00:00Z" },
      { userId: 2, choice: "shade", observedAt: "2026-09-05T10:00:00Z" },
      { userId: 3, choice: "mixed", observedAt: "2026-09-05T10:00:00Z" },
    ]);
    expect(result?.contributors).toBe(3);
    expect(result?.choice).toBe("shade");
  });

  it("lets corrections gently adjust rather than replace objective values", () => {
    const correction = (userId: number): ViewEvidence => ({
      userId, kind: "correction", observedAt: `2026-09-0${userId}T10:00:00Z`,
      values: { openness: "enclosed", sky: "closed", relief: "flat", water: "none", horizon: "trees", naturalness: "natural", disturbance: "quiet" },
    });
    const result = blendedViewEstimate(
      [correction(1), correction(2), correction(3)],
      { openness: .9, sky: .9, relief: .9, water: .9, naturalness: .2, remoteness: .2 },
      { open: .8, trees: .1, buildings: .1 },
    );
    expect(result?.contributors).toBe(3);
    expect(result?.components.relief).toBeGreaterThan(.65);
    expect(result?.components.sky).toBeGreaterThan(.65);
    expect(result?.components.naturalness).toBeGreaterThan(.4);
    expect(result?.horizon.open).toBeGreaterThan(result?.horizon.trees ?? 1);
  });

  it("keeps directional openness separate from sky openness", () => {
    const obstructions = Array<string>(72).fill("terrain");
    obstructions[0] = "building";
    expect(directionalOpenness(obstructions, 0)).toBeLessThan(1);
    expect(scoreViewComponents({ sky: .8, relief: .6, water: .4, naturalness: .7, remoteness: .7 })).toBeCloseTo(66.5);
  });
});
