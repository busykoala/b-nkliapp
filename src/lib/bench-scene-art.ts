import type { BenchDetail, LandContext, PrecipitationType } from "./types";

const UI_ART_ROOT = "/ui-art/v1";
const SCENE_ART_ROOT = "/ui-art/v4";
const WATER_ART_ROOT = "/ui-art/v5";

type BenchMaterial = "wood" | "metal" | "stone";
type BenchShape = "back-arm" | "back" | "backless";
export type ScenePlace = "city" | "village" | "forest" | "open";
export type SceneRelief = "mountains" | "hills" | "none";
export type SceneWater = "lake" | "river" | "none";

export type BenchSceneLayers = {
  place: ScenePlace;
  relief: SceneRelief;
  water: SceneWater;
  snowy: boolean;
  placeArt: string;
  groundArt: string;
  reliefArt: string | null;
  waterArt: string | null;
};

function hasLabel(labels: string[], value: string) {
  return labels.some((label) => label.toLocaleLowerCase("de-CH").includes(value));
}

/** Resolve independent scene facts. Proximity alone never becomes a view. */
export function benchSceneLayers(input: {
  landContext: LandContext | null;
  buildingCount100m: number | null;
  buildingObstructionPercent?: number | null;
  viewLabels: string[];
  waterView?: number | null;
  snowCoverPercent?: number;
  precipitationType?: PrecipitationType;
}): BenchSceneLayers {
  const buildings = input.buildingCount100m ?? 0;
  const builtUp = input.landContext === "urban" || buildings >= 5 || (input.buildingObstructionPercent ?? 0) >= 35;
  const place: ScenePlace = input.landContext === "forest" || input.landContext === "forest_edge"
    ? "forest"
    : input.landContext === "urban" && buildings >= 25
      ? "city"
      : builtUp ? "village" : "open";

  const relief: SceneRelief = hasLabel(input.viewLabels, "bergblick")
    ? "mountains"
    : hasLabel(input.viewLabels, "hügelblick")
      ? "hills"
      : "none";
  const visibleWater = (input.waterView ?? 0) >= .5;
  const water: SceneWater = visibleWater && hasLabel(input.viewLabels, "seeblick")
    ? "lake"
    : visibleWater && hasLabel(input.viewLabels, "wasserblick")
      ? "river"
      : "none";
  const snowy = (input.snowCoverPercent ?? 0) >= 20 || input.precipitationType === "snow" || input.precipitationType === "mixed";

  return {
    place,
    relief,
    water,
    snowy,
    placeArt: `${SCENE_ART_ROOT}/place-${place}.webp`,
    groundArt: `${SCENE_ART_ROOT}/place-open.webp`,
    reliefArt: relief === "none" ? null : `${SCENE_ART_ROOT}/relief-${relief}.webp`,
    waterArt: water === "none" ? null : `${WATER_ART_ROOT}/water-${water}.webp`,
  };
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
