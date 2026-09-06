import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeMigration, migrations } from "@/db/migrations";
import { readBenchObservationSummary } from "./repository";

describe("bench observation repository", () => {
  let database: Database.Database;
  let benchRowId: number;
  let userIds: number[];

  beforeEach(() => {
    database = new Database(":memory:");
    database.pragma("foreign_keys=ON");
    for (const migration of migrations) executeMigration(database, migration);
    benchRowId = Number(database.prepare(
      "INSERT INTO benches(id,osm_type,osm_id,latitude,longitude,source_updated_at,imported_at) VALUES(?,?,?,?,?,?,?)",
    ).run("osm-node-13", "node", 13, 47, 8, "2026-09-05", "2026-09-05").lastInsertRowid);
    userIds = [1, 2, 3].map((number) => Number(database.prepare(
      "INSERT INTO users(username,username_key,password_hash,created_at,avatar_seed) VALUES(?,?,?,?,?)",
    ).run(`Person ${number}`, `person-${number}`, "test", "2026-09-05", `seed-${number}`).lastInsertRowid));
  });

  afterEach(() => database.close());

  function addLight(userId: number, choice: "sun" | "shade" | "mixed", observedAt: string) {
    database.prepare(`INSERT INTO bench_light_observations(
      bench_row_id,user_id,choice,observed_at,season,day_phase,created_at
    ) VALUES(?,?,?,?,?,?,?)`).run(benchRowId, userId, choice, observedAt, "autumn", "day", observedAt);
  }

  it("counts only the newest comparable observation from each person", () => {
    addLight(userIds[0], "sun", "2026-09-05T10:00:00Z");
    addLight(userIds[0], "shade", "2026-09-05T11:00:00Z");
    addLight(userIds[1], "shade", "2026-09-05T11:05:00Z");
    addLight(userIds[2], "mixed", "2026-09-05T11:10:00Z");

    const summary = readBenchObservationSummary(database, benchRowId, userIds[0], "autumn", "day");
    expect(summary.light.mine?.choice).toBe("shade");
    expect(summary.light.publicTrend?.contributors).toBe(3);
    expect(summary.light.publicTrend?.choice).toBe("shade");
  });

  it("keeps a two-person trend private", () => {
    addLight(userIds[0], "sun", "2026-09-05T10:00:00Z");
    addLight(userIds[1], "sun", "2026-09-05T10:05:00Z");
    expect(readBenchObservationSummary(database, benchRowId, null, "autumn", "day").light.publicTrend).toBeNull();
  });
});
