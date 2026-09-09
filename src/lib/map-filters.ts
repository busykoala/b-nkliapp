import type { MapFilters } from "./types";

export function activeMapFilterCount(filters: MapFilters) {
  return Object.values(filters).filter((value) => value !== undefined && value !== "").length;
}

export function matchesLightFilter(actual: boolean | null, requested: boolean | undefined) {
  return requested === undefined || actual === requested;
}

export function activeMapFilters(filters: MapFilters): Array<{ key: keyof MapFilters; label: string }> {
  const labels: Partial<Record<keyof MapFilters, string>> = {
    backrest: "Rückenlehne", armrest: "Armlehnen", covered: "Überdacht", wheelchair: "Mit Rollstuhl nutzbar",
    fireplaceNearby: "Feuerstelle", wasteBasketNearby: "Abfalleimer",
  };
  const material: Record<string, string> = { wood: "Holz", metal: "Metall", stone: "Stein", concrete: "Beton", plastic: "Kunststoff", mixed: "Gemischt" };
  return (Object.entries(filters) as Array<[keyof MapFilters, MapFilters[keyof MapFilters]]>)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => ({ key, label: key === "sunnyNow" ? `${value ? "Sonne" : "Schatten"} geschätzt`
      : key === "material" ? material[String(value)] ?? String(value)
        : key === "minSeats" ? `Ab ${value} Sitzplätzen`
          : key === "minCommunityRating" ? `Ab ${value} Sternen` : `${value === false ? "Ohne " : ""}${labels[key] ?? key}` }));
}
