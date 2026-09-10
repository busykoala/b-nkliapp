import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("keeps the map filters and bench details consistent when evidence is contradictory or negative", async () => {
  const folder = mkdtempSync(join(tmpdir(), "benchly-evidence-read-"));
  vi.stubEnv("DATABASE_PATH", join(folder, "test.sqlite")); vi.stubEnv("BENCHLY_SEED_DEMO", "true"); vi.resetModules();
  const { sqlite } = await import("@/db/client");
  try {
    const { readBenchDetail } = await import("@/features/bench-detail/service");
    const { readMapFeatures } = await import("@/features/map/service");
    const row = sqlite.prepare("SELECT row_id,latitude,longitude FROM benches WHERE id='osm-node-101'").get() as { row_id: number; latitude: number; longitude: number };
    sqlite.prepare("INSERT INTO bench_attribute_state(bench_row_id,attribute,value_json,confidence,conflicting,evidence_count,source_types_json,latest_at,method_version,resolved_at) VALUES(?,'backrest',NULL,'unknown',1,2,'[\"community\"]','2026-09-09','attribute-resolution-1','2999-01-01')").run(row.row_id);
    const query = { bounds: { west: row.longitude-.001, east: row.longitude+.001, south: row.latitude-.001, north: row.latitude+.001 }, zoom: 18 };
    expect(readBenchDetail("osm-node-101", null)?.properties.find((item) => item.key === "backrest")?.value).toBe("Unbekannt");
    expect(readMapFeatures({ ...query, filters: { backrest: true } })).toHaveLength(0);
    expect(readMapFeatures({ ...query, filters: { backrest: false } })).toHaveLength(0);
    sqlite.prepare("UPDATE bench_attribute_state SET value_json='0',confidence='high',conflicting=0 WHERE bench_row_id=?").run(row.row_id);
    expect(readBenchDetail("osm-node-101", null)?.properties.find((item) => item.key === "backrest")?.value).toBe("Nein");
    expect(readMapFeatures({ ...query, filters: { backrest: false } }).some((item) => item.id === "osm-node-101")).toBe(true);
    const user = Number(sqlite.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES('Editor','editor','hash','2026-09-09')").run().lastInsertRowid);
    sqlite.prepare("INSERT INTO bench_metadata_edits(bench_row_id,user_id,field,old_value,new_value,created_at) VALUES(?,?,'backrest','0','1','3000-01-01')").run(row.row_id, user);
    expect(readBenchDetail("osm-node-101", null)?.properties.find((item) => item.key === "backrest")?.value).toBe("Ja");
    expect(readMapFeatures({ ...query, filters: { backrest: true } }).some((item) => item.id === "osm-node-101")).toBe(true);
  } finally {
    sqlite.close(); delete (globalThis as typeof globalThis & { benchlySqlite?: typeof sqlite }).benchlySqlite;
    vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true });
  }
});

it("filters only recorded nearby facilities and keeps photo estimates out of factual filters", async () => {
  const folder = mkdtempSync(join(tmpdir(), "benchly-facilities-read-"));
  vi.stubEnv("DATABASE_PATH", join(folder, "test.sqlite")); vi.stubEnv("BENCHLY_SEED_DEMO", "true"); vi.resetModules();
  const { sqlite } = await import("@/db/client");
  try {
    const { readBenchDetail } = await import("@/features/bench-detail/service");
    const { readMapFeatures } = await import("@/features/map/service");
    const row = sqlite.prepare("SELECT row_id,latitude,longitude FROM benches WHERE id='osm-node-101'").get() as { row_id: number; latitude: number; longitude: number };
    const query = { bounds: { west: row.longitude-.0001, east: row.longitude+.0001, south: row.latitude-.0001, north: row.latitude+.0001 }, zoom: 18 };
    expect(readMapFeatures({...query, filters: {toiletsNearby: true}})).toHaveLength(0);
    sqlite.prepare("INSERT INTO bench_amenities(bench_row_id,category,distance_meters,source,method_version,computed_at) VALUES(?,'toilets',250,'OpenStreetMap','nearby-amenities-2','2026-09-10')").run(row.row_id);
    expect(readMapFeatures({...query, filters: {toiletsNearby: true}}).some((item) => item.id === "osm-node-101")).toBe(true);
    expect(readMapFeatures({...query, filters: {drinkingWaterNearby: true}})).toHaveLength(0);
    expect(readBenchDetail("osm-node-101", null)?.knowledge?.amenities[0]).toMatchObject({distanceMeters: 250, distanceType: "straight_line"});
    sqlite.prepare("UPDATE bench_amenities SET distance_meters=250.1").run();
    expect(readMapFeatures({...query, filters: {toiletsNearby: true}})).toHaveLength(0);
    sqlite.prepare("UPDATE benches SET backrest=NULL WHERE row_id=?").run(row.row_id);
    sqlite.prepare("DELETE FROM bench_knowledge_queue WHERE bench_row_id=?").run(row.row_id);
    sqlite.prepare(`INSERT INTO bench_photo_estimates VALUES(?,'backrest','true','eligible','["image-hash"]','validated-model','prompt',NULL,'2026-09-10',40,'physical-photo-estimate-1',?,?)`).run(row.row_id, row.latitude, row.longitude);
    const detail = readBenchDetail("osm-node-101", null);
    expect(detail?.knowledge?.photoEstimates).toHaveLength(1);
    expect(detail?.properties.find((item) => item.key === "backrest")?.value).toBe("Unbekannt");
    expect(readMapFeatures({...query, filters: {backrest: true}})).toHaveLength(0);
    expect(readMapFeatures({...query, filters: {backrest: false}})).toHaveLength(0);
  } finally {
    sqlite.close(); delete (globalThis as typeof globalThis & { benchlySqlite?: typeof sqlite }).benchlySqlite;
    vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true });
  }
});
