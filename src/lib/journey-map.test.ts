import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { calculateJourneyPadding, claimJourneyMap, clearJourneyMap, paintJourney, releaseJourneyMap } from "./journey-map";
import { summarizeJourney, type JourneyLeg } from "./journey";

const point = { label: "Spiez", latitude: 46.68844, longitude: 7.68949 };
const leg: JourneyLeg = { id: "foot", mode: "walk", from: point, to: point, departure: "2026-09-05T08:00:00Z", arrival: "2026-09-05T08:01:00Z", predicted: false, durationSeconds: 60, geometry: [[7.689, 46.688], [7.68949, 46.68844]], geometryQuality: "routed", warnings: [] };

function mapFixture(ready = true) {
  const sources = new Map<string, { data: GeoJSON.FeatureCollection; setData: (data: GeoJSON.FeatureCollection) => void }>();
  const layers = new Map<string, unknown>();
  const stub = {
    isStyleLoaded: () => ready,
    getSource: (id: string) => sources.get(id), getLayer: (id: string) => id === "clusters" ? { id } : layers.get(id),
    addSource: vi.fn((id: string, source: { data: GeoJSON.FeatureCollection }) => sources.set(id, { ...source, setData(data) { this.data = data; } })),
    addLayer: vi.fn((layer: { id: string }) => layers.set(layer.id, layer)),
    removeLayer: (id: string) => layers.delete(id), removeSource: (id: string) => sources.delete(id),
  };
  return { sources, layers, stub, map: stub as unknown as MapLibreMap };
}
describe("journey map layers", () => {
  it("preserves walking coordinates, omits unknown paths and reuses GPU sources", () => {
    const { map, sources, layers, stub } = mapFixture();
    const option = summarizeJourney("a", [leg, { ...leg, id: "unknown", geometry: [], geometryQuality: "missing" }]);
    expect(paintJourney(map, [option], "a", "foot")).toBe(true);
    const data = sources.get("journey-route")!.data;
    expect(data.features).toHaveLength(1);
    expect(data.features[0].geometry).toEqual({ type: "LineString", coordinates: leg.geometry });
    expect(data.features[0].properties).toMatchObject({ selected: true, active: true });
    paintJourney(map, [option], "a", null);
    expect(stub.addSource).toHaveBeenCalledTimes(2);
    expect(layers.size).toBe(4);
    clearJourneyMap(map);
    expect(sources.size).toBe(0); expect(layers.size).toBe(0);
  });
  it("defers until the base style is usable", () => {
    const { map, sources } = mapFixture(false);
    expect(paintJourney(map, [summarizeJourney("a", [leg])], "a", null)).toBe(false);
    expect(sources.size).toBe(0);
  });
  it("prevents an obsolete planner from clearing a newer route", () => {
    const { map, sources } = mapFixture();
    const option = summarizeJourney("a", [leg]);
    const older = claimJourneyMap(map);
    expect(paintJourney(map, [option], "a", null, older)).toBe(true);

    const newer = claimJourneyMap(map);
    expect(paintJourney(map, [option], "a", null, newer)).toBe(true);
    expect(releaseJourneyMap(map, older)).toBe(false);
    expect(sources.has("journey-route")).toBe(true);
    expect(paintJourney(map, [option], "a", null, older)).toBe(false);

    expect(releaseJourneyMap(map, newer)).toBe(true);
    expect(sources.size).toBe(0);
  });
  it("derives route padding from the rendered sheet instead of viewport fractions", () => {
    const map = { top: 0, right: 400, bottom: 800, left: 0, width: 400, height: 800 };
    expect(calculateJourneyPadding(map, { top: 480, right: 400, bottom: 800, left: 0, width: 400, height: 320 }, { top: 0, right: 400, bottom: 72, left: 0, width: 400, height: 72 })).toEqual({ top: 88, right: 24, bottom: 344, left: 24 });
    expect(calculateJourneyPadding(map, { top: 72, right: 400, bottom: 800, left: 200, width: 200, height: 728 })).toEqual({ top: 24, right: 224, bottom: 24, left: 24 });
  });
  it("retains a valid drawable area when a full sheet overlaps the toolbar", () => {
    expect(calculateJourneyPadding(
      { top: 0, left: 0, right: 390, bottom: 664, width: 390, height: 664 },
      { top: 72, left: 0, right: 390, bottom: 664, width: 390, height: 592 },
      { top: 0, left: 0, right: 390, bottom: 112, width: 390, height: 112 },
    )).toEqual({ top: 128, right: 24, bottom: 408, left: 24 });
  });
});
