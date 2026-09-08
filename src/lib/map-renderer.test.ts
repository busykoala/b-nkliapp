import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { addCoreArtLayers, addCoreMapLayers, clusterExpansionZoom, featureCollection, loadMapArt, selectedBenchFeature } from "./map-renderer";
import type { BenchDetail, MapFeature } from "./types";

describe("map rendering", () => {
  it("opens every cluster by at least one level while respecting tightly fitted extents", () => {
    expect(clusterExpansionZoom(7.2, 7.5)).toBe(8.2);
    expect(clusterExpansionZoom(13, 16.4)).toBe(16.4);
    expect(clusterExpansionZoom(17.5, 19)).toBe(18);
  });

  it("preserves bench and cluster data in longitude/latitude order", () => {
    const features: MapFeature[] = [
      { kind: "cluster", id: "cluster", longitude: 7.68, latitude: 46.68, count: 3,
        west: 7.67, south: 46.67, east: 7.69, north: 46.69 },
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
    expect(layer("cluster-hits").paint["circle-radius"]).toEqual(["interpolate", ["linear"], ["get", "count"], 2, 24, 50, 29, 500, 36]);
    expect(layer("benches").paint["circle-color"]).toEqual(layer("selected-bench-core").paint["circle-color"]);
  });

  it("removes hard fallback rings after watercolor markers load", () => {
    const layers = new Set(["clusters", "cluster-count", "benches", "selected-bench-core", "selected-bench-halo"]);
    const setPaintProperty = vi.fn();
    const map = {
      hasImage: () => true,
      getLayer: (id: string) => layers.has(id) ? { id } : undefined,
      addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
      setPaintProperty,
    } as unknown as MapLibreMap;
    addCoreArtLayers(map);
    for (const layer of ["clusters", "benches", "selected-bench-core", "selected-bench-halo"]) {
      expect(setPaintProperty).toHaveBeenCalledWith(layer, "circle-stroke-opacity", 0);
    }
    expect(setPaintProperty).toHaveBeenCalledWith("cluster-count", "text-color", "#344f43");
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
