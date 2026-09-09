import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ requireUser: vi.fn(), assertContributorAllowed: vi.fn(), consumeRateLimit: vi.fn(), contributorHashForUser: vi.fn((id) => `test-${id}`), getContributorIdentity: vi.fn(async () => ({ ipHash: "test-ip" })) }));
vi.mock("@/lib/security", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let folder: string, database: Database.Database, userId: number;
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "benchly-verification-"));
  vi.stubEnv("DATABASE_PATH", join(folder, "test.sqlite")); vi.stubEnv("BENCHLY_SEED_DEMO", "true"); vi.resetModules();
  database = (await import("@/db/client")).sqlite;
  userId = Number(database.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES('Observer','observer','hash','2026-09-09')").run().lastInsertRowid);
  auth.requireUser.mockResolvedValue({ id: userId });
});
afterEach(() => { database.close(); delete (globalThis as typeof globalThis & { benchlySqlite?: Database.Database }).benchlySqlite; vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(folder, { recursive: true, force: true }); });
it("requires an account and accepts only verification attributes", async () => {
  const { answerBenchQuestion } = await import("./bench-verification");
  auth.requireUser.mockRejectedValueOnce(new Error("Bitte anmelden."));
  expect((await answerBenchQuestion({ benchId: "osm-node-101", attribute: "backrest", value: 1 })).ok).toBe(false);
  expect((await answerBenchQuestion({ benchId: "osm-node-101", attribute: "latitude", value: 1 })).ok).toBe(false);
  expect(database.prepare("SELECT count(*) n FROM bench_attribute_evidence").get()).toEqual({ n: 0 });
});
it("retains each report, queues resolution and never changes the canonical value directly", async () => {
  const { answerBenchQuestion } = await import("./bench-verification");
  const original = database.prepare("SELECT backrest FROM benches WHERE id='osm-node-101'").get();
  for (const [index, value] of [0, 1, null].entries()) {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000 + index);
    const result = await answerBenchQuestion({ benchId: "osm-node-101", attribute: "backrest", value });
    expect(result.ok, result.message).toBe(true);
  }
  expect(database.prepare("SELECT backrest FROM benches WHERE id='osm-node-101'").get()).toEqual(original);
  expect(database.prepare("SELECT count(*) n FROM bench_attribute_evidence").get()).toEqual({ n: 3 });
  expect(database.prepare("SELECT value_json FROM bench_verification_answers").get()).toEqual({ value_json: "null" });
  expect(database.prepare("SELECT reason FROM bench_knowledge_queue WHERE bench_row_id=(SELECT row_id FROM benches WHERE id='osm-node-101')").get()).toEqual({ reason: "verification" });
});
