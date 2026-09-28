import { describe, expect, it } from "vitest";
import { cloudDensity, cloudOpacity, cloudPixels } from "./cloud-field";

describe("continuous painted clouds", () => {
  it("is deterministic and wraps around north at every altitude", () => {
    for (const y of [0, .17, .5, .9, 1]) {
      expect(cloudDensity(0, y)).toBe(cloudDensity(1, y));
      expect(cloudDensity(-.2, y)).toBeCloseTo(cloudDensity(.8, y), 12);
    }
    expect(cloudPixels(64, 24, .4, true)).toEqual(cloudPixels(64, 24, .4, true));
  });
  it("leaves clear skies untouched and occludes stars behind full overcast", () => {
    for (let value = 0; value <= 1; value += .1) {
      expect(cloudOpacity(value, 0)).toBe(0);
      expect(cloudOpacity(value, 1)).toBe(1);
      expect(cloudOpacity(value, .7)).toBeGreaterThanOrEqual(cloudOpacity(value, .3));
    }
  });
  it("uses dark night pigment rather than enlarged luminous white ellipses", () => {
    const pixels = cloudPixels(64, 24, .5, true);
    const alpha = Array.from(pixels).filter((_, index) => index % 4 === 3);
    expect(Math.min(...alpha)).toBe(0);
    expect(Math.max(...alpha)).toBe(255);
    expect(Math.max(...Array.from(pixels).filter((_, index) => index % 4 !== 3))).toBeLessThan(85);
    for (let y = 0; y < 24; y++) expect(pixels.slice(y * 64 * 4, y * 64 * 4 + 4))
      .toEqual(pixels.slice((y * 64 + 63) * 4, (y * 64 + 64) * 4));
  });
});
