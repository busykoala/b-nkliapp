import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { sqlite } from "@/db/client";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVITE_DAYS = 30;

export type ReferralInvite = {
  id: number;
  inviterUserId: number;
  inviterUsername: string;
  expiresAt: string;
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createReferralInvite(userId: number, database: Database.Database = sqlite, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
  database.prepare("DELETE FROM referral_invites WHERE expires_at<=? AND id NOT IN (SELECT invite_id FROM referrals)").run(now.toISOString());
  database.prepare("INSERT INTO referral_invites(inviter_user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)")
    .run(userId, tokenHash(token), now.toISOString(), expiresAt);
  return { token, expiresAt };
}

export function getReferralInvite(token: string, database: Database.Database = sqlite, now = new Date()): ReferralInvite | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const row = database.prepare(`SELECT i.id,i.inviter_user_id,u.username,i.expires_at
    FROM referral_invites i JOIN users u ON u.id=i.inviter_user_id
    WHERE i.token_hash=? AND i.revoked_at IS NULL AND i.expires_at>?`).get(tokenHash(token), now.toISOString()) as {
      id: number; inviter_user_id: number; username: string; expires_at: string;
    } | undefined;
  return row ? { id: row.id, inviterUserId: row.inviter_user_id, inviterUsername: row.username, expiresAt: row.expires_at } : null;
}

export function recordReferral(invite: ReferralInvite, referredUserId: number, database: Database.Database = sqlite, now = new Date()) {
  if (invite.inviterUserId === referredUserId) return false;
  const result = database.prepare(`INSERT OR IGNORE INTO referrals(invite_id,inviter_user_id,referred_user_id,created_at)
    VALUES(?,?,?,?)`).run(invite.id, invite.inviterUserId, referredUserId, now.toISOString());
  return result.changes === 1;
}

export function getReferralCount(userId: number, database: Database.Database = sqlite) {
  return Number((database.prepare("SELECT count(*) count FROM referrals WHERE inviter_user_id=?").get(userId) as {count: number}).count);
}
