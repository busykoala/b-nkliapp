import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DIALECT_AREAS } from "@/i18n/dialects/registry.generated";

type Artifact = {
  metadata: { areaCount: number; generatedFrom: string; sourceArchiveSha256: string; bfsSourceArchiveSha256: string; method: string };
  territory: { type: string; coordinates: unknown };
  languageAreas: Array<{ properties: { language: string }; geometry: { type: string; coordinates: unknown } }>;
  languageAreaFallbacks: Array<{ properties: { language: string }; geometry: { type: string; coordinates: unknown } }>;
  features: Array<{ properties: { areaId: string; municipalities: Array<{ bfsId: number; name: string }> }; geometry: { type: string; coordinates: unknown } }>;
};

let artifact: Artifact;

function positions(value: unknown, result: number[][] = []): number[][] {
  if (!Array.isArray(value)) return result;
  if (typeof value[0] === "number" && typeof value[1] === "number") result.push(value as number[]);
  else for (const child of value) positions(child, result);
  return result;
}

beforeAll(() => {
  artifact = JSON.parse(readFileSync(join(process.cwd(), "config/dialects/areas.generated.json"), "utf8"));
});

describe("versioned dialect geography", () => {
  it("contains only licensed explicit municipality assignments", () => {
    expect(artifact.metadata).toMatchObject({
      areaCount: 127,
      generatedFrom: "swissBOUNDARIES3D_2026-01",
      sourceArchiveSha256: "68e922353c76fa5db3cef06a32f9711c0198faa6fbd2b5bcde9edc88b0f8999f",
      bfsSourceArchiveSha256: "2ac8a8d68929f63c5f3f2ed5dee72c3c3a3fc4a64077072fcade53135f2191a6",
      method: "union-of-explicit-current-municipality-anchors",
    });
    expect(artifact.features).toHaveLength(artifact.metadata.areaCount);
    expect(artifact.languageAreas.map((area) => area.properties.language).sort()).toEqual(["de", "fr", "it", "rm"]);
    expect(artifact.languageAreaFallbacks.map((area) => area.properties.language).sort()).toEqual(["de", "fr", "it", "rm"]);
    const validAreaIds = new Set<string>(DIALECT_AREAS.map((area) => area.id));
    for (const feature of artifact.features) {
      expect(validAreaIds.has(feature.properties.areaId), feature.properties.areaId).toBe(true);
      expect(feature.properties.municipalities.length, feature.properties.areaId).toBeGreaterThan(0);
      expect(["Polygon", "MultiPolygon"]).toContain(feature.geometry.type);
    }
  });

  it("contains compact 2D WGS84 coordinates", () => {
    for (const position of [...positions(artifact.territory.coordinates), ...artifact.languageAreas.flatMap((feature) => positions(feature.geometry.coordinates)), ...artifact.languageAreaFallbacks.flatMap((feature) => positions(feature.geometry.coordinates)), ...artifact.features.flatMap((feature) => positions(feature.geometry.coordinates))]) {
      expect(position).toHaveLength(2);
      expect(position[0]).toBeGreaterThanOrEqual(5.7);
      expect(position[0]).toBeLessThanOrEqual(10.8);
      expect(position[1]).toBeGreaterThanOrEqual(45.7);
      expect(position[1]).toBeLessThanOrEqual(48.0);
    }
  });

  it("resolves representative coordinates and rejects foreign locations", async () => {
    const { spatialDialectResolution } = await import("./spatial");
    expect(spatialDialectResolution(47.3769, 8.5417)).toMatchObject({ insideSwitzerland: true, languageArea: "de", areaIds: expect.arrayContaining(["zh-core"]) });
    expect(spatialDialectResolution(46.5197, 6.6323)).toMatchObject({ insideSwitzerland: true, languageArea: "fr", areaIds: expect.arrayContaining(["fr-vaud"]) });
    expect(spatialDialectResolution(46.0037, 8.9511)).toMatchObject({ insideSwitzerland: true, languageArea: "it", areaIds: expect.arrayContaining(["lmo-luganese"]) });
    expect(spatialDialectResolution(46.7951, 10.2948)).toMatchObject({ insideSwitzerland: true, languageArea: "rm", areaIds: expect.arrayContaining(["rm-vallader"]) });
    expect(spatialDialectResolution(48.8566, 2.3522)).toEqual({ insideSwitzerland: false, areaIds: [], languageArea: null, sourceVersion: "swissBOUNDARIES3D_2026-01+sprg20220501" });
  });
});
