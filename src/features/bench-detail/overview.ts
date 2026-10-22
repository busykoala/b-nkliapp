import type { BenchDetail } from "@/lib/types";
import type { Translator } from "@/i18n/types";
import { viewLabel } from "@/i18n/bench-labels";
import { surfaceLabel } from "@/i18n/approach-labels";
import { benchFact } from "./facts";

export type NearbyAmenity = NonNullable<BenchDetail["knowledge"]>["amenities"][number];
export type OverviewFact = { value: string; detail?: string; label?: string };

/** Only resolved observations belong in the visitor summary. Technical evidence stays internal. */
function knownBoolean(bench: BenchDetail, key: "backrest" | "armrest" | "covered" | "wheelchair") {
  const fact = benchFact(bench, key);
  return fact.state === "known" && typeof fact.value === "boolean" ? fact.value : null;
}

export type VisitHint = { kind: "light" | "seating" | "noise"; text: string };

/** A bounded visitor presentation, independent of translated placeholders. */
export function visitHints(bench: BenchDetail, t: Translator): VisitHint[] {
  const hints: VisitHint[] = [];
  if (bench.dayPhase !== "night" && bench.sunnyNow !== null) {
    hints.push({ kind: "light", text: t("bench.visit.lightEstimate", { value: t(bench.sunnyNow ? "bench.overview.sun" : "bench.overview.shade") }) });
  }
  const seating: string[] = [];
  const backrest = knownBoolean(bench, "backrest");
  const armrest = knownBoolean(bench, "armrest");
  if (backrest !== null) seating.push(t(backrest ? "bench.attributes.backrest" : "bench.summary.noBackrest"));
  if (armrest !== null) seating.push(t(armrest ? "bench.attributes.armrest" : "bench.visit.noArmrest"));
  if (seating.length) hints.push({ kind: "seating", text: seating.join(" · ") });
  const minutes = bench.localMinutesNow;
  const period = minutes >= 360 && minutes < 1320 ? "day" : "night";
  const hasNoise = Number.isFinite(minutes) && minutes >= 0 && minutes < 1440
    && bench.knowledge?.noise.some(item => item.period === period && item.value !== null && Number.isFinite(item.value) && item.value >= 0);
  if (hasNoise) {
    const noise = quietSummary(bench, t);
    hints.push({ kind: "noise", text: [noise.value, noise.detail].filter(Boolean).join(" · ") });
  }
  return hints;
}

export function comfortSummary(bench: BenchDetail, t: Translator): OverviewFact {
  const backrest = knownBoolean(bench, "backrest");
  const covered = knownBoolean(bench, "covered");
  const armrest = knownBoolean(bench, "armrest");
  const items: string[] = [];
  if (backrest !== null) items.push(t(backrest ? "bench.attributes.backrest" : "bench.summary.noBackrest"));
  if (covered !== null) items.push(t(covered ? "bench.attributes.covered" : "bench.overview.uncovered"));
  if (armrest === true) items.push(t("bench.attributes.armrest"));
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

/** Only traffic-noise model data informs this summary, never subjective ratings.
 * Product bands describe relative model levels, not health or legal limits.
 * Missing layers cannot establish that a place is quiet. */
export function quietSummary(bench: BenchDetail, t: Translator): OverviewFact {
  // Match the existing traffic model convention used by walk evidence (06–22 h),
  // independently of whether the sun has already set.
  const minutes = bench.localMinutesNow;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 1440) return { value: t("bench.visit.noiseUnknown") };
  const period = minutes >= 360 && minutes < 1320 ? "day" : "night";
  const noise = bench.knowledge?.noise.filter(item => item.period === period && item.value !== null && Number.isFinite(item.value) && item.value >= 0)
    .sort((a, b) => b.value! - a.value!)[0];
  if (!noise) return { value: t("bench.visit.noiseUnknown") };
  const level = noise.value! < 45 ? "noiseLow" : noise.value! < 60 ? "noiseNoticeable" : "noiseHigh";
  return {
    value: t(`bench.visit.${level}`),
    detail: t("bench.visit.noiseEstimate", { source: t(noise.mode === "rail" ? "bench.overview.railNoise" : "bench.overview.roadNoise") }),
  };
}

export function nearbyAmenities(bench: Pick<BenchDetail, "knowledge">): NearbyAmenity[] {
  // A fountain is not necessarily drinking water. Preserve the category and its label.
  return (bench.knowledge?.amenities ?? [])
    .filter(item => ["toilets", "drinking_water", "fountain"].includes(item.category) && item.distanceMeters !== null && Number.isFinite(item.distanceMeters) && item.distanceMeters >= 0)
    .sort((a, b) => a.distanceMeters! - b.distanceMeters!);
}

/** Bench space and a mapped approach do not certify a complete journey. */
export function visitAccessState(bench: Pick<BenchDetail, "properties" | "knowledge">) {
  const approach = bench.knowledge?.approach;
  const space = benchFact(bench, "wheelchair");
  return {
    steps: approach?.steps === true,
    obstacle: approach?.stepFreePossible === false || (space.state === "known" && space.value === false),
    unknown: !approach || approach.steps == null || approach.stepFreePossible == null
      || (approach.unmappedLastMeters ?? 0) > 0 || Boolean(approach.terrainAmbiguity),
  };
}
