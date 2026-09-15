import { describe, expect, it } from "vitest";
import { clampPanoramaVertical, moonShadowPath, panoramaBenchShadow, panoramaPollDelay, panoramaShadowContrast, panoramaTrackOffset, panoramaWrappedPositions } from "./bench-panorama";

describe("360 degree panorama track", () => {
  it("checks a cold painting promptly, then backs off without ignoring error retries", () => {
    expect(panoramaPollDelay(1, 1_000)).toBe(1_000);
    expect(panoramaPollDelay(20, 1_000)).toBe(1_000);
    expect(panoramaPollDelay(21, 1_000)).toBe(5_000);
    expect(panoramaPollDelay(1, 30_000)).toBe(30_000);
  });

  it("centres north in the middle copy", () => {
    expect(panoramaTrackOffset(600, 500, 0)).toBe(-2420);
  });

  it("aligns repeated image edges to whole CSS pixels", () => {
    expect(Number.isInteger(panoramaTrackOffset(388, 323.328125, 359.67))).toBe(true);
  });

  it("scales the circular texture without changing equivalent-heading wrap", () => {
    expect(panoramaTrackOffset(600, 500, 0, 2)).toBe(-5140);
    expect(panoramaTrackOffset(600, 500, 360, 2)).toBe(panoramaTrackOffset(600, 500, 0, 2));
  });

  it("wraps equivalent headings to the identical crop", () => {
    expect(panoramaTrackOffset(600, 500, -10)).toBe(panoramaTrackOffset(600, 500, 350));
    expect(panoramaTrackOffset(600, 500, 720)).toBe(panoramaTrackOffset(600, 500, 0));
  });

  it("duplicates scene objects at the circular edge so they are never clipped", () => {
    expect(panoramaWrappedPositions(0)).toEqual([0, 100]);
    const [primary, wrapped] = panoramaWrappedPositions(359);
    expect(primary).toBeCloseTo(359 / 3.6);
    expect(wrapped).toBeCloseTo(359 / 3.6 + 100);
  });

  it("limits vertical map-style movement to the overscan", () => {
    expect(clampPanoramaVertical(500, 200)).toBeCloseTo(90);
    expect(clampPanoramaVertical(500, -200)).toBeCloseTo(-90);
    expect(clampPanoramaVertical(500, 12)).toBe(12);
  });
});

describe("panorama light", () => {
  it("builds a valid closed moon shadow from two absolute arcs", () => {
    expect(moonShadowPath(.25)).toBe("M 24 6 A 18 18 0 0 0 24 42 A 5.5 18 0 0 0 24 6 Z");
    expect(moonShadowPath(.75)).toBe("M 24 6 A 18 18 0 0 1 24 42 A 5.5 18 0 0 1 24 6 Z");
  });

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
