import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StyleSpecification } from "maplibre-gl";
import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it, vi } from "vitest";
import {
  BUILDING_PATTERN_ART,
  CORE_MAP_ART,
  benchWashIconExpression,
  buildingPatternExpression,
  DECORATIVE_MAP_ART,
  FALLBACK_MAP_STYLE,
  FULL_ART_BUDGET_BYTES,
  INITIAL_ART_BUDGET_BYTES,
  LOCAL_TRANSIT_FILTER,
  loadWatercolorMapStyle,
  mapDayPalette,
  mapSunLighting,
  TRANSIT_ZOOM,
  TRANSIT_MAP_ART,
  transformWatercolorStyle,
  transitIconExpression,
  transitIconForSubclass,
  transitIconScaleForSubclass,
  transitIconScaleExpression,
  watercolorLayerRank,
  WATERCOLOR_LAYER_ORDER,
} from "./watercolor-map";

const fixture = {
  version: 8,
  sources: { base: { type: "vector", tiles: ["https://example.test/{z}/{x}/{y}.pbf"] } },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#fff" } },
    { id: "hillshade_grey", type: "fill", source: "base", "source-layer": "hillshade", paint: {} },
    { id: "water", type: "fill", source: "base", "source-layer": "water", paint: {} },
    { id: "building", type: "fill", source: "base", "source-layer": "building", paint: {} },
    { id: "road_fill", type: "line", source: "base", "source-layer": "transportation", paint: {} },
    { id: "public_transport", type: "line", source: "base", "source-layer": "transportation", paint: {} },
    { id: "construct", type: "fill", source: "base", "source-layer": "construct", paint: {} },
    { id: "aeroway_polygon_casing", type: "line", source: "base", "source-layer": "aeroway", paint: {} },
    { id: "aeroway_polygon_fill", type: "fill", source: "base", "source-layer": "aeroway", paint: {} },
    { id: "road_number", type: "symbol", source: "base", "source-layer": "transportation_name", layout: {}, paint: {} },
    { id: "aerodrome_label", type: "symbol", source: "base", "source-layer": "aerodrome_label", layout: { "icon-image": "airplane_large_grey" }, paint: {} },
    { id: "poi_rank2", type: "symbol", source: "base", "source-layer": "poi", layout: {}, paint: {} },
  ],
} as StyleSpecification;

function layer(style: StyleSpecification, id: string) {
  return style.layers.find((item) => item.id === id) as { paint?: Record<string, unknown>; layout?: Record<string, unknown> };
}

function assetBytes(url: string) {
  return statSync(join(process.cwd(), "public", url.replace(/^\//, ""))).size;
}

function evaluateTransit(expression: unknown, properties: Record<string, string | number>) {
  const compiled = createExpression(expression);
  if (compiled.result === "error") throw new Error(JSON.stringify(compiled.value));
  return compiled.value.evaluate({ zoom: 16 }, { type: "Point", properties });
}

describe("watercolor map style", () => {
  it("paints terrain, water, buildings, roads and transit without mutating the source style", () => {
    const original = JSON.stringify(fixture);
    const styled = transformWatercolorStyle(fixture);

    expect(JSON.stringify(fixture)).toBe(original);
    expect(layer(styled, "background").paint?.["background-color"]).toBe("#f3e5c4");
    expect(layer(styled, "hillshade_grey").paint?.["fill-color"]).toBeInstanceOf(Array);
    expect(layer(styled, "water").paint?.["fill-color"]).toBe("#5f9ea5");
    expect(layer(styled, "building").paint?.["fill-color"]).toBeInstanceOf(Array);
    expect(layer(styled, "road_fill").paint?.["line-color"]).toBe("#f5dfb2");
    expect(layer(styled, "public_transport").paint?.["line-color"]).toBe("#765a78");
    expect(layer(styled, "construct").paint?.["fill-color"]).toBeInstanceOf(Array);
    expect(layer(styled, "aeroway_polygon_fill").paint?.["fill-color"]).toBeInstanceOf(Array);
    expect(layer(styled, "aeroway_polygon_casing").paint?.["line-opacity"]).toBe(.09);
    expect(layer(styled, "road_number").layout?.visibility).toBe("none");
    expect(layer(styled, "aerodrome_label").layout?.["icon-image"]).toBe("");
    expect(layer(styled, "poi_rank2").layout?.visibility).toBe("none");
  });

  it("keeps the visual groups in the intended painterly layer order", () => {
    const scrambled = { ...fixture, layers: [...fixture.layers].reverse() } as StyleSpecification;
    const styled = transformWatercolorStyle(scrambled);
    const ranks = styled.layers.map(watercolorLayerRank);

    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
    expect(WATERCOLOR_LAYER_ORDER).toEqual([
      "paper", "relief", "vegetation", "water", "buildings", "routes", "labels", "transit", "benches",
    ]);
  });

  it("uses calm transit zoom thresholds and distinct daylight palettes", () => {
    expect(TRANSIT_ZOOM).toEqual({ major: 12, local: 14.5, labels: 16 });
    expect(mapDayPalette("day").background).not.toBe(mapDayPalette("night").background);
    expect(mapDayPalette("dawn").background).not.toBe(mapDayPalette("dusk").background);
    expect(mapSunLighting(Math.PI / 4, 0).directionDegrees).toBe(180);
    expect(mapSunLighting(.1, -Math.PI / 2).shadowTranslate).not.toEqual(mapSunLighting(.1, Math.PI / 2).shadowTranslate);
  });

  it("maps every supported stop family to a dedicated painted icon", () => {
    expect(transitIconForSubclass("railway_station")).toBe("benchly-transit-rail");
    expect(transitIconForSubclass("bus_stop")).toBe("benchly-transit-bus");
    expect(transitIconForSubclass("tram_stop")).toBe("benchly-transit-tram");
    expect(transitIconForSubclass("subway_stop")).toBe("benchly-transit-metro");
    expect(transitIconForSubclass("funicular_stop")).toBe("benchly-transit-funicular");
    expect(transitIconForSubclass("gondola_station")).toBe("benchly-transit-cable-car");
    expect(transitIconForSubclass("cafe")).toBe("");
    expect(transitIconScaleForSubclass("bus_stop")).toBeGreaterThan(1);
    expect(transitIconScaleForSubclass("funicular_stop")).toBeGreaterThan(transitIconScaleForSubclass("bus_stop"));
    expect(transitIconScaleForSubclass("gondola_station")).toBeGreaterThan(transitIconScaleForSubclass("bus_stop"));
  });

  it("degrades a missing artwork independently instead of dropping all markers", () => {
    const benchExpression = benchWashIconExpression(new Set(["benchly-wash-sunny"]));
    const transitExpression = transitIconExpression(new Set(["benchly-transit-bus"]));
    const buildingExpression = buildingPatternExpression(new Set(["benchly-building-roof-ochre"]));

    expect(benchExpression).toContain("benchly-wash-sunny");
    expect(benchExpression).not.toContain("benchly-wash-shade");
    expect(transitExpression).toContain("benchly-transit-bus");
    expect(transitExpression).not.toContain("benchly-transit-rail");
    expect(evaluateTransit(transitExpression, { subclass: "ferry_terminal" })).toBe("");
    expect(evaluateTransit(transitExpression, { subclass: "bus_stop" })).toBe("benchly-transit-bus");
    expect(buildingExpression).toContain("benchly-building-roof-ochre");
    expect(buildingExpression).not.toContain("benchly-building-roof-terracotta");
    expect(BUILDING_PATTERN_ART).toHaveLength(4);
  });

  it("includes Spiez Schiffstation and the other boat-stop classes without treating marinas as transit", () => {
    // Actual POI from swisstopo base.vt/v1.0.0/14/8541/5783.pbf,
    // checked 2026-09-05: 46.68847823652703, 7.6898932456970215.
    const spiez = { class: "ferry_terminal", subclass: "ferry_terminal", "name:latin": "Spiez Schiffstation", station_id: 8507154 };
    const available = new Set(TRANSIT_MAP_ART.map((asset) => asset.name));
    for (const subclass of [spiez.subclass, "ferry", "car_ferry"]) {
      const properties = { ...spiez, subclass };
      expect(evaluateTransit(LOCAL_TRANSIT_FILTER, properties)).toBe(true);
      expect(transitIconForSubclass(subclass)).toBe("benchly-transit-ferry");
      expect(evaluateTransit(transitIconExpression(available), properties)).toBe("benchly-transit-ferry");
      expect(evaluateTransit(transitIconScaleExpression(), properties)).toBe(transitIconScaleForSubclass(subclass));
    }
    for (const subclass of ["marina", "harbour", "cafe"]) {
      expect(evaluateTransit(LOCAL_TRANSIT_FILTER, { subclass })).toBe(false);
      expect(evaluateTransit(transitIconExpression(available), { subclass })).toBe("");
    }
  });

  it("falls back quickly when the remote style never answers", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    const result = await loadWatercolorMapStyle(fetcher as typeof fetch, 5);
    expect(result).toEqual({ style: FALLBACK_MAP_STYLE, basemap: "fallback" });
  });

  it("keeps initial and complete artwork inside the transfer budgets", () => {
    const paperBytes = assetBytes("/map-art/v3/paper.webp");
    const initialBytes = paperBytes + CORE_MAP_ART.reduce((sum, asset) => sum + assetBytes(asset.url), 0);
    const fullBytes = initialBytes
      + DECORATIVE_MAP_ART.reduce((sum, asset) => sum + assetBytes(asset.url), 0)
      + TRANSIT_MAP_ART.reduce((sum, asset) => sum + assetBytes(asset.url), 0);

    expect(initialBytes).toBeLessThanOrEqual(INITIAL_ART_BUDGET_BYTES);
    expect(fullBytes).toBeLessThanOrEqual(FULL_ART_BUDGET_BYTES);
    expect(DECORATIVE_MAP_ART.some((asset) => asset.name === "benchly-airport-airplane")).toBe(true);
  });

  it("ships only registered map artwork and the shared paper texture", () => {
    const directory = join(process.cwd(), "public/map-art");
    const files = readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    const used = ["/map-art/v3/paper.webp", ...CORE_MAP_ART.map((asset) => asset.url),
      ...DECORATIVE_MAP_ART.map((asset) => asset.url), ...TRANSIT_MAP_ART.map((asset) => asset.url)]
      .map((url) => join(process.cwd(), "public", url));
    expect(files.sort()).toEqual([...new Set(used)].sort());
  });
});
