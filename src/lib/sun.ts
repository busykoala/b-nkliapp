import * as SunCalc from "suncalc";

export type ObstructionType = "building" | "vegetation" | "terrain" | "unknown";
export type ShadeCause = "frei" | "nacht" | "überdacht" | "gebäude" | "vegetation" | "gelände" | "unbekannt";
export type DayPhase = "dawn" | "day" | "dusk" | "night";

function zurichDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function zurichClockMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

export function getSkyTrack(date: Date, latitude: number, longitude: number) {
  const dateKey = zurichDateKey(date);
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = Date.UTC(year, month - 1, day) - 3 * 60 * 60 * 1000;
  const end = start + 30 * 60 * 60 * 1000;
  const sun: Array<{ minute: number; altitudeDegrees: number }> = [];
  const moon: Array<{ minute: number; altitudeDegrees: number }> = [];
  for (let time = start; time <= end; time += 5 * 60 * 1000) {
    const moment = new Date(time);
    if (zurichDateKey(moment) !== dateKey) continue;
    const minute = zurichClockMinutes(moment);
    const sunPosition = SunCalc.getPosition(moment, latitude, longitude);
    const moonPosition = SunCalc.getMoonPosition(moment, latitude, longitude);
    sun.push({ minute, altitudeDegrees: Number(sunPosition.altitude.toFixed(2)) });
    moon.push({ minute, altitudeDegrees: Number(moonPosition.altitude.toFixed(2)) });
  }
  return { sun, moon };
}

export function getDaylightState(date: Date, latitude: number, longitude: number) {
  const position = SunCalc.getPosition(date, latitude, longitude);
  const altitude = position.altitude;
  const times = SunCalc.getTimes(date, latitude, longitude);
  const sunrise = times.sunrise?.getTime() ?? date.getTime();
  const sunset = times.sunset?.getTime() ?? date.getTime();
  const solarNoon = times.solarNoon?.getTime() ?? (sunrise + sunset) / 2;
  const progress = sunset > sunrise
    ? Math.max(0, Math.min(1, (date.getTime() - sunrise) / (sunset - sunrise)))
    : .5;
  const phase: DayPhase = altitude <= -6
    ? "night"
    : altitude < 8
      ? date.getTime() < solarNoon ? "dawn" : "dusk"
      : "day";
  return { phase, progress, altitude, azimuth: position.azimuth };
}

export function getMoonState(date: Date, latitude: number, longitude: number) {
  const position = SunCalc.getMoonPosition(date, latitude, longitude);
  const illumination = SunCalc.getMoonIllumination(date);
  const times = SunCalc.getMoonTimes(date, latitude, longitude);
  const formatter = new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
  return {
    altitude: position.altitude,
    azimuth: position.azimuth,
    fraction: Math.max(0, Math.min(1, illumination.fraction)),
    phase: illumination.phase,
    visible: position.altitude > 0,
    rise: times.rise ? formatter.format(times.rise) : "–",
    set: times.set ? formatter.format(times.set) : "–",
  };
}

export function interpolateHorizon(profile: number[] | null, azimuthDegrees: number): number {
  if (!profile || profile.length === 0) return 0;
  const normalized = ((azimuthDegrees % 360) + 360) % 360;
  const position = (normalized / 360) * profile.length;
  const lower = Math.floor(position) % profile.length;
  const upper = (lower + 1) % profile.length;
  const fraction = position - Math.floor(position);
  return profile[lower] * (1 - fraction) + profile[upper] * fraction;
}

export function calculateSunState(input: {
  date?: Date;
  latitude: number;
  longitude: number;
  horizonProfile?: number[] | null;
  covered?: boolean | null;
  canopyPercent?: number | null;
  obstructionTypes?: ObstructionType[] | null;
}) {
  const date = input.date ?? new Date();
  const position = SunCalc.getPosition(date, input.latitude, input.longitude);
  const azimuth = position.azimuth;
  const altitude = position.altitude;
  const horizon = interpolateHorizon(input.horizonProfile ?? null, azimuth);
  const index = input.obstructionTypes?.length
    ? Math.round((azimuth / 360) * input.obstructionTypes.length) % input.obstructionTypes.length
    : -1;
  const obstructionType = index >= 0 ? input.obstructionTypes?.[index] ?? "unknown" : "unknown";
  const hasModeledProfile = Boolean(input.horizonProfile?.length);
  const fallbackCanopyPenalty = hasModeledProfile ? 0 : (input.canopyPercent ?? 0) >= 70 ? 8 : (input.canopyPercent ?? 0) >= 40 ? 3 : 0;
  // swissSURFACE3D cells, geocoding and a seated eye all have small spatial uncertainty.
  // Avoid declaring shade for a sun that merely grazes the calculated horizon.
  const horizonUncertainty = obstructionType === "terrain" ? 1.2 : obstructionType === "building" || obstructionType === "vegetation" ? .7 : 0;
  const sunny = !input.covered && altitude > 0 && altitude + horizonUncertainty > horizon + fallbackCanopyPenalty;
  const shadeCause: ShadeCause = sunny ? "frei" : altitude <= 0 ? "nacht" : input.covered ? "überdacht"
    : obstructionType === "building" ? "gebäude" : obstructionType === "vegetation" ? "vegetation"
      : obstructionType === "terrain" ? "gelände" : "unbekannt";
  return { sunny, altitude, azimuth, horizon, obstructionType, shadeCause };
}

export function getSunTimes(date: Date, latitude: number, longitude: number) {
  const times = SunCalc.getTimes(date, latitude, longitude);
  const formatter = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    sunrise: times.sunrise ? formatter.format(times.sunrise) : "–",
    sunset: times.sunset ? formatter.format(times.sunset) : "–",
  };
}

export function getLocalSunSchedule(input: {
  date?: Date;
  latitude: number;
  longitude: number;
  horizonProfile?: number[] | null;
  obstructionTypes?: ObstructionType[] | null;
  covered?: boolean | null;
  canopyPercent?: number | null;
}) {
  const date = input.date ?? new Date();
  const times = SunCalc.getTimes(date, input.latitude, input.longitude);
  const formatter = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit",
  });
  if (!times.sunrise || !times.sunset || Number.isNaN(times.sunrise.getTime()) || Number.isNaN(times.sunset.getTime())) {
    return { directSunrise: "–", directSunset: "–", sunMinutes: 0, windows: [] as Array<{ start: string; end: string }> };
  }
  const step = 5 * 60 * 1000;
  const samples: Array<{ date: Date; sunny: boolean }> = [];
  for (let value = times.sunrise.getTime(); value <= times.sunset.getTime(); value += step) {
    const moment = new Date(value);
    samples.push({ date: moment, sunny: calculateSunState({ ...input, date: moment }).sunny });
  }
  const windows: Array<{ start: string; end: string }> = [];
  let start: Date | null = null;
  for (const sample of samples) {
    if (sample.sunny && !start) start = sample.date;
    if (!sample.sunny && start) {
      windows.push({ start: formatter.format(start), end: formatter.format(new Date(sample.date.getTime() - step)) });
      start = null;
    }
  }
  if (start) windows.push({ start: formatter.format(start), end: formatter.format(samples.at(-1)?.date ?? start) });
  return {
    directSunrise: windows[0]?.start ?? "Keine direkte Sonne",
    directSunset: windows.at(-1)?.end ?? "Keine direkte Sonne",
    sunMinutes: samples.filter((sample) => sample.sunny).length * 5,
    windows,
  };
}

export function getSeasonalSunMinutes(input: Omit<Parameters<typeof getLocalSunSchedule>[0], "date">, year = new Date().getUTCFullYear()) {
  const minutes = (month: number, day: number) => getLocalSunSchedule({
    ...input,
    date: new Date(Date.UTC(year, month - 1, day, 12)),
  }).sunMinutes;
  return {
    spring: minutes(3, 20),
    summer: minutes(6, 21),
    autumn: minutes(9, 22),
    winter: minutes(12, 21),
  };
}
