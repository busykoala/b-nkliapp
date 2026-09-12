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
  it("attributes only a photo projection still applied at the same bench position", async () => {
    const folder = mkdtempSync(join(tmpdir(), "benchly-photo-detail-"));
    folders.push(folder);
    vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
    vi.stubEnv("BENCHLY_SEED_DEMO", "true");
    vi.resetModules();
    const { sqlite } = await import("@/db/client");
    const { readPhotoEvidence, readDetailRow } = await import("./repository");
    const row = readDetailRow("osm-node-101")!;
    sqlite.exec(`CREATE TABLE bank_photo_evidence(bench_row_id INTEGER,bench_id TEXT,bench_latitude REAL,
      bench_longitude REAL,signals TEXT,base_enrichment TEXT,applied_enrichment TEXT)`);
    sqlite.prepare("INSERT INTO bank_photo_evidence VALUES(?,?,?,?,?,?,?)").run(
      row.row_id, row.id, row.latitude, row.longitude, JSON.stringify({ photos: [{ source_id: 42, image_id: 9 }] }),
      JSON.stringify({ view_labels: "[]" }), JSON.stringify({ view_labels: row.view_labels }),
    );
    expect(readPhotoEvidence(row)).toEqual({ observationCount: 1 });
    expect(readPhotoEvidence({ ...row, latitude: Number(row.latitude) + .01 })).toBeNull();
    expect(readPhotoEvidence({ ...row, view_labels: "changed afterwards" })).toBeNull();
  });

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

  it("uses a position-bound estimate only when no observed direction exists", async () => {
    const folder = mkdtempSync(join(tmpdir(), "benchly-direction-detail-"));
    folders.push(folder);
    vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
    vi.stubEnv("BENCHLY_SEED_DEMO", "true");
    vi.resetModules();
    const { sqlite } = await import("@/db/client");
    const unknown = sqlite.prepare("SELECT row_id,id,latitude,longitude FROM benches WHERE id='osm-node-112'").get() as Record<string, string | number>;
    const observed = sqlite.prepare("SELECT row_id,id,latitude,longitude FROM benches WHERE id='osm-node-101'").get() as Record<string, string | number>;
    const insert = sqlite.prepare(`INSERT INTO bench_direction_estimates(
      bench_row_id,bench_id,bench_latitude,bench_longitude,direction_degrees,top_probability,entropy,
      probabilities_json,signals_json,source_versions_json,analysis_run_id,method_version,computed_at,published_at
    ) VALUES(?,?,?,?,90,.8,.3,'{}','[]','{}','test','test','2026-01-01','2026-01-01')`);
    insert.run(unknown.row_id, unknown.id, unknown.latitude, unknown.longitude);
    insert.run(observed.row_id, observed.id, observed.latitude, observed.longitude);

    const { readBenchDetail } = await import("./service");
    expect(readBenchDetail("osm-node-112", null)?.directionDegrees).toBe(90);
    expect(readBenchDetail("osm-node-101", null)?.directionDegrees).toBe(205);

    sqlite.prepare("UPDATE benches SET latitude=latitude+.001 WHERE id='osm-node-112'").run();
    expect(readBenchDetail("osm-node-112", null)?.directionDegrees).toBeNull();
  });

  it("reports the nearest mapped path or road", async () => {
    const folder = mkdtempSync(join(tmpdir(), "benchly-detail-road-"));
    folders.push(folder);
    vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
    vi.stubEnv("BENCHLY_SEED_DEMO", "true");
    vi.resetModules();
    const { sqlite } = await import("@/db/client");
    const row = sqlite.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number };
    sqlite.prepare("UPDATE bench_enrichments SET distance_path_meters=314,distance_major_road_meters=1.4 WHERE bench_row_id=?").run(row.row_id);
    sqlite.prepare(`INSERT INTO pipeline_runs(kind,status,pipeline_version,started_at,finished_at)
      VALUES('import-osm','completed','4.7.0',?,?)`).run("2026-09-10T10:00:00Z", "2026-09-10T10:01:00Z");

    const { readBenchDetail } = await import("./service");
    expect(readBenchDetail("osm-node-101", null)?.distancePathMeters).toBe(1.4);
  });

  it("supersedes a stale stored distance with the current routing graph", async () => {
    const folder = mkdtempSync(join(tmpdir(), "benchly-detail-nearest-"));
    folders.push(folder);
    vi.stubEnv("DATABASE_PATH", join(folder, "benchly.sqlite"));
    vi.stubEnv("BENCHLY_SEED_DEMO", "true");
    vi.stubEnv("WALK_ROUTER_URL", "http://router.internal:8989");
    vi.resetModules();
    const fetcher = vi.fn(async () => Response.json({type: "Point", coordinates: [8.54171, 47.3769], distance: 5.23}));
    vi.stubGlobal("fetch", fetcher);
    const { readVerifiedBenchDetail } = await import("./service");

    expect((await readVerifiedBenchDetail("osm-node-101", null))?.distancePathMeters).toBe(5.23);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
