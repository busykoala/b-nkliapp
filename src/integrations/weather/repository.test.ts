import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folders: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("stored weather", () => {
  it("samples only four bytes for a bench and never reaches a provider", async () => {
    const folder = mkdtempSync(join(tmpdir(), "benchly-weather-"));
    folders.push(folder);
    vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
    vi.stubEnv("BENCHLY_SEED_DEMO", "false");
    vi.resetModules();

    const { sqlite } = await import("@/db/client");
    const { wgs84ToLv95 } = await import("@/lib/elevation");
    const { readWeatherSample } = await import("./repository");
    const { getLocalWeather } = await import("./service");
    const point = wgs84ToLv95(47.37674, 8.54183);
    const values = Buffer.alloc(16);
    [280, 281, 282, 283].forEach((value, index) => values.writeFloatLE(value, index * 4));
    const now = new Date().toISOString();
    const insert = sqlite.prepare(`
      INSERT INTO weather_snapshots(source,parameter,reference_at,valid_at,origin_easting,origin_northing,
        resolution_meters,width,height,values_blob,nodata_value,imported_at)
      VALUES('test',?,?,?, ?,?,100,2,2,?,NULL,?)
    `);
    insert.run("T_2M", now, now, point.easting, point.northing, values, now);
    const fetcher = vi.spyOn(globalThis, "fetch");

    expect(readWeatherSample("T_2M", point.easting + 100, point.northing + 100)).toEqual({ value: 283, validAt: now });
    expect(getLocalWeather(47.37674, 8.54183)?.temperatureC).toBeCloseTo(6.85, 2);
    expect(fetcher).not.toHaveBeenCalled();
    sqlite.close();
  });
});
