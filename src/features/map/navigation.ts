import type { MapFilters, MapQuery } from "@/lib/types";
import type { Map as MapLibreMap } from "maplibre-gl";

/** Transient camera state. It lives only for the current in-app return path. */
export type MapCameraSnapshot = {
  center: [longitude: number, latitude: number];
  zoom: number;
  bearing: number;
  pitch: number;
};

/**
 * The task underneath a bench inspection. These values are intentionally not
 * persisted: they describe where Back should return during this browser visit.
 */
export type BenchReturnContext =
  | { kind: "map"; camera?: MapCameraSnapshot; cameraInteraction: number }
  | { kind: "list"; benchId: string; scrollTop: number; camera: MapCameraSnapshot; cameraInteraction: number }
  | { kind: "walk" };

/** One semantic foreground task, derived from the map screen's task state. */
export type ActiveMapTask =
  | { kind: "browse" }
  | { kind: "list" }
  | { kind: "bench"; benchId: string; origin: BenchReturnContext["kind"] }
  | { kind: "journey"; benchId: string }
  | { kind: "walk" }
  | { kind: "return-journey" }
  | { kind: "facility"; benchId: string }
  | { kind: "add"; stage: "position" | "details" };

export type BenchHistoryEntry = {
  version: 1;
  task: "bench";
  benchId: string;
  returnContext: BenchReturnContext;
};

export type PendingBenchHistoryClose = {
  benchId: string;
  backStarted: boolean;
};

export type BenchHistoryCloseAction = "wait" | "back" | "complete" | "abandon";

/**
 * Reconciles the synchronous History API URL with Next's asynchronous
 * useSearchParams view while an app-owned bench entry is being closed.
 */
export function benchHistoryCloseAction(
  pending: PendingBenchHistoryClose,
  browserBenchId: string | null,
  routerBenchId: string | null,
): BenchHistoryCloseAction {
  if (browserBenchId === null && routerBenchId === null) return "complete";
  if (!pending.backStarted) {
    if (browserBenchId === pending.benchId && routerBenchId === pending.benchId) return "back";
    if (browserBenchId !== null && browserBenchId !== pending.benchId) return "abandon";
    return "wait";
  }
  if (browserBenchId !== null && browserBenchId !== pending.benchId) return "abandon";
  return "wait";
}

/** Push application data only; Next.js adds its own private history state. */
export function pushBenchHistoryEntry(benchId: string, returnContext: BenchReturnContext) {
  const url = new URL(window.location.href);
  url.searchParams.set("bank", benchId);
  url.searchParams.delete("action");
  url.searchParams.delete("amenity");
  const benchly: BenchHistoryEntry = { version: 1, task: "bench", benchId, returnContext };
  // Copying history.state also copies __NA, which makes Next's history wrapper
  // skip URL synchronization and leaves useSearchParams on the preceding view.
  window.history.pushState({ benchly }, "", `${url.pathname}${url.search}${url.hash}`);
}

export function readBenchHistoryEntry(state: unknown): BenchHistoryEntry | null {
  if (!state || typeof state !== "object" || !("benchly" in state)) return null;
  const entry = (state as { benchly?: unknown }).benchly;
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as Partial<BenchHistoryEntry>;
  if (candidate.version !== 1 || candidate.task !== "bench" || typeof candidate.benchId !== "string" || !candidate.returnContext) return null;
  return candidate as BenchHistoryEntry;
}

export function captureMapCamera(map: MapLibreMap): MapCameraSnapshot {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

export function restoreMapCamera(map: MapLibreMap, camera: MapCameraSnapshot) {
  map.stop();
  map.jumpTo(camera);
}

export function visibleMapQuery(map: MapLibreMap, filters: MapFilters): MapQuery {
  const bounds = map.getBounds();
  return { bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, zoom: map.getZoom(), filters };
}
