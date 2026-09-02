import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("stores visual evidence metadata without any image blob column", () => {
    const database = new Database(":memory:");
    for (const migration of migrations) database.exec(migration.sql);
    const columns = database.prepare("PRAGMA table_info(image_observations)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("image_sha256");
    expect(columns.map((column) => column.name)).not.toContain("image_blob");
    expect(columns.map((column) => column.name)).not.toContain("thumbnail");
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='likely_land_context_idx'").get()).toBeTruthy();
    database.close();
  });

  it("preserves ratings and corrections in an online backup used for rollback", async () => {
    const directory = mkdtempSync(join(tmpdir(), "benchly-backup-test-"));
    const backupPath = join(directory, "rollback.sqlite");
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys=ON");
      for (const migration of migrations) database.exec(migration.sql);
      const bench = database.prepare("INSERT INTO benches(id,osm_type,osm_id,latitude,longitude,source_updated_at,imported_at) VALUES(?,?,?,?,?,?,?)")
        .run("osm-node-1", "node", 1, 47, 8, "2026-01-01", "2026-01-01");
      database.prepare("INSERT INTO ratings(bench_row_id,contributor_hash,overall,view_score,comfort,quiet,visible,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(bench.lastInsertRowid, "browser-hash", 5, 4, 5, 4, 1, "2026-01-01", "2026-01-01");
      database.prepare("INSERT INTO corrections(bench_row_id,contributor_hash,field,proposed_value,visible,created_at) VALUES(?,?,?,?,?,?)")
        .run(bench.lastInsertRowid, "browser-hash", "removed", "Nicht mehr vorhanden", 1, "2026-01-01");
      await database.backup(backupPath);
      database.prepare("DELETE FROM ratings").run();
      database.prepare("DELETE FROM corrections").run();

      const restored = new Database(backupPath, { readonly: true });
      expect((restored.prepare("SELECT count(*) count FROM ratings").get() as { count: number }).count).toBe(1);
      expect((restored.prepare("SELECT count(*) count FROM corrections").get() as { count: number }).count).toBe(1);
      expect((restored.pragma("integrity_check", { simple: true }) as string)).toBe("ok");
      restored.close();
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
