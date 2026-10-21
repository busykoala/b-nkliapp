import * as SunCalc from "suncalc";
import { getDaylightState, getMoonState } from "../../src/lib/sun";
import type { BenchDetail } from "../../src/lib/types";

export const artSeasons = ["spring", "summer", "autumn", "winter"] as const;
export type ArtSeason = typeof artSeasons[number];
const dates = { spring: "2026-03-20", summer: "2026-06-21", autumn: "2026-09-22", winter: "2026-12-21" };
const conditions = [
  { id: "dawn", event: "sunrise", minutes: -18, cover: .12 },
  { id: "sunrise", event: "sunrise", minutes: 12, cover: .18 },
  { id: "morning", event: "sunrise", minutes: 70, cover: .08 },
  { id: "noon-clear", event: "solarNoon", minutes: 0, cover: 0 },
  { id: "clouds-light", event: "solarNoon", minutes: 0, cover: .25 },
  { id: "clouds-broken", event: "solarNoon", minutes: 0, cover: .55 },
  { id: "overcast", event: "solarNoon", minutes: 0, cover: 1 },
  { id: "rain-light", event: "solarNoon", minutes: 0, cover: .82, precipitation: "rain", rate: .4 },
  { id: "rain-heavy", event: "solarNoon", minutes: 0, cover: .97, precipitation: "rain", rate: 8 },
  { id: "snowfall", event: "solarNoon", minutes: 0, cover: .9, precipitation: "snow", rate: 1.2 },
  { id: "snow-cover", event: "solarNoon", minutes: 0, cover: .3, snow: 20 },
  { id: "mixed", event: "sunset", minutes: -30, cover: .9, precipitation: "mixed", rate: .8 },
  { id: "sunset", event: "sunset", minutes: -12, cover: .22 },
  { id: "dusk", event: "sunset", minutes: 18, cover: .12 },
  { id: "stars", event: "stars", minutes: 0, cover: 0 },
  { id: "moon-full", event: "moon-full", minutes: 0, cover: .04 },
  { id: "moon-crescent", event: "moon-crescent", minutes: 0, cover: .12 },
  { id: "night-clouds", event: "moon-full", minutes: 0, cover: .65 },
  { id: "night-overcast", event: "moon-full", minutes: 0, cover: 1 },
] as const;

function nightTime(start: Date, latitude: number, longitude: number, kind: string) {
  // Find actual ephemerides instead of combining a fictional moon with real stars.
  for (let day = 0; day < 35; day++) for (let hour = 16; hour < 32; hour += .5) {
    const at = new Date(start.getTime() + day * 86_400_000 + hour * 3_600_000);
    const sun = getDaylightState(at, latitude, longitude);
    const moon = getMoonState(at, latitude, longitude);
    if (sun.altitude > (kind === "moon-crescent" ? -6 : -12)) continue;
    if (kind === "stars" ? moon.altitude < -8 : moon.altitude > (kind === "moon-crescent" ? 8 : 15)
      && (kind === "moon-full" ? moon.fraction > .88 : moon.fraction > .08 && moon.fraction < .35)) return at;
  }
  throw new Error(`No ${kind} ephemeris found for ${latitude}, ${longitude}`);
}

export function artScenarios(latitude: number, longitude: number, season: ArtSeason) {
  const day = new Date(`${dates[season]}T00:00:00Z`);
  const times = SunCalc.getTimes(new Date(day.getTime() + 12 * 3_600_000), latitude, longitude);
  const nightDates = new Map<string, Date>();
  return conditions.map((condition) => {
    let at: Date;
    if (condition.event === "sunrise" || condition.event === "sunset" || condition.event === "solarNoon") {
      at = new Date(times[condition.event]!.getTime() + condition.minutes * 60_000);
    } else {
      at = nightDates.get(condition.event) ?? nightTime(day, latitude, longitude, condition.event);
      nightDates.set(condition.event, at);
    }
    const sun = getDaylightState(at, latitude, longitude);
    const moon = getMoonState(at, latitude, longitude);
    const precipitation = "precipitation" in condition ? condition.precipitation : "none";
    const rate = "rate" in condition ? condition.rate : 0;
    const snowDepth = "snow" in condition ? condition.snow : 0;
    const weather: NonNullable<BenchDetail["weather"]> = {
      temperatureC: precipitation === "snow" || snowDepth ? -3 : precipitation === "mixed" ? 1 : 12,
      precipitationMm10: rate / 6, precipitationRateMmH: rate, precipitationType: precipitation,
      sunshineMinutes10: (1 - condition.cover) * 10, windKmh: 5, humidityPercent: 70,
      globalRadiationWm2: Math.max(0, Math.sin(sun.altitude * Math.PI / 180) * 800 * (1 - condition.cover)),
      cloudCover: condition.cover, cloudLow: condition.cover, cloudMid: 0, cloudHigh: 0,
      snowCoverPercent: snowDepth ? 80 : 0, snowDepthCm: snowDepth, snowfallLimitMeters: null,
      location: "Synthetic review weather; astronomical sky", observedAt: at.toISOString(), source: "MeteoSchweiz",
    };
    return { id: condition.id, at: at.toISOString(), season, sun, moon, weather };
  });
}

export type ArtScenario = ReturnType<typeof artScenarios>[number];

export function applyArtScenario(bench: BenchDetail, scene: ArtScenario): BenchDetail {
  return { ...bench, season: scene.season, weather: scene.weather, skyObservedAt: scene.at,
    // A fixed historical sky must never inherit today's direct-sun result.
    sunnyNow: scene.sun.altitude <= 0 || bench.covered ? false : null,
    shadeCause: scene.sun.altitude <= 0 ? "nacht" : bench.covered ? "überdacht" : "unbekannt",
    dayPhase: scene.sun.phase, sunAltitudeDegrees: scene.sun.altitude, sunAzimuthDegrees: scene.sun.azimuth,
    daylightProgress: scene.sun.progress, moonAltitudeDegrees: scene.moon.altitude,
    moonAzimuthDegrees: scene.moon.azimuth, moonVisible: scene.moon.visible,
    moonPhase: scene.moon.phase, moonIllumination: scene.moon.fraction,
  };
}
