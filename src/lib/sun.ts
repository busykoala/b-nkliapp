import * as SunCalc from "suncalc";

export type ObstructionType = "building" | "vegetation" | "terrain" | "unknown";
export type ShadeCause = "frei" | "nacht" | "überdacht" | "gebäude" | "vegetation" | "gelände" | "unbekannt";

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
  // SunCalc 2 returns navigation azimuth and apparent altitude in degrees.
  const azimuth = position.azimuth;
  const altitude = position.altitude;
  const horizon = interpolateHorizon(input.horizonProfile ?? null, azimuth);
  const index = input.obstructionTypes?.length
    ? Math.round((azimuth / 360) * input.obstructionTypes.length) % input.obstructionTypes.length
    : -1;
  const obstructionType = index >= 0 ? input.obstructionTypes?.[index] ?? "unknown" : "unknown";
  const hasModeledProfile = Boolean(input.horizonProfile?.length);
  const fallbackCanopyPenalty = hasModeledProfile ? 0 : (input.canopyPercent ?? 0) >= 70 ? 8 : (input.canopyPercent ?? 0) >= 40 ? 3 : 0;
  const sunny = !input.covered && altitude > 0 && altitude > horizon + fallbackCanopyPenalty;
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
