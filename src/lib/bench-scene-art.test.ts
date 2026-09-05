import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BenchLandscape } from "../components/bench-landscape";
import type { BenchDetail } from "./types";
import { benchSceneArt, benchSpriteArt, seasonOverlayArt } from "./bench-scene-art";

const uiArtDirectory = join(process.cwd(), "public", "ui-art");
const uiArtFiles = () => readdirSync(uiArtDirectory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));

function largestAsset(matches: (name: string) => boolean) {
  return Math.max(...uiArtFiles()
    .filter(matches)
    .map((name) => statSync(name).size));
}

describe("bench scene artwork", () => {
  it("distinguishes dense cities, villages, forests, water, and open country", () => {
    expect(benchSceneArt({ landContext: "urban", buildingCount100m: 40, hasWater: false })).toContain("scene-city");
    expect(benchSceneArt({ landContext: "urban", buildingCount100m: 12, hasWater: false })).toContain("scene-village");
    expect(benchSceneArt({ landContext: "forest", buildingCount100m: 0, hasWater: false })).toContain("scene-forest");
    expect(benchSceneArt({ landContext: "open", buildingCount100m: 0, hasWater: true })).toContain("scene-lake");
    expect(benchSceneArt({ landContext: "open", buildingCount100m: 0, hasWater: false })).toContain("scene-country");
  });

  it("maps material, backrest, and armrests to the matching bench sprite", () => {
    expect(benchSpriteArt({ material: "Holz", backrest: true, armrests: true })).toContain("bench-wood-back-arm");
    expect(benchSpriteArt({ material: "Metall", backrest: true, armrests: false })).toContain("bench-metal-back-v1");
    expect(benchSpriteArt({ material: "Beton", backrest: false, armrests: true })).toContain("bench-stone-backless");
  });

  it.each([
    { landContext: "urban" as const, buildingCount100m: 40, expected: "/ui-art/v3/bench-scene-harbour" },
    { landContext: "urban" as const, buildingCount100m: 8, expected: "/ui-art/v3/bench-scene-harbour" },
    { landContext: "forest" as const, buildingCount100m: 0, expected: "/ui-art/v2/bench-scene-lake" },
    { landContext: "forest_edge" as const, buildingCount100m: 6, expected: "/ui-art/v3/bench-scene-harbour" },
    { landContext: null, buildingCount100m: null, expected: "/ui-art/v2/bench-scene-lake" },
  ])("keeps water visible despite surrounding land use: %j", (context) => {
    expect(benchSceneArt({ ...context, hasWater: true })).toBe(`${context.expected}.webp`);
    expect(benchSceneArt({ ...context, hasWater: true, snowCoverPercent: 70 })).toBe(`${context.expected}-winter.webp`);
  });

  it.each([
    { waterfront: true, viewLabels: [] },
    { waterfront: null, viewLabels: ["Seeblick"] },
    { waterfront: true, viewLabels: [], landContext: null, buildingCount100m: null, buildingObstructionPercent: 67 },
  ])("renders the water evidence in the actual urban bench illustration: %j", (water) => {
    const bench = {
      landContext: "urban", buildingCount100m: 40,
      dayPhase: "day", season: "summer", sunnyNow: true, weather: null,
      sunAltitudeDegrees: 30, sunAzimuthDegrees: 180, moonIllumination: 0,
      moonPhase: 0, properties: [], ...water,
    } as unknown as BenchDetail;
    const markup = renderToStaticMarkup(createElement(BenchLandscape, { bench }));
    expect(markup).toContain("scene-harbour");
    expect(markup).not.toContain("scene-city");
    // Keep the treatment on the native SVG path for Safari, preserve solid
    // alpha, and constrain processing to the small foreground sprite.
    expect(markup).toContain('color-interpolation-filters="sRGB"');
    expect(markup).toContain('<feFuncA type="identity"');
    expect(markup).toMatch(/<image filter="url\(#[^"]+-bench-pigment\)"/);
  });

  it("uses strong building obstruction even when the land classification is missing", () => {
    const context = { landContext: null, buildingCount100m: null, buildingObstructionPercent: 67, hasWater: true };
    expect(benchSceneArt(context)).toContain("scene-harbour");
    expect(benchSceneArt({ ...context, buildingObstructionPercent: 6 })).toContain("scene-lake");
    expect(benchSceneArt({ ...context, hasWater: false })).not.toContain("harbour");
    expect(benchSceneArt({ ...context, snowCoverPercent: 70 })).toContain("harbour-winter");
  });

  it("selects the current seasonal overlay", () => {
    expect(seasonOverlayArt("spring")).toContain("season-spring");
    expect(seasonOverlayArt("winter")).toContain("season-winter");
  });

  it("uses snowy landscapes only with snow evidence, retaining the actual setting", () => {
    const lake = { landContext: "open" as const, buildingCount100m: 0, hasWater: true };
    expect(benchSceneArt(lake)).not.toContain("winter");
    expect(benchSceneArt({ ...lake, snowCoverPercent: 70 })).toContain("lake-winter");
    expect(benchSceneArt({ ...lake, hasWater: false, snowCoverPercent: 70, elevationMeters: 2200 })).toContain("alpine-winter");
    expect(benchSceneArt({ ...lake, landContext: "forest", hasWater: false, snowCoverPercent: 70 })).toContain("forest-winter");
  });

  it("keeps contextual and complete UI artwork inside the transfer budgets", () => {
    const files = uiArtFiles();
    // A shoulder season can also have a light snow overlay. Include both, plus
    // the shared paper texture and the optional shelter, in the worst case.
    const contextualBytes = statSync(join(process.cwd(), "public/map-art/v3/paper.webp")).size
      + statSync(join(uiArtDirectory, "v2", "bench-shelter.webp")).size
      + largestAsset((name) => name.includes("/season-")) + [
      (name: string) => name.includes("/bench-scene-"),
      (name: string) => /\/bench-(wood|metal|stone)-/.test(name),
      (name: string) => name.includes("/season-"),
      (name: string) => name.includes("/celestial-"),
      (name: string) => name.includes("/weather-"),
    ].reduce((sum, matches) => sum + largestAsset(matches), 0);
    const completeBytes = files.reduce((sum, name) => sum + statSync(name).size, 0);

    expect(contextualBytes).toBeLessThanOrEqual(400 * 1024);
    expect(completeBytes).toBeLessThanOrEqual(800 * 1024);
  });
});
