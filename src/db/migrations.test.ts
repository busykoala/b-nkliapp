import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations } from "./migrations";

describe("SQLite migrations and R*Tree", () => {
  it("keeps the spatial index synchronized", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys=ON");
    for (const migration of migrations) database.exec(migration.sql);
    const values = ["osm-node-999", "node", 999, 47.1, 8.1, "2026-01-01", "2026-01-01"];
    database.prepare("INSERT INTO benches(id,osm_type,osm_id,latitude,longitude,source_updated_at,imported_at) VALUES(?,?,?,?,?,?,?)").run(...values);
    expect((database.prepare("SELECT count(*) count FROM bench_spatial_index WHERE min_longitude<=8.1 AND max_longitude>=8.1").get() as { count: number }).count).toBe(1);
    database.prepare("UPDATE benches SET longitude=9.2 WHERE id='osm-node-999'").run();
    expect((database.prepare("SELECT min_longitude longitude FROM bench_spatial_index").get() as { longitude: number }).longitude).toBeCloseTo(9.2, 4);
    database.prepare("DELETE FROM benches WHERE id='osm-node-999'").run();
    expect((database.prepare("SELECT count(*) count FROM bench_spatial_index").get() as { count: number }).count).toBe(0);
    database.close();
  });
});
