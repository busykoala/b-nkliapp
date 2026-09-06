import { getDaylightState } from "@/lib/sun";

export type ObservationSeason = "spring" | "summer" | "autumn" | "winter";
export type LightObservationPhase = "morning" | "day" | "evening";

export function benchObservationNow(): Date {
  const fixed = process.env.BENCHLY_SEED_DEMO === "true" ? process.env.BENCHLY_E2E_NOW : undefined;
  if (fixed) {
    const parsed = new Date(fixed);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function observationSeason(date: Date): ObservationSeason {
  const month = Number(new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Zurich",
    month: "numeric",
  }).format(date));
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

export function lightObservationContext(date: Date, latitude: number, longitude: number): {
  season: ObservationSeason;
  dayPhase: LightObservationPhase;
} | null {
  const phase = getDaylightState(date, latitude, longitude).phase;
  if (phase === "night") return null;
  return {
    season: observationSeason(date),
    dayPhase: phase === "dawn" ? "morning" : phase === "dusk" ? "evening" : "day",
  };
}
