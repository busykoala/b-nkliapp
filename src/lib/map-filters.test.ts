import { describe, expect, it } from "vitest";
import { activeMapFilterCount, matchesLightFilter } from "./map-filters";

describe("map filters", () => {
  it("counts shade as an active filter", () => {
    expect(activeMapFilterCount({ sunnyNow: false })).toBe(1);
    expect(activeMapFilterCount({ sunnyNow: undefined })).toBe(0);
  });

  it("counts only editable bench choices", () => {
    expect(activeMapFilterCount({ backrest: true, minSeats: 4, material: "wood", minCommunityRating: 4 })).toBe(4);
  });

  it("keeps sun, shade and unknown light distinct", () => {
    expect(matchesLightFilter(true, true)).toBe(true);
    expect(matchesLightFilter(false, false)).toBe(true);
    expect(matchesLightFilter(null, false)).toBe(false);
    expect(matchesLightFilter(false, true)).toBe(false);
  });
});
