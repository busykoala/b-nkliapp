import { describe, expect, it } from "vitest";
import { buildContextModel, type ContextFeature } from "./context-model";

const feature = (overrides: Partial<ContextFeature>): ContextFeature => ({
  kind: "building",
  center_latitude: 47.0002,
  center_longitude: 8,
  min_latitude: 47.00018,
  max_latitude: 47.00022,
  min_longitude: 7.99995,
  max_longitude: 8.00005,
  height_meters: 12,
  subtype: "yes",
  ...overrides,
});

describe("near-field context model", () => {
  it("places a northern building into the north-facing horizon bins", () => {
    const model = buildContextModel(47, 8, null, [feature({})]);
    expect(model.horizonProfile[0]).toBeGreaterThan(20);
    expect(model.obstructionTypes[0]).toBe("building");
    expect(model.buildingObstructionPercent).toBeGreaterThan(0);
  });

  it("keeps an empty setting open and explicitly preliminary", () => {
    const model = buildContextModel(47, 8, null, []);
    expect(model.horizonProfile.every((angle) => angle === 0)).toBe(true);
    expect(model.viewLabels).toContain("Freier Nahhorizont");
    expect(model.viewExplanation.join(" ")).toContain("swisstopo");
  });
});
