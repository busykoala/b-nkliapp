import { describe, expect, it } from "vitest";
import { NIGHT_SKY_CATALOG, horizontalStarPosition, panoramaSkyTop, projectNightSky } from "./night-sky";

describe("night sky projection", () => {
  it("extends the panorama from the generated horizon raster to the zenith", () => {
    expect(panoramaSkyTop(88)).toBe(0);
    expect(panoramaSkyTop(58)).toBe(25);
    expect(panoramaSkyTop(-32)).toBe(100);
  });

  it("keeps Polaris close to geographic north for a Swiss observer", () => {
    const polaris = NIGHT_SKY_CATALOG.find((star) => star.id === "polaris")!;
    const position = horizontalStarPosition(polaris, new Date("2026-09-27T21:00:00Z"), 47.3769, 8.5417);
    expect(Math.min(position.azimuthDegrees, 360 - position.azimuthDegrees)).toBeLessThan(2);
    expect(position.altitudeDegrees).toBeCloseTo(47.4, 0);
  });

  it("projects a dense but bounded field with real guide stars", () => {
    const visible = projectNightSky(new Date("2026-09-27T21:00:00Z"), 47.3769, 8.5417);
    expect(NIGHT_SKY_CATALOG).toHaveLength(720);
    expect(visible.length).toBeGreaterThan(300);
    expect(visible.length).toBeLessThan(400);
    expect(visible.some((star) => star.important)).toBe(true);
    for (const star of visible) {
      expect(star.leftPercent).toBeGreaterThanOrEqual(0);
      expect(star.leftPercent).toBeLessThan(100);
      expect(star.topPercent).toBeGreaterThanOrEqual(0);
      expect(star.topPercent).toBeLessThan(100);
    }
  });
});
