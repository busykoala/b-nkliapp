import { PANORAMA_MIN_ALTITUDE, PANORAMA_SKY_MAX_ALTITUDE } from "./night-sky";

export const PANORAMA_REST_ALTITUDE = 13;
export const PANORAMA_ARTIFACT_SPAN = 90;
export const PANORAMA_HEIGHT_SCALE = 1.36;

export function normalizePanoramaHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

export function panoramaPixelsPerDegree(viewportHeight: number, zoom = 1) {
  return viewportHeight * PANORAMA_HEIGHT_SCALE * zoom / PANORAMA_ARTIFACT_SPAN;
}

export function panoramaMaximumPitch(viewportHeight: number, zoom = 1) {
  const pixelsPerDegree = panoramaPixelsPerDegree(viewportHeight, zoom);
  if (!pixelsPerDegree) return 0;
  return Math.max(0, PANORAMA_SKY_MAX_ALTITUDE - PANORAMA_REST_ALTITUDE
    - viewportHeight / (2 * pixelsPerDegree));
}

export function clampPanoramaPitch(viewportHeight: number, value: number, zoom = 1) {
  return Math.max(0, Math.min(panoramaMaximumPitch(viewportHeight, zoom), value));
}

export function panoramaProjection(viewportWidth: number, viewportHeight: number,
  heading: number, pitch = 0, zoom = 1) {
  const pixelsPerDegree = panoramaPixelsPerDegree(viewportHeight, zoom);
  const clampedPitch = clampPanoramaPitch(viewportHeight, pitch, zoom);
  const copyWidth = Math.round(360 * pixelsPerDegree);
  const trackHeight = (PANORAMA_SKY_MAX_ALTITUDE - PANORAMA_MIN_ALTITUDE) * pixelsPerDegree;
  const centreAltitude = PANORAMA_REST_ALTITUDE + clampedPitch;
  return {
    pitch: clampedPitch,
    maximumPitch: panoramaMaximumPitch(viewportHeight, zoom),
    pixelsPerDegree,
    copyWidth,
    trackHeight,
    rasterHeight: PANORAMA_ARTIFACT_SPAN * pixelsPerDegree,
    left: Math.round(viewportWidth / 2 - copyWidth * (1 + normalizePanoramaHeading(heading) / 360)),
    top: viewportHeight / 2 - (PANORAMA_SKY_MAX_ALTITUDE - centreAltitude) * pixelsPerDegree,
  };
}

export type PrecipitationParticle = {
  x: number;
  y: number;
  delay: number;
  duration: number;
  size: number;
  length: number;
  drift: number;
  alpha: number;
};

function hash(seed: string, index: number, channel: number) {
  let value = 2166136261;
  const source = `${seed}:${index}:${channel}`;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    value ^= source.charCodeAt(cursor);
    value = Math.imul(value, 16777619);
  }
  value += value << 13; value ^= value >>> 7;
  value += value << 3; value ^= value >>> 17; value += value << 5;
  return (value >>> 0) / 4_294_967_296;
}

export function precipitationParticleCount(kind: "rain" | "snow", width: number, height: number,
  rateMmH: number | null, mixed = false) {
  const baseline = kind === "rain" ? 36 : 26;
  const maximum = kind === "rain" ? 220 : 150;
  const areaScale = Math.sqrt(Math.max(1, width * height) / (390 * 325));
  const intensity = rateMmH === null ? .55 : Math.max(.42, Math.min(1.72, Math.sqrt(Math.max(0, rateMmH) / 2)));
  const mixedShare = mixed ? (kind === "rain" ? .62 : .52) : 1;
  return Math.max(8, Math.min(maximum, Math.round(baseline * areaScale * intensity * mixedShare)));
}

export function precipitationParticles(kind: "rain" | "snow", count: number, seed: string): PrecipitationParticle[] {
  return Array.from({ length: count }, (_, index) => {
    // Stratification guarantees coverage in every horizontal and vertical
    // third while the seeded jitter prevents a visible grid.
    const column = index % 12;
    const row = Math.floor(index / 12);
    return {
      x: (column + hash(seed, index, 0)) / 12 * 100,
      y: ((row * 37 + column * 17) % 100 + hash(seed, index, 1) * 8) % 100,
      delay: -hash(seed, index, 2) * (kind === "rain" ? 1.15 : 5.4),
      duration: kind === "rain" ? .62 + hash(seed, index, 3) * .55 : 3.6 + hash(seed, index, 3) * 2.8,
      size: kind === "rain" ? .7 + hash(seed, index, 4) * .7 : 2.2 + hash(seed, index, 4) * 3.1,
      length: kind === "rain" ? 12 + hash(seed, index, 5) * 16 : 1,
      drift: kind === "rain" ? -18 - hash(seed, index, 6) * 15 : -16 + hash(seed, index, 6) * 32,
      alpha: kind === "rain" ? .42 + hash(seed, index, 7) * .3 : .56 + hash(seed, index, 7) * .34,
    };
  });
}

export function panoramaHasSnowCover(depthCm: number | null | undefined, coverPercent: number | null | undefined) {
  return (depthCm ?? 0) >= 1 || (coverPercent ?? 0) >= 20;
}
