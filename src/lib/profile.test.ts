import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("adds public memories to the journal without changing achievement progress", async () => {
  const folder = mkdtempSync(join(tmpdir(), "benchly-journal-"));
  vi.stubEnv("DATABASE_PATH", join(folder, "journal.sqlite"));
  vi.stubEnv("BENCHLY_SEED_DEMO", "true");
  vi.resetModules();
  const { sqlite } = await import("@/db/client");
  try {
    const { getTrailProfile } = await import("./profile");
    const user = Number(sqlite.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES('Journal','journal','test-hash','2026-10-01')").run().lastInsertRowid);
    const bench = sqlite.prepare("SELECT row_id FROM benches WHERE active=1 LIMIT 1").get() as { row_id: number };
    const before = getTrailProfile(user, sqlite)!;
    for (const [body, visible] of [["A public memory", 1], ["A hidden memory", 0]] as const) {
      sqlite.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,created_at,updated_at,visible) VALUES(?,?,'memory',?,'2026-10-21','2026-10-21',?)").run(bench.row_id, user, body, visible);
    }
    const after = getTrailProfile(user, sqlite)!;
    expect(after.recent).toHaveLength(1);
    expect(after.recent[0]).toMatchObject({ kind: "moment", detail: "A public memory" });
    expect(after.activity).toEqual(before.activity);
    expect(after.journey).toEqual(before.journey);
    expect(after.uniquePlaces).toBe(before.uniquePlaces);
    expect(after.landscapes).toEqual(before.landscapes);
  } finally {
    sqlite.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(folder, { recursive: true, force: true });
  }
});
