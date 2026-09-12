import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { executeMigration, migrations } from "@/db/migrations";
import { createReferralInvite, getReferralCount, getReferralInvite, recordReferral } from "./service";

function database() {
  const value = new Database(":memory:");
  value.pragma("foreign_keys=ON");
  migrations.forEach((migration) => executeMigration(value, migration));
  value.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES(?,?,?,?)").run("Einlader", "einlader", "hash", "2026-01-01");
  return value;
}

describe("referral invitations", () => {
  it("stores only a hash and credits each newly created account once", () => {
    const db = database();
    try {
      const created = createReferralInvite(1, db, new Date("2026-09-01T10:00:00Z"));
      expect(created.token).toHaveLength(43);
      expect((db.prepare("SELECT token_hash FROM referral_invites").get() as {token_hash: string}).token_hash).not.toContain(created.token);
      const invite = getReferralInvite(created.token, db, new Date("2026-09-02T10:00:00Z"));
      expect(invite).toMatchObject({ inviterUserId: 1, inviterUsername: "Einlader" });
      const referred = db.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES(?,?,?,?)").run("Gast", "gast", "hash", "2026-09-02");
      expect(recordReferral(invite!, Number(referred.lastInsertRowid), db)).toBe(true);
      expect(recordReferral(invite!, Number(referred.lastInsertRowid), db)).toBe(false);
      expect(getReferralCount(1, db)).toBe(1);
    } finally { db.close(); }
  });

  it("rejects malformed and expired secrets", () => {
    const db = database();
    try {
      const created = createReferralInvite(1, db, new Date("2026-01-01T00:00:00Z"));
      expect(getReferralInvite("not-a-secret", db)).toBeNull();
      expect(getReferralInvite(created.token, db, new Date("2026-02-01T00:00:01Z"))).toBeNull();
    } finally { db.close(); }
  });
});
