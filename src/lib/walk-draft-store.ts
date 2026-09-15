import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { cookies } from "next/headers";
import { sqlite } from "@/db/client";
import type { WalkDraftSnapshot, WalkResult } from "@/lib/walks/model";

const COOKIE = "benchly_walk_draft";
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;

type DraftState = Omit<WalkDraftSnapshot, "result">;
type DraftRow = { state_json: string; result_blob: Buffer | null; expires_at: string };

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function expiry() {
  return new Date(Date.now() + LIFETIME_MS);
}

async function identity(create: boolean) {
  const store = await cookies();
  let token = store.get(COOKIE)?.value;
  if ((!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) && create) token = randomBytes(32).toString("base64url");
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  if (create) store.set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiry(),
  });
  return hash(token);
}

function prune() {
  sqlite.prepare("DELETE FROM walk_drafts WHERE expires_at <= ?").run(new Date().toISOString());
}

export async function loadStoredWalkDraft(): Promise<WalkDraftSnapshot | null> {
  const tokenHash = await identity(false);
  if (!tokenHash) return null;
  const row = sqlite.prepare("SELECT state_json,result_blob,expires_at FROM walk_drafts WHERE token_hash=? AND expires_at>?")
    .get(tokenHash, new Date().toISOString()) as DraftRow | undefined;
  if (!row) return null;
  try {
    const state = JSON.parse(row.state_json) as DraftState;
    const result = row.result_blob ? JSON.parse(inflateSync(row.result_blob, { maxOutputLength: 32 * 1024 * 1024 }).toString()) as WalkResult : null;
    if (result && !result.suggestions.some((item) => item.id === state.selected)) state.selected = result.suggestions[0]?.id ?? "";
    return { ...state, result };
  } catch {
    // A corrupt or obsolete private draft is never allowed to break the map.
    return null;
  }
}

export async function storeWalkDraftState(state: DraftState) {
  const tokenHash = await identity(true);
  if (!tokenHash) throw new Error("Unable to create walk draft");
  prune();
  const now = new Date().toISOString();
  const existing = sqlite.prepare("SELECT result_blob FROM walk_drafts WHERE token_hash=?").get(tokenHash) as { result_blob: Buffer | null } | undefined;
  sqlite.prepare(`INSERT INTO walk_drafts(token_hash,state_json,result_blob,updated_at,expires_at) VALUES(?,?,?,?,?)
    ON CONFLICT(token_hash) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at,expires_at=excluded.expires_at`)
    .run(tokenHash, JSON.stringify(state), existing?.result_blob ?? null, now, expiry().toISOString());
}

export async function storeWalkResult(result: WalkResult) {
  const tokenHash = await identity(true);
  if (!tokenHash) throw new Error("Unable to create walk draft");
  const blob = deflateSync(Buffer.from(JSON.stringify(result)), { level: 6 });
  if (blob.length > MAX_RESULT_BYTES) throw new Error("Walk result exceeds private draft limit");
  prune();
  const query = result.query;
  const state: DraftState = {
    origin: query.origin,
    settings: { minutes: query.minutes, shape: query.shape, light: query.light, speed: query.speed, difficulty: query.difficulty, maxRestMinutes: query.maxRestMinutes, time: "" },
    selected: result.suggestions[0]?.id ?? "",
    extras: false,
    dirty: false,
  };
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO walk_drafts(token_hash,state_json,result_blob,updated_at,expires_at) VALUES(?,?,?,?,?)
    ON CONFLICT(token_hash) DO UPDATE SET state_json=excluded.state_json,result_blob=excluded.result_blob,updated_at=excluded.updated_at,expires_at=excluded.expires_at`)
    .run(tokenHash, JSON.stringify(state), blob, now, expiry().toISOString());
}

export async function removeStoredWalkDraft() {
  const store = await cookies();
  const tokenHash = await identity(false);
  if (tokenHash) sqlite.prepare("DELETE FROM walk_drafts WHERE token_hash=?").run(tokenHash);
  store.delete(COOKIE);
}
