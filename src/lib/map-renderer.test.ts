import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { addCoreMapLayers, featureCollection, loadMapArt, selectedBenchFeature } from "./map-renderer";
import type { BenchDetail, MapFeature } from "./types";

describe("map rendering", () => {
  it("preserves bench and cluster data in longitude/latitude order", () => {
    const features: MapFeature[] = [
      { kind: "cluster", id: "cluster", longitude: 7.68, latitude: 46.68, count: 3 },
      { kind: "bench", id: "bench", longitude: 7.69, latitude: 46.69, sunnyNow: false,
        verificationStatus: "unverified", rating: null, viewScore: null, viewType: null },
    ];
    const data = featureCollection(features);
    expect(data.features[0].geometry.coordinates).toEqual([7.68, 46.68]);
    expect(data.features.map((feature) => feature.properties)).toEqual(features);
  });

  it("clears the selection and retains its status without copying detail records", () => {
    expect(selectedBenchFeature().features).toEqual([]);
    const bench = { longitude: 7.69, latitude: 46.69, sunnyNow: null, verificationStatus: "verified" } as BenchDetail;
    expect(selectedBenchFeature(bench).features[0].properties).toEqual({ sunnyNow: null, verificationStatus: "verified" });
  });

  it("keeps 44px click targets and identical status colors for normal and selected benches", () => {
    const addLayer = vi.fn();
    const map = { addSource: vi.fn(), addLayer } as unknown as MapLibreMap;
    addCoreMapLayers(map);
    const layers = addLayer.mock.calls.map(([layer]) => layer);
    const layer = (id: string) => layers.find((item) => item.id === id);
    expect(layer("bench-hits").paint["circle-radius"]).toBe(22);
    expect(layer("benches").paint["circle-color"]).toEqual(layer("selected-bench-core").paint["circle-color"]);
  });

  it("reuses registered GPU images and isolates individual loading failures", async () => {
    const images = new Set(["existing"]);
    const map = {
      hasImage: (id: string) => images.has(id),
      loadImage: vi.fn(async (url: string) => {
        if (url === "/missing.png") throw new Error("missing");
        return { data: "pixels" };
      }),
      addImage: vi.fn((id: string) => images.add(id)),
    };
    await loadMapArt(map as unknown as MapLibreMap, [
      { name: "existing", url: "/existing.png", pixelRatio: 2 },
      { name: "missing", url: "/missing.png", pixelRatio: 2 },
      { name: "new", url: "/new.png", pixelRatio: 2 },
    ]);
    expect(map.loadImage).toHaveBeenCalledTimes(2);
    expect(map.addImage).toHaveBeenCalledExactlyOnceWith("new", "pixels", { pixelRatio: 2 });
  });
});
