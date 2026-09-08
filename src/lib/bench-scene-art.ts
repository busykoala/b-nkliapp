import type { BenchDetail, LandContext, PrecipitationType } from "./types";

const BENCH_ART_ROOT = "/ui-art/benches";
const SCENE_ART_ROOT = "/ui-art/scenes";
const SEASON_ART_ROOT = "/ui-art/seasons";

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

export type BenchSceneComposition = {
  builtWaterfront: boolean;
  placeX: number;
  waterX: number;
  waterY: number;
  waterWidth: number;
  waterHeight: number;
  benchOffsetX: number;
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
    waterArt: water === "none" ? null : `${SCENE_ART_ROOT}/water-${water}.webp`,
  };
}

/** Arrange independent motifs as one view. At a built waterfront, water is
 * the view to the left rather than a translucent sheet over the settlement. */
export function benchSceneComposition(scene: Pick<BenchSceneLayers, "place" | "water">): BenchSceneComposition {
  const hasWater = scene.water !== "none";
  const builtWaterfront = hasWater && (scene.place === "city" || scene.place === "village");
  const builtRiver = builtWaterfront && scene.water === "river";
  return {
    builtWaterfront,
    placeX: 0,
    waterX: builtRiver ? -18 : builtWaterfront ? -58 : 0,
    waterY: scene.water === "river" ? 128 : builtWaterfront ? 80 : 0,
    waterWidth: scene.water === "river" ? builtRiver ? 550 : 610 : builtWaterfront ? 560 : 640,
    waterHeight: scene.water === "river" ? 352 : builtWaterfront ? 400 : 480,
    benchOffsetX: hasWater ? 82 : 0,
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
  return `${BENCH_ART_ROOT}/${material}-${shape}.webp`;
}

export function seasonOverlayArt(season: BenchDetail["season"]) {
  return `${SEASON_ART_ROOT}/${season}.webp`;
}
