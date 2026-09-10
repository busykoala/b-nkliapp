import type { MapFilters } from "./types";
import type { Translator } from "@/i18n/types";

export function activeMapFilterCount(filters: MapFilters) {
  return Object.values(filters).filter((value) => value !== undefined && value !== "").length;
}

export function matchesLightFilter(actual: boolean | null, requested: boolean | undefined) {
  return requested === undefined || actual === requested;
}

export function activeMapFilters(filters: MapFilters, t: Translator): Array<{ key: keyof MapFilters; label: string }> {
  const labels: Partial<Record<keyof MapFilters, string>> = {
    backrest: t("bench.attributes.backrest"), armrest: t("bench.attributes.armrest"), covered: t("bench.attributes.covered"), wheelchair: t("bench.attributes.wheelchair"),
    fireplaceNearby: t("map.filters.fireplace"), wasteBasketNearby: t("map.filters.bin"),
  };
  const material: Record<string, string> = { wood: t("bench.materials.wood"), metal: t("bench.materials.metal"), stone: t("bench.materials.stone"), concrete: t("bench.materials.concrete"), plastic: t("bench.materials.plastic"), mixed: t("bench.materials.mixed") };
  return (Object.entries(filters) as Array<[keyof MapFilters, MapFilters[keyof MapFilters]]>)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => ({ key, label: key === "sunnyNow" ? t(value ? "map.filters.sunEstimate" : "map.filters.shadeEstimate")
      : key === "material" ? material[String(value)] ?? String(value)
        : key === "minSeats" ? t("map.filters.seatsFrom", { count: Number(value) })
          : key === "minCommunityRating" ? t("map.filters.starsFrom", { count: Number(value) }) : value === false ? t("map.filters.without", { label: labels[key] ?? key }) : labels[key] ?? key }));
}
