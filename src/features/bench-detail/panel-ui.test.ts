import { describe, expect, it } from "vitest";

import { minuteClock, obstructionChart } from "./panel-ui";

describe("obstructionChart", () => {
  it("does not invent openness from a missing vegetation measurement", () => {
    expect(obstructionChart(20, null)).toEqual({ buildings: 20, plants: null, open: null, unknown: 80, inconsistent: false });
  });

  it("keeps a missing building measurement unknown even when vegetation is zero", () => {
    expect(obstructionChart(null, 0)).toEqual({ buildings: null, plants: 0, open: null, unknown: 100, inconsistent: false });
  });

  it("derives openness only from two complete compatible measurements", () => {
    expect(obstructionChart(20, 30)).toEqual({ buildings: 20, plants: 30, open: 50, unknown: 0, inconsistent: false });
  });

  it("rejects a combined chart when the categories overlap beyond their denominator", () => {
    expect(obstructionChart(80, 30)).toEqual({ buildings: 80, plants: 30, open: null, unknown: null, inconsistent: true });
  });

  it("omits a chart when neither measurement exists", () => {
    expect(obstructionChart(null, null)).toBeNull();
  });
});

describe("minuteClock", () => {
  it("renders the calculation minute without spilling into another day", () => {
    expect(minuteClock(0)).toBe("00:00");
    expect(minuteClock(14 * 60 + 20.9)).toBe("14:20");
    expect(minuteClock(1_500)).toBe("23:59");
  });
});
