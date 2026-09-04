"use server";

import { sqlite } from "@/db/client";
import { displayMaterial, yesNoUnknown } from "@/lib/bench";
import { buildContextModel, type ContextFeature } from "@/lib/context-model";
import { fetchPointElevation, fetchTerrainHorizon } from "@/lib/elevation";
import { parseWkbGeometry } from "@/lib/exact-geometry";
import { fetchSwissLandCoverEvidence, SWISSTOPO_LAND_COVER_VERSION } from "@/lib/land-cover";
import { normalizeLocationKey, searchGeoAdminLocations } from "@/lib/place-search";
import { calculateSunState, getDaylightState, getLocalSunSchedule, getMoonState, getSeasonalSunMinutes, getSkyTrack, getSunTimes, type ObstructionType } from "@/lib/sun";
import type { BenchDetail, LikelyEnvironment, MapFeature, MapFilters, MapQuery, PlaceResult } from "@/lib/types";
import { visionLabelsEnabled } from "@/lib/vision-gate";
import { getLocalWeather } from "@/lib/weather";
import { getCurrentUser } from "@/lib/security";
import { z } from "zod";

function aiLabelsEnabled() {
  const latest = sqlite.prepare(`
    SELECT stats FROM pipeline_runs
    WHERE kind='vision-benchmark' AND status='completed'
    ORDER BY finished_at DESC,id DESC LIMIT 1
  `).get() as { stats: string | null } | undefined;
  return visionLabelsEnabled(process.env.BENCHLY_AI_LABELS_ENABLED, latest?.stats ?? null);
}

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
  viewType: z.enum(["mountain", "hill", "lake", "open", "limited"]).optional(),
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
  pipeline_version: string | null;
  verification_status: "verified" | "unverified";
};

function parseArray<T>(value: unknown): T[] {
  if (!value) return [];
  try { const parsed = JSON.parse(String(value)); return Array.isArray(parsed) ? parsed as T[] : []; }
  catch { return []; }
}

function cacheEnrichment(write: () => void) {
  try {
    write();
  } catch (error) {
    // Enrichment is a cache: a concurrent worker must never make the bench itself unavailable.
    console.warn("Bench enrichment could not be cached", error);
  }
}

function zurichMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function zurichSeason(date: Date): BenchDetail["season"] {
  const month = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Zurich", month: "numeric" }).format(date));
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

function mapViewType(labels: string[]): MapFilters["viewType"] | null {
  if (labels.includes("Bergblick")) return "mountain";
  if (labels.includes("Hügelblick")) return "hill";
  if (labels.includes("Seeblick") || labels.includes("Wasserblick")) return "lake";
  if (labels.includes("Weitsicht")) return "open";
  if (labels.includes("Eingeschränkte Aussicht") || labels.includes("Keine besondere Aussicht")) return "limited";
  return null;
}

function nearOpenness(obstructionTypes: ObstructionType[], directionDegrees: number | null) {
  if (obstructionTypes.length !== 72) return null;
  const indices = obstructionTypes.map((_, index) => index).filter((index) => directionDegrees === null
    || Math.abs((((index * 5 - directionDegrees) + 540) % 360) - 180) <= 45);
  const blocked = indices.filter((index) => obstructionTypes[index] === "building" || obstructionTypes[index] === "vegetation").length;
  return indices.length ? 1 - blocked / indices.length : null;
}

function filterSql(filters: MapFilters | undefined, parameters: Array<string | number>) {
  const clauses = ["b.active = 1"];
  const useAiLabels = aiLabelsEnabled();
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
    if (filters.environment === "forest") {
      clauses.push(useAiLabels ? "(e.in_forest = 1 OR (lm.confidence='high' AND lm.land_context='forest' AND lm.land_context_probability>=0.9))" : "e.in_forest = 1");
    } else {
      clauses.push(useAiLabels ? "(e.land_context = 'open' OR (lm.confidence='high' AND lm.land_context='open' AND lm.land_context_probability>=0.85))" : "e.land_context = 'open'");
    }
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
      clauses.push(useAiLabels ? "(coalesce(e.view_labels, '') LIKE ? OR coalesce(e.view_labels, '') LIKE ? OR (lm.confidence='high' AND lm.lake_view_probability>=0.85))" : "(coalesce(e.view_labels, '') LIKE ? OR coalesce(e.view_labels, '') LIKE ?)");
      parameters.push("%Seeblick%", "%Wasserblick%");
    } else if (filters.viewType === "mountain") {
      clauses.push("coalesce(e.view_labels, '') LIKE ?");
      parameters.push("%Bergblick%");
    } else if (filters.viewType === "hill") {
      clauses.push("coalesce(e.view_labels, '') LIKE ?");
      parameters.push("%Hügelblick%");
    } else if (filters.viewType === "open") {
      clauses.push(useAiLabels ? "(coalesce(e.view_labels, '') LIKE ? OR (lm.confidence='high' AND lm.open_view_probability>=0.85))" : "coalesce(e.view_labels, '') LIKE ?");
      parameters.push("%Weitsicht%");
    } else {
      clauses.push(useAiLabels ? "(coalesce(e.view_labels, '') LIKE ? OR (lm.confidence='high' AND lm.limited_view_probability>=0.85))" : "coalesce(e.view_labels, '') LIKE ?");
      parameters.push("%Eingeschränkte Aussicht%");
    }
  }
  return clauses.join(" AND ");
}

export async function getMapFeatures(input: MapQuery): Promise<MapFeature[]> {
  const parsed = querySchema.parse(input);
  const { west, south, east, north } = parsed.bounds;
  const parameters: Array<string | number> = [west, east, south, north];
  const where = filterSql(parsed.filters, parameters);
  if (parsed.zoom < 18 && !parsed.filters?.sunnyNow) {
    const cellSize = 360 / (2 ** parsed.zoom * 2.5);
    const grouped = sqlite.prepare(`
      SELECT CAST(b.longitude / ? AS INTEGER) grid_x, CAST(b.latitude / ? AS INTEGER) grid_y,
        avg(b.latitude) latitude, avg(b.longitude) longitude, count(*) count,
        min(b.id) id, avg(e.view_score) view_score, min(e.view_labels) view_labels,
        min(b.verification_status) verification_status,
        avg(ra.rating_average) rating_average
      FROM bench_spatial_index s
      JOIN benches b ON b.row_id = s.row_id
      LEFT JOIN bench_enrichments e ON e.bench_row_id = b.row_id
      LEFT JOIN bench_likely_metadata lm ON lm.bench_row_id = b.row_id
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
      verificationStatus: cell.verification_status,
    });
  }
  const rows = sqlite.prepare(`
    SELECT b.id, b.latitude, b.longitude, b.covered, b.verification_status, e.canopy_percent, e.horizon_profile,
      e.obstruction_types, e.pipeline_version, e.view_score, e.view_labels, ra.rating_average
    FROM bench_spatial_index s
    JOIN benches b ON b.row_id = s.row_id
    LEFT JOIN bench_enrichments e ON e.bench_row_id = b.row_id
    LEFT JOIN bench_likely_metadata lm ON lm.bench_row_id = b.row_id
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
    // Map markers only make a binary promise after the full worker model has
    // combined raster surface/terrain with exact context geometry.
    const hasCurrentProfile = profile.length === 72
      && (["4.2.0", "4.3.0", "GeoAdmin-Horizont v4", "GeoAdmin-Horizont v5"].includes(String(row.pipeline_version)));
    const sunnyNow = hasCurrentProfile ? calculateSunState({
      date: now,
      latitude: row.latitude,
      longitude: row.longitude,
      horizonProfile: profile.length ? profile : null,
      obstructionTypes,
      covered: Boolean(row.covered),
      canopyPercent: row.canopy_percent,
    }).sunny : null;
    return { row, sunnyNow };
  }).filter((item) => !parsed.filters?.sunnyNow || item.sunnyNow === true);

  if (parsed.zoom < 18) {
    const cellSize = 360 / (2 ** parsed.zoom * 2.5);
    const cells = new Map<string, typeof individual>();
    for (const item of individual) {
      const key = `${Math.trunc(item.row.longitude / cellSize)}:${Math.trunc(item.row.latitude / cellSize)}`;
      const cell = cells.get(key);
      if (cell) cell.push(item);
      else cells.set(key, [item]);
    }
    return [...cells.entries()].slice(0, 2000).map(([key, items]) => items.length > 1 ? {
      kind: "cluster" as const,
      id: `cluster-${parsed.zoom}-${key}`,
      latitude: items.reduce((sum, item) => sum + item.row.latitude, 0) / items.length,
      longitude: items.reduce((sum, item) => sum + item.row.longitude, 0) / items.length,
      count: items.length,
    } : {
      kind: "bench" as const,
      id: items[0].row.id,
      latitude: items[0].row.latitude,
      longitude: items[0].row.longitude,
      viewScore: items[0].row.view_score === null ? null : Math.max(1, Math.min(5, Math.round(items[0].row.view_score / 20))),
      sunnyNow: items[0].sunnyNow,
      rating: items[0].row.rating_average === null ? null : Number(items[0].row.rating_average.toFixed(1)),
      viewType: mapViewType(parseArray<string>(items[0].row.view_labels)),
      verificationStatus: items[0].row.verification_status,
    });
  }

  return individual.slice(0, 2000).map(({ row, sunnyNow }) => ({
      kind: "bench", id: row.id, latitude: row.latitude, longitude: row.longitude,
      viewScore: row.view_score === null ? null : Math.max(1, Math.min(5, Math.round(row.view_score / 20))),
      sunnyNow, rating: row.rating_average === null ? null : Number(row.rating_average.toFixed(1)),
      viewType: mapViewType(parseArray<string>(row.view_labels)),
      verificationStatus: row.verification_status,
    }));
}

type DetailRow = Record<string, string | number | null>;

export async function getBenchDetail(benchId: string): Promise<BenchDetail | null> {
  if (!/^(osm-(node|way)-\d+|community-[0-9a-f-]{36})$/.test(benchId)) return null;
  const row = sqlite.prepare(`
    SELECT b.*, e.*,
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
      (SELECT avg(quiet) FROM ratings r WHERE r.bench_row_id=b.row_id AND r.visible=1) rating_quiet
      ,(SELECT count(*) FROM bench_confirmations c WHERE c.bench_row_id=b.row_id) confirmation_count
      ,(SELECT count(*) FROM bench_removal_confirmations rc JOIN bench_removal_requests rr ON rr.id=rc.request_id WHERE rr.bench_row_id=b.row_id AND rr.status='pending') removal_confirmation_count
    FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    LEFT JOIN bench_likely_metadata lm ON lm.bench_row_id=b.row_id WHERE b.id=? AND b.active=1
  `).get(benchId) as DetailRow | undefined;
  if (!row) return null;

  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const directionDegrees = row.direction_degrees === null ? null : Number(row.direction_degrees);
  let elevationMeters = row.elevation_meters == null ? null : Number(row.elevation_meters);
  let elevationSource = row.elevation_source == null ? null : String(row.elevation_source);
  let pipelineVersion = row.pipeline_version ? String(row.pipeline_version) : "OSM-Nahbereich v1";
  let horizon = parseArray<number>(row.horizon_profile);
  let obstructionTypes = parseArray<ObstructionType>(row.obstruction_types);
  let sunMinutesSummer = row.sun_minutes_summer == null ? null : Number(row.sun_minutes_summer);
  let sunMinutesWinter = row.sun_minutes_winter == null ? null : Number(row.sun_minutes_winter);
  let sunMinutesSpring = row.sun_minutes_spring == null ? null : Number(row.sun_minutes_spring);
  let sunMinutesAutumn = row.sun_minutes_autumn == null ? null : Number(row.sun_minutes_autumn);
  let components: Record<string, number> = {};
  try { components = row.view_components ? JSON.parse(String(row.view_components)) : {}; } catch { components = {}; }
  let hasTerrainModel = parseArray<number>(row.terrain_horizon_profile).length === 72;
  const officialLandEvidence = Boolean(sqlite.prepare(
    "SELECT 1 FROM official_context_sources WHERE source='swissTLM3D' LIMIT 1",
  ).get());
  const exactOsmEvidence = Boolean(sqlite.prepare(`
    SELECT 1 FROM pipeline_runs
    WHERE kind IN ('import-osm','refresh') AND status='completed' AND pipeline_version IN ('4.2.0','4.3.0')
    LIMIT 1
  `).get());
  const exactLandEvidence = officialLandEvidence || exactOsmEvidence;
  // “Nicht im Wald” is only a fact once a complete polygon source has been
  // imported. Missing polygons in the legacy seed mean unknown, not false.
  let inForest = !exactLandEvidence || row.in_forest === null ? null : Boolean(row.in_forest);
  let landContext = row.land_context === null ? null : String(row.land_context) as BenchDetail["landContext"];
  let waterfront = !exactLandEvidence || row.waterfront === null ? null : Boolean(row.waterfront);
  let canopyContext = row.canopy_context === null ? null : String(row.canopy_context) as BenchDetail["canopyContext"];
  let canopyPercent = row.canopy_percent === null ? null : Number(row.canopy_percent);
  const canopyShare3m = row.canopy_share_3m === null ? null : Number(row.canopy_share_3m);
  const canopyShare10m = row.canopy_share_10m === null ? null : Number(row.canopy_share_10m);
  const canopyShare25m = row.canopy_share_25m === null ? null : Number(row.canopy_share_25m);
  let vegetationMedianHeight = row.vegetation_median_height === null ? null : Number(row.vegetation_median_height);
  let vegetationMaxHeight = row.vegetation_max_height === null ? null : Number(row.vegetation_max_height);
  let distanceForestMeters = !exactLandEvidence || row.distance_forest_meters === null ? null : Number(row.distance_forest_meters);
  let distanceWaterMeters = !exactLandEvidence || row.distance_water_meters === null ? null : Number(row.distance_water_meters);
  let distancePathMeters = !exactOsmEvidence || row.distance_path_meters === null ? null : Number(row.distance_path_meters);
  let contextModel: ReturnType<typeof buildContextModel> | null = null;
  let contextViewRefreshed = false;
  const needsLandCoverRefresh = !String(row.context_source_version ?? "").includes(SWISSTOPO_LAND_COVER_VERSION);
  const needsContextRefresh = !hasTerrainModel || !["GeoAdmin-Horizont v5", "4.3.0"].includes(pipelineVersion)
    || row.environment_computed_at === null || needsLandCoverRefresh;
  if (needsContextRefresh) {
    const contextFeatures = getContextFeatures(latitude, longitude);
    const landCover = needsLandCoverRefresh ? await fetchSwissLandCoverEvidence(latitude, longitude) : null;
    const terrain = process.env.BENCHLY_DISABLE_ELEVATION_FETCH === "true" ? null : await fetchTerrainHorizon(latitude, longitude);
    const storedTerrain = parseArray<number>(row.terrain_horizon_profile);
    const terrainEvidence = terrain ? {
      elevationMeters: terrain.elevationMeters, horizonProfile: terrain.horizonProfile, sampleElevations: terrain.sampleElevations,
    } : hasTerrainModel && elevationMeters !== null ? {
      elevationMeters, horizonProfile: storedTerrain, sampleElevations: [],
    } : undefined;
    contextModel = terrainEvidence || !hasTerrainModel || landCover
      ? buildContextModel(latitude, longitude, directionDegrees, contextFeatures, terrainEvidence, landCover ?? undefined)
      : null;
    if (contextModel) {
      horizon = contextModel.horizonProfile;
      obstructionTypes = contextModel.obstructionTypes;
      if (terrain) {
        components = contextModel.viewComponents;
        contextViewRefreshed = true;
      } else if (landCover) {
        components = { ...components, naturalness: contextModel.viewComponents.naturalness };
      }
      if (landCover) {
        inForest = contextModel.inForest;
        landContext = contextModel.landContext;
        canopyContext = contextModel.canopyContext;
      } else {
        if (exactLandEvidence) inForest ??= contextModel.inForest;
        if ((landContext === null || landContext === "unknown") && contextModel.landContext !== "unknown") landContext = contextModel.landContext;
        if ((canopyContext === null || canopyContext === "unknown") && contextModel.canopyContext !== "unknown") canopyContext = contextModel.canopyContext;
      }
      if (exactLandEvidence) waterfront = contextModel.waterfront ?? waterfront;
      canopyPercent = canopyPercent ?? contextModel.canopyPercent;
      vegetationMedianHeight = vegetationMedianHeight ?? contextModel.vegetationMedianHeight;
      vegetationMaxHeight = vegetationMaxHeight ?? contextModel.vegetationMaxHeight;
      if (exactLandEvidence) {
        distanceForestMeters = contextModel.distanceForestMeters ?? distanceForestMeters;
        distanceWaterMeters = contextModel.distanceWaterMeters ?? distanceWaterMeters;
      }
      if (exactOsmEvidence) distancePathMeters = contextModel.distancePathMeters ?? distancePathMeters;
    }
    if (terrainEvidence && contextModel) {
      const model = contextModel;
      hasTerrainModel = true;
      elevationMeters = terrainEvidence.elevationMeters;
      elevationSource = terrain?.source ?? elevationSource;
      pipelineVersion = "GeoAdmin-Horizont v5";
      // Replace any seasonal values produced by the earlier near-field-only model.
      sunMinutesSummer = null;
      sunMinutesWinter = null;
      sunMinutesSpring = null;
      sunMinutesAutumn = null;
      const computedAt = new Date().toISOString();
      cacheEnrichment(() => sqlite.prepare(`
        INSERT INTO bench_enrichments (
          bench_row_id,elevation_meters,elevation_source,elevation_updated_at,in_forest,canopy_percent,
          distance_forest_meters,distance_water_meters,distance_path_meters,horizon_profile,terrain_horizon_profile,obstruction_types,
          building_obstruction_percent,vegetation_obstruction_percent,distance_building_meters,building_count_100m,
          view_score,view_confidence,view_components,view_labels,context_source_version,pipeline_version,computed_at,sun_confidence,
          land_context,waterfront,canopy_context,canopy_share_3m,canopy_share_10m,canopy_share_25m,
          vegetation_median_height,vegetation_max_height,environment_computed_at
        ) VALUES (
          @rowId,@elevation,@elevationSource,@computedAt,@inForest,@canopy,@forest,@water,@path,@horizon,@terrainHorizon,@obstructionTypes,
          @buildingPercent,@vegetationPercent,@distanceBuilding,@buildingCount,@viewScore,'mittel',@components,@viewLabels,
          @contextSourceVersion,'GeoAdmin-Horizont v5',@computedAt,'mittel',
          @landContext,@waterfront,@canopyContext,@canopy3,@canopy10,@canopy25,@vegetationMedian,@vegetationMax,@computedAt
        )
        ON CONFLICT(bench_row_id) DO UPDATE SET
          elevation_meters=excluded.elevation_meters,elevation_source=excluded.elevation_source,
          elevation_updated_at=excluded.elevation_updated_at,in_forest=excluded.in_forest,canopy_percent=excluded.canopy_percent,
          distance_forest_meters=excluded.distance_forest_meters,distance_water_meters=excluded.distance_water_meters,
          distance_path_meters=excluded.distance_path_meters,
          horizon_profile=excluded.horizon_profile,terrain_horizon_profile=excluded.terrain_horizon_profile,
          obstruction_types=excluded.obstruction_types,building_obstruction_percent=excluded.building_obstruction_percent,
          vegetation_obstruction_percent=excluded.vegetation_obstruction_percent,distance_building_meters=excluded.distance_building_meters,
          building_count_100m=excluded.building_count_100m,view_score=excluded.view_score,view_confidence=excluded.view_confidence,
          view_components=excluded.view_components,view_labels=excluded.view_labels,context_source_version=excluded.context_source_version,
          pipeline_version=excluded.pipeline_version,computed_at=excluded.computed_at,sun_confidence=excluded.sun_confidence,
          land_context=excluded.land_context,waterfront=excluded.waterfront,canopy_context=excluded.canopy_context,
          canopy_share_3m=excluded.canopy_share_3m,canopy_share_10m=excluded.canopy_share_10m,
          canopy_share_25m=excluded.canopy_share_25m,vegetation_median_height=excluded.vegetation_median_height,
          vegetation_max_height=excluded.vegetation_max_height,environment_computed_at=excluded.environment_computed_at
      `).run({
        rowId: row.row_id,
        elevation: terrainEvidence.elevationMeters,
        elevationSource,
        computedAt,
        inForest: inForest === null ? null : Number(inForest), canopy: canopyPercent,
        forest: distanceForestMeters, water: distanceWaterMeters, path: distancePathMeters,
        horizon: JSON.stringify(model.horizonProfile),
        terrainHorizon: JSON.stringify(terrainEvidence.horizonProfile),
        obstructionTypes: JSON.stringify(model.obstructionTypes),
        buildingPercent: model.buildingObstructionPercent,
        vegetationPercent: model.vegetationObstructionPercent,
        distanceBuilding: model.distanceBuildingMeters,
        buildingCount: model.buildingCount100m,
        viewScore: contextViewRefreshed ? model.viewScore : row.view_score,
        components: JSON.stringify(components),
        viewLabels: JSON.stringify(contextViewRefreshed ? model.viewLabels : parseArray<string>(row.view_labels)),
        contextSourceVersion: [landCover?.sourceVersion, officialLandEvidence ? "swissTLM3D" : "OpenStreetMap"].filter(Boolean).join(" + "),
        landContext, waterfront: waterfront === null ? null : Number(waterfront), canopyContext,
        canopy3: canopyShare3m, canopy10: canopyShare10m, canopy25: canopyShare25m,
        vegetationMedian: vegetationMedianHeight, vegetationMax: vegetationMaxHeight,
      }));
    }
  }

  if (elevationMeters === null && process.env.BENCHLY_DISABLE_ELEVATION_FETCH !== "true") {
    const elevation = await fetchPointElevation(latitude, longitude);
    if (elevation) {
      elevationMeters = elevation.meters;
      elevationSource = elevation.source;
      cacheEnrichment(() => sqlite.prepare(`
        INSERT INTO bench_enrichments (bench_row_id, elevation_meters, elevation_source, elevation_updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(bench_row_id) DO UPDATE SET
          elevation_meters=excluded.elevation_meters,
          elevation_source=excluded.elevation_source,
          elevation_updated_at=excluded.elevation_updated_at
      `).run(row.row_id, elevationMeters, elevationSource, new Date().toISOString()));
    }
  }
  const sunInput = { latitude, longitude, horizonProfile: horizon, obstructionTypes, covered: Boolean(row.covered), canopyPercent };
  const effectiveSunInput = { ...sunInput, horizonProfile: horizon, obstructionTypes, canopyPercent: contextModel?.canopyPercent ?? sunInput.canopyPercent };
  const now = new Date();
  const sun = calculateSunState({ ...effectiveSunInput, date: now });
  const daylight = getDaylightState(now, latitude, longitude);
  const moon = getMoonState(now, latitude, longitude);
  const weather = await getLocalWeather(latitude, longitude, daylight.altitude, elevationMeters);
  const skyTrack = getSkyTrack(now, latitude, longitude);
  const localSun = getLocalSunSchedule(effectiveSunInput);
  if (hasTerrainModel && [sunMinutesSummer, sunMinutesWinter, sunMinutesSpring, sunMinutesAutumn].some((value) => value === null)) {
    const seasonal = getSeasonalSunMinutes(effectiveSunInput);
    sunMinutesSummer = seasonal.summer;
    sunMinutesWinter = seasonal.winter;
    sunMinutesSpring = seasonal.spring;
    sunMinutesAutumn = seasonal.autumn;
    cacheEnrichment(() => sqlite.prepare(`
      UPDATE bench_enrichments SET sun_minutes_summer=?,sun_minutes_winter=?,sun_minutes_spring=?,sun_minutes_autumn=?
      WHERE bench_row_id=?
    `).run(sunMinutesSummer, sunMinutesWinter, sunMinutesSpring, sunMinutesAutumn, row.row_id));
  }
  const times = getSunTimes(now, latitude, longitude);
  const recentRatings = sqlite.prepare(`SELECT id, overall, view_score as view, comfort, quiet, note, created_at as createdAt FROM ratings WHERE bench_row_id=? AND visible=1 ORDER BY updated_at DESC LIMIT 5`).all(row.row_id);
  const corrections = sqlite.prepare(`SELECT id, field, proposed_value as proposedValue, note, created_at as createdAt FROM corrections WHERE bench_row_id=? AND visible=1 ORDER BY created_at DESC LIMIT 20`).all(row.row_id);
  const media = sqlite.prepare(`SELECT id, relation, provider, source_url as sourceUrl, thumbnail_url as thumbnailUrl, author, license, distance_meters as distanceMeters, title FROM media WHERE bench_row_id=? ORDER BY relation, distance_meters LIMIT 12`).all(row.row_id);
  const currentUser = await getCurrentUser();
  const myRating = currentUser ? sqlite.prepare(`SELECT overall,view_score as view,comfort,quiet,note FROM ratings WHERE bench_row_id=? AND user_id=? LIMIT 1`).get(row.row_id, currentUser.id) : null;
  const ratingCount = Number(row.rating_count ?? 0);
  // A near-field-only model cannot honestly produce the full 1–5 view score:
  // relief is 25% of that model and the distant horizon is still unknown.
  const rawViewScore = hasTerrainModel ? contextViewRefreshed ? contextModel?.viewScore ?? null : row.view_score === null ? null : Number(row.view_score) : null;
  const viewScore = rawViewScore === null ? null : Math.max(1, Math.min(5, Math.round(rawViewScore / 20)));
  const explanation: string[] = [];
  const viewLabels = contextViewRefreshed ? contextModel?.viewLabels ?? [] : parseArray<string>(row.view_labels);
  if ((components.openness ?? 0) > 0.8) explanation.push("Weiter, wenig verdeckter Horizont");
  if ((components.relief ?? 0) > 0.8) explanation.push("Ausgeprägtes Berg- oder Hügelrelief");
  if ((components.water ?? 0) > 0.75) explanation.push("Freie Sichtachse zu einer Wasserfläche");
  if ((components.naturalness ?? 0) > 0.8) explanation.push("Überwiegend natürliche Umgebung");
  if (contextModel) explanation.push(...contextModel.viewExplanation);
  if (explanation.length === 0) explanation.push("Aus Gelände, Landbedeckung und Umgebung berechnet");

  const likelyConfidence = String(row.likely_confidence ?? "low") as "high" | "medium" | "low";
  const likelyEvidenceCount = Number(row.likely_evidence_group_count ?? 0);
  const likelyUpdatedAt = String(row.likely_updated_at ?? "");
  const likelyEvidence = parseArray<LikelyEnvironment["evidence"][number]>(row.likely_evidence_summary);
  const directViewEvidenceCount = likelyEvidence.filter((item) => item.directView).length;
  const likelyEnvironment = aiLabelsEnabled() && row.likely_confidence ? {
    confidence: likelyConfidence,
    evidenceGroupCount: likelyEvidenceCount,
    updatedAt: likelyUpdatedAt,
    modelVersion: row.likely_model_version ? String(row.likely_model_version) : null,
    traits: [
      row.likely_land_context && row.likely_land_probability !== null ? { kind: "land" as const, label: landContextLabel(String(row.likely_land_context)), probability: Number(row.likely_land_probability) } : null,
      row.likely_canopy_context && row.likely_canopy_probability !== null ? { kind: "canopy" as const, label: canopyContextLabel(String(row.likely_canopy_context)), probability: Number(row.likely_canopy_probability) } : null,
      likelyTrait("lake", "Seeblick", row.likely_lake_view_probability),
      likelyTrait("mountain", "Bergblick", row.likely_mountain_view_probability),
      likelyTrait("open", "Weite Aussicht", row.likely_open_view_probability),
      likelyTrait("limited", "Eingeschränkte Aussicht", row.likely_limited_view_probability),
      likelyTrait("buildings", "Gebäude im Umfeld", row.likely_buildings_probability),
      likelyTrait("roadRail", "Strasse oder Bahn im Umfeld", row.likely_road_rail_probability),
    ].filter((trait): trait is NonNullable<typeof trait> => trait !== null && trait.probability >= .5)
      .map((trait) => {
        const isView = ["lake", "mountain", "open", "limited"].includes(trait.kind);
        const evidenceCount = isView ? directViewEvidenceCount : likelyEvidenceCount;
        return { ...trait, confidence: traitConfidence(trait.probability, evidenceCount), evidenceCount, updatedAt: likelyUpdatedAt };
      }),
    evidence: likelyEvidence,
  } : null;

  const contributedFields = new Set((sqlite.prepare(
    "SELECT DISTINCT field FROM bench_metadata_edits WHERE bench_row_id=?",
  ).all(row.row_id) as Array<{ field: string }>).map((item) => item.field));
  const propertySource = (field: string) => contributedFields.has(field) || row.osm_type === "community" ? "Bänkli App" as const : "OpenStreetMap" as const;
  const properties = [
    { key: "backrest" as const, label: "Rückenlehne", value: yesNoUnknown(row.backrest as number | null), source: propertySource("backrest") },
    { key: "armrest" as const, label: "Armlehnen", value: yesNoUnknown(row.armrest as number | null), source: propertySource("armrest") },
    { key: "covered" as const, label: "Überdacht", value: yesNoUnknown(row.covered as number | null), source: propertySource("covered") },
    { key: "wheelchair" as const, label: "Barrierefrei", value: yesNoUnknown(row.wheelchair as number | null), source: propertySource("wheelchair") },
    { key: "material" as const, label: "Material", value: displayMaterial(row.material as string | null), source: propertySource("material") },
    { key: "seats" as const, label: "Sitzplätze", value: row.seats ? String(row.seats) : "Unbekannt", source: propertySource("seats") },
  ];
  return {
    id: String(row.id), osmType: String(row.osm_type), osmId: Number(row.osm_id),
    latitude, longitude, title: String(row.name || row.description || "Sitzbank"),
    name: row.name === null ? null : String(row.name),
    dedication: row.dedication === null ? null : String(row.dedication),
    locationName: row.location_name === null ? null : String(row.location_name),
    locationPostcode: row.location_postcode === null ? null : String(row.location_postcode),
    locationCanton: row.location_canton === null ? null : String(row.location_canton),
    verificationStatus: String(row.verification_status) === "unverified" ? "unverified" : "verified",
    confirmationCount: Number(row.confirmation_count ?? 0),
    verificationThreshold: Math.max(2, Math.min(10, Number(process.env.BENCH_VERIFICATION_THRESHOLD ?? 3) || 3)),
    removalConfirmationCount: Number(row.removal_confirmation_count ?? 0),
    description: row.operator ? `Betreiber: ${row.operator}` : null, properties,
    elevationMeters,
    elevationSource,
    analysisCoverage: hasTerrainModel ? "terrain" : "near-field",
    viewScore,
    viewComponents: {
      openness: components.openness ?? null,
      relief: components.relief ?? null,
      water: components.water ?? null,
      naturalness: components.naturalness ?? null,
      remoteness: components.remoteness ?? null,
    },
    nearOpenness: contextModel ? contextModel.nearOpennessPercent / 100 : nearOpenness(obstructionTypes, directionDegrees),
    viewConfidence: (hasTerrainModel ? contextModel ? exactOsmEvidence ? "mittel" : "niedrig"
      : pipelineVersion === "GeoAdmin-Horizont v5" && !exactOsmEvidence ? "niedrig" : row.view_confidence ?? "mittel" : "niedrig") as BenchDetail["viewConfidence"], viewExplanation: explanation,
    sunrise: times.sunrise, sunset: times.sunset,
    directSunrise: localSun.directSunrise, directSunset: localSun.directSunset,
    sunMinutesToday: localSun.sunMinutes, shadeMinutesToday: localSun.shadeMinutes,
    daylightMinutesToday: localSun.daylightMinutes, sunWindows: localSun.windows, shadeWindows: localSun.shadeWindows,
    shadeCause: sun?.shadeCause ?? "unbekannt",
    sunnyNow: sun?.sunny ?? null,
    sunConfidence: (hasTerrainModel ? contextModel ? exactOsmEvidence ? "mittel" : "niedrig"
      : pipelineVersion === "GeoAdmin-Horizont v5" && !exactOsmEvidence ? "niedrig" : row.sun_confidence ?? "mittel" : "niedrig") as BenchDetail["sunConfidence"],
    sunAltitudeDegrees: daylight.altitude,
    sunAzimuthDegrees: daylight.azimuth,
    daylightProgress: daylight.progress,
    localMinutesNow: zurichMinutes(now),
    dayPhase: daylight.phase,
    season: zurichSeason(now),
    moonAltitudeDegrees: moon.altitude,
    moonAzimuthDegrees: moon.azimuth,
    moonIllumination: moon.fraction,
    moonPhase: moon.phase,
    moonVisible: moon.visible,
    moonrise: moon.rise,
    moonset: moon.set,
    skyTrack,
    weather,
    sunMinutesSummer,
    sunMinutesWinter,
    sunMinutesSpring,
    sunMinutesAutumn,
    inForest, landContext, waterfront, canopyContext, canopyPercent,
    canopyShare3m, canopyShare10m, canopyShare25m, vegetationMedianHeight, vegetationMaxHeight,
    distanceWaterMeters, distancePathMeters,
    directionDegrees,
    buildingObstructionPercent: contextModel?.buildingObstructionPercent ?? (row.building_obstruction_percent === null ? null : Number(row.building_obstruction_percent)),
    vegetationObstructionPercent: contextModel?.vegetationObstructionPercent ?? (row.vegetation_obstruction_percent === null ? null : Number(row.vegetation_obstruction_percent)),
    distanceBuildingMeters: contextModel?.distanceBuildingMeters ?? (row.distance_building_meters === null ? null : Number(row.distance_building_meters)),
    buildingCount100m: contextModel?.buildingCount100m ?? (row.building_count_100m === null ? null : Number(row.building_count_100m)),
    viewLabels, likelyEnvironment,
    ratingAverage: row.rating_average === null ? null : Number(Number(row.rating_average).toFixed(1)), ratingCount,
    ratingBreakdown: ratingCount ? { overall: Number(Number(row.rating_average).toFixed(1)), view: Number(Number(row.rating_view).toFixed(1)), comfort: Number(Number(row.rating_comfort).toFixed(1)), quiet: Number(Number(row.rating_quiet).toFixed(1)) } : null,
    myRating: myRating as BenchDetail["myRating"],
    recentRatings: recentRatings as BenchDetail["recentRatings"], corrections: corrections as BenchDetail["corrections"], media: media as BenchDetail["media"],
    sourceUpdatedAt: String(row.source_updated_at), pipelineVersion,
  };
}

function likelyTrait(kind: "lake" | "mountain" | "open" | "limited" | "buildings" | "roadRail", label: string, value: string | number | null) {
  return value === null ? null : { kind, label, probability: Number(value) };
}

function traitConfidence(probability: number, evidenceCount: number): "high" | "medium" | "low" {
  if (probability >= .85 && evidenceCount >= 2) return "high";
  if (probability >= .65 && evidenceCount >= 1) return "medium";
  return "low";
}

function landContextLabel(value: string) {
  return ({ forest: "Wald", forest_edge: "Am Waldrand", park: "Park", open: "Offenes Gelände", urban: "Im Ort", mixed: "Abwechslungsreiche Umgebung", unknown: "Umgebung noch unklar" } as Record<string, string>)[value] ?? value;
}

function canopyContextLabel(value: string) {
  return ({ none: "Freier Himmel", partial: "Unter einzelnen Bäumen", dense: "Dichtes Blätterdach", unknown: "Baumbestand noch unklar" } as Record<string, string>)[value] ?? value;
}

function getContextFeatures(latitude: number, longitude: number): ContextFeature[] {
  type ContextRow = ContextFeature & { geometry_wkb: Buffer | null; source: string; source_version: string | null };
  const latitudeDelta = 500 / 111_320;
  const longitudeDelta = 500 / (111_320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  const nearby = sqlite.prepare(`
    SELECT f.kind,f.subtype,f.center_latitude,f.center_longitude,f.min_latitude,f.max_latitude,
      f.min_longitude,f.max_longitude,f.height_meters,f.ground_elevation_meters,f.roof_elevation_meters,
      f.geometry_wkb,f.source,f.source_version
    FROM environment_spatial_index s JOIN environment_features f ON f.row_id=s.row_id
    WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?
      AND (f.geometry_wkb IS NOT NULL OR f.kind IN ('building','tree'))
    LIMIT 20000
  `).all(longitude - longitudeDelta, longitude + longitudeDelta, latitude - latitudeDelta, latitude + latitudeDelta) as ContextRow[];
  const farLatitudeDelta = 10_000 / 111_320;
  const farLongitudeDelta = 10_000 / (111_320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  const waters = sqlite.prepare(`
    SELECT f.kind,f.subtype,f.center_latitude,f.center_longitude,f.min_latitude,f.max_latitude,
      f.min_longitude,f.max_longitude,f.height_meters,f.ground_elevation_meters,f.roof_elevation_meters,
      f.geometry_wkb,f.source,f.source_version
    FROM environment_spatial_index s JOIN environment_features f ON f.row_id=s.row_id
    WHERE f.kind='water' AND s.max_longitude>=? AND s.min_longitude<=?
      AND s.max_latitude>=? AND s.min_latitude<=? AND f.geometry_wkb IS NOT NULL LIMIT 1000
  `).all(longitude - farLongitudeDelta, longitude + farLongitudeDelta, latitude - farLatitudeDelta, latitude + farLatitudeDelta) as ContextRow[];
  const officialVersion = (sqlite.prepare(
    "SELECT version FROM official_context_sources WHERE source='swissTLM3D'",
  ).get() as { version: string } | undefined)?.version;
  const buildingVersion = (sqlite.prepare(
    "SELECT version FROM official_context_sources WHERE source='swissBUILDINGS3D'",
  ).get() as { version: string } | undefined)?.version;
  const hasLocalSwissBuildings = nearby.some((feature) => feature.kind === "building" && feature.source === "swissBUILDINGS3D" && feature.geometry_wkb);
  const hasLocalOfficialForest = nearby.some((feature) => feature.kind === "forest" && feature.source === "swissTLM3D"
    && feature.source_version === officialVersion && feature.geometry_wkb);
  const hasLocalOfficialWater = [...nearby, ...waters].some((feature) => feature.kind === "water" && feature.source === "swissTLM3D"
    && feature.source_version === officialVersion && feature.geometry_wkb);
  const identities = new Map<string, ContextFeature>();
  for (const feature of [...nearby, ...waters]) {
    if (feature.kind === "building" && buildingVersion && hasLocalSwissBuildings) {
      if (feature.source !== "swissBUILDINGS3D" || !feature.geometry_wkb) continue;
    } else if (feature.kind === "forest" && hasLocalOfficialForest
      && (feature.source !== "swissTLM3D" || feature.source_version !== officialVersion)) continue;
    else if (feature.kind === "water" && hasLocalOfficialWater
      && (feature.source !== "swissTLM3D" || feature.source_version !== officialVersion)) continue;
    try {
      const widthMeters = Math.abs(feature.max_longitude - feature.min_longitude) * 111_320 * Math.cos(latitude * Math.PI / 180);
      const heightMeters = Math.abs(feature.max_latitude - feature.min_latitude) * 111_320;
      if (feature.kind === "building" && (widthMeters > 600 || heightMeters > 600)) continue;
      const identity = [feature.kind, feature.center_latitude.toFixed(6), feature.center_longitude.toFixed(6),
        feature.min_latitude.toFixed(6), feature.min_longitude.toFixed(6)].join(":");
      identities.set(identity, {
        ...feature,
        exactGeometry: feature.geometry_wkb ? parseWkbGeometry(feature.geometry_wkb) : undefined,
      });
    } catch {
      // Corrupt or unsupported geometry is ignored rather than approximated from its bounding box.
    }
  }
  return [...identities.values()];
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const clean = z.string().trim().min(2).max(80).parse(query);
  const key = normalizeLocationKey(clean);
  const benches = sqlite.prepare(`
    SELECT id,coalesce(name,description,'Sitzbank') label,latitude,longitude,location_name,location_canton
    FROM benches
    WHERE active=1 AND (lower(coalesce(name,'')) LIKE ? OR lower(coalesce(description,'')) LIKE ?)
    ORDER BY name IS NOT NULL DESC, verification_status='verified' DESC, source_updated_at DESC LIMIT 6
  `).all(`%${clean.toLocaleLowerCase("de-CH")}%`, `%${clean.toLocaleLowerCase("de-CH")}%`) as Array<{ id: string; label: string; latitude: number; longitude: number; location_name: string | null; location_canton: string | null }>;
  const local = sqlite.prepare(`
    SELECT location_name,location_postcode,location_canton,avg(latitude) latitude,avg(longitude) longitude
    FROM benches WHERE active=1 AND (location_key LIKE ? OR lower(location_name) LIKE ?)
    GROUP BY location_key,location_postcode,location_canton ORDER BY count(*) DESC LIMIT 4
  `).all(`%${key}%`, `%${clean.toLocaleLowerCase("de-CH")}%`) as Array<{ location_name: string; location_postcode: string | null; location_canton: string | null; latitude: number; longitude: number }>;
  const benchResults: PlaceResult[] = benches.map((bench) => ({
    id: `bench-${bench.id}`,
    label: [bench.label, bench.location_name, bench.location_canton].filter(Boolean).join(" · "),
    latitude: bench.latitude, longitude: bench.longitude, kind: "bench", benchId: bench.id,
  }));
  const localResults: PlaceResult[] = local.map((place) => ({
    id: `local-${place.latitude}-${place.longitude}`,
    label: [place.location_postcode, place.location_name, place.location_canton].filter(Boolean).join(" "),
    latitude: place.latitude, longitude: place.longitude, kind: "place" as const,
  }));
  const remoteResults: PlaceResult[] = (await searchGeoAdminLocations(clean)).map((place) => ({ ...place, kind: "place" }));
  return [...benchResults, ...localResults, ...remoteResults]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.label.toLocaleLowerCase("de-CH") === item.label.toLocaleLowerCase("de-CH")) === index)
    .slice(0, 8);
}
