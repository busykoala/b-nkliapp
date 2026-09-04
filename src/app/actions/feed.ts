"use server";

import { sqlite } from "@/db/client";

export type FeedEntry = {
  id: string;
  kind: "added" | "rated" | "confirmed" | "missing" | "edited";
  username: string;
  avatarSeed: string;
  benchId: string;
  benchName: string;
  createdAt: string;
};

export async function getActivityFeed(limit = 60): Promise<FeedEntry[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return sqlite.prepare(`
    SELECT * FROM (
      SELECT 'added-' || b.row_id id, 'added' kind, u.username, u.avatar_seed, b.id bench_id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), 'Sitzbank') bench_name,
        b.imported_at created_at
      FROM benches b JOIN users u ON u.id=b.created_by_user_id
      WHERE b.active=1
      UNION ALL
      SELECT 'rated-' || r.id, 'rated', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), 'Sitzbank'), r.updated_at
      FROM ratings r JOIN users u ON u.id=r.user_id JOIN benches b ON b.row_id=r.bench_row_id
      WHERE r.visible=1 AND b.active=1
      UNION ALL
      SELECT 'confirmed-' || c.bench_row_id || '-' || c.user_id, 'confirmed', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), 'Sitzbank'), c.created_at
      FROM bench_confirmations c JOIN users u ON u.id=c.user_id JOIN benches b ON b.row_id=c.bench_row_id
      WHERE b.active=1
      UNION ALL
      SELECT 'missing-' || rc.request_id || '-' || rc.user_id, 'missing', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), 'Sitzbank'), rc.created_at
      FROM bench_removal_confirmations rc JOIN users u ON u.id=rc.user_id
      JOIN bench_removal_requests rr ON rr.id=rc.request_id JOIN benches b ON b.row_id=rr.bench_row_id
      UNION ALL
      SELECT 'edited-' || e.id, 'edited', u.username, u.avatar_seed, b.id,
        coalesce(nullif(b.name,''), nullif(b.location_name,''), 'Sitzbank'), e.created_at
      FROM bench_metadata_edits e JOIN users u ON u.id=e.user_id JOIN benches b ON b.row_id=e.bench_row_id
      WHERE b.active=1
    ) ORDER BY created_at DESC LIMIT ?
  `).all(safeLimit).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      id: String(item.id), kind: String(item.kind) as FeedEntry["kind"], username: String(item.username), avatarSeed: String(item.avatar_seed || item.username),
      benchId: String(item.bench_id), benchName: String(item.bench_name), createdAt: String(item.created_at),
    };
  });
}
