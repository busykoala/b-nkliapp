/** Serializable journey model and pure calculations. No provider or database imports. */
export type JourneyPoint = { label: string; latitude: number; longitude: number; stationId?: string; platform?: string };
export type JourneyOrigin = JourneyPoint & { kind: "location" | "address" | "station" };
export type JourneyQuery = {
  benchId: string; origin: JourneyOrigin; mode: "transit" | "walk";
  time: string; arriveBy: boolean; speedKmh: 3 | 4.2 | 5.4; bufferMinutes: 0 | 3 | 6 | 10;
};
export type TransferTone = "plenty" | "fits" | "tight" | "insufficient" | "unknown";
export type TransferAssessment = {
  availableSeconds: number; requiredSeconds: number | null; slackSeconds: number | null;
  walkingSeconds: number | null; officialMinimumSeconds: number | null;
  bufferMinutes: number; tone: TransferTone; evidence: string; guaranteed: boolean; staySeated: boolean;
};
export type JourneyLeg = {
  id: string; mode: "walk" | "rail" | "bus" | "tram" | "metro" | "ferry" | "funicular" | "cable-car";
  from: JourneyPoint; to: JourneyPoint; departure: string; arrival: string;
  scheduledDeparture?: string; scheduledArrival?: string; predicted: boolean;
  line?: string; direction?: string; distanceMeters?: number; durationSeconds: number;
  geometry: [number, number][]; geometryQuality: "routed" | "schematic" | "missing";
  warnings: string[]; platformChanges?: string[]; transfer?: TransferAssessment;
};
export type JourneyOption = {
  id: string; legs: JourneyLeg[]; departure: string; arrival: string; durationSeconds: number;
  walkingSeconds: number; changes: number; complete: boolean; feasible: boolean; warnings: string[];
};
export type JourneyResult = { options: JourneyOption[]; fetchedAt: string; feedUpdatedAt: string | null; message?: string; partial: boolean };
export type TransferRule = { type: number; minimumSeconds: number | null; source: string };
export const PACE_OPTIONS = [{ speed: 3, label: "Gemütlich" }, { speed: 4.2, label: "Normal" }, { speed: 5.4, label: "Zügig" }] as const;
export const TRANSFER_LABELS: Record<TransferTone, string> = { plenty: "Viel Luft", fits: "Passend", tight: "Knapp", insufficient: "Nicht ausreichend", unknown: "Nicht sicher einschätzbar" };

export function walkingSeconds(meters: number, speedKmh: number) { return Math.ceil(meters * 3.6 / speedKmh - 1e-9); }
export function distanceMeters(a: JourneyPoint, b: JourneyPoint) {
  const rad = Math.PI / 180;
  const x = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, x)));
}
export function assessTransfer(availableSeconds: number, walkSeconds: number | null, rule: TransferRule | null, bufferMinutes: number): TransferAssessment {
  const staySeated = rule?.type === 4;
  const minimum = rule?.minimumSeconds ?? null;
  const requiredSeconds = staySeated ? 0 : walkSeconds === null && minimum === null ? null : Math.max(walkSeconds ?? 0, minimum ?? 0);
  const slackSeconds = requiredSeconds === null ? null : availableSeconds - requiredSeconds;
  const extra = (slackSeconds ?? 0) - (staySeated ? 0 : bufferMinutes * 60);
  const tone: TransferTone = rule?.type === 3 ? "insufficient" : slackSeconds === null ? "unknown" : slackSeconds < 0 ? "insufficient" : extra < 0 ? "tight" : extra >= 300 ? "plenty" : "fits";
  return { availableSeconds, requiredSeconds, slackSeconds, walkingSeconds: walkSeconds, officialMinimumSeconds: minimum, bufferMinutes, tone,
    evidence: rule?.source ?? (walkSeconds !== null ? "Fussweg-Schätzung" : "Keine verlässliche Weg- oder Mindestzeit"),
    guaranteed: rule?.type === 1, staySeated };
}
export function summarizeJourney(id: string, legs: JourneyLeg[], warnings: string[] = []): JourneyOption {
  const departure = legs[0]?.departure ?? "";
  const arrival = legs.at(-1)?.arrival ?? "";
  const vehicles = legs.filter((leg) => leg.mode !== "walk");
  return { id, legs, departure, arrival, durationSeconds: Math.max(0, (Date.parse(arrival) - Date.parse(departure)) / 1000),
    walkingSeconds: legs.filter((leg) => leg.mode === "walk").reduce((sum, leg) => sum + leg.durationSeconds, 0),
    changes: Math.max(0, vehicles.length - 1 - vehicles.filter((leg) => leg.transfer?.staySeated).length),
    complete: legs.every((leg) => leg.geometryQuality !== "missing" && !leg.warnings.length),
    feasible: legs.every((leg) => !leg.transfer || !["tight", "insufficient", "unknown"].includes(leg.transfer.tone)), warnings };
}
export function journeyClock(iso: string) { return new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
export function journeyMinutes(seconds: number) { return `${Math.ceil(seconds / 60)} min`; }
/** datetime-local inputs are Swiss wall time, independent of the browser's zone. */
export function swissWallTime(iso: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return parts.replace(" ", "T");
}
export function swissWallTimeToIso(wall: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) return null;
  // Prefer the first occurrence during the autumn clock change; reject spring gaps.
  for (const offset of ["+02:00", "+01:00"]) {
    const date = new Date(`${wall}:00${offset}`);
    if (Number.isFinite(date.getTime()) && swissWallTime(date.toISOString()) === wall) return date.toISOString();
  }
  return null;
}
