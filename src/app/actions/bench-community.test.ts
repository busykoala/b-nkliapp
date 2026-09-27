import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/security", () => ({
  requireUser: auth.requireUser,
  assertContributorAllowed: vi.fn(),
  consumeRateLimit: vi.fn(),
  contributorHashForUser: (id: number) => `user-${id}`,
  getContributorIdentity: async () => ({ ipHash: "test-ip" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let folder: string;
let database: Database.Database;
let userId: number;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "benchly-follow-"));
  vi.stubEnv("DATABASE_PATH", join(folder, "test.sqlite"));
  vi.stubEnv("BENCHLY_SEED_DEMO", "true");
  vi.resetModules();
  database = (await import("@/db/client")).sqlite;
  userId = Number(database.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES('Saver','saver','hash','2026-09-09')").run().lastInsertRowid);
  auth.requireUser.mockResolvedValue({ id: userId });
});

afterEach(() => {
  database.close();
  delete (globalThis as typeof globalThis & { benchlySqlite?: Database.Database }).benchlySqlite;
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});

it("sets the desired saved state idempotently and can remove an inactive bench", async () => {
  const { setBenchFollow } = await import("./bench-community");
  const row = database.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number };

  expect(await setBenchFollow("osm-node-101", true)).toMatchObject({ ok: true, following: true });
  expect(await setBenchFollow("osm-node-101", true)).toMatchObject({ ok: true, following: true });
  expect(database.prepare("SELECT count(*) count FROM bench_follows WHERE bench_row_id=? AND user_id=?").get(row.row_id, userId)).toEqual({ count: 1 });

  database.prepare("UPDATE benches SET active=0 WHERE row_id=?").run(row.row_id);
  expect(await setBenchFollow("osm-node-101", false)).toMatchObject({ ok: true, following: false });
  expect(database.prepare("SELECT count(*) count FROM bench_follows WHERE bench_row_id=? AND user_id=?").get(row.row_id, userId)).toEqual({ count: 0 });
});
