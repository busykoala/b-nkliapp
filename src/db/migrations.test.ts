import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeMigration, migrations } from "./migrations";

function applyMigrations(database: Database.Database, selected = migrations) {
  for (const migration of selected) executeMigration(database, migration);
}

describe("SQLite migrations and R*Tree", () => {
  it("keeps the spatial index synchronized", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys=ON");
    applyMigrations(database);
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
    applyMigrations(database);
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
      applyMigrations(database);
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

  it("keeps observations separate from objective enrichment", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys=ON");
    applyMigrations(database);
    const bench = database.prepare("INSERT INTO benches(id,osm_type,osm_id,latitude,longitude,source_updated_at,imported_at) VALUES(?,?,?,?,?,?,?)")
      .run("osm-node-13", "node", 13, 47, 8, "2026-01-01", "2026-01-01");
    const user = database.prepare("INSERT INTO users(username,username_key,password_hash,created_at,avatar_seed) VALUES(?,?,?,?,?)")
      .run("Bänkli-Fan", "bänkli-fan", "test", "2026-01-01", "seed");
    database.prepare("INSERT INTO bench_light_observations(bench_row_id,user_id,choice,observed_at,season,day_phase,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(bench.lastInsertRowid, user.lastInsertRowid, "sun", "2026-09-05T12:00:00Z", "autumn", "day", "2026-09-05T12:00:00Z");
    expect((database.prepare("SELECT count(*) count FROM bench_light_observations").get() as { count: number }).count).toBe(1);
    expect((database.prepare("SELECT count(*) count FROM bench_enrichments").get() as { count: number }).count).toBe(0);
    database.close();
  });

  it("upgrades existing environment data before accepting nearby amenities", () => {
    const database = new Database(":memory:");
    const amenityIndex = migrations.findIndex(({ id }) => id === "0014_environment_amenities");
    const amenityMigration = migrations[amenityIndex];
    expect(amenityMigration?.id).toBe("0014_environment_amenities");
    applyMigrations(database, migrations.slice(0, amenityIndex));
    database.prepare(`INSERT INTO environment_features(
      source,source_id,kind,subtype,center_latitude,center_longitude,min_latitude,max_latitude,
      min_longitude,max_longitude,raw_tags,imported_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "OpenStreetMap", "node-1", "tree", "tree", 47, 8, 47, 47, 8, 8, "{}", "2026-09-06",
    );

    executeMigration(database, amenityMigration!);
    database.prepare(`INSERT INTO environment_features(
      source,source_id,kind,subtype,center_latitude,center_longitude,min_latitude,max_latitude,
      min_longitude,max_longitude,raw_tags,imported_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "OpenStreetMap", "node-2", "fireplace", "firepit", 47.1, 8.1, 47.1, 47.1, 8.1, 8.1, "{}", "2026-09-06",
    );
    database.prepare(`INSERT INTO environment_features(
      source,source_id,kind,subtype,center_latitude,center_longitude,min_latitude,max_latitude,
      min_longitude,max_longitude,raw_tags,imported_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "OpenStreetMap", "node-3", "waste_basket", "waste_basket", 47.2, 8.2, 47.2, 47.2, 8.2, 8.2, "{}", "2026-09-06",
    );

    expect(database.prepare("SELECT kind FROM environment_features ORDER BY row_id").all())
      .toEqual([{ kind: "tree" }, { kind: "fireplace" }, { kind: "waste_basket" }]);
    expect((database.prepare("SELECT count(*) count FROM environment_spatial_index").get() as { count: number }).count).toBe(3);
    database.close();
  });

  it("stores nearby amenities as editable bench facts", () => {
    const database = new Database(":memory:");
    applyMigrations(database);
    const columns = database.prepare("PRAGMA table_info(benches)").all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining(["fireplace_nearby", "waste_basket_nearby"]));
    const definition = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bench_metadata_edits'").get() as { sql: string }).sql;
    expect(definition).toContain("fireplaceNearby");
    expect(definition).toContain("wasteBasketNearby");
    database.close();
  });
});
