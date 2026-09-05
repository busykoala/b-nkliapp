import { DATA_PROVIDERS } from "@/data/runtime.generated";
import { HORIZON_DISTANCES_METERS, wgs84ToLv95 } from "@/lib/elevation";

export type PointElevation = {
  meters: number;
  source: "GeoAdmin-Punkthöhe";
};

export type TerrainHorizon = {
  elevationMeters: number;
  horizonProfile: number[];
  sampleElevations: number[];
  source: "GeoAdmin-Höhenprofil";
};

const HORIZON_BEARING_GROUPS = [
  Array.from({ length: 36 }, (_, index) => index * 5),
  Array.from({ length: 36 }, (_, index) => 180 + index * 5),
];

export function parsePointHeight(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || !("height" in payload)) return null;
  const meters = Number((payload as { height: unknown }).height);
  return Number.isFinite(meters) && meters >= -100 && meters <= 5_000 ? meters : null;
}

export async function fetchPointElevation(latitude: number, longitude: number): Promise<PointElevation | null> {
  const { easting, northing } = wgs84ToLv95(latitude, longitude);
  const url = new URL(DATA_PROVIDERS.geoAdminHeightUrl);
  url.searchParams.set("easting", easting.toFixed(2));
  url.searchParams.set("northing", northing.toFixed(2));
  url.searchParams.set("sr", "2056");
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Benchly/1.0 (point elevation cache)" },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return null;
    const meters = parsePointHeight(await response.json());
    return meters === null ? null : { meters, source: "GeoAdmin-Punkthöhe" };
  } catch {
    return null;
  }
}

function profileHeight(point: unknown): number | null {
  if (!point || typeof point !== "object" || !("alts" in point)) return null;
  const alts = (point as { alts?: Record<string, unknown> }).alts;
  const value = Number(alts?.COMB ?? alts?.DTM2 ?? alts?.DTM25);
  return Number.isFinite(value) && value >= -100 && value <= 5_000 ? value : null;
}

export async function fetchTerrainHorizon(latitude: number, longitude: number): Promise<TerrainHorizon | null> {
  const origin = wgs84ToLv95(latitude, longitude);
  const horizonProfile: number[] = [];
  const sampleElevations: number[] = [];
  let elevationMeters: number | null = null;
  try {
    for (const bearings of HORIZON_BEARING_GROUPS) {
      const coordinates: number[][] = [[origin.easting, origin.northing]];
      for (const bearing of bearings) {
        const radians = bearing * Math.PI / 180;
        for (const distance of HORIZON_DISTANCES_METERS) {
          coordinates.push([
            origin.easting + Math.sin(radians) * distance,
            origin.northing + Math.cos(radians) * distance,
          ]);
        }
        coordinates.push([origin.easting, origin.northing]);
      }
      const body = new URLSearchParams({
        geom: JSON.stringify({ type: "LineString", coordinates }),
        sr: "2056",
        nb_points: "2",
        distinct_points: "True",
      });
      const response = await fetch(DATA_PROVIDERS.geoAdminProfileUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Benchly/1.0 (terrain horizon cache)",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const points = await response.json() as unknown[];
      if (!Array.isArray(points) || points.length < coordinates.length) return null;
      const groupElevation = profileHeight(points[0]);
      if (groupElevation === null) return null;
      elevationMeters ??= groupElevation;
      let cursor = 1;
      for (let bearingIndex = 0; bearingIndex < bearings.length; bearingIndex += 1) {
        let maximumAngle = -5;
        for (const distance of HORIZON_DISTANCES_METERS) {
          const sample = profileHeight(points[cursor]);
          cursor += 1;
          sampleElevations.push(sample ?? groupElevation);
          if (sample === null) continue;
          maximumAngle = Math.max(maximumAngle, Math.atan2(sample - (groupElevation + 1.1), distance) * 180 / Math.PI);
        }
        cursor += 1;
        horizonProfile.push(Number(maximumAngle.toFixed(2)));
      }
    }
    if (elevationMeters === null || horizonProfile.length !== 72 || sampleElevations.length < 72) return null;
    return { elevationMeters, horizonProfile, sampleElevations, source: "GeoAdmin-Höhenprofil" };
  } catch {
    return null;
  }
}
