"use server";

import { sqlite } from "@/db/client";
import type { ActivityFeed, FeedCursor, FeedEntry, FeedPage, WeeklyBench } from "@/features/feed/model";
import { getCurrentUser } from "@/lib/security";

export type { FeedEntry } from "@/features/feed/model";

export async function getActivityFeed(limit = 48): Promise<ActivityFeed> {
  return { ...await getFeedPage(null, limit), weeklyBench: weeklyBench() };
}

export async function getFeedPage(cursor: FeedCursor | null = null, limit = 48): Promise<FeedPage> {
  if (cursor && (typeof cursor.id !== "string" || cursor.id.length > 100 || typeof cursor.createdAt !== "string" || cursor.createdAt.length > 40 || !Number.isFinite(Date.parse(cursor.createdAt)))) throw new Error("Ungültige Feed-Seite.");
  const user = await getCurrentUser();
  const personalized = Boolean(user && sqlite.prepare(`
    SELECT 1 FROM bench_follows WHERE user_id=? UNION SELECT 1 FROM place_follows WHERE user_id=? LIMIT 1
  `).get(user.id, user.id));
  const safeLimit = Math.max(1, Math.min(48, Number.isFinite(limit) ? Math.trunc(limit) : 48));
  const rows = sqlite.prepare(`
    SELECT * FROM (
      SELECT 'moment-' || m.id id, 'moment' kind, u.username, u.avatar_seed, b.id bench_id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), nullif(b.description,''), 'Sitzbank') bench_name,
        m.created_at, m.body detail, b.row_id, b.location_key
      FROM bench_moments m JOIN users u ON u.id=m.user_id JOIN benches b ON b.row_id=m.bench_row_id
      WHERE m.visible=1 AND b.active=1
      UNION ALL
      SELECT 'care-' || c.id, 'care', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), nullif(b.description,''), 'Sitzbank'), c.created_at, c.kind, b.row_id, b.location_key
      FROM bench_care_actions c JOIN users u ON u.id=c.user_id JOIN benches b ON b.row_id=c.bench_row_id WHERE b.active=1
      UNION ALL
      SELECT 'added-' || b.row_id, 'added', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), nullif(b.description,''), 'Sitzbank'), b.imported_at, NULL, b.row_id, b.location_key
      FROM benches b JOIN users u ON u.id=b.created_by_user_id WHERE b.active=1
      UNION ALL
      SELECT 'rated-' || r.id, 'rated', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), nullif(b.description,''), 'Sitzbank'), r.updated_at, r.note, b.row_id, b.location_key
      FROM ratings r JOIN users u ON u.id=r.user_id JOIN benches b ON b.row_id=r.bench_row_id WHERE r.visible=1 AND b.active=1
      UNION ALL
      SELECT 'confirmed-' || c.bench_row_id || '-' || c.user_id, 'confirmed', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), nullif(b.description,''), 'Sitzbank'), c.created_at, NULL, b.row_id, b.location_key
      FROM bench_confirmations c JOIN users u ON u.id=c.user_id JOIN benches b ON b.row_id=c.bench_row_id WHERE b.active=1
      UNION ALL
      SELECT 'missing-' || rc.request_id || '-' || rc.user_id, 'missing', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), nullif(b.description,''), 'Sitzbank'), rc.created_at, NULL, b.row_id, b.location_key
      FROM bench_removal_confirmations rc JOIN users u ON u.id=rc.user_id
      JOIN bench_removal_requests rr ON rr.id=rc.request_id JOIN benches b ON b.row_id=rr.bench_row_id
      UNION ALL
      SELECT 'edited-' || e.id, 'edited', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), nullif(b.description,''), 'Sitzbank'), e.created_at, e.field, b.row_id, b.location_key
      FROM bench_metadata_edits e JOIN users u ON u.id=e.user_id JOIN benches b ON b.row_id=e.bench_row_id WHERE b.active=1
    ) activity
    WHERE (?=0 OR EXISTS(SELECT 1 FROM bench_follows bf WHERE bf.user_id=? AND bf.bench_row_id=activity.row_id)
      OR EXISTS(SELECT 1 FROM place_follows pf WHERE pf.user_id=? AND pf.location_key=activity.location_key))
      AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(personalized ? 1 : 0, user?.id ?? 0, user?.id ?? 0, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, safeLimit + 1);
  const entries = rows.slice(0, safeLimit).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      id: String(item.id), kind: String(item.kind) as FeedEntry["kind"], username: String(item.username), avatarSeed: String(item.avatar_seed || item.username),
      benchId: String(item.bench_id), benchName: String(item.bench_name), createdAt: String(item.created_at), detail: item.detail ? String(item.detail) : null,
    };
  });
  const last = entries.at(-1);
  return { personalized, entries, nextCursor: rows.length > safeLimit && last ? { createdAt: last.createdAt, id: last.id } : null };
}

function weeklyBench(): WeeklyBench | null {
  const count = Number((sqlite.prepare("SELECT count(*) count FROM benches WHERE active=1 AND verification_status='verified'").get() as { count: number }).count);
  if (!count) return null;
  const week = weekKey(new Date());
  const offset = [...week].reduce((sum, character) => sum + character.charCodeAt(0), 0) % count;
  const row = sqlite.prepare(`
    SELECT id,coalesce(nullif(name,''),nullif(description,''),nullif(location_name,''),'Ein Bänkli') name,location_name place
    FROM benches WHERE active=1 AND verification_status='verified' ORDER BY row_id LIMIT 1 OFFSET ?
  `).get(offset) as { id: string; name: string; place: string | null } | undefined;
  return row ?? null;
}

function weekKey(date: Date) {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-${week}`;
}
