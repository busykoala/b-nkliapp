import type { BenchDetail } from "@/lib/types";
import type { Translator } from "@/i18n/types";
import { viewLabel } from "@/i18n/bench-labels";
import { surfaceLabel } from "@/i18n/approach-labels";
import { benchFact } from "./facts";

export type NearbyAmenity = NonNullable<BenchDetail["knowledge"]>["amenities"][number];
export type OverviewFact = { value: string; detail?: string; label?: string };

/** Only resolved observations belong in the visitor summary. Evidence stays in Sources. */
function knownBoolean(bench: BenchDetail, key: "backrest" | "armrest" | "covered" | "wheelchair") {
  const fact = benchFact(bench, key);
  return fact.state === "known" && typeof fact.value === "boolean" ? fact.value : null;
}

export function comfortSummary(bench: BenchDetail, t: Translator): OverviewFact {
  const backrest = knownBoolean(bench, "backrest");
  const covered = knownBoolean(bench, "covered");
  const armrest = knownBoolean(bench, "armrest");
  const seats = benchFact(bench, "seats");
  const items: string[] = [];
  if (backrest !== null) items.push(t(backrest ? "bench.attributes.backrest" : "bench.summary.noBackrest"));
  if (covered !== null) items.push(t(covered ? "bench.attributes.covered" : "bench.overview.uncovered"));
  if (armrest === true) items.push(t("bench.attributes.armrest"));
  if (seats.state === "known" && typeof seats.value === "number" && Number.isFinite(seats.value) && seats.value > 0) {
    items.push(t("bench.overview.seats", { count: Math.round(seats.value) }));
  }
  return { value: items.shift() ?? "–", detail: items.join(" · ") || undefined };
}

function clockMinutes(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function lightSummary(bench: BenchDetail, t: Translator): OverviewFact {
  if (bench.dayPhase === "night") return { value: t("bench.summary.night") };
  if (bench.sunnyNow === null) return { value: "–" };

  const windows = bench.sunWindows
    .map(window => ({ ...window, startMinute: clockMinutes(window.start), endMinute: clockMinutes(window.end) }))
    .filter(window => window.startMinute !== null && window.endMinute !== null && window.endMinute > window.startMinute)
    .sort((a, b) => a.startMinute! - b.startMinute!);

  if (bench.sunnyNow) {
    const active = windows.find(window => window.startMinute! <= bench.localMinutesNow && window.endMinute! > bench.localMinutesNow);
    return {
      value: t("bench.overview.sun"),
      detail: active ? t("bench.overview.sunUntil", { time: active.end }) : undefined,
    };
  }

  const next = windows.find(window => window.startMinute! > bench.localMinutesNow);
  return {
    value: t("bench.overview.shade"),
    detail: next ? t("bench.overview.sunFrom", { time: next.start }) : undefined,
  };
}

export function accessSummary(bench: BenchDetail, t: Translator): OverviewFact {
  const approach = bench.knowledge?.approach;
  const space = knownBoolean(bench, "wheelchair");
  // "No mapped steps" is not a whole-route accessibility assurance.
  if (approach?.steps === true) return { value: t("bench.overview.steps"), detail: approach.surface ? surfaceLabel(approach.surface, t) : undefined };
  if (space !== null) return { value: t(space ? "bench.attributes.wheelchair" : "bench.summary.noWheelchair"), detail: approach?.surface ? surfaceLabel(approach.surface, t) : undefined };
  // A surface observation is useful, but it must not masquerade as an access verdict.
  if (approach?.surface) return { label: t("bench.overview.surface"), value: surfaceLabel(approach.surface, t) };
  return { value: "–" };
}

export function viewSummary(bench: BenchDetail, t: Translator): OverviewFact {
  const labels = [...new Set(bench.viewLabels.filter(label => label !== "Aussicht noch offen").map(label => viewLabel(label, t)))].filter(Boolean);
  return { value: labels.slice(0, 2).join(" · ") || "–" };
}

export function validRating(value: number | null | undefined, count: number) {
  return count > 0 && typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

export function quietSummary(bench: BenchDetail, t: Translator, number: (value: number) => string): OverviewFact {
  const count = bench.ratingBreakdown?.counts.quiet ?? 0;
  const score = validRating(bench.ratingBreakdown?.quiet, count);
  if (score !== null) return { value: `${number(score)} / 5`, detail: t("bench.overview.quietRatings", { count }) };
  const period = bench.dayPhase === "night" ? "night" : "day";
  const noise = bench.knowledge?.noise.filter(item => item.period === period && item.value !== null && Number.isFinite(item.value))
    .sort((a, b) => b.value! - a.value!)[0];
  if (!noise) return { value: "–" };
  return {
    value: t(noise.mode === "rail" ? "bench.overview.railNoise" : "bench.overview.roadNoise"),
    detail: t("bench.overview.modelNoiseValue", { value: number(noise.value!), unit: noise.unit }),
  };
}

export function nearbyAmenities(bench: Pick<BenchDetail, "knowledge">): NearbyAmenity[] {
  // A fountain is not necessarily drinking water. Preserve the category and its label.
  return (bench.knowledge?.amenities ?? [])
    .filter(item => ["toilets", "drinking_water", "fountain"].includes(item.category) && item.distanceMeters !== null && Number.isFinite(item.distanceMeters) && item.distanceMeters >= 0)
    .sort((a, b) => a.distanceMeters! - b.distanceMeters!);
}
