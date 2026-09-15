import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import type { WalkDraftSettings, WalkResult } from "@/lib/walks/model";

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));
vi.mock("@/db/client", async () => {
  const { default: SQLite } = await import("better-sqlite3");
  return { sqlite: new SQLite(":memory:") };
});

import { sqlite } from "@/db/client";
import { loadStoredWalkDraft, removeStoredWalkDraft, storeWalkDraftState, storeWalkResult } from "./walk-draft-store";

const settings: WalkDraftSettings = { minutes: 50, shape: "loop", light: "any", difficulty: "easy", speed: 4.2, time: "" };
const result = { query: { ...settings, origin: { kind: "location", label: "Spiez", latitude: 46.68, longitude: 7.67 }, time: new Date().toISOString() }, suggestions: [{ id: "chosen" }], fetchedAt: new Date().toISOString(), partial: false } as WalkResult;

describe("private walk draft", () => {
  beforeEach(() => {
    cookieJar.clear();
    (sqlite as Database.Database).exec(`DROP TABLE IF EXISTS walk_drafts;
      CREATE TABLE walk_drafts(token_hash TEXT PRIMARY KEY,state_json TEXT NOT NULL,result_blob BLOB,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL);`);
  });

  it("resumes the selected route using only an opaque HttpOnly cookie", async () => {
    await storeWalkResult(result);
    const token = cookieJar.get("benchly_walk_draft");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((sqlite as Database.Database).prepare("SELECT token_hash FROM walk_drafts").get()).not.toHaveProperty("token_hash", token);
    await storeWalkDraftState({ origin: result.query.origin, settings, selected: "chosen", extras: true, dirty: true });
    expect(await loadStoredWalkDraft()).toMatchObject({ selected: "chosen", extras: true, dirty: true, result: { suggestions: [{ id: "chosen" }] } });
    expect((sqlite as Database.Database).prepare("SELECT typeof(result_blob) kind FROM walk_drafts").get()).toMatchObject({ kind: "blob" });
  });

  it("expires after seven days and discards only when explicitly asked", async () => {
    await storeWalkResult(result);
    (sqlite as Database.Database).prepare("UPDATE walk_drafts SET expires_at='2000-01-01'").run();
    expect(await loadStoredWalkDraft()).toBeNull();
    await storeWalkResult(result);
    await removeStoredWalkDraft();
    expect(cookieJar.size).toBe(0);
    expect((sqlite as Database.Database).prepare("SELECT count(*) count FROM walk_drafts").get()).toMatchObject({ count: 0 });
  });
});
