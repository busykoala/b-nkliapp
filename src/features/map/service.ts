import "server-only";

import { z } from "zod";
import { sqlite } from "@/db/client";
import { DATA_RUNTIME } from "@/data/runtime.generated";
import { benchObservationNow } from "@/features/bench-observations/context";
import { matchesLightFilter } from "@/lib/map-filters";
import { calculateSunState, type ObstructionType } from "@/lib/sun";
import type { BenchViewType, MapFeature, MapFilters, MapQuery } from "@/lib/types";

const boundsSchema = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
}).refine((bounds) => bounds.west < bounds.east
  && bounds.south < bounds.north
  && bounds.east - bounds.west <= 12
  && bounds.north - bounds.south <= 6, "Kartenausschnitt ist zu gross.");

const filtersSchema = z.object({
  sunnyNow: z.boolean().optional(),
  backrest: z.boolean().optional(),
  armrest: z.boolean().optional(),
  covered: z.boolean().optional(),
  wheelchair: z.boolean().optional(),
  fireplaceNearby: z.boolean().optional(),
  wasteBasketNearby: z.boolean().optional(),
  material: z.string().max(40).optional(),
  minSeats: z.number().int().min(1).max(12).optional(),
  minCommunityRating: z.number().min(1).max(5).optional(),
}).optional();

const querySchema = z.object({
  bounds: boundsSchema,
  zoom: z.number().min(5).max(20),
  filters: filtersSchema,
});

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
  pipeline_version: string | null;
  verification_status: "verified" | "unverified";
};

type LitBench = { row: MapRow; sunnyNow: boolean | null };

function parseArray<T>(value: unknown): T[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function mapViewType(labels: string[]): BenchViewType | null {
  if (labels.includes("Bergblick")) return "mountain";
  if (labels.includes("Hügelblick")) return "hill";
  if (labels.includes("Seeblick") || labels.includes("Wasserblick")) return "lake";
  if (labels.includes("Weitsicht")) return "open";
  if (labels.includes("Eingeschränkte Aussicht") || labels.includes("Keine besondere Aussicht")) return "limited";
  return null;
}

function filterSql(filters: MapFilters | undefined, parameters: Array<string | number>) {
  const clauses = ["b.active = 1"];
  for (const field of ["backrest", "armrest", "covered", "wheelchair"] as const) {
    if (filters?.[field] === undefined) continue;
    clauses.push(`b.${field} = ?`);
    parameters.push(filters[field] ? 1 : 0);
  }
  for (const [filter, column] of [["fireplaceNearby", "fireplace_nearby"], ["wasteBasketNearby", "waste_basket_nearby"]] as const) {
    if (filters?.[filter] === undefined) continue;
    clauses.push(`b.${column} = ?`);
    parameters.push(filters[filter] ? 1 : 0);
  }
  if (filters?.material) {
    clauses.push("lower(b.material) = lower(?)");
    parameters.push(filters.material);
  }
  if (filters?.minSeats) {
    clauses.push("b.seats >= ?");
    parameters.push(filters.minSeats);
  }
  if (filters?.minCommunityRating) {
    clauses.push("coalesce((SELECT avg(r.overall) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1), 0) >= ?");
    parameters.push(filters.minCommunityRating);
  }
  return clauses.join(" AND ");
}

function benchFeature(item: LitBench): MapFeature {
  const { row, sunnyNow } = item;
  return {
    kind: "bench",
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    viewScore: row.view_score === null ? null : Math.max(1, Math.min(5, Math.round(row.view_score / 20))),
    sunnyNow,
    rating: row.rating_average === null ? null : Number(row.rating_average.toFixed(1)),
    viewType: mapViewType(parseArray<string>(row.view_labels)),
    verificationStatus: row.verification_status,
  };
}

function clusterFeature(id: string, items: LitBench[]): MapFeature {
  let latitude = 0;
  let longitude = 0;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { row } of items) {
    latitude += row.latitude;
    longitude += row.longitude;
    west = Math.min(west, row.longitude);
    south = Math.min(south, row.latitude);
    east = Math.max(east, row.longitude);
    north = Math.max(north, row.latitude);
  }
  return {
    kind: "cluster",
    id,
    latitude: latitude / items.length,
    longitude: longitude / items.length,
    count: items.length,
    west,
    south,
    east,
    north,
  };
}

function readGroupedFeatures(query: MapQuery, where: string, parameters: Array<string | number>) {
  const cellSize = 360 / (2 ** query.zoom * 2.5);
  const rows = sqlite.prepare(`
    SELECT CAST(b.longitude / ? AS INTEGER) grid_x, CAST(b.latitude / ? AS INTEGER) grid_y,
      avg(b.latitude) latitude, avg(b.longitude) longitude, count(*) count,
      min(b.longitude) west, min(b.latitude) south, max(b.longitude) east, max(b.latitude) north,
      min(b.id) id, avg(e.view_score) view_score, min(e.view_labels) view_labels,
      min(b.verification_status) verification_status,
      avg((SELECT avg(r.overall) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1)) rating_average
    FROM bench_spatial_index s
    JOIN benches b ON b.row_id=s.row_id
    LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    WHERE s.max_longitude>=? AND s.min_longitude<=?
      AND s.max_latitude>=? AND s.min_latitude<=? AND ${where}
    GROUP BY grid_x,grid_y
    LIMIT 2000
  `).all(cellSize, cellSize, ...parameters) as Array<MapRow & {
    grid_x: number;
    grid_y: number;
    count: number;
    west: number;
    south: number;
    east: number;
    north: number;
  }>;

  return rows.map((row): MapFeature => row.count === 1 ? benchFeature({ row, sunnyNow: null }) : {
    kind: "cluster",
    id: `cluster-${query.zoom}-${row.grid_x}:${row.grid_y}`,
    latitude: row.latitude,
    longitude: row.longitude,
    count: row.count,
    west: row.west,
    south: row.south,
    east: row.east,
    north: row.north,
  });
}

function readIndividualFeatures(query: MapQuery, where: string, parameters: Array<string | number>) {
  const rows = sqlite.prepare(`
    SELECT b.id,b.latitude,b.longitude,b.covered,b.verification_status,e.canopy_percent,e.horizon_profile,
      e.obstruction_types,e.pipeline_version,e.view_score,e.view_labels,
      (SELECT avg(r.overall) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_average
    FROM bench_spatial_index s
    JOIN benches b ON b.row_id=s.row_id
    LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    WHERE s.max_longitude>=? AND s.min_longitude<=?
      AND s.max_latitude>=? AND s.min_latitude<=? AND ${where}
    LIMIT 10000
  `).all(...parameters) as MapRow[];
  const now = benchObservationNow();
  return rows.map((row): LitBench => {
    const horizonProfile = parseArray<number>(row.horizon_profile);
    const obstructionTypes = parseArray<ObstructionType>(row.obstruction_types);
    const currentProfile = horizonProfile.length === 72
      && ["4.2.0", "4.3.0", "4.4.0", "GeoAdmin-Horizont v4", "GeoAdmin-Horizont v5", "GeoAdmin-Horizont v6",
        DATA_RUNTIME.pipelineVersion, DATA_RUNTIME.profilePipelineVersion].includes(String(row.pipeline_version));
    const light = currentProfile ? calculateSunState({
      date: now,
      latitude: row.latitude,
      longitude: row.longitude,
      horizonProfile,
      obstructionTypes,
      covered: Boolean(row.covered),
      canopyPercent: row.canopy_percent,
    }) : null;
    return { row, sunnyNow: light?.shadeCause === "nacht" ? null : light?.sunny ?? null };
  }).filter((item) => matchesLightFilter(item.sunnyNow, query.filters?.sunnyNow));
}

export function readMapFeatures(input: MapQuery): MapFeature[] {
  const query = querySchema.parse(input);
  const { west, south, east, north } = query.bounds;
  const parameters: Array<string | number> = [west, east, south, north];
  const where = filterSql(query.filters, parameters);
  if (query.zoom < 18 && query.filters?.sunnyNow === undefined) {
    return readGroupedFeatures(query, where, parameters);
  }

  const benches = readIndividualFeatures(query, where, parameters);
  if (query.zoom >= 18) return benches.slice(0, 2000).map(benchFeature);

  const cellSize = 360 / (2 ** query.zoom * 2.5);
  const cells = new Map<string, LitBench[]>();
  for (const bench of benches) {
    const key = `${Math.trunc(bench.row.longitude / cellSize)}:${Math.trunc(bench.row.latitude / cellSize)}`;
    const cell = cells.get(key);
    if (cell) cell.push(bench);
    else cells.set(key, [bench]);
  }
  return [...cells.entries()].slice(0, 2000).map(([key, items]) => items.length === 1
    ? benchFeature(items[0])
    : clusterFeature(`cluster-${query.zoom}-${key}`, items));
}
