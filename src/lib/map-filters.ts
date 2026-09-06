import type { MapFilters } from "./types";

export function activeMapFilterCount(filters: MapFilters) {
  return Object.values(filters).filter((value) => value !== undefined && value !== "").length;
}

export function matchesLightFilter(actual: boolean | null, requested: boolean | undefined) {
  return requested === undefined || actual === requested;
}
