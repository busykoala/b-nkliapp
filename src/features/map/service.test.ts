import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DATA_RUNTIME } from "@/data/runtime.generated";

const folders: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

it.each([DATA_RUNTIME.pipelineVersion, DATA_RUNTIME.profilePipelineVersion])(
  "keeps a currently sunny bench in the sunlight filter after enrichment with %s", async (version) => {
    const folder = mkdtempSync(join(tmpdir(), "benchly-map-version-"));
    folders.push(folder);
    vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
    vi.stubEnv("BENCHLY_SEED_DEMO", "true");
    vi.stubEnv("BENCHLY_E2E_NOW", "2026-06-21T12:00:00Z");
    vi.resetModules();
    const { sqlite } = await import("@/db/client");
    const { readMapFeatures } = await import("./service");
    const bench = sqlite.prepare("SELECT row_id,latitude,longitude FROM benches WHERE id='osm-node-101'").get() as {
      row_id: number; latitude: number; longitude: number;
    };
    sqlite.prepare("UPDATE benches SET covered=0 WHERE row_id=?").run(bench.row_id);
    sqlite.prepare("UPDATE bench_enrichments SET pipeline_version=?,horizon_profile=?,obstruction_types=? WHERE bench_row_id=?")
      .run(version, JSON.stringify(Array(72).fill(0)), JSON.stringify(Array(72).fill("terrain")), bench.row_id);
    const query = { bounds: { west: bench.longitude - .001, east: bench.longitude + .001,
      south: bench.latitude - .001, north: bench.latitude + .001 }, zoom: 18, filters: { sunnyNow: true } };
    expect(readMapFeatures(query).some((feature) => feature.kind === "bench" && feature.id === "osm-node-101")).toBe(true);
    sqlite.prepare("UPDATE bench_enrichments SET pipeline_version=NULL WHERE bench_row_id=?").run(bench.row_id);
    expect(readMapFeatures(query).some((feature) => feature.kind === "bench" && feature.id === "osm-node-101")).toBe(false);
  },
);

it("returns decision evidence for nearby list results only at a useful map scale", async () => {
  const folder = mkdtempSync(join(tmpdir(), "benchly-map-list-"));
  folders.push(folder);
  vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
  vi.stubEnv("BENCHLY_SEED_DEMO", "true");
  vi.stubEnv("BENCHLY_E2E_NOW", "2026-06-21T12:00:00Z");
  vi.resetModules();
  const { sqlite } = await import("@/db/client");
  const { readMapBenchList } = await import("./service");
  const bench = sqlite.prepare("SELECT latitude,longitude FROM benches WHERE id='osm-node-101'").get() as { latitude: number; longitude: number };
  const bounds = { west: bench.longitude - .001, east: bench.longitude + .001, south: bench.latitude - .001, north: bench.latitude + .001 };
  expect(readMapBenchList({ bounds, zoom: 12 })).toEqual({ items: [], zoomRequired: true });
  const result = readMapBenchList({ bounds, zoom: 18 });
  expect(result.zoomRequired).toBe(false);
  expect(result.items[0]).toMatchObject({
    id: "osm-node-101",
    title: "Lindenhof, Zürich",
    backrest: true,
    wheelchair: true,
    rating: null,
    ratingCount: 0,
    verificationStatus: "verified",
  });
  expect(result.items[0].distanceMeters).toBeLessThan(1);
});
