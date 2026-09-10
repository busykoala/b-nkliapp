import type { Translator } from "./types";

const surfaces = new Set(["asphalt", "paved", "unpaved", "concrete", "paving_stones", "cobblestone", "sett", "gravel", "fine_gravel", "compacted", "ground", "dirt", "earth", "grass", "sand", "wood", "rock", "pebblestone", "mud"] as const);
const smoothness = new Set(["excellent", "good", "intermediate", "bad", "very_bad", "horrible", "very_horrible", "impassable"] as const);
type SetValue<T> = T extends Set<infer V> ? V : never;

export function surfaceLabel(value: string, t: Translator) {
  return value.split(";").map((part) => {
    const key = part.trim() as SetValue<typeof surfaces>;
    return surfaces.has(key) ? t(`knowledge.surfaces.${key}`) : part;
  }).join(" / ");
}
export function smoothnessLabel(value: string, t: Translator) {
  const key = value as SetValue<typeof smoothness>;
  return smoothness.has(key) ? t(`knowledge.smoothness.${key}`) : value;
}
