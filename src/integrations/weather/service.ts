import { readWeatherSample } from "./repository";
import { wgs84ToLv95 } from "@/lib/elevation";
import type { PrecipitationType } from "@/lib/types";

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

function snapshotValue(parameter: string, easting: number, northing: number, maximumAgeHours: number) {
  const sample = readWeatherSample(parameter, easting, northing);
  if (!sample || Date.now() - new Date(sample.validAt).getTime() > maximumAgeHours * 3_600_000) return null;
  return sample;
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

export function getLocalWeather(latitude: number, longitude: number, elevationMeters: number | null = null): LocalWeather | null {
  const { easting, northing } = wgs84ToLv95(latitude, longitude);
  const sample = (parameter: string, maximumAgeHours: number) => snapshotValue(parameter, easting, northing, maximumAgeHours);
  const cloudTotal = sample("CLCT", 8);
  const cloudLow = sample("CLCL", 8);
  const cloudMid = sample("CLCM", 8);
  const cloudHigh = sample("CLCH", 8);
  const radarRate = sample("RZC", .5);
  const modelRain = sample("RAIN_GSP", 8);
  const modelSnow = sample("SNOW_GSP", 8);
  const snowfallLimit = sample("SNOWLMT", 8);
  const snowCover = sample("SNOWC", 8);
  const snowDepth = sample("H_SNOW", 8);
  const modelTemperature = sample("T_2M", 8);
  const modelSurfaceElevation = sample("HSURF", 24 * 45);
  if (!modelTemperature) return null;

  const correction = elevationMeters === null || modelSurfaceElevation === null
    ? 0
    : Math.max(-8, Math.min(8, (modelSurfaceElevation.value - elevationMeters) * .0065));
  const temperatureC = modelTemperature.value - 273.15 + correction;
  const precipitationRateMmH = radarRate?.value ?? null;
  return {
    temperatureC,
    precipitationMm10: null,
    precipitationRateMmH,
    precipitationType: precipitationKind({ intensity: precipitationRateMmH, rain: modelRain?.value ?? null, snow: modelSnow?.value ?? null, snowfallLimit: snowfallLimit?.value ?? null, elevation: elevationMeters, temperature: temperatureC }),
    sunshineMinutes10: null,
    windKmh: null,
    humidityPercent: null,
    globalRadiationWm2: null,
    cloudCover: fraction(cloudTotal?.value) ?? (precipitationRateMmH !== null && precipitationRateMmH > .03 ? .96 : .2),
    cloudLow: fraction(cloudLow?.value),
    cloudMid: fraction(cloudMid?.value),
    cloudHigh: fraction(cloudHigh?.value),
    snowCoverPercent: snowCover?.value == null ? null : Math.max(0, Math.min(100, snowCover.value)),
    snowDepthCm: snowDepth?.value == null ? null : Math.max(0, snowDepth.value * 100),
    snowfallLimitMeters: snowfallLimit?.value ?? null,
    location: "diesem Bänkli",
    observedAt: modelTemperature.validAt,
    source: "MeteoSchweiz",
  };
}
