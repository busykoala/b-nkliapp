import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cloudDensity, cloudOpacity, cloudPixels, cloudTwilightStrength } from "./cloud-field";

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
  it("keeps larger groups close to the requested cloud coverage", () => {
    for (const cover of [.25, .55, .9]) {
      const pixels = cloudPixels(128, 48, cover, false);
      let covered = 0;
      for (let i = 3; i < pixels.length; i += 4) covered += pixels[i] / 255;
      expect(covered / (pixels.length / 4)).toBeCloseTo(cover, 1);
    }
  });
  it("increases cloud cover without moving the groups or changing coverage at night", () => {
    const width = 128, height = 48;
    let previous = cloudPixels(width, height, 0, false);
    for (const cover of [.08, .18, .22, .25, .55, .65, .9, .97, 1]) {
      const day = cloudPixels(width, height, cover, false);
      const night = cloudPixels(width, height, cover, true);
      let area = 0;
      for (let i = 3; i < day.length; i += 4) {
        expect(day[i]).toBeGreaterThanOrEqual(previous[i]);
        expect(night[i]).toBe(day[i]);
        area += day[i] / 255;
      }
      expect(Math.abs(area / (width * height) - cover)).toBeLessThan(.03);
      previous = day;
    }
  });
  it("keeps painted brush edges circular and cloud cover calibrated", () => {
    const width = 128, height = 48;
    const pigment = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      pigment[index] = 128 + 105 * Math.sin(x / 9 + y / 7);
      pigment[index + 3] = 255;
    }
    const painted = cloudPixels(width, height, .55, false, pigment);
    expect(painted).not.toEqual(cloudPixels(width, height, .55, false));
    let covered = 0;
    for (let i = 3; i < painted.length; i += 4) covered += painted[i] / 255;
    expect(covered / (width * height)).toBeCloseTo(.55, 1);
    for (let y = 0; y < height; y++) expect(painted.slice(y * width * 4, y * width * 4 + 4))
      .toEqual(painted.slice((y * width + width - 1) * 4, (y * width + width) * 4));
    const overcast = cloudPixels(width, height, 1, true, pigment);
    for (let i = 3; i < overcast.length; i += 4) expect(overcast[i]).toBe(255);
  });
  it("keeps high-contrast pigment from making overcast interiors speckled", () => {
    const width = 128, height = 48;
    const pigment = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      pigment[index] = (x + y) % 2 ? 255 : 0;
      pigment[index + 3] = 255;
    }
    for (const night of [false, true]) {
      const pixels = cloudPixels(width, height, 1, night, pigment);
      let largestToneStep = 0;
      for (let y = 0; y < height; y++) for (let x = 1; x < width - 1; x++) {
        const index = (y * width + x) * 4;
        largestToneStep = Math.max(largestToneStep, Math.abs(pixels[index] - pixels[index - 4]));
        expect(pixels[index + 3]).toBe(255);
      }
      expect(largestToneStep).toBeLessThan(night ? 5 : 14);
    }
  });
  it("changes only twilight color, preserving weather coverage and the north boundary", () => {
    const width = 64, height = 24;
    const pigment = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pigment.length; i += 4) pigment[i] = (i * 17) % 256;
    for (const cover of [0, .18, .55, .9, 1]) for (const sunAltitude of [-6, -4, 0, 2, 7, 8, 35]) {
      const neutral = cloudPixels(width, height, cover, false, pigment);
      const graded = cloudPixels(width, height, cover, false, pigment, sunAltitude);
      for (let i = 3; i < graded.length; i += 4) expect(graded[i]).toBe(neutral[i]);
      for (let y = 0; y < height; y++) expect(graded.slice(y * width * 4, y * width * 4 + 4))
        .toEqual(graded.slice((y * width + width - 1) * 4, (y * width + width) * 4));
      if (cover === 0 || cover === 1 || sunAltitude <= -6 || sunAltitude >= 8) expect(graded).toEqual(neutral);
    }
    const dawn = cloudPixels(width, height, .22, false, pigment, 0);
    const day = cloudPixels(width, height, .22, false, pigment);
    expect(dawn).not.toEqual(day);
    // Select an opaque pixel: reduced glare still leaves a luminous cloud.
    const i = dawn.findIndex((value, index) => index % 4 === 3 && value === 255) - 3;
    expect(i).toBeGreaterThanOrEqual(0);
    expect(dawn[i]).toBeGreaterThan(140);
    expect(dawn[i]).toBeLessThan(day[i]);
    expect(dawn[i]).toBeGreaterThan(dawn[i + 2]);
  });
  it("fades the twilight wash continuously and leaves night and neutral controls unchanged", () => {
    for (const boundary of [-6, 0, 8]) {
      const left = cloudTwilightStrength(.22, false, boundary - .0001);
      const right = cloudTwilightStrength(.22, false, boundary + .0001);
      expect(Math.abs(left - right)).toBeLessThan(.00001);
    }
    const night = cloudPixels(64, 24, .55, true);
    const day = cloudPixels(64, 24, .55, false);
    // Frozen composition digests protect both neutral palettes. The preceding
    // layout is retained with the optical study's exact control source.
    expect(createHash("sha256").update(day).digest("hex"))
      .toBe("97f614fa699fa0d1054dce685efc00e599921bd38d35ff1d2b6dd0a4d6602e6f");
    expect(createHash("sha256").update(night).digest("hex"))
      .toBe("fdd98cabfad5ee871b3f75e1394b6f9503c0c3ed495711d45eccce2306005888");
    for (const altitude of [-20, -6, -2, 0, 8, 80, NaN, Infinity, -Infinity]) {
      expect(cloudPixels(64, 24, .55, true, undefined, altitude)).toEqual(night);
      if (!Number.isFinite(altitude) || altitude <= -6 || altitude >= 8)
        expect(cloudPixels(64, 24, .55, false, undefined, altitude)).toEqual(day);
    }
    expect(cloudTwilightStrength(1, false, 0)).toBe(0);
    expect(cloudTwilightStrength(.22, false, 0)).toBeGreaterThan(.99);
    expect(cloudTwilightStrength(.97, false, 0)).toBeLessThan(.12);
    expect(cloudTwilightStrength(.22, false, 0)).toBeGreaterThan(cloudTwilightStrength(.22, false, 4));
  });
});
