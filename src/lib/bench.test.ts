import { describe, expect, it } from "vitest";
import { normalizeBoolean, parseDirection, scoreView } from "./bench";

describe("OSM normalization", () => {
  it("normalizes directions", () => {
    expect(parseDirection("NW")).toBe(315);
    expect(parseDirection("-45°")).toBe(315);
    expect(parseDirection("both")).toBeNull();
  });
  it("normalizes OSM booleans", () => {
    expect(normalizeBoolean("yes")).toBe(true);
    expect(normalizeBoolean("no")).toBe(false);
    expect(normalizeBoolean("unknown")).toBeNull();
  });
});

describe("view score", () => {
  it("uses the versioned component weights", () => {
    expect(scoreView({ openness: 1, relief: 0, water: 0, naturalness: 0, remoteness: 0 })).toBe(35);
    expect(scoreView({ openness: 1, relief: 1, water: 1, naturalness: 1, remoteness: 1 })).toBe(100);
  });
  it("clamps inputs", () => expect(scoreView({ openness: 2, relief: -1, water: 0, naturalness: 0, remoteness: 0 })).toBe(35));
});
