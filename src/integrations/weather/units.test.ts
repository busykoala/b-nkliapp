import { describe, expect, it } from "vitest";
import { iconCloudPercentToFraction } from "./units";

describe("ICON cloud-cover units", () => {
  it.each([
    [0, 0],
    [.5, .005],
    [1, .01],
    [25, .25],
    [100, 1],
  ])("converts %s percent to the application fraction %s", (input, expected) => {
    expect(iconCloudPercentToFraction(input)).toBe(expected);
  });

  it("keeps invalid values unknown and clamps malformed percentages", () => {
    expect(iconCloudPercentToFraction(null)).toBeNull();
    expect(iconCloudPercentToFraction(Number.NaN)).toBeNull();
    expect(iconCloudPercentToFraction(-10)).toBe(0);
    expect(iconCloudPercentToFraction(120)).toBe(1);
  });
});
