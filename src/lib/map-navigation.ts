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
