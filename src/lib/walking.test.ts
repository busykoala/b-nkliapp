import { expect, it } from "vitest";
import { pathSeconds, pathTimes, routeCells, routeOverlap, type WalkPath } from "./walking";
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
