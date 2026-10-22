import { describe, expect, it } from "vitest";
import { benchBearingTurn } from "./bearing";

describe("bench viewing direction", () => {
  it("takes the short route across north", () => {
    expect(benchBearingTurn(350, 10)).toBe("right");
    expect(benchBearingTurn(10, 350)).toBe("left");
    expect(benchBearingTurn(200, 20)).toBe("left");
  });
  it("stays quiet near arrival and without a recorded direction", () => {
    expect(benchBearingTurn(355, 5)).toBeNull();
    expect(benchBearingTurn(45, 45)).toBeNull();
    expect(benchBearingTurn(45, null)).toBeNull();
    expect(benchBearingTurn(45, undefined)).toBeNull();
    expect(benchBearingTurn(45, NaN)).toBeNull();
  });
});
