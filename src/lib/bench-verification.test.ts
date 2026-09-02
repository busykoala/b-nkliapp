import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrations } from "@/db/migrations";
import { getUserBadges, refreshUserBadges } from "./badges";
import { recordBenchConfirmation, recordRemovalConfirmation, resolveVerificationThreshold } from "./bench-verification";

describe("community verification", () => {
  let database: Database.Database;
  let benchRowId: number;

  beforeEach(() => {
    database = new Database(":memory:");
    database.pragma("foreign_keys=ON");
    for (const migration of migrations) database.exec(migration.sql);
    const insertUser = database.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES(?,?,?,?)");
    for (let id = 1; id <= 4; id += 1) insertUser.run(`User${id}`, `user${id}`, "hash", "2026-01-01");
    benchRowId = Number(database.prepare(`
      INSERT INTO benches(id,osm_type,osm_id,latitude,longitude,active,source_updated_at,imported_at,created_by_user_id,verification_status)
      VALUES('community-test','community',-1,47,8,1,'2026-01-01','2026-01-01',1,'unverified')
    `).run().lastInsertRowid);
    database.prepare("INSERT INTO bench_confirmations(bench_row_id,user_id,created_at) VALUES(?,?,?)").run(benchRowId, 1, "2026-01-01");
  });

  afterEach(() => database.close());

  it("counts each user once and verifies at the configured threshold", () => {
    const duplicate = recordBenchConfirmation(database, benchRowId, 1, 3, "2026-01-02");
    expect(duplicate).toMatchObject({ added: false, count: 1, verified: false });
    expect(recordBenchConfirmation(database, benchRowId, 2, 3, "2026-01-02")).toMatchObject({ added: true, count: 2, verified: false });
    expect(recordBenchConfirmation(database, benchRowId, 3, 3, "2026-01-03")).toMatchObject({ added: true, count: 3, verified: true });
    expect((database.prepare("SELECT verification_status FROM benches WHERE row_id=?").get(benchRowId) as { verification_status: string }).verification_status).toBe("verified");
    expect(recordBenchConfirmation(database, benchRowId, 4, 3, "2026-01-04")).toMatchObject({ added: false, alreadyVerified: true });
  });

  it("requires distinct removal confirmations and retains the history", () => {
    expect(recordRemovalConfirmation(database, benchRowId, 1, 3, "2026-02-01")).toMatchObject({ added: true, count: 1, removed: false });
    expect(recordRemovalConfirmation(database, benchRowId, 1, 3, "2026-02-01")).toMatchObject({ added: false, count: 1, removed: false });
    recordRemovalConfirmation(database, benchRowId, 2, 3, "2026-02-02");
    expect(recordRemovalConfirmation(database, benchRowId, 3, 3, "2026-02-03")).toMatchObject({ count: 3, removed: true });
    const bench = database.prepare("SELECT active,verification_status,removed_at FROM benches WHERE row_id=?").get(benchRowId) as { active: number; verification_status: string; removed_at: string };
    expect(bench).toMatchObject({ active: 0, verification_status: "removed", removed_at: "2026-02-03" });
    expect((database.prepare("SELECT count(*) count FROM bench_removal_confirmations").get() as { count: number }).count).toBe(3);
  });

  it("awards badges from persisted actions without duplicating them", () => {
    refreshUserBadges(1, database);
    refreshUserBadges(1, database);
    const badge = getUserBadges(1, database).find((item) => item.key === "erstes-plaetzli");
    expect(badge).toMatchObject({ earned: true, progress: 1 });
    expect((database.prepare("SELECT count(*) count FROM user_badges WHERE user_id=1").get() as { count: number }).count).toBe(1);
  });
});

describe("verification threshold", () => {
  it("uses a configurable safe range", () => {
    expect(resolveVerificationThreshold("5")).toBe(5);
    expect(resolveVerificationThreshold("1")).toBe(2);
    expect(resolveVerificationThreshold("99")).toBe(10);
    expect(resolveVerificationThreshold("nope")).toBe(3);
  });
});
