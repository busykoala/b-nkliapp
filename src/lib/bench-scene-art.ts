import type { BenchDetail, LandContext } from "./types";

const UI_ART_ROOT = "/ui-art/v1";

type BenchMaterial = "wood" | "metal" | "stone";
type BenchShape = "back-arm" | "back" | "backless";

export function benchSceneArt(input: {
  landContext: LandContext | null;
  buildingCount100m: number | null;
  buildingObstructionPercent?: number | null;
  hasWater: boolean;
  snowCoverPercent?: number;
  elevationMeters?: number | null;
}) {
  // These are qualitative surroundings, not percentages of a reconstructed
  // photograph. Preserve both water and substantial building evidence.
  const builtUp = input.landContext === "urban" || (input.buildingCount100m ?? 0) >= 5
    || (input.buildingObstructionPercent ?? 0) >= 35;
  const kind = input.hasWater ? builtUp ? "harbour" : "lake"
    : input.landContext === "urban" && (input.buildingCount100m ?? 0) >= 25 ? "city"
      : builtUp ? "village"
        : input.landContext === "forest" || input.landContext === "forest_edge" ? "forest" : "country";
  if (kind === "harbour") return `/ui-art/v3/bench-scene-harbour${(input.snowCoverPercent ?? 0) >= 25 ? "-winter" : ""}.webp`;
  if ((input.snowCoverPercent ?? 0) >= 25) {
    const winterKind = kind === "country" && (input.elevationMeters ?? 0) >= 1600 ? "alpine" : kind;
    return `/ui-art/v2/bench-scene-${winterKind}-winter.webp`;
  }
  if (kind === "lake" || kind === "village") return `/ui-art/v2/bench-scene-${kind}.webp`;
  if (kind === "city") return "/ui-art/v3/bench-scene-city.webp";
  return `${UI_ART_ROOT}/bench-scene-${kind}-v1.webp`;
}

export function benchSpriteArt(input: { material: string; backrest: boolean; armrests: boolean }) {
  const normalized = input.material.toLocaleLowerCase("de-CH");
  const material: BenchMaterial = normalized.includes("stein") || normalized.includes("beton")
    ? "stone"
    : normalized.includes("metall") || normalized.includes("stahl") || normalized.includes("eisen")
      ? "metal"
      : "wood";
  const shape: BenchShape = input.backrest ? input.armrests ? "back-arm" : "back" : "backless";
  return `${UI_ART_ROOT}/bench-${material}-${shape}-v1.webp`;
}

export function seasonOverlayArt(season: BenchDetail["season"]) {
  return `${UI_ART_ROOT}/season-${season}-v1.webp`;
}
