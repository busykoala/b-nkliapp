import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("serves isolated panorama fixtures through the real detail and artifact readers", async () => {
  const folder = mkdtempSync(join(tmpdir(), "benchly-panorama-fixture-"));
  const databasePath = join(folder, "benchly.sqlite");
  vi.stubEnv("DATABASE_PATH", databasePath);
  vi.stubEnv("BENCHLY_E2E_DATABASE", databasePath);
  vi.stubEnv("BENCHLY_E2E_PANORAMA_CACHE", join(folder, "panoramas"));
  vi.stubEnv("BENCHLY_SEED_DEMO", "true");
  vi.resetModules();

  const { sqlite } = await import("@/db/client");
  const { readBenchDetail, readBenchPageMetadata } = await import("@/features/bench-detail/service");
  const { enqueuePanoramaRequest, readArtifactByKey, readPanoramaDescriptor } = await import("@/features/bench-panorama/repository");
  const { createIsolatedPanoramaBench, installTerrainPanoramaFixture, removeIsolatedPanoramaBench } = await import("@/test/support/panorama-fixture");
  const owned: string[] = [];
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const seed = readBenchDetail("osm-node-109", null)!;
    expect(seed).not.toBeNull();
    const first = createIsolatedPanoramaBench();
    owned.push(first);
    const second = createIsolatedPanoramaBench();
    owned.push(second);
    expect(second).not.toBe(first);

    // Checking the row alone missed the previous invalid-ID fixture: both
    // public readers must accept it without weakening production validation.
    for (const id of owned) {
      expect(readBenchPageMetadata(id)).toEqual(readBenchPageMetadata(seed.id));
      expect(readBenchDetail(id, null)).toMatchObject({
        id, directionDegrees: seed.directionDegrees, latitude: seed.latitude, longitude: seed.longitude,
      });
    }
    expect(readBenchDetail("panorama-test-invalid", null)).toBeNull();
    expect(readPanoramaDescriptor("panorama-test-invalid")).toEqual({ status: "unavailable" });
    expect(enqueuePanoramaRequest(first)).toBe(true);
    expect(readPanoramaDescriptor(first).status).toBe("generating");

    await installTerrainPanoramaFixture(first, true);
    await installTerrainPanoramaFixture(second, false);
    const firstPanorama = readPanoramaDescriptor(first);
    const secondPanorama = readPanoramaDescriptor(second);
    expect(firstPanorama).toMatchObject({ status: "ready", completeness: "complete" });
    expect(secondPanorama.status).toBe("ready");
    expect(secondPanorama.renderKey).not.toBe(firstPanorama.renderKey);
    expect(readBenchDetail(first, null)?.panorama).toEqual(firstPanorama);
    for (const url of [firstPanorama.artifactUrl, firstPanorama.materialUrl, firstPanorama.lightMapUrl]) {
      expect(url).toMatch(/^\/media\/panorama\/[0-9a-f]{64}$/);
      const artifact = readArtifactByKey(url!.split("/").at(-1)!);
      expect(artifact).not.toBeNull();
      expect(existsSync(artifact!.artifactPath)).toBe(true);
    }

    // A valid-looking ID is not enough to authorize fixture cleanup.
    expect(() => removeIsolatedPanoramaBench(seed.id)).toThrow("not owned");
    expect(() => removeIsolatedPanoramaBench("community-00000000-0000-4000-8000-000000000000")).toThrow("not owned");
    removeIsolatedPanoramaBench(first);
    owned.splice(owned.indexOf(first), 1);
    expect(readBenchDetail(first, null)).toBeNull();
    expect(readPanoramaDescriptor(first).status).toBe("unavailable");
    expect(readPanoramaDescriptor(second)).toEqual(secondPanorama);
    expect(readBenchDetail(seed.id, null)?.covered).toBe(seed.covered);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    for (const id of owned) removeIsolatedPanoramaBench(id);
    sqlite.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(folder, { recursive: true, force: true });
  }
});
