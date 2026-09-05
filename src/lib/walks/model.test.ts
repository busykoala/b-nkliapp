import { describe, expect, it } from "vitest";
import { individualBenchName, landscapeScore, verifiedExtras, walkCopy, type RouteEvidence, type WalkBench } from "./model";
const bench: WalkBench = { id: "a", name: "Seeblick", label: "Seeblick", waterfront: true, latitude: 46.688, longitude: 7.689, quality: .8 };
describe("Bänkli-centred outing copy", () => {
  it("keeps actual names and counts optional discoveries separately", () => {
    expect(walkCopy([bench], "loop", 7)).toEqual({ title: "Eine Runde zum Bänkli «Seeblick»", pause: "Mit dem Bänkli «Seeblick» zum Innehalten", discover: "Und unterwegs noch 7 weitere Bänkli zum Entdecken." });
  });
  it("only describes water when supported, and hides zero discoveries", () => {
    expect(walkCopy([{ ...bench, name: "Sitzbank" }], "loop", 0)).toMatchObject({ title: "Eine Runde zum Uferbänkli", discover: null });
    expect(walkCopy([{ ...bench, name: null, waterfront: false }], "one-way", 1)).toMatchObject({ title: "Ein Spaziergang zum Bänkli", pause: "Mit einem Bänkli zum Innehalten", discover: "Und unterwegs noch ein weiteres Bänkli zum Entdecken." });
  });
  it("deduplicates repeated legs and removes planned stops", () => {
    const extra = { ...bench, id: "b" };
    expect(verifiedExtras([bench, extra, extra], [bench])).toEqual([extra]);
    expect(walkCopy([bench, extra, { ...bench, id: "c" }], "loop", 2).pause).toBe("Mit 3 Bänkli zum Innehalten");
    expect(individualBenchName(" Sitzbank ")).toBeNull();
    expect(individualBenchName("  Rosmaries Bänkli  ")).toBe("  Rosmaries Bänkli  ");
  });
  it("does not reward missing evidence", () => {
    const evidence: RouteEvidence = { quiet: null, nature: null, water: null, view: null, light: null, coverage: 0, lightCoverage: 0, updatedAt: null, reasons: [], warnings: [] };
    expect(landscapeScore(evidence, { ...bench, quality: null }, "any")).toBe(0);
    expect(landscapeScore({ ...evidence, quiet: 1, nature: 1, water: 1, view: 1, light: 1 }, { ...bench, quality: 1 }, "sun")).toBeCloseTo(1);
  });
});
