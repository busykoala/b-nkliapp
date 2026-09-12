import { sqlite } from "@/db/client";
import type Database from "better-sqlite3";

export const badgeCatalog = [
  { key: "erstes-plaetzli", art: "discoverer", metric: "added", target: 1 },
  { key: "baenkli-scout", art: "pioneer", metric: "verifiedAdded", target: 3 },
  { key: "spaehnase", art: "scout", metric: "added", target: 10 },
  { key: "verifizierli", art: "checker", metric: "confirmed", target: 5 },
  { key: "holzauge", art: "detective", metric: "removed", target: 3 },
  { key: "pausenpoet", art: "poet", metric: "rated", target: 5 },
  { key: "baenkli-botschafter", art: "scout", metric: "referred", target: 3 },
  { key: "baenkli-buenzli", art: "expert", metric: "total", target: 25 },
  { key: "bankdirektor", art: "guru", metric: "total", target: 75 },
  { key: "sitzungspraesident", art: "legend", metric: "total", target: 200 },
] as const;

export type BadgeKey = typeof badgeCatalog[number]["key"];
export type BadgeMetric = typeof badgeCatalog[number]["metric"];

export function getUserActivity(userId: number, database: Database.Database = sqlite) {
  const row = database.prepare(`
    SELECT
      (SELECT count(*) FROM benches WHERE created_by_user_id=@userId) added,
      (SELECT count(*) FROM benches WHERE created_by_user_id=@userId AND verification_status='verified') verifiedAdded,
      (SELECT count(*) FROM bench_confirmations WHERE user_id=@userId) confirmed,
      (SELECT count(*) FROM bench_removal_confirmations WHERE user_id=@userId) removed,
      (SELECT count(*) FROM ratings WHERE user_id=@userId) rated,
      (SELECT count(*) FROM referrals WHERE inviter_user_id=@userId) referred,
      (SELECT count(DISTINCT bench_row_id) FROM bench_metadata_edits WHERE user_id=@userId) edited
  `).get({ userId }) as Record<string, number>;
  const total = row.added + row.confirmed + row.removed + row.rated + row.edited;
  return { ...row, total } as Record<BadgeMetric, number> & { edited: number };
}

export function refreshUserBadges(userId: number, database: Database.Database = sqlite) {
  const activity = getUserActivity(userId, database);
  const now = new Date().toISOString();
  const insert = database.prepare("INSERT OR IGNORE INTO user_badges(user_id,badge_key,awarded_at) VALUES(?,?,?)");
  for (const badge of badgeCatalog) if (activity[badge.metric] >= badge.target) insert.run(userId, badge.key, now);
}

export function getUserBadges(userId: number, database: Database.Database = sqlite) {
  const activity = getUserActivity(userId, database);
  const earned = new Set((database.prepare("SELECT badge_key FROM user_badges WHERE user_id=?").all(userId) as Array<{ badge_key: string }>).map((row) => row.badge_key));
  return badgeCatalog.map((badge) => ({ ...badge, earned: earned.has(badge.key), progress: Math.min(activity[badge.metric], badge.target) }));
}
