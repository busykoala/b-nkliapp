import { describe, expect, it } from "vitest";
import { benchVisits, restCoverage, restWaypoints } from "./rest-stops";
import type { WalkBench, WalkQuery } from "./model";
import type { WalkPath } from "../walking";
const bench = (id: string, longitude: number): WalkBench => ({ id, label: id, name: id, longitude, latitude: 47, waterfront: false, quality: null });
const query: WalkQuery = { origin: { label: "Start", kind: "location", longitude: 8, latitude: 47 }, minutes: 30, shape: "one-way", light: "any", speed: 4.2, difficulty: "easy", time: "2026-09-09T10:00:00Z", maxRestMinutes: 5 };
const path: WalkPath = { geometry: [[8, 47], [8.03, 47]], distance: 2275, referenceSeconds: 1008, ascent: 0, warnings: [], details: {}, instructions: [] };
const benches = [.006, .012, .018, .024, .03].map((offset, index) => bench(`b${index}`, 8 + offset));

describe("maximum gap between actual rest opportunities", () => {
  it("counts benches on segments even when routing vertices are sparse", () => {
    const coverage = restCoverage(path, benches, query)!;
    expect(coverage).not.toBeNull();
    expect(coverage.maxGapSeconds).toBeCloseTo(240, 3);
    expect(coverage.stops).toHaveLength(4);
  });
  it("checks the first and last walking legs and never counts a nearby disconnected seat", () => {
    expect(restCoverage(path, benches.slice(1), query)).toBeNull();
    expect(restCoverage(path, benches.slice(0, 3), query)).toBeNull();
    expect(restCoverage(path, benches.map((b) => ({ ...b, latitude: 47.0001 })), query)).toBeNull();
    expect(restCoverage({ ...path, warnings: ["Zwischenhalt: Zugang prüfen"] }, benches, query)).toBeNull();
  });
  it("uses the chosen pace and slope-aware intervals", () => {
    expect(restCoverage(path, benches, { ...query, speed: 3 })).toBeNull();
    const steep = { ...path, geometry: [[8, 47], [8.006, 47], [8.03, 47]] as [number, number][], details: { time: [[0, 1, 500_000], [1, 2, 508_000]] as [number, number, number][] } };
    expect(restCoverage(steep, benches, query)).toBeNull();
  });
  it("retains repeated visits to the same seat on the return leg", () => {
    const loop = { ...path, geometry: [[8, 47], [8.03, 47], [8, 47]] as [number, number][], referenceSeconds: 2016 };
    const visits = benchVisits(loop, [benches[1]], 4.2);
    expect(visits).toHaveLength(2);
    expect(visits[1].routeSeconds).toBeGreaterThan(visits[0].routeSeconds);
    expect(restCoverage(loop, benches, { ...query, shape: "loop" })?.maxGapSeconds).toBeLessThanOrEqual(300.001);
  });
  it("routes through candidate seats before treating their access as evidence", () => {
    const offset = benches.map((b) => ({ ...b, latitude: b.latitude + .0001 }));
    const points = restWaypoints(path, offset, offset.at(-1)!, query)!;
    expect(points).not.toBeNull();
    expect(points.some((point) => point.latitude === 47.0001)).toBe(true);
    expect(restCoverage(path, offset, query)).toBeNull();
  });
});
