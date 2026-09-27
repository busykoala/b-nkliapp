import { describe, expect, it } from "vitest";
import { PANORAMA_MATERIAL_IDS, panoramaMaterialIsSkyPixel, panoramaMaterialIsSnowEligible,
  panoramaMaterialSemanticId, panoramaMaterialUsesCoverageAlpha, panoramaTextureDimensions } from "./panorama-material";

describe("panorama material contract", () => {
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
});
