import { describe, expect, it } from "vitest";
import { clampPanoramaVertical, moonLightPath, panoramaBenchShadow, panoramaCelestialTop, panoramaMaterialIsSky, panoramaPollDelay, panoramaShadowContrast, panoramaTrackOffset, panoramaWrappedPositions } from "./bench-panorama";

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

  it("lets the expanded view reach the zenith while retaining lower-scene overscan", () => {
    expect(clampPanoramaVertical(500, 400)).toBeCloseTo(316.6667);
    expect(clampPanoramaVertical(500, -200)).toBeCloseTo(-90);
    expect(clampPanoramaVertical(500, 12)).toBe(12);
  });
});

describe("panorama light", () => {
  it("projects celestial bodies like the geographic raster and hides material occluders", () => {
    expect(panoramaCelestialTop(88)).toBe(0);
    expect(panoramaCelestialTop(58)).toBe(25);
    expect(panoramaCelestialTop(-32)).toBe(100);
    expect(panoramaMaterialIsSky(new Uint8ClampedArray([0, 0, 0, 255]))).toBe(true);
    expect(panoramaMaterialIsSky(new Uint8ClampedArray([44, 68, 122, 255]))).toBe(false);
  });
  it("paints new, quarter, full and waning moon illumination on the proper side", () => {
    const newMoon = moonLightPath(0);
    const waxingQuarter = moonLightPath(.25);
    const fullMoon = moonLightPath(.5);
    const waningQuarter = moonLightPath(.75);
    expect(newMoon).toMatch(/^M .* Z$/);
    expect(newMoon).not.toBe(fullMoon);
    expect(waxingQuarter).not.toBe(waningQuarter);
    expect(waxingQuarter).toContain("L 42.00 24.00");
    expect(waningQuarter).toContain("L 6.00 24.00");
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
