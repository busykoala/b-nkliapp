"use server";

import { sqlite } from "@/db/client";
import { displayMaterial, yesNoUnknown } from "@/lib/bench";
import { buildContextModel, type ContextFeature } from "@/lib/context-model";
import { fetchPointElevation, fetchTerrainHorizon } from "@/lib/elevation";
import { calculateSunState, getLocalSunSchedule, getSeasonalSunMinutes, getSunTimes, type ObstructionType } from "@/lib/sun";
import type { BenchDetail, LikelyEnvironment, MapFeature, MapFilters, MapQuery, PlaceResult } from "@/lib/types";
import { z } from "zod";

const aiLabelsEnabled = process.env.BENCHLY_AI_LABELS_ENABLED === "true";

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
    if (filters.environment === "forest") {
      clauses.push(aiLabelsEnabled ? "(e.in_forest = 1 OR (lm.confidence='high' AND lm.land_context='forest' AND lm.land_context_probability>=0.9))" : "e.in_forest = 1");
    } else {
      clauses.push(aiLabelsEnabled ? "(e.land_context = 'open' OR (lm.confidence='high' AND lm.land_context='open' AND lm.land_context_probability>=0.85))" : "e.land_context = 'open'");
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
      clauses.push(aiLabelsEnabled ? "(coalesce(e.view_labels, '') LIKE ? OR coalesce(e.view_labels, '') LIKE ? OR (lm.confidence='high' AND lm.lake_view_probability>=0.85))" : "(coalesce(e.view_labels, '') LIKE ? OR coalesce(e.view_labels, '') LIKE ?)");
      parameters.push("%Seeblick%", "%Wasserblick%");
    } else if (filters.viewType === "mountain") {
      clauses.push(aiLabelsEnabled ? "(coalesce(e.view_labels, '') LIKE ? OR (lm.confidence='high' AND lm.mountain_view_probability>=0.85))" : "coalesce(e.view_labels, '') LIKE ?");
      parameters.push("%Bergblick%");
    } else if (filters.viewType === "open") {
      clauses.push(aiLabelsEnabled ? "(coalesce(e.view_labels, '') LIKE ? OR (lm.confidence='high' AND lm.open_view_probability>=0.85))" : "coalesce(e.view_labels, '') LIKE ?");
      parameters.push("%Weitsicht%");
    } else {
      clauses.push(aiLabelsEnabled ? "(coalesce(e.view_labels, '') LIKE ? OR (lm.confidence='high' AND lm.limited_view_probability>=0.85))" : "coalesce(e.view_labels, '') LIKE ?");
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
    });
  }
  const rows = sqlite.prepare(`
    SELECT b.id, b.latitude, b.longitude, b.covered, e.canopy_percent, e.horizon_profile,
      e.obstruction_types, e.view_score, e.view_labels, ra.rating_average
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
    const sunnyNow = calculateSunState({
      date: now,
      latitude: row.latitude,
      longitude: row.longitude,
      horizonProfile: profile.length ? profile : null,
      obstructionTypes,
      covered: Boolean(row.covered),
      canopyPercent: row.canopy_percent,
    }).sunny;
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
    });
  }

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
  let contextModel: ReturnType<typeof buildContextModel> | null = null;
  if (!hasTerrainModel) {
    const contextFeatures = getContextFeatures(latitude, longitude);
    const terrain = process.env.BENCHLY_DISABLE_ELEVATION_FETCH === "true" ? null : await fetchTerrainHorizon(latitude, longitude);
    contextModel = buildContextModel(latitude, longitude, directionDegrees, contextFeatures, terrain ? {
      elevationMeters: terrain.elevationMeters,
      horizonProfile: terrain.horizonProfile,
      sampleElevations: terrain.sampleElevations,
    } : undefined);
    horizon = contextModel.horizonProfile;
    obstructionTypes = contextModel.obstructionTypes;
    components = contextModel.viewComponents;
    if (terrain) {
      hasTerrainModel = true;
      elevationMeters = terrain.elevationMeters;
      elevationSource = terrain.source;
      pipelineVersion = "GeoAdmin-Horizont v1";
      // Replace any seasonal values produced by the earlier near-field-only model.
      sunMinutesSummer = null;
      sunMinutesWinter = null;
      sunMinutesSpring = null;
      sunMinutesAutumn = null;
      const computedAt = new Date().toISOString();
      sqlite.prepare(`
        INSERT INTO bench_enrichments (
          bench_row_id,elevation_meters,elevation_source,elevation_updated_at,in_forest,canopy_percent,
          distance_water_meters,distance_path_meters,horizon_profile,terrain_horizon_profile,obstruction_types,
          building_obstruction_percent,vegetation_obstruction_percent,distance_building_meters,building_count_100m,
          view_score,view_confidence,view_components,view_labels,context_source_version,pipeline_version,computed_at,sun_confidence
        ) VALUES (
          @rowId,@elevation,@elevationSource,@computedAt,@inForest,@canopy,@water,@path,@horizon,@terrainHorizon,@obstructionTypes,
          @buildingPercent,@vegetationPercent,@distanceBuilding,@buildingCount,@viewScore,'mittel',@components,@viewLabels,
          'OpenStreetMap + GeoAdmin','GeoAdmin-Horizont v1',@computedAt,'mittel'
        )
        ON CONFLICT(bench_row_id) DO UPDATE SET
          elevation_meters=excluded.elevation_meters,elevation_source=excluded.elevation_source,
          elevation_updated_at=excluded.elevation_updated_at,in_forest=excluded.in_forest,canopy_percent=excluded.canopy_percent,
          distance_water_meters=excluded.distance_water_meters,distance_path_meters=excluded.distance_path_meters,
          horizon_profile=excluded.horizon_profile,terrain_horizon_profile=excluded.terrain_horizon_profile,
          obstruction_types=excluded.obstruction_types,building_obstruction_percent=excluded.building_obstruction_percent,
          vegetation_obstruction_percent=excluded.vegetation_obstruction_percent,distance_building_meters=excluded.distance_building_meters,
          building_count_100m=excluded.building_count_100m,view_score=excluded.view_score,view_confidence=excluded.view_confidence,
          view_components=excluded.view_components,view_labels=excluded.view_labels,context_source_version=excluded.context_source_version,
          pipeline_version=excluded.pipeline_version,computed_at=excluded.computed_at,sun_confidence=excluded.sun_confidence
      `).run({
        rowId: row.row_id,
        elevation: terrain.elevationMeters,
        elevationSource: terrain.source,
        computedAt,
        inForest: row.in_forest === null ? null : Number(row.in_forest),
        canopy: row.canopy_percent === null ? null : Number(row.canopy_percent),
        water: row.distance_water_meters === null ? null : Number(row.distance_water_meters),
        path: contextModel.distancePathMeters,
        horizon: JSON.stringify(contextModel.horizonProfile),
        terrainHorizon: JSON.stringify(terrain.horizonProfile),
        obstructionTypes: JSON.stringify(contextModel.obstructionTypes),
        buildingPercent: contextModel.buildingObstructionPercent,
        vegetationPercent: contextModel.vegetationObstructionPercent,
        distanceBuilding: contextModel.distanceBuildingMeters,
        buildingCount: contextModel.buildingCount100m,
        viewScore: contextModel.viewScore,
        components: JSON.stringify(contextModel.viewComponents),
        viewLabels: JSON.stringify(contextModel.viewLabels),
      });
    }
  }

  if (elevationMeters === null && process.env.BENCHLY_DISABLE_ELEVATION_FETCH !== "true") {
    const elevation = await fetchPointElevation(latitude, longitude);
    if (elevation) {
      elevationMeters = elevation.meters;
      elevationSource = elevation.source;
      sqlite.prepare(`
        INSERT INTO bench_enrichments (bench_row_id, elevation_meters, elevation_source, elevation_updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(bench_row_id) DO UPDATE SET
          elevation_meters=excluded.elevation_meters,
          elevation_source=excluded.elevation_source,
          elevation_updated_at=excluded.elevation_updated_at
      `).run(row.row_id, elevationMeters, elevationSource, new Date().toISOString());
    }
  }
  const sunInput = { latitude, longitude, horizonProfile: horizon, obstructionTypes, covered: Boolean(row.covered), canopyPercent: row.canopy_percent === null ? null : Number(row.canopy_percent) };
  const effectiveSunInput = { ...sunInput, horizonProfile: horizon, obstructionTypes, canopyPercent: contextModel?.canopyPercent ?? sunInput.canopyPercent };
  const sun = calculateSunState(effectiveSunInput);
  const localSun = getLocalSunSchedule(effectiveSunInput);
  if (hasTerrainModel && [sunMinutesSummer, sunMinutesWinter, sunMinutesSpring, sunMinutesAutumn].some((value) => value === null)) {
    const seasonal = getSeasonalSunMinutes(effectiveSunInput);
    sunMinutesSummer = seasonal.summer;
    sunMinutesWinter = seasonal.winter;
    sunMinutesSpring = seasonal.spring;
    sunMinutesAutumn = seasonal.autumn;
    sqlite.prepare(`
      UPDATE bench_enrichments SET sun_minutes_summer=?,sun_minutes_winter=?,sun_minutes_spring=?,sun_minutes_autumn=?
      WHERE bench_row_id=?
    `).run(sunMinutesSummer, sunMinutesWinter, sunMinutesSpring, sunMinutesAutumn, row.row_id);
  }
  const times = getSunTimes(new Date(), latitude, longitude);
  const recentRatings = sqlite.prepare(`SELECT id, overall, view_score as view, comfort, quiet, note, created_at as createdAt FROM ratings WHERE bench_row_id=? AND visible=1 ORDER BY updated_at DESC LIMIT 5`).all(row.row_id);
  const corrections = sqlite.prepare(`SELECT id, field, proposed_value as proposedValue, note, created_at as createdAt FROM corrections WHERE bench_row_id=? AND visible=1 ORDER BY created_at DESC LIMIT 20`).all(row.row_id);
  const media = sqlite.prepare(`SELECT id, relation, provider, source_url as sourceUrl, thumbnail_url as thumbnailUrl, author, license, distance_meters as distanceMeters, title FROM media WHERE bench_row_id=? ORDER BY relation, distance_meters LIMIT 12`).all(row.row_id);
  const ratingCount = Number(row.rating_count ?? 0);
  // A near-field-only model cannot honestly produce the full 1–5 view score:
  // relief is 25% of that model and the distant horizon is still unknown.
  const rawViewScore = hasTerrainModel ? contextModel?.viewScore ?? (row.view_score === null ? null : Number(row.view_score)) : null;
  const viewScore = rawViewScore === null ? null : Math.max(1, Math.min(5, Math.round(rawViewScore / 20)));
  const explanation: string[] = [];
  const viewLabels = contextModel?.viewLabels ?? parseArray<string>(row.view_labels);
  if (viewLabels.length) explanation.push(...viewLabels);
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
  const likelyEnvironment = aiLabelsEnabled && row.likely_confidence ? {
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
    latitude, longitude, title: String(row.description || "Sitzbank"),
    description: row.operator ? `Betreiber: ${row.operator}` : null, properties,
    elevationMeters,
    elevationSource,
    analysisCoverage: hasTerrainModel ? "terrain" : "near-field",
    viewScore, viewConfidence: (hasTerrainModel ? contextModel ? "mittel" : row.view_confidence ?? "mittel" : "niedrig") as BenchDetail["viewConfidence"], viewExplanation: explanation,
    sunrise: times.sunrise, sunset: times.sunset,
    directSunrise: localSun.directSunrise, directSunset: localSun.directSunset,
    sunMinutesToday: localSun.sunMinutes, sunWindows: localSun.windows,
    shadeCause: sun?.shadeCause ?? "unbekannt",
    sunnyNow: sun?.sunny ?? null,
    sunConfidence: (hasTerrainModel ? contextModel ? "mittel" : row.sun_confidence ?? "mittel" : "niedrig") as BenchDetail["sunConfidence"],
    sunMinutesSummer,
    sunMinutesWinter,
    sunMinutesSpring,
    sunMinutesAutumn,
    inForest: row.in_forest === null ? null : Boolean(row.in_forest),
    landContext: row.land_context === null ? null : String(row.land_context) as BenchDetail["landContext"],
    waterfront: row.waterfront === null ? null : Boolean(row.waterfront),
    canopyContext: row.canopy_context === null ? null : String(row.canopy_context) as BenchDetail["canopyContext"],
    canopyPercent: row.canopy_percent === null ? null : Number(row.canopy_percent),
    canopyShare3m: row.canopy_share_3m === null ? null : Number(row.canopy_share_3m),
    canopyShare10m: row.canopy_share_10m === null ? null : Number(row.canopy_share_10m),
    canopyShare25m: row.canopy_share_25m === null ? null : Number(row.canopy_share_25m),
    vegetationMedianHeight: row.vegetation_median_height === null ? null : Number(row.vegetation_median_height),
    vegetationMaxHeight: row.vegetation_max_height === null ? null : Number(row.vegetation_max_height),
    distanceWaterMeters: row.distance_water_meters === null ? null : Number(row.distance_water_meters),
    distancePathMeters: contextModel?.distancePathMeters ?? (row.distance_path_meters === null ? null : Number(row.distance_path_meters)),
    directionDegrees,
    buildingObstructionPercent: contextModel?.buildingObstructionPercent ?? (row.building_obstruction_percent === null ? null : Number(row.building_obstruction_percent)),
    vegetationObstructionPercent: contextModel?.vegetationObstructionPercent ?? (row.vegetation_obstruction_percent === null ? null : Number(row.vegetation_obstruction_percent)),
    distanceBuildingMeters: contextModel?.distanceBuildingMeters ?? (row.distance_building_meters === null ? null : Number(row.distance_building_meters)),
    buildingCount100m: contextModel?.buildingCount100m ?? (row.building_count_100m === null ? null : Number(row.building_count_100m)),
    viewLabels, likelyEnvironment,
    ratingAverage: row.rating_average === null ? null : Number(Number(row.rating_average).toFixed(1)), ratingCount,
    ratingBreakdown: ratingCount ? { overall: Number(Number(row.rating_average).toFixed(1)), view: Number(Number(row.rating_view).toFixed(1)), comfort: Number(Number(row.rating_comfort).toFixed(1)), quiet: Number(Number(row.rating_quiet).toFixed(1)) } : null,
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
  const latitudeDelta = 500 / 111_320;
  const longitudeDelta = 500 / (111_320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  const nearby = sqlite.prepare(`
    SELECT f.kind,f.subtype,f.center_latitude,f.center_longitude,f.min_latitude,f.max_latitude,
      f.min_longitude,f.max_longitude,f.height_meters
    FROM environment_spatial_index s JOIN environment_features f ON f.row_id=s.row_id
    WHERE s.max_longitude>=? AND s.min_longitude<=? AND s.max_latitude>=? AND s.min_latitude<=?
    LIMIT 20000
  `).all(longitude - longitudeDelta, longitude + longitudeDelta, latitude - latitudeDelta, latitude + latitudeDelta) as ContextFeature[];
  const farLatitudeDelta = 10_000 / 111_320;
  const farLongitudeDelta = 10_000 / (111_320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));
  const waters = sqlite.prepare(`
    SELECT f.kind,f.subtype,f.center_latitude,f.center_longitude,f.min_latitude,f.max_latitude,
      f.min_longitude,f.max_longitude,f.height_meters
    FROM environment_spatial_index s JOIN environment_features f ON f.row_id=s.row_id
    WHERE f.kind='water' AND s.max_longitude>=? AND s.min_longitude<=?
      AND s.max_latitude>=? AND s.min_latitude<=? LIMIT 1000
  `).all(longitude - farLongitudeDelta, longitude + farLongitudeDelta, latitude - farLatitudeDelta, latitude + farLatitudeDelta) as ContextFeature[];
  const identities = new Map<string, ContextFeature>();
  for (const feature of [...nearby, ...waters]) {
    identities.set(`${feature.kind}:${feature.center_latitude}:${feature.center_longitude}`, feature);
  }
  return [...identities.values()];
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
