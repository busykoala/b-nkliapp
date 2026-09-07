import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BenchLandscape } from "../components/bench-landscape";
import type { BenchDetail } from "./types";
import { benchSceneLayers, benchSpriteArt, seasonOverlayArt } from "./bench-scene-art";

const uiArtDirectory = join(process.cwd(), "public", "ui-art");
const uiArtFiles = () => readdirSync(uiArtDirectory, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));

function largestAsset(matches: (name: string) => boolean) {
  return Math.max(...uiArtFiles()
    .filter(matches)
    .map((name) => statSync(name).size));
}

describe("bench scene artwork", () => {
  it("keeps place, relief and water as independent layers", () => {
    expect(benchSceneLayers({ landContext: "urban", buildingCount100m: 40, viewLabels: ["Bergblick", "Seeblick"], waterView: 1 }))
      .toMatchObject({ place: "city", relief: "mountains", water: "lake" });
    expect(benchSceneLayers({ landContext: "urban", buildingCount100m: 12, viewLabels: ["Hügelblick", "Wasserblick"], waterView: .8 }))
      .toMatchObject({ place: "village", relief: "hills", water: "river" });
    expect(benchSceneLayers({ landContext: "forest", buildingCount100m: 0, viewLabels: [], waterView: 0 }))
      .toMatchObject({ place: "forest", relief: "none", water: "none" });
  });

  it("maps material, backrest, and armrests to the matching bench sprite", () => {
    expect(benchSpriteArt({ material: "Holz", backrest: true, armrests: true })).toContain("bench-wood-back-arm");
    expect(benchSpriteArt({ material: "Metall", backrest: true, armrests: false })).toContain("bench-metal-back-v1");
    expect(benchSpriteArt({ material: "Beton", backrest: false, armrests: true })).toContain("bench-stone-backless");
  });

  it("does not turn waterfront proximity or weak water evidence into a lake", () => {
    expect(benchSceneLayers({ landContext: "open", buildingCount100m: 0, viewLabels: ["Wasser im Umfeld"], waterView: .8 }).water).toBe("none");
    expect(benchSceneLayers({ landContext: "open", buildingCount100m: 0, viewLabels: ["Seeblick"], waterView: .35 }).water).toBe("none");
    expect(benchSceneLayers({ landContext: "open", buildingCount100m: 0, viewLabels: ["Seeblick"], waterView: .9 }).water).toBe("lake");
  });

  it.each([
    { viewLabels: ["Seeblick"], water: 1, expected: "water-lake" },
    { viewLabels: ["Wasserblick"], water: .8, expected: "water-river" },
    { viewLabels: ["Wasser im Umfeld"], water: 1, expected: "water-none" },
  ])("renders only supported water evidence in the actual illustration: %j", ({ viewLabels, water, expected }) => {
    const bench = {
      landContext: "urban", buildingCount100m: 40,
      dayPhase: "day", season: "summer", sunnyNow: true, weather: null,
      sunAltitudeDegrees: 30, sunAzimuthDegrees: 180, moonIllumination: 0,
      moonPhase: 0, properties: [], viewLabels, viewComponents: { water },
    } as unknown as BenchDetail;
    const markup = renderToStaticMarkup(createElement(BenchLandscape, { bench }));
    expect(markup).toContain("scene-city");
    expect(markup).toContain(expected);
    // Keep the treatment on the native SVG path for Safari, preserve solid
    // alpha, and constrain processing to the small foreground sprite.
    expect(markup).toContain('color-interpolation-filters="sRGB"');
    expect(markup).toContain('<feFuncA type="identity"');
    expect(markup).toMatch(/<image filter="url\(#[^"]+-bench-pigment\)"/);
  });

  it("uses strong building obstruction when land classification is missing", () => {
    const context = { landContext: null, buildingCount100m: null, viewLabels: [] };
    expect(benchSceneLayers({ ...context, buildingObstructionPercent: 67 }).place).toBe("village");
    expect(benchSceneLayers({ ...context, buildingObstructionPercent: 6 }).place).toBe("open");
  });

  it("selects the current seasonal overlay", () => {
    expect(seasonOverlayArt("spring")).toContain("season-spring");
    expect(seasonOverlayArt("winter")).toContain("season-winter");
  });

  it("combines snow with the actual setting rather than selecting a winter location", () => {
    const lake = { landContext: "open" as const, buildingCount100m: 0, viewLabels: ["Seeblick", "Bergblick"], waterView: 1 };
    expect(benchSceneLayers(lake)).toMatchObject({ place: "open", relief: "mountains", water: "lake", snowy: false });
    expect(benchSceneLayers({ ...lake, snowCoverPercent: 70 })).toMatchObject({ place: "open", relief: "mountains", water: "lake", snowy: true });
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

    expect(contextualBytes).toBeLessThanOrEqual(460 * 1024);
    expect(completeBytes).toBeLessThanOrEqual(1_200 * 1024);
  });
});
