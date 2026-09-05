import { journeyMinutes, type JourneyLeg, type JourneyOption, type JourneyQuery } from "./journey";

export const PREFERENCES_KEY = "benchly-journey-preferences";
export type JourneyPreferences = {
  speed: JourneyQuery["speedKmh"];
  buffer: JourneyQuery["bufferMinutes"];
};
export type JourneySettings = JourneyPreferences & {
  mode: JourneyQuery["mode"];
  timeMode: "now" | "departure" | "arrival";
  time: string;
};

export function parsePreferences(raw: string | null): JourneyPreferences {
  const preferences: JourneyPreferences = { speed: 4.2, buffer: 3 };
  try {
    const saved = JSON.parse(raw ?? "null");
    if ([3, 4.2, 5.4].includes(saved?.speed)) preferences.speed = saved.speed;
    if ([0, 3, 6, 10].includes(saved?.buffer)) preferences.buffer = saved.buffer;
  } catch { /* Invalid or older preferences use the defaults. */ }
  return preferences;
}

export function journeyBounds(legs: JourneyLeg[]): [[number, number], [number, number]] | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const leg of legs) {
    const points = leg.geometry.length ? leg.geometry : [
      [leg.from.longitude, leg.from.latitude], [leg.to.longitude, leg.to.latitude],
    ];
    for (const [longitude, latitude] of points) {
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
  }
  return west === Infinity ? null : [[west, south], [east, north]];
}

export function tightestTransfer(option: JourneyOption) {
  const transfers = option.legs.flatMap((leg) => leg.transfer ? [leg.transfer] : []);
  if (!transfers.length) return "Ohne Umsteigen";
  if (transfers.some((transfer) => transfer.slackSeconds === null)) return "Umstiegszeit noch unsicher";
  const tightest = Math.min(...transfers.map((transfer) => transfer.slackSeconds!));
  return `Engster Umstieg: ${journeyMinutes(tightest)} Luft · gewünscht +${transfers[0].bufferMinutes} min`;
}
