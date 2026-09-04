import { sqlite } from "@/db/client";
import { wgs84ToLv95 } from "./elevation";
import type { PrecipitationType } from "./types";

export type LocalWeather = {
  temperatureC: number;
  precipitationMm10: number | null;
  precipitationRateMmH: number | null;
  precipitationType: PrecipitationType;
  sunshineMinutes10: number | null;
  windKmh: number | null;
  humidityPercent: number | null;
  globalRadiationWm2: number | null;
  cloudCover: number;
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  snowCoverPercent: number | null;
  snowDepthCm: number | null;
  snowfallLimitMeters: number | null;
  location: string;
  observedAt: string;
  source: "MeteoSchweiz";
};

type ForecastPoint = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
  exposition: string;
  fullWeatherStation: boolean;
};
type SnapshotRow = {
  valid_at: string;
  origin_easting: number;
  origin_northing: number;
  resolution_meters: number;
  width: number;
  height: number;
  values_blob: Buffer;
  nodata_value: number | null;
};

let weatherCache: { expiresAt: number; value: Promise<ForecastPoint[]> } | null = null;

function csvRows(input: string) {
  const [header, ...rows] = input.trim().split(/\r?\n/);
  const fields = header.split(";");
  return rows.map((line) => Object.fromEntries(line.split(";").map((value, index) => [fields[index], value])));
}

function optionalNumber(value: string | undefined) {
  return value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}

async function fetchCsv(url: string, revalidate: number, timeout: number) {
  const response = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`MeteoSchweiz antwortet mit ${response.status}`);
  return new TextDecoder("iso-8859-1").decode(await response.arrayBuffer());
}

async function loadStations() {
  const stationCsv = await fetchCsv("https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/ogd-smn_meta_stations.csv", 86_400, 6_000);
  return csvRows(stationCsv).map((row) => ({
    id: row.station_abbr,
    name: row.station_name,
    latitude: Number(row.station_coordinates_wgs84_lat),
    longitude: Number(row.station_coordinates_wgs84_lon),
    elevationMeters: optionalNumber(row.station_height_masl),
    exposition: row.station_exposition_en?.toLocaleLowerCase("en-US") ?? "",
    fullWeatherStation: row.station_type_en?.toLocaleLowerCase("en-US").includes("weather station") ?? false,
  }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

function distanceKilometers(latitude: number, longitude: number, point: ForecastPoint) {
  const latitudeDistance = (point.latitude - latitude) * 111.32;
  const longitudeDistance = (point.longitude - longitude) * 111.32 * Math.cos(latitude * Math.PI / 180);
  return Math.hypot(latitudeDistance, longitudeDistance);
}

function selectReferenceStation(points: ForecastPoint[], latitude: number, longitude: number, elevationMeters: number | null) {
  const weatherStations = points.some((point) => point.fullWeatherStation)
    ? points.filter((point) => point.fullWeatherStation)
    : points;
  const candidates = weatherStations.map((point) => ({
    point,
    distance: distanceKilometers(latitude, longitude, point),
    elevationDifference: elevationMeters !== null && point.elevationMeters !== null
      ? Math.abs(elevationMeters - point.elevationMeters)
      : null,
  }));
  const nearby = candidates.filter((candidate) => candidate.distance <= 80);
  const localCandidates = nearby.length > 0 ? nearby : candidates;
  const heightCompatible = elevationMeters === null
    ? localCandidates
    : localCandidates.filter((candidate) => candidate.elevationDifference === null || candidate.elevationDifference <= 1_000);
  const pool = heightCompatible.length > 0 ? heightCompatible : localCandidates;

  return pool.reduce<(typeof pool)[number] | null>((best, candidate) => {
    const score = candidate.distance
      + (candidate.elevationDifference ?? 0) / 100
      + (candidate.elevationDifference !== null
        && candidate.elevationDifference > 500
        && /summit|peak|pass|crest/.test(candidate.point.exposition) ? 12 : 0);
    if (!best) return candidate;
    const bestScore = best.distance
      + (best.elevationDifference ?? 0) / 100
      + (best.elevationDifference !== null
        && best.elevationDifference > 500
        && /summit|peak|pass|crest/.test(best.point.exposition) ? 12 : 0);
    return score < bestScore ? candidate : best;
  }, null)?.point ?? null;
}

function temperatureAtElevation(temperatureC: number, stationElevation: number | null, targetElevation: number | null) {
  if (stationElevation === null || targetElevation === null) return temperatureC;
  const correction = Math.max(-8, Math.min(8, (stationElevation - targetElevation) * .0065));
  return temperatureC + correction;
}

function snapshotValue(parameter: string, latitude: number, longitude: number, maximumAgeHours: number) {
  const row = sqlite.prepare(`
    SELECT valid_at,origin_easting,origin_northing,resolution_meters,width,height,values_blob,nodata_value
    FROM weather_snapshots WHERE parameter=? ORDER BY valid_at DESC LIMIT 1
  `).get(parameter) as SnapshotRow | undefined;
  if (!row || Date.now() - new Date(row.valid_at).getTime() > maximumAgeHours * 3_600_000) return null;
  const point = wgs84ToLv95(latitude, longitude);
  const column = Math.round((point.easting - row.origin_easting) / row.resolution_meters);
  const line = Math.round((point.northing - row.origin_northing) / row.resolution_meters);
  if (column < 0 || line < 0 || column >= row.width || line >= row.height) return null;
  const offset = (line * row.width + column) * 4;
  if (offset + 4 > row.values_blob.length) return null;
  const value = row.values_blob.readFloatLE(offset);
  if (!Number.isFinite(value) || (row.nodata_value !== null && Math.abs(value - row.nodata_value) < 1e-5)) return null;
  return { value, validAt: row.valid_at };
}

function fraction(value: number | null | undefined) {
  if (value == null) return null;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function precipitationKind(input: {
  intensity: number | null;
  rain: number | null;
  snow: number | null;
  snowfallLimit: number | null;
  elevation: number | null;
  temperature: number;
}): PrecipitationType {
  if (input.intensity !== null && input.intensity < .03) return "none";
  if (input.intensity === null && Math.max(input.rain ?? 0, input.snow ?? 0) <= 0) return "none";
  if ((input.snow ?? 0) > (input.rain ?? 0) * 1.25) return "snow";
  if ((input.rain ?? 0) > (input.snow ?? 0) * 1.25) return "rain";
  if (input.snowfallLimit !== null && input.elevation !== null) {
    if (input.elevation >= input.snowfallLimit + 100) return "snow";
    if (input.elevation <= input.snowfallLimit - 100) return "rain";
    return "mixed";
  }
  if (input.temperature <= .5) return "snow";
  if (input.temperature >= 2) return "rain";
  return "mixed";
}

export async function getLocalWeather(latitude: number, longitude: number, sunAltitudeDegrees = 0, elevationMeters: number | null = null): Promise<LocalWeather | null> {
  const cloudTotal = snapshotValue("CLCT", latitude, longitude, 8);
  const cloudLow = snapshotValue("CLCL", latitude, longitude, 8);
  const cloudMid = snapshotValue("CLCM", latitude, longitude, 8);
  const cloudHigh = snapshotValue("CLCH", latitude, longitude, 8);
  const radarRate = snapshotValue("RZC", latitude, longitude, .5);
  const modelRain = snapshotValue("RAIN_GSP", latitude, longitude, 8);
  const modelSnow = snapshotValue("SNOW_GSP", latitude, longitude, 8);
  const snowfallLimit = snapshotValue("SNOWLMT", latitude, longitude, 8);
  const snowCover = snapshotValue("SNOWC", latitude, longitude, 8);
  const snowDepth = snapshotValue("H_SNOW", latitude, longitude, 8);
  const modelTemperature = snapshotValue("T_2M", latitude, longitude, 8);

  try {
    if (!weatherCache || weatherCache.expiresAt < Date.now()) weatherCache = { expiresAt: Date.now() + 30 * 60 * 1000, value: loadStations() };
    const points = await weatherCache.value;
    const referenceStation = selectReferenceStation(points, latitude, longitude, elevationMeters);
    if (!referenceStation) return null;
    const station = referenceStation.id.toLocaleLowerCase("en-US");
    const measurements = await fetchCsv(`https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${station}/ogd-smn_${station}_t_now.csv`, 600, 5_000);
    const latest = csvRows(measurements).at(-1);
    const measuredTemperature = optionalNumber(latest?.tre200s0);
    const modelTemperatureC = modelTemperature ? modelTemperature.value - 273.15 : null;
    const stationTemperatureC = measuredTemperature === null
      ? null
      : temperatureAtElevation(measuredTemperature, referenceStation.elevationMeters, elevationMeters);
    const temperatureC = modelTemperatureC ?? stationTemperatureC;
    const precipitationMm10 = optionalNumber(latest?.rre150z0);
    const precipitationRateMmH = radarRate?.value ?? (precipitationMm10 === null ? null : precipitationMm10 * 6);
    const sunshineMinutes10 = optionalNumber(latest?.sre000z0);
    const humidityPercent = optionalNumber(latest?.ure200s0);
    const globalRadiationWm2 = optionalNumber(latest?.gre000z0);
    const cloudCover = fraction(cloudTotal?.value) ?? (precipitationRateMmH !== null && precipitationRateMmH > .03
      ? .96
      : sunAltitudeDegrees > 3 && sunshineMinutes10 !== null
        ? Math.max(0, Math.min(1, 1 - sunshineMinutes10 / 10))
        : humidityPercent === null ? .2 : Math.max(.08, Math.min(.9, (humidityPercent - 52) / 45)));
    return temperatureC !== null && Number.isFinite(temperatureC) ? {
      temperatureC,
      precipitationMm10,
      precipitationRateMmH,
      precipitationType: precipitationKind({ intensity: precipitationRateMmH, rain: modelRain?.value ?? null, snow: modelSnow?.value ?? null, snowfallLimit: snowfallLimit?.value ?? null, elevation: elevationMeters, temperature: temperatureC }),
      sunshineMinutes10,
      windKmh: optionalNumber(latest?.fu3010z0),
      humidityPercent,
      globalRadiationWm2,
      cloudCover,
      cloudLow: fraction(cloudLow?.value),
      cloudMid: fraction(cloudMid?.value),
      cloudHigh: fraction(cloudHigh?.value),
      snowCoverPercent: snowCover?.value == null ? null : Math.max(0, Math.min(100, snowCover.value)),
      snowDepthCm: snowDepth?.value == null ? null : Math.max(0, snowDepth.value * 100),
      snowfallLimitMeters: snowfallLimit?.value ?? null,
      observedAt: modelTemperature?.validAt ?? cloudTotal?.validAt ?? latest?.reference_timestamp ?? "",
      location: modelTemperature ? "diesem Bänkli" : referenceStation.name,
      source: "MeteoSchweiz",
    } : null;
  } catch {
    if (!modelTemperature) return null;
    const temperatureC = modelTemperature.value - 273.15;
    return {
      temperatureC,
      precipitationMm10: null,
      precipitationRateMmH: radarRate?.value ?? null,
      precipitationType: precipitationKind({ intensity: radarRate?.value ?? null, rain: modelRain?.value ?? null, snow: modelSnow?.value ?? null, snowfallLimit: snowfallLimit?.value ?? null, elevation: elevationMeters, temperature: temperatureC }),
      sunshineMinutes10: null, windKmh: null, humidityPercent: null, globalRadiationWm2: null,
      cloudCover: fraction(cloudTotal?.value) ?? .2,
      cloudLow: fraction(cloudLow?.value), cloudMid: fraction(cloudMid?.value), cloudHigh: fraction(cloudHigh?.value),
      snowCoverPercent: snowCover?.value == null ? null : Math.max(0, Math.min(100, snowCover.value)),
      snowDepthCm: snowDepth?.value == null ? null : Math.max(0, snowDepth.value * 100),
      snowfallLimitMeters: snowfallLimit?.value ?? null,
      location: "diesem Bänkli", observedAt: cloudTotal?.validAt ?? modelTemperature.validAt, source: "MeteoSchweiz",
    };
  }
}
