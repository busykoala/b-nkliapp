import { expect, it } from "vitest";
import { pathSeconds, pathTimes, routeAccessibility, routeCells, routeOverlap, type WalkPath } from "@/features/routing/walking";
const path: WalkPath = { geometry: [[7.6, 46.6], [7.6001, 46.6], [7.601, 46.6]], distance: 100, referenceSeconds: 100, ascent: 20, warnings: [], instructions: [], details: { time: [[0, 1, 50000], [1, 2, 50000]] } };
it("uses provider slope time, not flat distance or vertex count", () => {
  expect(pathSeconds(path, 5)).toBe(100);
  expect(pathTimes(path, 5)).toEqual([0, 50, 100]);
  expect(pathTimes(path, 3).at(-1)).toBe(167);
});
it("recognises repeated sections regardless of walking direction", () => {
  const reversed = { ...path, geometry: [...path.geometry].reverse() };
  expect(routeOverlap(routeCells(path), routeCells(reversed))).toBeGreaterThan(.5);
});
it("summarises mapped stairs, slope and surfaces without claiming universal accessibility", () => {
  expect(routeAccessibility({ ...path, details: {
    road_class: [[0, 1, "steps"], [1, 2, "path"]],
    average_slope: [[0, 1, -12.4], [1, 2, 4]],
    surface: [[0, 1, "paving_stones"], [1, 2, "asphalt"]],
  } })).toMatchObject({ steps: "present", maximumSlopePercent: 12.4, surfaces: ["paving_stones", "asphalt"] });
  expect(routeAccessibility({ ...path, details: { road_class: [[0, 2, "footway"]] } }).steps).toBe("none");
  expect(routeAccessibility({ ...path, details: {} }).steps).toBe("unknown");
});
