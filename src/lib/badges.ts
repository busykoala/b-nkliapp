import { sqlite } from "@/db/client";
import type Database from "better-sqlite3";

export const badgeCatalog = [
  { key: "erstes-plaetzli", name: "Bänkli-Entdecker:in", art: "discoverer", hint: "Ein Bänkli eingetragen", metric: "added", target: 1 },
  { key: "baenkli-scout", name: "Bänkli-Pionier:in", art: "pioneer", hint: "3 eigene Bänkli bestätigt", metric: "verifiedAdded", target: 3 },
  { key: "spaehnase", name: "Bänkli-Spürnase", art: "scout", hint: "10 Bänkli eingetragen", metric: "added", target: 10 },
  { key: "verifizierli", name: "Bänkli-Prüfer:in", art: "checker", hint: "5 Bänkli bestätigt", metric: "confirmed", target: 5 },
  { key: "holzauge", name: "Bänkli-Detektiv:in", art: "detective", hint: "3 fehlende Bänkli bestätigt", metric: "removed", target: 3 },
  { key: "pausenpoet", name: "Pausenpoet:in", art: "poet", hint: "5 Bewertungen geschrieben", metric: "rated", target: 5 },
  { key: "baenkli-buenzli", name: "Bänkli-Kenner:in", art: "expert", hint: "25 hilfreiche Beiträge", metric: "total", target: 25 },
  { key: "bankdirektor", name: "Bänkli-Guru", art: "guru", hint: "75 hilfreiche Beiträge", metric: "total", target: 75 },
  { key: "sitzungspraesident", name: "Bänkli-Legende", art: "legend", hint: "200 hilfreiche Beiträge", metric: "total", target: 200 },
] as const;

export type BadgeMetric = typeof badgeCatalog[number]["metric"];

export function getUserActivity(userId: number, database: Database.Database = sqlite) {
  const row = database.prepare(`
    SELECT
      (SELECT count(*) FROM benches WHERE created_by_user_id=@userId) added,
      (SELECT count(*) FROM benches WHERE created_by_user_id=@userId AND verification_status='verified') verifiedAdded,
      (SELECT count(*) FROM bench_confirmations WHERE user_id=@userId) confirmed,
      (SELECT count(*) FROM bench_removal_confirmations WHERE user_id=@userId) removed,
      (SELECT count(*) FROM ratings WHERE user_id=@userId) rated,
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
