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
  pavedGround: 10,
  surfacedGround: 11,
} as const;

export const PANORAMA_MATERIAL_MAX_ID = PANORAMA_MATERIAL_IDS.surfacedGround;

export type DecodedPanoramaMaterial = {
  pixels: Uint8ClampedArray; width: number; height: number;
  transport: "rgba" | "opaque-planes-v2";
};

/** Recover exact facts before filtering. Opaque transport avoids Canvas alpha rounding. */
export function decodePanoramaMaterial(pixels: Uint8ClampedArray, width: number, height: number): DecodedPanoramaMaterial {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || pixels.length !== width * height * 4) throw new Error("Invalid panorama material dimensions");
  const footer = [66, 78, 75, 255, 77, 65, 84, 255, 2, 0, 0, 255];
  const start = (height - 1) * width * 4;
  const tagged = width >= 3 && footer.slice(0, 8).every((value, offset) => pixels[start + offset] === value);
  if (tagged && (!footer.every((value, offset) => pixels[start + offset] === value)
    || height < 3 || height % 2 !== 1)) throw new Error("Unsupported or malformed panorama material transport");
  const opaque = tagged;
  if (!opaque) return { pixels, width, height, transport: "rgba" };
  const rows = (height - 1) / 2, size = width * rows * 4;
  const canonical = pixels.slice(0, size);
  for (let index = 0; index < size; index += 4) canonical[index + 3] = pixels[size + index];
  return { pixels: canonical, width, height: rows, transport: "opaque-planes-v2" };
}

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
      // Settlement denotes a mapped land area. Projected solid walls have
      // their own building ID; this label provides no evidence of snow clearing.
      semanticId === PANORAMA_MATERIAL_IDS.settlement ||
      semanticId === PANORAMA_MATERIAL_IDS.rock ||
      semanticId === PANORAMA_MATERIAL_IDS.snowOrGlacier ||
      semanticId === PANORAMA_MATERIAL_IDS.pavedGround ||
      semanticId === PANORAMA_MATERIAL_IDS.surfacedGround ||
      semanticId === PANORAMA_MATERIAL_IDS.unknownTerrain;
  }
  // Compatibility with already published v0 RGB masks.
  return (semanticId >= 115 && semanticId <= 209) || semanticId >= 240;
}

/** Detect old opaque RGB masks once per decoded asset, never per boundary pixel. */
export function panoramaMaterialHasCoverage(pixels: ArrayLike<number>) {
  let evidence = false;
  for (let i = 0; i < pixels.length; i += 4) {
    // Canvas unpremultiplication can round low categorical values at a
    // translucent edge. Fully covered pixels retain exact channel values.
    if (pixels[i + 3] === 255 && pixels[i + 1] > PANORAMA_MATERIAL_MAX_ID) return false;
    evidence ||= pixels[i + 1] > 0 || pixels[i + 3] < 255;
  }
  return evidence;
}

/** Same wrap-safe continuous sampling as the shader; G always stays categorical. */
export function samplePanoramaMaterial(pixels: ArrayLike<number>, width: number, height: number,
  u: number, v: number, modern: boolean): [number, number, number, number] {
  const x = u * width - .5, y = v * height - .5;
  const left = Math.floor(x), top = Math.floor(y), fx = x - left, fy = y - top;
  const at = (column: number, row: number) => (Math.max(0, Math.min(height - 1, row)) * width
    + ((column % width) + width) % width) * 4;
  const owner = at(Math.floor(u * width), Math.floor(v * height));
  const semantic = pixels[owner + 1];
  if (!modern) return [pixels[owner] / 255, semantic, pixels[owner + 2] / 255, semantic > 0 ? 1 : 0];
  let coverage = 0, depth = 0, normal = 0;
  for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
    const index = at(left + dx, top + dy);
    const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * pixels[index + 3] / 255;
    coverage += weight; depth += pixels[index] / 255 * weight; normal += pixels[index + 2] / 255 * weight;
  }
  return [coverage ? depth / coverage : 0, semantic, coverage ? normal / coverage : 0, coverage];
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

/** Scalar direct-light maps are continuous and circular; semantic IDs are not involved. */
export function samplePanoramaLight(data: Uint8ClampedArray, width: number, height: number, u: number, v: number) {
  const x = u * width - .5, y = v * height - .5, left = Math.floor(x), top = Math.floor(y);
  const blendX = x - left, blendY = y - top;
  const value = (column: number, row: number) => data[(Math.max(0, Math.min(height - 1, row)) * width
    + ((column % width) + width) % width) * 4] / 255;
  return (value(left, top) * (1 - blendX) + value(left + 1, top) * blendX) * (1 - blendY)
    + (value(left, top + 1) * (1 - blendX) + value(left + 1, top + 1) * blendX) * blendY;
}

/** Continuous snow retention, derived from categorical facts without modifying G. */
export function panoramaSnowCoverage(pixels: Uint8ClampedArray, width: number, height: number,
  modern: boolean, altitudeRange = 90) {
  const size = width * height;
  let numerator = new Float32Array(size), denominator = new Float32Array(size), support = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const semantic = pixels[i * 4 + 1], coverage = modern ? pixels[i * 4 + 3] / 255 : +(semantic > 0);
    const forest = modern && semantic === PANORAMA_MATERIAL_IDS.forest;
    const eligible = panoramaMaterialIsSnowEligible(semantic) ? 1 : forest ? .18 : 0;
    // B encodes .5 + signed slope/180. Steep faces retain less snow than
    // level ground; the previous response increased whitening with slope.
    const flatness = Math.max(0, 1 - Math.abs(pixels[i * 4 + 2] / 255 - .5) * 2);
    numerator[i] = eligible * (.12 + .88 * flatness * flatness) * coverage;
    denominator[i] = coverage;
    const water = modern && (semantic === PANORAMA_MATERIAL_IDS.water || semantic === PANORAMA_MATERIAL_IDS.river);
    support[i] = water ? 0 : coverage;
  }
  const blur = (input: Float32Array, radius: number, horizontal: boolean) => {
    const output = new Float32Array(size);
    const length = horizontal ? width : height, lines = horizontal ? height : width;
    const at = (line: number, position: number) => horizontal
      ? line * width + ((position % width) + width) % width
      : Math.max(0, Math.min(height - 1, position)) * width + line;
    for (let line = 0; line < lines; line++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) sum += input[at(line, offset)];
      for (let point = 0; point < length; point++) {
        output[at(line, point)] = sum / (radius * 2 + 1);
        sum += input[at(line, point + radius + 1)] - input[at(line, point - radius)];
      }
    }
    return output;
  };
  // Three small box passes approximate a wet painted edge at a constant
  // angular scale. Normalised coverage avoids dark/empty sky leaking inward.
  const radiusX = Math.max(1, Math.round(width / 360 * .9));
  const radiusY = Math.max(1, Math.round(height / altitudeRange * .9));
  for (let pass = 0; pass < 3; pass++) {
    numerator = blur(blur(numerator, radiusX, true), radiusY, false);
    denominator = blur(blur(denominator, radiusX, true), radiusY, false);
    support = blur(blur(support, radiusX, true), radiusY, false);
  }
  const output = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    const semantic = pixels[i * 4 + 1];
    const land = panoramaMaterialIsSnowEligible(semantic) || modern && semantic === PANORAMA_MATERIAL_IDS.forest;
    // Fade on the snowy side of a shoreline before the categorical
    // exclusion. Clipping a half-strength blurred wash directly to texel IDs
    // reinstates a staircase. Sky has zero coverage, so this does not erode
    // a snowy skyline or invent snow on water. Buildings retain their crisp
    // source edges; eroding snow around every wall would invent thawed moats.
    const continuity = denominator[i] > 0 ? support[i] / denominator[i] : 0;
    const fade = Math.max(0, Math.min(1, (continuity - .5) / .45));
    const edge = fade * fade * (3 - 2 * fade);
    output[i * 4] = land && denominator[i] > 0 ? Math.min(255, Math.max(0, numerator[i] / denominator[i] * edge * 255)) : 0;
    output[i * 4 + 3] = 255;
  }
  return output;
}
