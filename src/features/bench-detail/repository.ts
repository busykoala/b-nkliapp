import "server-only";

import { sqlite } from "@/db/client";
import { DATA_RUNTIME } from "@/data/runtime.generated";
import type { BenchDetail } from "@/lib/types";

export type DetailRow = Record<string, string | number | null>;

export function readDetailMetadata(benchId: string) {
  return sqlite.prepare(`
    SELECT coalesce(b.name,b.description,'Sitzbank') title,
      CASE WHEN json_array_length(e.terrain_horizon_profile)=72 THEN e.view_score ELSE NULL END view_score
    FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    WHERE b.id=? AND b.active=1
  `).get(benchId) as { title: string; view_score: number | null } | undefined;
}

export function readDetailRow(benchId: string) {
  return sqlite.prepare(`
    SELECT b.*,e.*,
      lm.land_context likely_land_context,lm.land_context_probability likely_land_probability,
      lm.canopy_context likely_canopy_context,lm.canopy_probability likely_canopy_probability,
      lm.lake_view_probability likely_lake_view_probability,lm.mountain_view_probability likely_mountain_view_probability,
      lm.open_view_probability likely_open_view_probability,lm.limited_view_probability likely_limited_view_probability,
      lm.buildings_probability likely_buildings_probability,lm.road_rail_probability likely_road_rail_probability,
      lm.confidence likely_confidence,lm.evidence_group_count likely_evidence_group_count,
      lm.evidence_summary likely_evidence_summary,lm.model_version likely_model_version,lm.updated_at likely_updated_at,
      (SELECT avg(overall) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_average,
      (SELECT count(*) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_count,
      (SELECT avg(view_score) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_view,
      (SELECT avg(comfort) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_comfort,
      (SELECT avg(quiet) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_quiet,
      (SELECT count(*) FROM bench_confirmations c WHERE c.bench_row_id=b.row_id) confirmation_count,
      (SELECT max(coalesce(last_seen_at,created_at)) FROM bench_confirmations c WHERE c.bench_row_id=b.row_id) last_confirmed_at,
      (SELECT count(*) FROM bench_removal_confirmations rc
        JOIN bench_removal_requests rr ON rr.id=rc.request_id
        WHERE rr.bench_row_id=b.row_id AND rr.status='pending') removal_confirmation_count
    FROM benches b
    LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    LEFT JOIN bench_likely_metadata lm ON lm.bench_row_id=b.row_id
    WHERE b.id=? AND b.active=1
  `).get(benchId) as DetailRow | undefined;
}

export function readEvidenceCoverage() {
  const officialLand = Boolean(sqlite.prepare(
    "SELECT 1 FROM official_context_sources WHERE source='swissTLM3D' LIMIT 1",
  ).get());
  const exactOsm = Boolean(sqlite.prepare(`
    SELECT 1 FROM pipeline_runs
    WHERE kind IN ('import-osm','refresh') AND status='completed'
      AND pipeline_version IN ('4.2.0','4.3.0','4.4.0',?)
    LIMIT 1
  `).get(DATA_RUNTIME.pipelineVersion));
  return { exactOsm, exactLand: officialLand || exactOsm };
}

export function readLatestVisionStats() {
  return (sqlite.prepare(`
    SELECT stats FROM pipeline_runs
    WHERE kind='vision-benchmark' AND status='completed'
    ORDER BY finished_at DESC,id DESC LIMIT 1
  `).get() as { stats: string | null } | undefined)?.stats ?? null;
}

export function readPhotoEvidence(row: DetailRow): BenchDetail["photoEvidence"] {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='bank_photo_evidence'").get()) return null;
  const evidence = sqlite.prepare(`SELECT signals,base_enrichment,applied_enrichment
    FROM bank_photo_evidence WHERE bench_row_id=? AND bench_id=? AND bench_latitude=? AND bench_longitude=?
  `).get(row.row_id, row.id, row.latitude, row.longitude) as {
    signals: string; base_enrichment: string | null; applied_enrichment: string | null;
  } | undefined;
  if (!evidence) return null;
  try {
    const base = JSON.parse(evidence.base_enrichment ?? "{}") as Record<string, unknown>;
    const applied = JSON.parse(evidence.applied_enrichment ?? "{}") as Record<string, unknown>;
    const contributes = Object.keys(applied).some((key) => applied[key] !== base[key] && applied[key] === row[key]);
    if (!contributes) return null;
    const signals = JSON.parse(evidence.signals) as { photos?: Array<{ source_id: number; image_id: number }> };
    const photos = new Set((signals.photos ?? [])
      .filter(({ source_id, image_id }) => Number.isSafeInteger(source_id) && source_id > 0
        && Number.isSafeInteger(image_id) && image_id > 0)
      .map(({ source_id, image_id }) => `${source_id}:${image_id}`));
    return photos.size ? { observationCount: photos.size } : null;
  } catch {
    return null;
  }
}

export function readBenchCommunity(row: DetailRow, userId: number | null) {
  const rowId = Number(row.row_id);
  const recentRatings = sqlite.prepare(`
    SELECT id,overall,view_score view,comfort,quiet,note,created_at createdAt
    FROM ratings WHERE bench_row_id=? AND visible=1 ORDER BY updated_at DESC LIMIT 5
  `).all(rowId) as BenchDetail["recentRatings"];
  const corrections = sqlite.prepare(`
    SELECT id,field,proposed_value proposedValue,note,created_at createdAt
    FROM corrections WHERE bench_row_id=? AND visible=1 ORDER BY created_at DESC LIMIT 20
  `).all(rowId) as BenchDetail["corrections"];
  const media = sqlite.prepare(`
    SELECT id,relation,provider,source_url sourceUrl,thumbnail_url thumbnailUrl,author,license,
      distance_meters distanceMeters,title
    FROM media WHERE bench_row_id=? ORDER BY relation,distance_meters LIMIT 12
  `).all(rowId) as BenchDetail["media"];
  const moments = (sqlite.prepare(`
    SELECT m.id,m.kind,m.body,m.photo_url photoUrl,m.created_at createdAt,
      u.username,u.avatar_seed avatarSeed,m.user_id
    FROM bench_moments m JOIN users u ON u.id=m.user_id
    WHERE m.bench_row_id=? AND m.visible=1 ORDER BY m.created_at DESC LIMIT 12
  `).all(rowId) as Array<Record<string, unknown>>).map((moment) => {
    const storedPhoto = String(moment.photoUrl ?? "");
    return {
      ...moment,
      hasPhoto: Boolean(storedPhoto),
      photoUrl: storedPhoto.startsWith("garage:") ? null : moment.photoUrl,
      mine: userId === Number(moment.user_id),
    };
  }) as BenchDetail["moments"];
  const careCounts = Object.fromEntries((sqlite.prepare(`
    SELECT kind,count(DISTINCT user_id) count FROM bench_care_actions
    WHERE bench_row_id=? AND created_at>=datetime('now','-90 days') GROUP BY kind
  `).all(rowId) as Array<{ kind: string; count: number }>).map((item) => [item.kind, Number(item.count)]));
  const myCare = userId === null ? [] : (sqlite.prepare(`
    SELECT DISTINCT kind FROM bench_care_actions
    WHERE bench_row_id=? AND user_id=? AND created_at>=datetime('now','start of day')
  `).all(rowId, userId) as Array<{ kind: BenchDetail["care"]["mine"][number] }>).map((item) => item.kind);
  const followingBench = userId !== null && Boolean(sqlite.prepare(
    "SELECT 1 FROM bench_follows WHERE bench_row_id=? AND user_id=?",
  ).get(rowId, userId));
  const followingPlace = userId !== null && Boolean(row.location_key) && Boolean(sqlite.prepare(
    "SELECT 1 FROM place_follows WHERE location_key=? AND user_id=?",
  ).get(row.location_key, userId));
  const myRating = userId === null ? null : sqlite.prepare(`
    SELECT overall,view_score view,comfort,quiet,note
    FROM ratings WHERE bench_row_id=? AND user_id=? LIMIT 1
  `).get(rowId, userId) as BenchDetail["myRating"];
  return { recentRatings, corrections, media, moments, careCounts, myCare, followingBench, followingPlace, myRating };
}

export function readContributedFields(rowId: number, userId: number | null) {
  const edits = sqlite.prepare("SELECT field,max(created_at) latest_at FROM bench_metadata_edits WHERE bench_row_id=? GROUP BY field").all(rowId) as Array<{ field: string; latest_at: string }>;
  const all = new Set(edits.map((item) => item.field));
  const mine = new Set(userId === null ? [] : (sqlite.prepare(
    "SELECT DISTINCT field FROM bench_metadata_edits WHERE bench_row_id=? AND user_id=?",
  ).all(rowId, userId) as Array<{ field: string }>).map((item) => item.field));
  const confirmation = userId === null ? undefined : sqlite.prepare("SELECT coalesce(last_seen_at,created_at) created_at FROM bench_confirmations WHERE bench_row_id=? AND user_id=?")
    .get(rowId, userId) as { created_at: string } | undefined;
  return { all, mine, latestEdits: Object.fromEntries(edits.map((item) => [item.field, item.latest_at])), lastConfirmedAt: confirmation?.created_at ?? null };
}
