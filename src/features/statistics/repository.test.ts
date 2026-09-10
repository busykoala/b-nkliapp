import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const folders: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

async function seededStatistics() {
  const folder = mkdtempSync(join(tmpdir(), "benchly-statistics-"));
  folders.push(folder);
  vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
  vi.stubEnv("BENCHLY_SEED_DEMO", "true");
  vi.resetModules();
  return await import("./repository");
}

it("builds rotating records, a correlation and municipality portraits from known data", async () => {
  const { readMunicipalityPortrait, readStatisticsDashboard } = await seededStatistics();
  const dashboard = readStatisticsDashboard("2026-09-10");
  expect(dashboard.totalBenches).toBe(12);
  expect(dashboard.locatedBenches).toBe(12);
  expect(dashboard.municipalityCount).toBe(12);
  expect(dashboard.records).toHaveLength(4);
  expect(dashboard.correlation.sampleSize).toBe(11);
  expect(dashboard.correlation.study).toBe("alpacas");
  expect(dashboard.correlation.hypothesesTested).toBeGreaterThan(200);
  expect(dashboard.correlation.coefficient).not.toBeNull();
  expect(dashboard.correlation.trend).not.toBeNull();
  expect(dashboard.correlation.boxPlots).toHaveLength(4);
  expect(dashboard.correlation.boxPlots.every((group) => group.lowerQuartile <= group.median && group.median <= group.upperQuartile)).toBe(true);
  expect(dashboard.populationYear).toBe(2025);
  expect(dashboard.municipalities[0]).toMatchObject({ population: expect.any(Number), benchesPerThousand: expect.any(Number) });
  expect(dashboard.benchOfTheDay?.id).toMatch(/^osm-node-/);

  const zurich = readMunicipalityPortrait("261", undefined, new Date("2026-09-10T12:00:00Z"));
  expect(zurich).toMatchObject({ name: "Zürich", canton: "Zürich", benchCount: 1 });
  expect(zurich?.records.bestView?.id).toBe("osm-node-101");
  expect(zurich?.metadataKnownShare).toBe(1);
});

it("offers a different external-data study for every month", async () => {
  const { readStatisticsDashboard } = await seededStatistics();
  const correlations = Array.from({ length: 12 }, (_, index) => readStatisticsDashboard("2026-09-10", undefined, index + 1).correlation);
  const studies = correlations.map((correlation) => correlation.study);
  expect(new Set(studies).size).toBe(12);
  expect(studies).toContain("alpacas");
  expect(studies).toContain("cinemaSeats");
  expect(studies).toContain("woodHarvest");
  expect(correlations.every((correlation) => correlation.coefficient !== null && correlation.trend !== null)).toBe(true);
  expect(correlations.every((correlation) => correlation.boxPlots.length === 4 && correlation.sampleSize >= 8)).toBe(true);
});

it("supports all roulette modes and rejects invalid municipality identifiers", async () => {
  const { readMunicipalityPortrait, readRouletteBench } = await seededStatistics();
  expect(readRouletteBench("beautiful", () => 0)).toMatch(/^osm-node-/);
  expect(readRouletteBench("sunny", () => .999)).toMatch(/^osm-node-/);
  expect(readRouletteBench("wild", () => .5)).toMatch(/^osm-node-/);
  expect(readMunicipalityPortrait("../../etc/passwd")).toBeNull();
});
