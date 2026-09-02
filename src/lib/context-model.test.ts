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
    expect(model.viewLabels).toContain("Nahbereich weitgehend offen");
    expect(model.nearOpennessPercent).toBe(100);
    expect(model.viewExplanation.join(" ")).toContain("Gesamtwertung");
  });

  it("does not present nearby water as a confirmed view", () => {
    const model = buildContextModel(47, 8, null, [feature({
      kind: "water",
      center_latitude: 47.001,
      min_latitude: 47.0009,
      max_latitude: 47.0011,
      subtype: "lake",
    })]);
    expect(model.viewLabels).toContain("Wasser im Umfeld");
    expect(model.viewLabels).not.toContain("Seeblick");
  });

  it("does not turn a forest bounding-box overlap into forest containment", () => {
    const model = buildContextModel(46.6622, 7.8092, null, [feature({
      kind: "forest",
      center_latitude: 46.663,
      center_longitude: 7.81,
      min_latitude: 46.661,
      max_latitude: 46.665,
      min_longitude: 7.808,
      max_longitude: 7.813,
    })]);
    expect(model.inForest).toBe(false);
  });

  it("accepts forest only after an exact geometry containment test", () => {
    const model = buildContextModel(47, 8, null, [feature({ kind: "forest", containsBench: true })]);
    expect(model.inForest).toBe(true);
  });

  it("produces a full view score once the terrain and far horizon are present", () => {
    const model = buildContextModel(47, 8, 180, [], {
      elevationMeters: 450,
      horizonProfile: Array(72).fill(2),
      sampleElevations: Array(72 * 106).fill(450).map((value, index) => index === 36 * 106 + 80 ? 1_500 : value),
    });
    expect(model.viewScore).toBeGreaterThan(50);
    expect(model.viewComponents.relief).toBeGreaterThan(0.5);
    expect(model.viewExplanation.join(" ")).toContain("20 km");
  });

  it("recognizes mountain relief without penalizing an Alpine horizon as blocked", () => {
    const model = buildContextModel(46.68654, 7.86468, null, [], {
      elevationMeters: 568,
      horizonProfile: Array(72).fill(12),
      sampleElevations: Array(72 * 106).fill(568).map((value, index) => index % 106 > 70 ? 1_800 : value),
    });
    expect(model.viewLabels).toContain("Bergblick");
    expect(model.viewLabels).not.toContain("Eingeschränkte Aussicht");
    expect(model.viewComponents.openness).toBeGreaterThan(0.6);
  });
});
