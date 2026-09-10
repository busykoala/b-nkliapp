import type { MessageKey, Translator } from "@/i18n/types";
import type { BenchDetail } from "./types";

type Poem = { first: string; second: string };

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export const poemGroupSizes = {
  "light.moon": 8,
  "light.night": 6,
  "light.unknown": 4,
  "light.sun": 8,
  "light.building": 5,
  "light.vegetation": 6,
  "light.terrain": 4,
  "light.roof": 4,
  "light.shade": 6,
  "weather.snow": 5,
  "weather.rain": 5,
  "weather.mixed": 4,
  "weather.overcast": 4,
  "weather.cloudy": 4,
  "weather.wind": 4,
  "view.mountains": 8,
  "view.hills": 6,
  "view.water": 7,
  "view.forest": 6,
  "view.open": 6,
  "view.limited": 5,
  "view.quiet": 6,
  "seat.roof": 4,
  "seat.support": 4,
  "seat.backrest": 5,
  "seat.wood": 4
} as const;

function choose(group: keyof typeof poemGroupSizes, seed: number, salt: number, t: Translator) {
  const variant = ((seed + Math.imul(salt, 2654435761)) >>> 0) % poemGroupSizes[group] + 1;
  // Group sizes are checked against every catalog; variant selection stays locale independent.
  return t(`poetry.${group}.v${variant}` as MessageKey);
}

function hasView(bench: BenchDetail, fragment: string) {
  return bench.viewLabels.some((label) => label.toLocaleLowerCase("de-CH").includes(fragment));
}

function lightLine(bench: BenchDetail, seed: number, t: Translator) {
  if (bench.shadeCause === "nacht") {
    return bench.moonVisible
      ? choose("light.moon", seed, 1, t)
      : choose("light.night", seed, 1, t);
  }
  if (bench.sunnyNow === null) {
    return choose("light.unknown", seed, 1, t);
  }
  if (bench.sunnyNow) {
    return choose("light.sun", seed, 1, t);
  }
  const phrases = bench.shadeCause === "gebäude"
    ? "light.building"
      : bench.shadeCause === "vegetation"
      ? "light.vegetation"
      : bench.shadeCause === "gelände"
        ? "light.terrain"
        : bench.shadeCause === "überdacht"
          ? "light.roof"
          : "light.shade";
  return choose(phrases, seed, 1, t);
}

function weatherLine(bench: BenchDetail, seed: number, t: Translator) {
  const weather = bench.weather;
  if (!weather) return null;
  if (weather.precipitationType === "snow") return choose("weather.snow", seed, 2, t);
  if (weather.precipitationType === "rain") return choose("weather.rain", seed, 2, t);
  if (weather.precipitationType === "mixed") return choose("weather.mixed", seed, 2, t);
  if (weather.cloudCover >= .78) return choose("weather.overcast", seed, 2, t);
  if (weather.cloudCover >= .35) return choose("weather.cloudy", seed, 2, t);
  if ((weather.windKmh ?? 0) >= 20) return choose("weather.wind", seed, 2, t);
  return null;
}

function viewLine(bench: BenchDetail, seed: number, t: Translator) {
  if (hasView(bench, "berg")) return choose("view.mountains", seed, 3, t);
  if (hasView(bench, "hügel")) return choose("view.hills", seed, 3, t);
  if (bench.waterfront || hasView(bench, "see") || hasView(bench, "wasser")) return choose("view.water", seed, 3, t);
  if (bench.inForest || hasView(bench, "wald")) return choose("view.forest", seed, 3, t);
  if (hasView(bench, "weit")) return choose("view.open", seed, 3, t);
  if (hasView(bench, "eingeschränkt") || hasView(bench, "keine besondere")) return choose("view.limited", seed, 3, t);
  return choose("view.quiet", seed, 3, t);
}

function benchLine(bench: BenchDetail, seed: number, t: Translator) {
  const property = (key: string) => bench.properties.find((item) => item.key === key)?.value;
  const backrest = property("backrest") === "Ja";
  const armrests = property("armrest") === "Ja";
  const covered = property("covered") === "Ja";
  const material = property("material");
  if (covered) return choose("seat.roof", seed, 4, t);
  if (backrest && armrests) return choose("seat.support", seed, 4, t);
  if (backrest) return choose("seat.backrest", seed, 4, t);
  if (material === "Holz") return choose("seat.wood", seed, 4, t);
  return null;
}

export function scenePoem(bench: BenchDetail, t: Translator): Poem {
  // The wording moves with the hourly scene while remaining stable during a visit.
  const seed = hash(`${bench.id}:${Math.floor(bench.localMinutesNow / 60)}:${bench.season}`);
  const light = lightLine(bench, seed, t);
  const weather = weatherLine(bench, seed, t);
  const view = viewLine(bench, seed, t);
  const seat = benchLine(bench, seed, t);
  const second = weather && weather !== light ? `${weather} — ${view}` : seat ?? view;
  return { first: `${light}.`, second: `${second}.` };
}
