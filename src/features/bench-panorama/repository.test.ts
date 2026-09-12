import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const folders: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("panorama requests", () => {
  it("deduplicates requests and exposes only coordinate-bound ready artifacts", async () => {
    const folder = mkdtempSync(join(tmpdir(), "benchly-panorama-repository-"));
    folders.push(folder);
    vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
    vi.stubEnv("BENCHLY_SEED_DEMO", "true");
    const { sqlite } = await import("@/db/client");
    const { enqueuePanoramaRequest, readPanoramaArtifact } = await import("./repository");
    expect(enqueuePanoramaRequest("osm-node-101")).toBe(true);
    expect(enqueuePanoramaRequest("osm-node-101")).toBe(true);
    expect((sqlite.prepare("SELECT count(*) count FROM bench_panorama_requests").get() as { count: number }).count).toBe(1);
    const bench = sqlite.prepare("SELECT row_id,id,latitude,longitude FROM benches WHERE id='osm-node-101'")
      .get() as Record<string, string | number>;
    sqlite.prepare(`INSERT INTO bench_panorama_geometry(
      bench_row_id,bench_id,bench_latitude,bench_longitude,geometry_key,status,complete,
      source_versions_json,algorithm_version,warnings_json,updated_at
    ) VALUES(?,?,?,?,?,'ready',1,'{}','test','[]','now')`).run(
      bench.row_id, bench.id, bench.latitude, bench.longitude, "geometry",
    );
    sqlite.prepare(`INSERT INTO bench_panorama_renders(
      bench_row_id,geometry_key,render_key,artifact_path,status,style_version,center_azimuth_degrees,
      horizontal_fov_degrees,width,height,weather_bucket,solar_lunar_bucket,bench_variant,updated_at
    ) VALUES(?,?,?,?,'ready','test',0,360,3600,900,'clear','day','wood','now')`).run(
      bench.row_id, "geometry", "render", "/cache/render.svg.gz",
    );
    expect(readPanoramaArtifact("osm-node-101")).toMatchObject({ renderKey: "render" });
    sqlite.prepare("UPDATE benches SET longitude=longitude+.001 WHERE row_id=?").run(bench.row_id);
    expect(readPanoramaArtifact("osm-node-101")).toBeNull();
  });
});
