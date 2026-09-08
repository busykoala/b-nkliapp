import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const folders: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("bench detail read model", () => {
  it("opens a bench entirely from imported data", async () => {
    const folder = mkdtempSync(join(tmpdir(), "benchly-detail-"));
    folders.push(folder);
    vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
    vi.stubEnv("BENCHLY_SEED_DEMO", "true");
    vi.resetModules();
    const fetch = vi.spyOn(globalThis, "fetch");

    const { readBenchDetail } = await import("./service");
    const bench = readBenchDetail("osm-node-101", null);

    expect(bench?.id).toBe("osm-node-101");
    expect(fetch).not.toHaveBeenCalled();
  });
});
