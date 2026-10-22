import type { MessageKey, Translator } from "@/i18n/types";
import type { BenchDetail } from "./types";

export const miniatureGroupSizes = {
  pause: 8, sun: 8, shade: 8, rain: 8, snow: 8, night: 8,
  mountains: 8, water: 8, forest: 8, autumn: 8,
  spring: 4, summer: 4, winter: 4, twilight: 4,
} as const;
export type MiniatureGroup = keyof typeof miniatureGroupSizes;
// Catalog validation also checks each complete, authored miniature.
export const poemGroupSizes = Object.fromEntries(Object.entries(miniatureGroupSizes).map(([group, count]) => [`miniatures.${group}`, count]));

export function poemHash(value: string) {
  let result = 2166136261;
  for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); }
  return result >>> 0;
}

/** The scene's timestamp, not the browser clock, makes server and client agree. */
export function sceneLocalDate(bench: Pick<BenchDetail, "skyObservedAt">) {
  const date = new Date(bench.skyObservedAt ?? "");
  if (!Number.isFinite(date.getTime())) return "undated";
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

export function eligibleMiniatures(bench: BenchDetail): MiniatureGroup[] {
  if (bench.dayPhase === "night" || bench.shadeCause === "nacht") return ["night"];
  if (bench.weather?.precipitationType === "snow") return ["snow"];
  if (bench.weather?.precipitationType === "rain" || bench.weather?.precipitationType === "mixed") return ["rain"];
  if (bench.dayPhase === "dawn" || bench.dayPhase === "dusk") return ["twilight"];
  const groups: MiniatureGroup[] = ["pause"];
  const hasView = (pattern: RegExp) => bench.viewLabels.some(label => pattern.test(label));
  if (hasView(/berg/i)) groups.push("mountains");
  if (bench.waterfront || hasView(/see|wasser|fluss/i)) groups.push("water");
  if (bench.inForest) groups.push("forest");
  // Potential direct sun alone does not prove that the weather is sunny.
  if (bench.sunnyNow === true && bench.weather?.cloudCover != null && bench.weather.cloudCover < .35) groups.push("sun");
  if (bench.sunnyNow === false) groups.push("shade");
  if (bench.season) groups.push(bench.season);
  return groups;
}

export function selectMiniature(bench: BenchDetail) {
  const date = sceneLocalDate(bench);
  const groups = eligibleMiniatures(bench);
  const group = groups[poemHash(`${bench.id}:${date}:${bench.dayPhase}:${groups.join(":")}`) % groups.length];
  const day = date === "undated" ? 0 : Math.floor(Date.parse(date) / 86_400_000);
  const variant = (poemHash(`${bench.id}:${group}`) + day) % miniatureGroupSizes[group] + 1;
  return { group, variant, key: `poetry.miniatures.${group}.v${variant}` as MessageKey };
}

export function scenePoem(bench: BenchDetail, t: Translator) {
  const selection = selectMiniature(bench);
  return { ...selection, text: t(selection.key) };
}
