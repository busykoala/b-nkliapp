import { describe, expect, it } from "vitest";
import { PANORAMA_MATERIAL_IDS, panoramaMaterialIsSkyPixel, panoramaMaterialIsSnowEligible,
  panoramaMaterialSemanticId, panoramaMaterialUsesCoverageAlpha, panoramaTextureDimensions,
  panoramaMaterialHasCoverage, samplePanoramaMaterial, samplePanoramaLight, panoramaSnowCoverage,
  decodePanoramaMaterial } from "./panorama-material";

describe("panorama material contract", () => {
  it("recovers all eight coverage bits and exact categories from opaque image planes", () => {
    const width = 256, height = 12, canonical = new Uint8ClampedArray(width * height * 4);
    const transport = new Uint8ClampedArray(width * (height * 2 + 1) * 4);
    for (let index = 0; index < transport.length; index += 4) transport[index + 3] = 255;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      canonical.set([x, y, 255 - x, x], index);
      transport.set([x, y, 255 - x, 255], index);
      transport[canonical.length + index] = x;
    }
    transport.set([66, 78, 75, 255, 77, 65, 84, 255, 2, 0, 0, 255], canonical.length * 2);
    const before = transport.slice(), decoded = decodePanoramaMaterial(transport, width, height * 2 + 1);
    expect(decoded).toMatchObject({ width, height, transport: "opaque-planes-v2" });
    expect(decoded.pixels).toEqual(canonical);
    expect(transport).toEqual(before);
    // Categorical labels are never repaired by averaging neighbouring IDs.
    expect([...new Set(Array.from(decoded.pixels).filter((_, i) => i % 4 === 1))]).toEqual([0,1,2,3,4,5,6,7,8,9,10,11]);
  });

  it("keeps mapped paving categorical and permits snow without assuming cleared roads", () => {
    const id = PANORAMA_MATERIAL_IDS.pavedGround;
    expect(id).toBe(10);
    expect(PANORAMA_MATERIAL_IDS.unknownTerrain).toBe(9);
    expect(panoramaMaterialUsesCoverageAlpha(id)).toBe(true);
    expect(panoramaMaterialUsesCoverageAlpha(12)).toBe(false);
    const pixels = new Uint8ClampedArray([100, id, 128, 255, 120, 3, 128, 255]);
    expect(panoramaMaterialHasCoverage(pixels)).toBe(true);
    expect(samplePanoramaMaterial(pixels, 2, 1, .49, .5, true)[1]).toBe(id);
    expect(samplePanoramaMaterial(pixels, 2, 1, .51, .5, true)[1]).toBe(3);
    expect(panoramaMaterialIsSnowEligible(id)).toBe(true);
    const snow = panoramaSnowCoverage(new Uint8ClampedArray([100, id, 128, 255]), 1, 1, true);
    expect(snow[0]).toBeGreaterThan(250);
    expect([...pixels]).toEqual([100, id, 128, 255, 120, 3, 128, 255]);
  });

  it("keeps uncertain road finishes distinct from paving and permits snow", () => {
    const id = PANORAMA_MATERIAL_IDS.surfacedGround;
    expect(id).toBe(11);
    expect(id).not.toBe(PANORAMA_MATERIAL_IDS.pavedGround);
    const pixels = new Uint8ClampedArray([100, id, 128, 255, 100, 4, 128, 255]);
    expect(panoramaMaterialHasCoverage(pixels)).toBe(true);
    expect(panoramaMaterialUsesCoverageAlpha(id)).toBe(true);
    expect(samplePanoramaMaterial(pixels, 2, 1, .49, .5, true)[1]).toBe(id);
    expect(samplePanoramaMaterial(pixels, 2, 1, .51, .5, true)[1]).toBe(4);
    expect(panoramaMaterialIsSnowEligible(id)).toBe(true);
    expect(panoramaSnowCoverage(pixels.slice(0, 4), 1, 1, true)[0]).toBeGreaterThan(250);
  });

  it("retains legacy pixels and refuses malformed or future opaque transport", () => {
    const legacy = new Uint8ClampedArray(3 * 5 * 4);
    expect(decodePanoramaMaterial(legacy, 3, 5).pixels).toBe(legacy);
    const malformed = new Uint8ClampedArray(3 * 4 * 4);
    malformed.set([66,78,75,255,77,65,84,255,2,0,0,255],3*3*4);
    expect(() => decodePanoramaMaterial(malformed, 3, 4)).toThrow("transport");
    malformed[3*3*4+8] = 3;
    expect(() => decodePanoramaMaterial(malformed, 3, 4)).toThrow("transport");
    expect(() => decodePanoramaMaterial(legacy, 4, 5)).toThrow("dimensions");
  });

  it("retains less snow on steep faces, preserves facts, and softens narrow semantic strips", () => {
    const width = 64, height = 16;
    const material = (semantic: number, normal: number) => {
      const values = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < values.length; i += 4) values.set([100, semantic, normal, 255], i);
      return values;
    };
    const flat = panoramaSnowCoverage(material(5, 128), width, height, true);
    const steep = panoramaSnowCoverage(material(5, 255), width, height, true);
    expect(flat[0]).toBeGreaterThan(steep[0] * 4);
    for (const semantic of [0, 1, 2, 8]) {
      const excluded = panoramaSnowCoverage(material(semantic, 128), width, height, true);
      expect(Array.from(excluded).filter((_, index) => index % 4 === 0).every((value) => value === 0)).toBe(true);
    }
    const strips = material(3, 128);
    for (let y = 0; y < height; y++) strips[(y * width + 32) * 4 + 1] = 5;
    const before = strips.slice();
    const coverage = panoramaSnowCoverage(strips, width, height, true);
    expect(strips).toEqual(before);
    expect(coverage[(8 * width + 32) * 4]).toBeLessThan(flat[0] * .6);
    expect(samplePanoramaLight(coverage, width, height, 0, .5)).toBe(samplePanoramaLight(coverage, width, height, 1, .5));
  });
  it("keeps snow connected across settlement ground without covering solid walls or water", () => {
    const width = 64, height = 16, pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      // A coarse settlement polygon is not a surveyed cleared path. The
      // separately projected wall/water classes remain explicit exclusions.
      const semantic = x < 32 ? PANORAMA_MATERIAL_IDS.settlement : PANORAMA_MATERIAL_IDS.unknownTerrain;
      pixels.set([100, semantic, 128, 255], (y * width + x) * 4);
    }
    const before = pixels.slice(), snow = panoramaSnowCoverage(pixels, width, height, true);
    expect(panoramaMaterialIsSnowEligible(PANORAMA_MATERIAL_IDS.settlement)).toBe(true);
    expect(pixels).toEqual(before);
    for (let x = 0; x < width; x++) expect(snow[(8 * width + x) * 4]).toBeGreaterThan(250);
    for (const semantic of [PANORAMA_MATERIAL_IDS.building, PANORAMA_MATERIAL_IDS.water]) {
      for (let y = 0; y < height; y++) for (let x = 0; x < 32; x++) pixels[(y * width + x) * 4 + 1] = semantic;
      const excluded = panoramaSnowCoverage(pixels, width, height, true);
      for (let x = 0; x < 32; x++) expect(excluded[(8 * width + x) * 4]).toBe(0);
    }
  });
  it("fades snow within the shore while keeping water clear and the snowy skyline intact", () => {
    const width = 64, height = 16, pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      pixels.set([100, x < 32 ? PANORAMA_MATERIAL_IDS.water : PANORAMA_MATERIAL_IDS.openGrassland, 128, 255], (y * width + x) * 4);
    }
    const before = pixels.slice(), shore = panoramaSnowCoverage(pixels, width, height, true);
    const at = (x: number) => shore[(8 * width + x) * 4];
    expect(at(31)).toBe(0);
    expect(at(32)).toBeLessThan(at(48) * .15);
    expect(at(32)).toBeLessThan(at(34));
    expect(at(34)).toBeLessThan(at(40));
    expect(at(48)).toBeGreaterThan(250);
    expect(pixels).toEqual(before);
    // The shoreline fade must not invent a broad thawed ring around houses.
    for (let y = 0; y < height; y++) for (let x = 0; x < 32; x++) pixels[(y * width + x) * 4 + 1] = PANORAMA_MATERIAL_IDS.building;
    const wall = panoramaSnowCoverage(pixels, width, height, true);
    expect(wall[(8 * width + 31) * 4]).toBe(0);
    expect(wall[(8 * width + 32) * 4]).toBeGreaterThan(at(48) * .3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      pixels.set(y < 8 ? [0,0,0,0] : [100,4,128,y === 8 ? 51 : 255], (y * width + x) * 4);
    }
    const skyline = panoramaSnowCoverage(pixels, width, height, true);
    expect(skyline[(8 * width + 32) * 4]).toBe(skyline[(15 * width + 32) * 4]);
    expect(skyline[(8 * width + 32) * 4]).toBeGreaterThan(250);
  });
  it("interpolates measured light continuously across the circular boundary", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(samplePanoramaLight(data, 2, 1, 0, .5)).toBe(.5);
    expect(samplePanoramaLight(data, 2, 1, 1, .5)).toBe(.5);
    expect(samplePanoramaLight(data, 2, 1, .25, -2)).toBe(0);
    expect(samplePanoramaLight(data, 2, 1, .75, 3)).toBe(1);
  });
  it("decodes exact categorical IDs without threshold ranges", () => {
    expect(panoramaMaterialSemanticId(5.49)).toBe(PANORAMA_MATERIAL_IDS.rock);
    expect(panoramaMaterialIsSkyPixel([0, 0, 0, 255])).toBe(true);
    expect(panoramaMaterialIsSkyPixel([0, PANORAMA_MATERIAL_IDS.rock, 0, 1])).toBe(false);
    expect(panoramaMaterialIsSkyPixel([0, PANORAMA_MATERIAL_IDS.rock, 0, 0])).toBe(true);
  });

  it("keeps legacy masks compatible while treating v1 alpha as coverage", () => {
    expect(panoramaMaterialUsesCoverageAlpha(PANORAMA_MATERIAL_IDS.building)).toBe(true);
    expect(panoramaMaterialUsesCoverageAlpha(153)).toBe(false);
    expect(panoramaMaterialIsSnowEligible(PANORAMA_MATERIAL_IDS.rock)).toBe(true);
    expect(panoramaMaterialIsSnowEligible(PANORAMA_MATERIAL_IDS.building)).toBe(false);
    expect(panoramaMaterialIsSnowEligible(153)).toBe(true);
  });

  it("bounds power-of-two textures by source, display DPR and GPU limits", () => {
    expect(panoramaTextureDimensions(2048, 512, 390, 1, 4096)).toEqual({ width: 512, height: 128 });
    expect(panoramaTextureDimensions(2048, 512, 900, 2, 4096)).toEqual({ width: 2048, height: 512 });
    expect(panoramaTextureDimensions(8192, 2048, 3000, 2, 4096)).toEqual({ width: 4096, height: 1024 });
  });

  it("filters continuous channels without creating a material between settlement and building", () => {
    const facts = new Uint8Array([51, 7, 102, 255, 153, 8, 204, 255]);
    expect(panoramaMaterialHasCoverage(facts)).toBe(true);
    const sample = samplePanoramaMaterial(facts, 2, 1, .5, .5, true);
    expect(sample[0]).toBeCloseTo(.4);
    expect(sample[1]).toBe(8);
    expect(sample[2]).toBeCloseTo(.6);
    expect(sample[3]).toBe(1);
    expect(samplePanoramaMaterial(facts, 2, 1, -.1, .5, true)).toEqual(samplePanoramaMaterial(facts, 2, 1, .9, .5, true));
  });

  it("preserves the fractional fringe even when the nearest categorical texel is sky", () => {
    const facts = new Uint8Array([204, 3, 153, 255, 0, 0, 0, 0]);
    const [depth, semantic, normal, coverage] = samplePanoramaMaterial(facts, 2, 1, .6, .5, true);
    expect(semantic).toBe(0);
    expect(coverage).toBeCloseTo(.3);
    expect(depth).toBeCloseTo(.8);
    expect(normal).toBeCloseTo(.6);
    expect(panoramaMaterialHasCoverage([0, 0, 0, 255, 100, 153, 128, 255])).toBe(false);
    expect(panoramaMaterialHasCoverage([0, 0, 0, 0, 0, 16, 128, 16, 100, 3, 128, 255])).toBe(true);
  });
});
