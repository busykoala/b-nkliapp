import { describe, expect, it } from "vitest";
import { clampPanoramaVertical, panoramaTrackOffset } from "./bench-panorama";

describe("360 degree panorama track", () => {
  it("centres north in the middle copy", () => {
    expect(panoramaTrackOffset(600, 500, 0)).toBe(-2020);
  });

  it("aligns repeated image edges to whole CSS pixels", () => {
    expect(Number.isInteger(panoramaTrackOffset(388, 323.328125, 359.67))).toBe(true);
  });

  it("wraps equivalent headings to the identical crop", () => {
    expect(panoramaTrackOffset(600, 500, -10)).toBe(panoramaTrackOffset(600, 500, 350));
    expect(panoramaTrackOffset(600, 500, 720)).toBe(panoramaTrackOffset(600, 500, 0));
  });

  it("limits vertical map-style movement to the overscan", () => {
    expect(clampPanoramaVertical(500, 200)).toBeCloseTo(40);
    expect(clampPanoramaVertical(500, -200)).toBeCloseTo(-40);
    expect(clampPanoramaVertical(500, 12)).toBe(12);
  });
});
