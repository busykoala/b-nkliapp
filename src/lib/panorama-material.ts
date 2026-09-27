/** Browser-side counterpart of worker/benchly/panorama/material.py. */
export const PANORAMA_MATERIAL_IDS = {
  sky: 0,
  water: 1,
  river: 2,
  forest: 3,
  openGrassland: 4,
  rock: 5,
  snowOrGlacier: 6,
  settlement: 7,
  building: 8,
  unknownTerrain: 9,
} as const;

export const PANORAMA_MATERIAL_MAX_ID = PANORAMA_MATERIAL_IDS.unknownTerrain;

export function panoramaMaterialSemanticId(channel: number) {
  return Math.max(0, Math.min(255, Math.round(channel)));
}

export function panoramaMaterialUsesCoverageAlpha(semanticId: number) {
  return semanticId >= PANORAMA_MATERIAL_IDS.water && semanticId <= PANORAMA_MATERIAL_MAX_ID;
}

export function panoramaMaterialIsSkyPixel(pixel: ArrayLike<number>) {
  const semanticId = panoramaMaterialSemanticId(pixel[1] ?? 0);
  return semanticId === PANORAMA_MATERIAL_IDS.sky ||
    (panoramaMaterialUsesCoverageAlpha(semanticId) && (pixel[3] ?? 255) === 0);
}

export function panoramaMaterialIsSnowEligible(semanticId: number) {
  if (panoramaMaterialUsesCoverageAlpha(semanticId)) {
    return semanticId === PANORAMA_MATERIAL_IDS.openGrassland ||
      semanticId === PANORAMA_MATERIAL_IDS.rock ||
      semanticId === PANORAMA_MATERIAL_IDS.snowOrGlacier ||
      semanticId === PANORAMA_MATERIAL_IDS.unknownTerrain;
  }
  // Compatibility with already published v0 RGB masks.
  return (semanticId >= 115 && semanticId <= 209) || semanticId >= 240;
}

function floorPowerOfTwo(value: number) {
  return 2 ** Math.floor(Math.log2(Math.max(1, value)));
}

function ceilPowerOfTwo(value: number) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

export function panoramaTextureDimensions(sourceWidth: number, sourceHeight: number,
  displayWidth: number, devicePixelRatio: number, maximumTextureSize: number) {
  const sourceLimit = floorPowerOfTwo(Math.min(sourceWidth, maximumTextureSize));
  const requested = ceilPowerOfTwo(Math.max(1, displayWidth) * Math.max(1, devicePixelRatio));
  const width = Math.max(1, Math.min(sourceLimit, requested));
  const sourceRatio = sourceHeight / Math.max(1, sourceWidth);
  const height = Math.max(1, floorPowerOfTwo(Math.min(maximumTextureSize, width * sourceRatio)));
  return { width, height };
}
