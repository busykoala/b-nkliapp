/** Periodic, deterministic pigment density in angular sky coordinates. */
const smooth = (value: number) => value * value * (3 - 2 * value);
const mix = (a: number, b: number, value: number) => a + (b - a) * value;

function random(x: number, y: number, period: number) {
  let value = Math.imul(((x % period) + period) % period + 17, 374761393) ^ Math.imul(y + 71, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}

function noise(x: number, y: number, period: number) {
  const left = Math.floor(x), top = Math.floor(y);
  const fx = smooth(x - left), fy = smooth(y - top);
  return mix(mix(random(left, top, period), random(left + 1, top, period), fx),
    mix(random(left, top + 1, period), random(left + 1, top + 1, period), fx), fy);
}

export function cloudDensity(azimuth: number, height: number) {
  const x = ((azimuth % 1) + 1) % 1;
  const warp = noise(x * 8, height * 5, 8) - .5;
  const drift = (noise(x * 4, height * 3, 4) - .5) * .55;
  // Shorter vertical groups leave intervals between cloud banks instead of
  // one pale mass filling a narrow viewport. Unequal interiors and drifting
  // edges keep the groups connected; every horizontal frequency wraps north.
  return noise(x * 6 + warp * .35, height * 8 + .7 + drift, 6) * .46
    + noise(x * 12, height * 16 - 1.4, 12) * .26
    + noise(x * 24 + warp, height * 32, 24) * .16
    + noise(x * 48, height * 64 + warp, 48) * .08
    + noise(x * 96, height * 128, 96) * .04;
}

export function cloudOpacity(density: number, cover: number) {
  const amount = Math.max(0, Math.min(1, Number.isFinite(cover) ? cover : 0));
  if (amount === 0) return 0;
  if (amount === 1) return 1;
  const threshold = .78 - amount * .56;
  const edge = Math.max(0, Math.min(1, (density - threshold) / .1));
  return smooth(edge);
}

/** A restrained twilight wash, fading into the existing day and night palettes. */
export function cloudTwilightStrength(cover: number, night: boolean, sunAltitude?: number) {
  if (night || sunAltitude === undefined || !Number.isFinite(sunAltitude)) return 0;
  const amount = Math.max(0, Math.min(1, Number.isFinite(cover) ? cover : 0));
  if (amount === 0) return 0;
  // Use the same -6° / +8° solar limits as the scene's day phases. Smooth
  // ramps avoid introducing another color step at either boundary. A closed
  // overcast keeps its neutral veil; this is color, not a coverage adjustment.
  const ramp = (value: number) => smooth(Math.max(0, Math.min(1, value)));
  return ramp((sunAltitude + 6) / 6) * (1 - ramp(sunAltitude / 8)) * (1 - amount ** 4);
}

/** RGBA texture: a soft slate veil at night, never a screen-blended white spotlight. */
export function cloudPixels(width: number, height: number, cover: number, night: boolean, pigment?: Uint8ClampedArray, sunAltitude?: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const densities = new Float32Array(width * height);
  const histogram = new Uint32Array(256);
  const amount = Math.max(0, Math.min(1, Number.isFinite(cover) ? cover : 0));
  const twilight = cloudTwilightStrength(cover, night, sunAltitude);
  const painted = pigment?.length === pixels.length ? pigment : null;
  let pigmentMean = 0;
  if (painted) {
    for (let index = 0; index < painted.length; index += 4) pigmentMean += painted[index] / 255;
    pigmentMean /= width * height;
  }
  const brushAt = (x: number, y: number) => painted ? painted[(y * width + (x === width - 1 ? 0 : x)) * 4] / 255 - pigmentMean : 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const density = cloudDensity(x / Math.max(1, width - 1), y / Math.max(1, height - 1)) + brushAt(x, y) * .12;
    densities[y * width + x] = density;
    histogram[Math.max(0, Math.min(255, Math.round(density * 255)))]++;
  }
  // Calibrate the angular field to the requested cover. An unchanged fixed
  // threshold made some "broken cloud" skies almost completely empty after
  // introducing larger groups. A histogram keeps this bounded and avoids a
  // large per-texture sort. It runs only when the weather state changes.
  let accumulated = 0, threshold = 0;
  const target = (1 - amount) * width * height;
  for (; threshold < 255; threshold++) {
    accumulated += histogram[threshold];
    if (accumulated >= target) break;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const density = densities[y * width + x];
    const index = (y * width + x) * 4;
    const brush = brushAt(x, y);
    // Pigment breaks the cloud's silhouette, but must not turn an overcast
    // interior into a map of hard mineral edges. Keep its tonal contribution
    // separate from the density used to calibrate weather coverage.
    const toneDensity = density - brush * .12;
    const shade = night ? 32 + toneDensity * 20 + brush * 2 : 164 + toneDensity * 75 + brush * 6;
    // Light optical pilot: slightly lower value, with more blue than red
    // absorbed. Keep the wash modest so luminous cloud openings survive.
    // Density, pigment edges and alpha remain independent of this color pass.
    pixels[index] = shade * (1 - twilight * .09);
    pixels[index + 1] = (shade + (night ? 13 : 5)) * (1 - twilight * .109);
    pixels[index + 2] = (shade + (night ? 24 : 2)) * (1 - twilight * .141);
    // Vary wet and dry edges with the same pigment vocabulary as the land.
    // Cloud cover still comes from the calibrated density, not this texture.
    const edgeWidth = painted ? .025 + Math.max(0, Math.min(1, .5 + brush * 2)) * .09 : .08;
    const edge = Math.max(0, Math.min(1, (density - threshold / 255) / edgeWidth + .5));
    pixels[index + 3] = 255 * (amount === 0 ? 0 : amount === 1 ? 1 : smooth(edge));
  }
  return pixels;
}
