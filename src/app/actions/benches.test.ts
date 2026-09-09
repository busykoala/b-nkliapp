import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/security", () => ({ requireUser: auth.requireUser, assertContributorAllowed: vi.fn(), consumeRateLimit: vi.fn(), contributorHashForUser: (id: number) => `user-${id}`, getContributorIdentity: async () => ({ ipHash: "test-ip" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/integrations/geoadmin/client", () => ({ reverseGeocodeSwiss: async () => ({ name: "Zürich", postcode: "8001", canton: "ZH" }), normalizeLocationKey: (name: string) => name.toLowerCase() }));
let folder: string, database: Database.Database;
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "benchly-submit-"));
  vi.stubEnv("DATABASE_PATH", join(folder, "test.sqlite"));
  vi.stubEnv("BENCHLY_SEED_DEMO", "true");
  vi.resetModules();
  database = (await import("@/db/client")).sqlite;
  const id = Number(database.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES('test','test','hash','2026-09-09')").run().lastInsertRowid);
  auth.requireUser.mockResolvedValue({ id });
});
afterEach(() => { database.close(); delete (globalThis as typeof globalThis & { benchlySqlite?: Database.Database }).benchlySqlite; vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true }); });
const form = () => { const data = new FormData(); data.set("latitude", "47.37674"); data.set("longitude", "8.54183"); data.set("name", "Neues Bänkli"); return data; };
it("requires a review of nearby benches, returns the new ID, and detects a stale review", async () => {
  const { addBench, getNearbyBenches } = await import("./benches");
  const nearby = await getNearbyBenches(47.37674, 8.54183);
  expect(nearby.map((bench) => bench.id)).toContain("osm-node-101");
  expect(nearby[0].distanceMeters).toBeCloseTo(0);
  const unreviewed = await addBench(null, form());
  expect(unreviewed).toMatchObject({ ok: false, nearby: expect.any(Array) });
  const reviewed = form(); reviewed.set("nearbyReviewed", "yes"); reviewed.set("nearbyIds", JSON.stringify(nearby.map((bench) => bench.id).sort()));
  const saved = await addBench(null, reviewed);
  expect(saved).toMatchObject({ ok: true, benchId: expect.stringMatching(/^community-/) });
  expect(database.prepare("SELECT verification_status FROM benches WHERE id=?").get(saved.benchId)).toEqual({ verification_status: "unverified" });
  const stale = await addBench(null, reviewed);
  expect(stale).toMatchObject({ ok: false, nearby: expect.arrayContaining([expect.objectContaining({ id: saved.benchId })]) });
  expect(database.prepare("SELECT count(*) n FROM benches WHERE name='Neues Bänkli'").get()).toEqual({ n: 1 });
});
it("does not save anonymously or accept an invalid location", async () => {
  const { addBench } = await import("./benches");
  auth.requireUser.mockRejectedValue(new Error("Bitte anmelden."));
  expect(await addBench(null, form())).toMatchObject({ ok: false, message: "Bitte anmelden." });
  const outside = form(); outside.set("latitude", "51");
  expect(await addBench(null, outside)).toMatchObject({ ok: false });
  expect(database.prepare("SELECT count(*) n FROM benches WHERE name='Neues Bänkli'").get()).toEqual({ n: 0 });
});
it("excludes inactive benches and points outside the true 25 metre circle", async () => {
  const { getNearbyBenches } = await import("./benches");
  database.prepare("UPDATE benches SET active=0 WHERE id='osm-node-101'").run();
  expect(await getNearbyBenches(47.37674, 8.54183)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "osm-node-101" })]));
  database.prepare("UPDATE benches SET active=1 WHERE id='osm-node-101'").run();
  // About 22 m north and 22 m east: inside the index square, outside the circle.
  expect(await getNearbyBenches(47.376938, 8.542122)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "osm-node-101" })]));
});
