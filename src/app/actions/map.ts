"use server";

import { sqlite } from "@/db/client";
import { displayMaterial, yesNoUnknown } from "@/lib/bench";
import { calculateSunState, getLocalSunSchedule, getSunTimes, type ObstructionType } from "@/lib/sun";
import type { BenchDetail, MapFeature, MapFilters, MapQuery, PlaceResult } from "@/lib/types";
import { z } from "zod";

const boundsSchema = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
}).refine((b) => b.west < b.east && b.south < b.north && b.east - b.west <= 12 && b.north - b.south <= 6, "Kartenausschnitt ist zu gross.");

const filtersSchema = z.object({
  sunnyNow: z.boolean().optional(),
  minViewScore: z.number().min(1).max(5).optional(),
  backrest: z.boolean().optional(),
  armrest: z.boolean().optional(),
  covered: z.boolean().optional(),
  wheelchair: z.boolean().optional(),
  environment: z.enum(["forest", "open"]).optional(),
  material: z.string().max(40).optional(),
  minCommunityRating: z.number().min(1).max(5).optional(),
  viewType: z.enum(["mountain", "lake", "open", "limited"]).optional(),
}).optional();

const querySchema = z.object({ bounds: boundsSchema, zoom: z.number().min(5).max(20), filters: filtersSchema });

type MapRow = {
  id: string;
  latitude: number;
  longitude: number;
  covered: number | null;
  canopy_percent: number | null;
  horizon_profile: string | null;
  view_score: number | null;
  rating_average: number | null;
  view_labels: string | null;
  obstruction_types: string | null;
};

function parseArray<T>(value: unknown): T[] {
  if (!value) return [];
  try { const parsed = JSON.parse(String(value)); return Array.isArray(parsed) ? parsed as T[] : []; }
  catch { return []; }
}

function mapViewType(labels: string[]): MapFilters["viewType"] | null {
  if (labels.includes("Bergblick")) return "mountain";
  if (labels.includes("Seeblick") || labels.includes("Wasserblick")) return "lake";
  if (labels.includes("Weitsicht")) return "open";
  if (labels.includes("Eingeschränkte Aussicht") || labels.includes("Keine besondere Aussicht")) return "limited";
  return null;
}

function filterSql(filters: MapFilters | undefined, parameters: Array<string | number>) {
  const clauses = ["b.active = 1"];
  if (filters?.minViewScore) {
    clauses.push("e.view_score >= ?");
    parameters.push(filters.minViewScore * 20);
  }
  for (const field of ["backrest", "armrest", "covered", "wheelchair"] as const) {
    if (filters?.[field] !== undefined) {
      clauses.push(`b.${field} = ?`);
      parameters.push(filters[field] ? 1 : 0);
    }
  }
  if (filters?.environment) {
    clauses.push("e.in_forest = ?");
    parameters.push(filters.environment === "forest" ? 1 : 0);
  }
  if (filters?.material) {
    clauses.push("lower(b.material) = lower(?)");
    parameters.push(filters.material);
  }
  if (filters?.minCommunityRating) {
    clauses.push("coalesce(ra.rating_average, 0) >= ?");
    parameters.push(filters.minCommunityRating);
  }
  if (filters?.viewType) {
    if (filters.viewType === "lake") {
      clauses.push("(coalesce(e.view_labels, '') LIKE ? OR coalesce(e.view_labels, '') LIKE ?)");
      parameters.push("%Seeblick%", "%Wasserblick%");
    } else {
      const label = { mountain: "%Bergblick%", open: "%Weitsicht%", limited: "%Eingeschränkte Aussicht%" }[filters.viewType];
      clauses.push("coalesce(e.view_labels, '') LIKE ?");
      parameters.push(label);
    }
  }
  return clauses.join(" AND ");
}

export async function getMapFeatures(input: MapQuery): Promise<MapFeature[]> {
  const parsed = querySchema.parse(input);
  const { west, south, east, north } = parsed.bounds;
  const parameters: Array<string | number> = [west, east, south, north];
  const where = filterSql(parsed.filters, parameters);
  if (parsed.zoom < 12 && !parsed.filters?.sunnyNow) {
    const cellSize = 360 / (2 ** parsed.zoom * 2.5);
    const grouped = sqlite.prepare(`
      SELECT CAST(b.longitude / ? AS INTEGER) grid_x, CAST(b.latitude / ? AS INTEGER) grid_y,
        avg(b.latitude) latitude, avg(b.longitude) longitude, count(*) count,
        min(b.id) id, avg(e.view_score) view_score, min(e.view_labels) view_labels,
        avg(ra.rating_average) rating_average
      FROM bench_spatial_index s
      JOIN benches b ON b.row_id = s.row_id
      LEFT JOIN bench_enrichments e ON e.bench_row_id = b.row_id
      LEFT JOIN (
        SELECT bench_row_id, avg(overall) AS rating_average FROM ratings WHERE visible = 1 GROUP BY bench_row_id
      ) ra ON ra.bench_row_id = b.row_id
      WHERE s.max_longitude >= ? AND s.min_longitude <= ?
        AND s.max_latitude >= ? AND s.min_latitude <= ? AND ${where}
      GROUP BY grid_x, grid_y
      LIMIT 2000
    `).all(cellSize, cellSize, ...parameters) as Array<MapRow & { grid_x: number; grid_y: number; count: number }>;
    return grouped.map((cell) => cell.count > 1 ? {
      kind: "cluster" as const, id: `cluster-${parsed.zoom}-${cell.grid_x}:${cell.grid_y}`,
      latitude: cell.latitude, longitude: cell.longitude, count: cell.count,
    } : {
      kind: "bench" as const, id: cell.id, latitude: cell.latitude, longitude: cell.longitude,
      viewScore: cell.view_score === null ? null : Math.max(1, Math.min(5, Math.round(cell.view_score / 20))),
      sunnyNow: null, rating: cell.rating_average === null ? null : Number(cell.rating_average.toFixed(1)),
      viewType: mapViewType(parseArray<string>(cell.view_labels)),
    });
  }
  const rows = sqlite.prepare(`
    SELECT b.id, b.latitude, b.longitude, b.covered, e.canopy_percent, e.horizon_profile,
      e.obstruction_types, e.view_score, e.view_labels, ra.rating_average
    FROM bench_spatial_index s
    JOIN benches b ON b.row_id = s.row_id
    LEFT JOIN bench_enrichments e ON e.bench_row_id = b.row_id
    LEFT JOIN (
      SELECT bench_row_id, avg(overall) AS rating_average FROM ratings WHERE visible = 1 GROUP BY bench_row_id
    ) ra ON ra.bench_row_id = b.row_id
    WHERE s.max_longitude >= ? AND s.min_longitude <= ?
      AND s.max_latitude >= ? AND s.min_latitude <= ? AND ${where}
    LIMIT 10000
  `).all(...parameters) as MapRow[];

  const now = new Date();
  const individual = rows.map((row) => {
    const profile = parseArray<number>(row.horizon_profile);
    const obstructionTypes = parseArray<ObstructionType>(row.obstruction_types);
    const sunnyNow = profile.length
      ? calculateSunState({ date: now, latitude: row.latitude, longitude: row.longitude, horizonProfile: profile, obstructionTypes, covered: Boolean(row.covered), canopyPercent: row.canopy_percent }).sunny
      : null;
    return { row, sunnyNow };
  }).filter((item) => !parsed.filters?.sunnyNow || item.sunnyNow === true);

  return individual.slice(0, 2000).map(({ row, sunnyNow }) => ({
      kind: "bench", id: row.id, latitude: row.latitude, longitude: row.longitude,
      viewScore: row.view_score === null ? null : Math.max(1, Math.min(5, Math.round(row.view_score / 20))),
      sunnyNow, rating: row.rating_average === null ? null : Number(row.rating_average.toFixed(1)),
      viewType: mapViewType(parseArray<string>(row.view_labels)),
    }));
}

type DetailRow = Record<string, string | number | null>;

export async function getBenchDetail(benchId: string): Promise<BenchDetail | null> {
  if (!/^osm-(node|way)-\d+$/.test(benchId)) return null;
  const row = sqlite.prepare(`
    SELECT b.*, e.*, 
      (SELECT avg(overall) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_average,
      (SELECT count(*) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_count,
      (SELECT avg(view_score) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_view,
      (SELECT avg(comfort) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_comfort,
      (SELECT avg(quiet) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_quiet
    FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE b.id=? AND b.active=1
  `).get(benchId) as DetailRow | undefined;
  if (!row) return null;

  let horizon: number[] = [];
  let obstructionTypes: ObstructionType[] = [];
  let components: Record<string, number> = {};
  horizon = parseArray<number>(row.horizon_profile);
  obstructionTypes = parseArray<ObstructionType>(row.obstruction_types);
  try { components = row.view_components ? JSON.parse(String(row.view_components)) : {}; } catch { components = {}; }
  const sunInput = { latitude: Number(row.latitude), longitude: Number(row.longitude), horizonProfile: horizon, obstructionTypes, covered: Boolean(row.covered), canopyPercent: row.canopy_percent === null ? null : Number(row.canopy_percent) };
  const hasLocalSunModel = horizon.length > 0;
  const sun = hasLocalSunModel ? calculateSunState(sunInput) : null;
  const localSun = hasLocalSunModel ? getLocalSunSchedule(sunInput) : {
    directSunrise: "Noch nicht berechnet", directSunset: "Noch nicht berechnet",
    sunMinutes: 0, windows: [] as Array<{ start: string; end: string }>,
  };
  const times = getSunTimes(new Date(), Number(row.latitude), Number(row.longitude));
  const recentRatings = sqlite.prepare(`SELECT id, overall, view_score as view, comfort, quiet, note, created_at as createdAt FROM ratings WHERE bench_row_id=? AND visible=1 ORDER BY updated_at DESC LIMIT 5`).all(row.row_id);
  const corrections = sqlite.prepare(`SELECT id, field, proposed_value as proposedValue, note, created_at as createdAt FROM corrections WHERE bench_row_id=? AND visible=1 ORDER BY created_at DESC LIMIT 20`).all(row.row_id);
  const media = sqlite.prepare(`SELECT id, relation, provider, source_url as sourceUrl, thumbnail_url as thumbnailUrl, author, license, distance_meters as distanceMeters, title FROM media WHERE bench_row_id=? ORDER BY relation, distance_meters LIMIT 12`).all(row.row_id);
  const ratingCount = Number(row.rating_count ?? 0);
  const viewScore = row.view_score === null ? null : Math.max(1, Math.min(5, Math.round(Number(row.view_score) / 20)));
  const explanation: string[] = [];
  const viewLabels = parseArray<string>(row.view_labels);
  if (viewLabels.length) explanation.push(...viewLabels);
  if ((components.openness ?? 0) > 0.8) explanation.push("Weiter, wenig verdeckter Horizont");
  if ((components.relief ?? 0) > 0.8) explanation.push("Ausgeprägtes Berg- oder Hügelrelief");
  if ((components.water ?? 0) > 0.75) explanation.push("Freie Sichtachse zu einer Wasserfläche");
  if ((components.naturalness ?? 0) > 0.8) explanation.push("Überwiegend natürliche Umgebung");
  if (explanation.length === 0) explanation.push("Aus Gelände, Landbedeckung und Umgebung berechnet");

  const properties = [
    { label: "Rückenlehne", value: yesNoUnknown(row.backrest as number | null), source: "OpenStreetMap" as const },
    { label: "Armlehnen", value: yesNoUnknown(row.armrest as number | null), source: "OpenStreetMap" as const },
    { label: "Überdacht", value: yesNoUnknown(row.covered as number | null), source: "OpenStreetMap" as const },
    { label: "Rollstuhlgerecht", value: yesNoUnknown(row.wheelchair as number | null), source: "OpenStreetMap" as const },
    { label: "Material", value: displayMaterial(row.material as string | null), source: "OpenStreetMap" as const },
    { label: "Sitzplätze", value: row.seats ? String(row.seats) : "Unbekannt", source: "OpenStreetMap" as const },
  ];
  return {
    id: String(row.id), osmType: String(row.osm_type), osmId: Number(row.osm_id),
    latitude: Number(row.latitude), longitude: Number(row.longitude), title: String(row.description || "Sitzbank"),
    description: row.operator ? `Betreiber: ${row.operator}` : null, properties,
    elevationMeters: row.elevation_meters === null ? null : Number(row.elevation_meters),
    viewScore, viewConfidence: (row.view_confidence ?? "niedrig") as BenchDetail["viewConfidence"], viewExplanation: explanation,
    sunrise: times.sunrise, sunset: times.sunset,
    directSunrise: localSun.directSunrise, directSunset: localSun.directSunset,
    sunMinutesToday: localSun.sunMinutes, sunWindows: localSun.windows,
    shadeCause: sun?.shadeCause ?? "unbekannt",
    sunnyNow: sun?.sunny ?? null,
    sunConfidence: (row.sun_confidence ?? "niedrig") as BenchDetail["sunConfidence"],
    sunMinutesSummer: row.sun_minutes_summer === null ? null : Number(row.sun_minutes_summer),
    sunMinutesWinter: row.sun_minutes_winter === null ? null : Number(row.sun_minutes_winter),
    sunMinutesSpring: row.sun_minutes_spring === null ? null : Number(row.sun_minutes_spring),
    sunMinutesAutumn: row.sun_minutes_autumn === null ? null : Number(row.sun_minutes_autumn),
    inForest: row.in_forest === null ? null : Boolean(row.in_forest),
    canopyPercent: row.canopy_percent === null ? null : Number(row.canopy_percent),
    distanceWaterMeters: row.distance_water_meters === null ? null : Number(row.distance_water_meters),
    distancePathMeters: row.distance_path_meters === null ? null : Number(row.distance_path_meters),
    directionDegrees: row.direction_degrees === null ? null : Number(row.direction_degrees),
    buildingObstructionPercent: row.building_obstruction_percent === null ? null : Number(row.building_obstruction_percent),
    vegetationObstructionPercent: row.vegetation_obstruction_percent === null ? null : Number(row.vegetation_obstruction_percent),
    distanceBuildingMeters: row.distance_building_meters === null ? null : Number(row.distance_building_meters),
    buildingCount100m: row.building_count_100m === null ? null : Number(row.building_count_100m),
    viewLabels,
    ratingAverage: row.rating_average === null ? null : Number(Number(row.rating_average).toFixed(1)), ratingCount,
    ratingBreakdown: ratingCount ? { overall: Number(Number(row.rating_average).toFixed(1)), view: Number(Number(row.rating_view).toFixed(1)), comfort: Number(Number(row.rating_comfort).toFixed(1)), quiet: Number(Number(row.rating_quiet).toFixed(1)) } : null,
    recentRatings: recentRatings as BenchDetail["recentRatings"], corrections: corrections as BenchDetail["corrections"], media: media as BenchDetail["media"],
    sourceUpdatedAt: String(row.source_updated_at), pipelineVersion: row.pipeline_version ? String(row.pipeline_version) : null,
  };
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const clean = z.string().trim().min(2).max(80).parse(query);
  const url = new URL("https://api3.geo.admin.ch/rest/services/api/SearchServer");
  url.searchParams.set("searchText", clean);
  url.searchParams.set("type", "locations");
  url.searchParams.set("origins", "zipcode,gg25,district");
  url.searchParams.set("limit", "6");
  url.searchParams.set("sr", "4326");
  const response = await fetch(url, { next: { revalidate: 86400 } });
  if (!response.ok) return [];
  const data = await response.json() as { results?: Array<{ id?: string | number; attrs?: Record<string, string | number> }> };
  return (data.results ?? []).flatMap((result) => {
    const attrs = result.attrs ?? {};
    const latitude = Number(attrs.lat ?? attrs.y);
    const longitude = Number(attrs.lon ?? attrs.x);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const label = String(attrs.label ?? attrs.detail ?? clean).replace(/<[^>]*>/g, "");
    return [{ id: String(result.id ?? `${latitude}-${longitude}`), label, latitude, longitude }];
  });
}
