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
  // Several scales, not Gaussian ellipses. The x periods make the north seam continuous.
  return noise(x * 12 + warp, height * 14, 12) * .44
    + noise(x * 24, height * 31 + warp, 24) * .27
    + noise(x * 48, height * 65, 48) * .17
    + noise(x * 96, height * 129, 96) * .08
    + noise(x * 192, height * 259, 192) * .04;
}

export function cloudOpacity(density: number, cover: number) {
  const amount = Math.max(0, Math.min(1, Number.isFinite(cover) ? cover : 0));
  if (amount === 0) return 0;
  if (amount === 1) return 1;
  const threshold = .78 - amount * .56;
  const edge = Math.max(0, Math.min(1, (density - threshold) / .1));
  return smooth(edge);
}

/** RGBA texture: a soft slate veil at night, never a screen-blended white spotlight. */
export function cloudPixels(width: number, height: number, cover: number, night: boolean) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const density = cloudDensity(x / (width - 1), y / (height - 1));
    const index = (y * width + x) * 4;
    const shade = night ? 32 + density * 20 : 164 + density * 75;
    pixels[index] = shade;
    pixels[index + 1] = shade + (night ? 13 : 5);
    pixels[index + 2] = shade + (night ? 24 : 2);
    pixels[index + 3] = 255 * cloudOpacity(density, cover);
  }
  return pixels;
}
