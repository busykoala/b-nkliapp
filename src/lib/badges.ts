import { sqlite } from "@/db/client";

export const badgeCatalog = [
  { key: "erstes-plaetzli", name: "Plätzli-Finder", icon: "🌱", hint: "Ein Bänkli eingetragen", metric: "added", target: 1 },
  { key: "spaehnase", name: "Spähnase", icon: "🔎", hint: "10 Bänkli eingetragen", metric: "added", target: 10 },
  { key: "verifizierli", name: "Verifizierli", icon: "✅", hint: "5 Bänkli bestätigt", metric: "confirmed", target: 5 },
  { key: "holzauge", name: "Holzauge", icon: "🪵", hint: "3 fehlende Bänkli bestätigt", metric: "removed", target: 3 },
  { key: "pausenpoet", name: "Pausenpoet", icon: "✍️", hint: "5 Bewertungen geschrieben", metric: "rated", target: 5 },
  { key: "baenkli-buenzli", name: "Bänkli-Bünzli", icon: "🏅", hint: "25 hilfreiche Beiträge", metric: "total", target: 25 },
  { key: "bankdirektor", name: "Bankdirektor", icon: "🎩", hint: "75 hilfreiche Beiträge", metric: "total", target: 75 },
  { key: "sitzungspraesident", name: "Sitzungspräsident", icon: "👑", hint: "200 hilfreiche Beiträge", metric: "total", target: 200 },
] as const;

export type BadgeMetric = typeof badgeCatalog[number]["metric"];

export function getUserActivity(userId: number) {
  const row = sqlite.prepare(`
    SELECT
      (SELECT count(*) FROM benches WHERE created_by_user_id=@userId) added,
      (SELECT count(*) FROM bench_confirmations WHERE user_id=@userId) confirmed,
      (SELECT count(*) FROM bench_removal_confirmations WHERE user_id=@userId) removed,
      (SELECT count(*) FROM ratings WHERE user_id=@userId) rated,
      (SELECT count(*) FROM bench_metadata_edits WHERE user_id=@userId) edited
  `).get({ userId }) as Record<string, number>;
  const total = row.added + row.confirmed + row.removed + row.rated + row.edited;
  return { ...row, total } as Record<BadgeMetric, number> & { edited: number };
}

export function refreshUserBadges(userId: number) {
  const activity = getUserActivity(userId);
  const now = new Date().toISOString();
  const insert = sqlite.prepare("INSERT OR IGNORE INTO user_badges(user_id,badge_key,awarded_at) VALUES(?,?,?)");
  for (const badge of badgeCatalog) if (activity[badge.metric] >= badge.target) insert.run(userId, badge.key, now);
}

export function getUserBadges(userId: number) {
  const activity = getUserActivity(userId);
  const earned = new Set((sqlite.prepare("SELECT badge_key FROM user_badges WHERE user_id=?").all(userId) as Array<{ badge_key: string }>).map((row) => row.badge_key));
  return badgeCatalog.map((badge) => ({ ...badge, earned: earned.has(badge.key), progress: Math.min(activity[badge.metric], badge.target) }));
}
