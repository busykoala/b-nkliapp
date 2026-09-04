import type Database from "better-sqlite3";
import { sqlite } from "@/db/client";
import { getUserActivity } from "@/lib/badges";
import { normalizeUsername } from "@/lib/security";

export type LandscapeKey = "forest" | "water" | "mountain" | "hill" | "open" | "city";
export type SeasonKey = "spring" | "summer" | "autumn" | "winter";

export type ProfileMoment = {
  id: string;
  kind: "added" | "rated" | "confirmed" | "missing" | "edited" | "corrected";
  benchId: string;
  benchName: string;
  createdAt: string;
};

export type TrailProfile = {
  id: number;
  username: string;
  avatarSeed: string;
  joinedAt: string;
  activity: {
    added: number;
    verifiedAdded: number;
    rated: number;
    confirmed: number;
    removed: number;
    edited: number;
    corrected: number;
  };
  uniquePlaces: number;
  journey: {
    title: string;
    currentFloor: number;
    nextTarget: number | null;
    progress: number;
  };
  landscapes: Array<{ key: LandscapeKey; name: string; hint: string; found: boolean; benchId: string | null }>;
  seasons: Array<{ key: SeasonKey; name: string; found: boolean }>;
  recent: ProfileMoment[];
  nextPrompt: { title: string; copy: string };
};

const rawInteractions = `
  SELECT row_id bench_row_id, imported_at created_at, 'added' kind
  FROM benches WHERE created_by_user_id=@userId AND active=1
  UNION ALL
  SELECT bench_row_id, updated_at, 'rated' FROM ratings WHERE user_id=@userId AND visible=1
  UNION ALL
  SELECT bench_row_id, created_at, 'confirmed' FROM bench_confirmations WHERE user_id=@userId
  UNION ALL
  SELECT rr.bench_row_id, rc.created_at, 'missing'
  FROM bench_removal_confirmations rc JOIN bench_removal_requests rr ON rr.id=rc.request_id
  WHERE rc.user_id=@userId
  UNION ALL
  SELECT bench_row_id, created_at, 'edited' FROM bench_metadata_edits WHERE user_id=@userId
  UNION ALL
  SELECT bench_row_id, created_at, 'corrected' FROM corrections WHERE user_id=@userId AND visible=1
`;

const landscapeCatalog: Array<{ key: LandscapeKey; name: string; hint: string }> = [
  { key: "forest", name: "Waldlicht", hint: "Ein Platz zwischen Bäumen" },
  { key: "water", name: "Am Wasser", hint: "See oder Fluss in der Nähe" },
  { key: "mountain", name: "Bergluft", hint: "Ein Platz mit Bergblick" },
  { key: "hill", name: "Hügelweg", hint: "Sanfte Höhen im Blick" },
  { key: "open", name: "Weite", hint: "Ein offener Horizont" },
  { key: "city", name: "Stadtpause", hint: "Ein stiller Fleck im Ort" },
];

const seasonCatalog: Array<{ key: SeasonKey; name: string }> = [
  { key: "spring", name: "Frühling" },
  { key: "summer", name: "Sommer" },
  { key: "autumn", name: "Herbst" },
  { key: "winter", name: "Winter" },
];

function seasonFor(value: string): SeasonKey {
  const month = new Date(value).getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

function journeyFor(places: number) {
  const stages = [
    { floor: 0, target: 1, title: "Die erste Spur" },
    { floor: 1, target: 5, title: "Auf leisen Pfaden" },
    { floor: 5, target: 15, title: "Durch Wald und Wiesen" },
    { floor: 15, target: 40, title: "Über den Hügeln" },
    { floor: 40, target: 100, title: "Mit weitem Blick" },
    { floor: 100, target: null, title: "Hüter:in der Bänkli" },
  ];
  const stage = [...stages].reverse().find((item) => places >= item.floor) ?? stages[0];
  const progress = stage.target === null ? 100 : Math.max(0, Math.min(100, ((places - stage.floor) / (stage.target - stage.floor)) * 100));
  return { title: stage.title, currentFloor: stage.floor, nextTarget: stage.target, progress };
}

function nextPrompt(activity: TrailProfile["activity"], landscapes: TrailProfile["landscapes"]) {
  if (activity.added === 0) return { title: "Setz deine erste Spur", copy: "Kennst du ein Bänkli, das auf der Karte noch fehlt?" };
  if (activity.rated === 0) return { title: "Erzähl von einer Pause", copy: "Eine ehrliche Stimme macht den nächsten Fund leichter." };
  if (activity.confirmed === 0) return { title: "Schau einmal genauer hin", copy: "Neue Bänkli freuen sich über eine Bestätigung vor Ort." };
  const missing = landscapes.find((item) => !item.found);
  if (missing) return { title: `${missing.name} entdecken`, copy: missing.hint };
  return { title: "Folge deiner Neugier", copy: "Vielleicht wartet gleich um die Ecke ein besonderer Platz." };
}

type LandscapeRow = {
  id: string;
  in_forest: number | null;
  land_context: string | null;
  waterfront: number | null;
  distance_water_meters: number | null;
  view_labels: string | null;
  view_components: string | null;
};

function landscapeKeys(row: LandscapeRow): LandscapeKey[] {
  const labels = row.view_labels ?? "";
  let openness = 0;
  try { openness = Number(JSON.parse(row.view_components ?? "{}").openness ?? 0); } catch { /* Incomplete legacy enrichment. */ }
  return [
    row.in_forest === 1 || row.land_context === "forest" || row.land_context === "forest_edge" ? "forest" : null,
    row.waterfront === 1 || (row.distance_water_meters !== null && row.distance_water_meters <= 80) || labels.includes("Seeblick") ? "water" : null,
    labels.includes("Bergblick") ? "mountain" : null,
    labels.includes("Hügelblick") ? "hill" : null,
    labels.includes("Weitsicht") || openness >= .72 ? "open" : null,
    row.land_context === "urban" ? "city" : null,
  ].filter((key): key is LandscapeKey => key !== null);
}

export function getTrailProfile(userId: number, database: Database.Database = sqlite): TrailProfile | null {
  const user = database.prepare("SELECT id,username,avatar_seed,created_at FROM users WHERE id=?")
    .get(userId) as { id: number; username: string; avatar_seed: string; created_at: string } | undefined;
  if (!user) return null;

  const baseActivity = getUserActivity(userId, database);
  const corrected = (database.prepare("SELECT count(*) count FROM corrections WHERE user_id=? AND visible=1").get(userId) as { count: number }).count;
  const activity = { ...baseActivity, corrected };
  const uniquePlaces = (database.prepare(`WITH raw AS (${rawInteractions}) SELECT count(DISTINCT bench_row_id) count FROM raw`)
    .get({ userId }) as { count: number }).count;
  const landscapeRows = database.prepare(`
    WITH raw AS (${rawInteractions}), touched AS (SELECT DISTINCT bench_row_id FROM raw)
    SELECT b.id,e.in_forest,e.land_context,e.waterfront,e.distance_water_meters,e.view_labels,e.view_components
    FROM touched JOIN benches b ON b.row_id=touched.bench_row_id
    LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
  `).all({ userId }) as LandscapeRow[];
  const firstForLandscape = new Map<LandscapeKey, string>();
  for (const row of landscapeRows) for (const key of landscapeKeys(row)) if (!firstForLandscape.has(key)) firstForLandscape.set(key, row.id);
  const landscapes = landscapeCatalog.map((item) => ({ ...item, found: firstForLandscape.has(item.key), benchId: firstForLandscape.get(item.key) ?? null }));

  const timestamps = database.prepare(`WITH raw AS (${rawInteractions}) SELECT created_at FROM raw`).all({ userId }) as Array<{ created_at: string }>;
  const foundSeasons = new Set(timestamps.map((item) => seasonFor(item.created_at)));
  const seasons = seasonCatalog.map((item) => ({ ...item, found: foundSeasons.has(item.key) }));

  const recent = database.prepare(`
    WITH raw AS (${rawInteractions}), latest AS (
      SELECT bench_row_id,kind,max(created_at) created_at FROM raw GROUP BY bench_row_id,kind
    )
    SELECT latest.kind || '-' || b.row_id || '-' || latest.created_at id,latest.kind,b.id bench_id,
      coalesce(nullif(b.name,''),nullif(b.location_name,''),'Sitzbank') bench_name,latest.created_at
    FROM latest JOIN benches b ON b.row_id=latest.bench_row_id
    ORDER BY latest.created_at DESC LIMIT 6
  `).all({ userId }).map((row) => {
    const item = row as Record<string, unknown>;
    return { id: String(item.id), kind: String(item.kind) as ProfileMoment["kind"], benchId: String(item.bench_id), benchName: String(item.bench_name), createdAt: String(item.created_at) };
  });

  return {
    id: user.id,
    username: user.username,
    avatarSeed: user.avatar_seed || `${user.id}:${user.username}`,
    joinedAt: user.created_at,
    activity,
    uniquePlaces,
    journey: journeyFor(uniquePlaces),
    landscapes,
    seasons,
    recent,
    nextPrompt: nextPrompt(activity, landscapes),
  };
}

export function getTrailProfileByUsername(username: string, database: Database.Database = sqlite) {
  if (username.length < 3 || username.length > 24) return null;
  const row = database.prepare("SELECT id FROM users WHERE username_key=?").get(normalizeUsername(username)) as { id: number } | undefined;
  return row ? getTrailProfile(row.id, database) : null;
}
