import { describe, expect, it } from "vitest";
import { clampPanoramaVertical, panoramaBenchShadow, panoramaShadowContrast, panoramaTrackOffset } from "./bench-panorama";

describe("360 degree panorama track", () => {
  it("centres north in the middle copy", () => {
    expect(panoramaTrackOffset(600, 500, 0)).toBe(-2420);
  });

  it("aligns repeated image edges to whole CSS pixels", () => {
    expect(Number.isInteger(panoramaTrackOffset(388, 323.328125, 359.67))).toBe(true);
  });

  it("wraps equivalent headings to the identical crop", () => {
    expect(panoramaTrackOffset(600, 500, -10)).toBe(panoramaTrackOffset(600, 500, 350));
    expect(panoramaTrackOffset(600, 500, 720)).toBe(panoramaTrackOffset(600, 500, 0));
  });

  it("limits vertical map-style movement to the overscan", () => {
    expect(clampPanoramaVertical(500, 200)).toBeCloseTo(90);
    expect(clampPanoramaVertical(500, -200)).toBeCloseTo(-90);
    expect(clampPanoramaVertical(500, 12)).toBe(12);
  });
});

describe("panorama light", () => {
  it("projects a longer bench shadow away from a low sun", () => {
    const low = panoramaBenchShadow(90, 6, 90);
    const high = panoramaBenchShadow(90, 60, 90);
    expect(low.turnDegrees).toBe(-180);
    expect(low.lengthPercent).toBeGreaterThan(high.lengthPercent);
  });

  it("softens directional shadow contrast as cloud cover closes", () => {
    expect(panoramaShadowContrast(.2)).toBe(1);
    expect(panoramaShadowContrast(.5)).toBe(.62);
    expect(panoramaShadowContrast(.72)).toBe(.28);
    expect(panoramaShadowContrast(.9)).toBe(.08);
  });
});
