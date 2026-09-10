import "server-only";

import type Database from "better-sqlite3";
import { sqlite } from "@/db/client";
import populationSnapshot from "./municipality-population.json";
import {
  dateSeed,
  dailyRecordKeys,
  linearTrend,
  municipalityPersonality,
  pearsonCorrelation,
  ratio,
  type BoxPlotGroup,
  type BenchFact,
  type MunicipalityPortrait,
  type MunicipalitySummary,
  type RouletteMode,
  type StatisticsDashboard,
  type StatisticsRecordKey,
} from "./model";

const municipalityPopulation = populationSnapshot.population as Record<string, number>;
const minimumRankedBenches = 10;

type FactRow = { id: string; title: string | null; place: string | null; metric: number | null };
type MunicipalityRow = {
  id: string; name: string; canton: string | null; bench_count: number; average_elevation: number | null;
  sunny_count: number; sunny_known: number; scenic_count: number; scenic_known: number;
  waterside_count: number; waterside_known: number; forest_count: number; forest_known: number;
};

const titleSql = "coalesce(nullif(b.name,''),nullif(g.locality_name,''),nullif(g.municipality_name,''),nullif(b.location_name,''),nullif(b.description,''))";
const placeSql = "coalesce(nullif(g.locality_name,''),nullif(g.municipality_name,''),nullif(b.location_name,''))";

function fact(row: FactRow | undefined): BenchFact | null {
  return row ? { id: row.id, title: row.title, place: row.place, metric: row.metric === null ? null : Number(row.metric) } : null;
}

function municipality(row: MunicipalityRow): MunicipalitySummary {
  const population = municipalityPopulation[String(Number(row.id))] ?? null;
  const benchCount = Number(row.bench_count);
  return {
    id: row.id,
    name: row.name,
    canton: row.canton,
    benchCount,
    population,
    benchesPerThousand: population ? benchCount / population * 1_000 : null,
    averageElevation: row.average_elevation === null ? null : Number(row.average_elevation),
    sunnyShare: ratio(Number(row.sunny_count), Number(row.sunny_known)),
    scenicShare: ratio(Number(row.scenic_count), Number(row.scenic_known)),
    watersideShare: ratio(Number(row.waterside_count), Number(row.waterside_known)),
    forestShare: ratio(Number(row.forest_count), Number(row.forest_known)),
  };
}

const municipalitySelect = `
  SELECT g.municipality_id id,max(g.municipality_name) name,max(g.canton_name) canton,count(*) bench_count,
    avg(e.elevation_meters) average_elevation,
    sum(CASE WHEN e.sun_minutes_winter>=180 THEN 1 ELSE 0 END) sunny_count,
    sum(CASE WHEN e.sun_minutes_winter IS NOT NULL THEN 1 ELSE 0 END) sunny_known,
    sum(CASE WHEN e.view_score>=75 THEN 1 ELSE 0 END) scenic_count,
    sum(CASE WHEN e.view_score IS NOT NULL THEN 1 ELSE 0 END) scenic_known,
    sum(CASE WHEN e.distance_water_meters<=250 THEN 1 ELSE 0 END) waterside_count,
    sum(CASE WHEN e.distance_water_meters IS NOT NULL THEN 1 ELSE 0 END) waterside_known,
    sum(CASE WHEN e.in_forest=1 THEN 1 ELSE 0 END) forest_count,
    sum(CASE WHEN e.in_forest IS NOT NULL THEN 1 ELSE 0 END) forest_known
  FROM benches b JOIN bench_geography g ON g.bench_row_id=b.row_id
  LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
  WHERE b.active=1 AND g.municipality_id IS NOT NULL AND g.municipality_name IS NOT NULL`;

function record(database: Database.Database, expression: string, direction: "ASC" | "DESC", municipalityId?: string): BenchFact | null {
  const where = municipalityId ? "AND g.municipality_id=?" : "";
  const row = database.prepare(`SELECT b.id,${titleSql} title,${placeSql} place,${expression} metric
    FROM benches b LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id
    JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    WHERE b.active=1 AND ${expression} IS NOT NULL ${where} ORDER BY ${expression} ${direction},b.row_id LIMIT 1`)
    .get(...(municipalityId ? [municipalityId] : [])) as FactRow | undefined;
  return fact(row);
}

const recordDefinitions: Record<StatisticsRecordKey, [string, "ASC" | "DESC"]> = {
  highest: ["e.elevation_meters", "DESC"], lowest: ["e.elevation_meters", "ASC"],
  sunniestWinter: ["e.sun_minutes_winter", "DESC"], shadiestWinter: ["e.sun_minutes_winter", "ASC"],
  sunniestSummer: ["e.sun_minutes_summer", "DESC"], shadiestSummer: ["e.sun_minutes_summer", "ASC"],
  bestView: ["e.view_score", "DESC"], closestWater: ["e.distance_water_meters", "ASC"], furthestWater: ["e.distance_water_meters", "DESC"],
  densestCanopy: ["e.canopy_percent", "DESC"], clearestCanopy: ["e.canopy_percent", "ASC"],
  closestPath: ["e.distance_path_meters", "ASC"], furthestPath: ["e.distance_path_meters", "DESC"],
  mostSeats: ["b.seats", "DESC"], mostBuildings: ["e.building_count_100m", "DESC"], fewestBuildings: ["e.building_count_100m", "ASC"],
  mostBlockedView: ["e.building_obstruction_percent", "DESC"],
  wildest: ["json_extract(e.view_components,'$.naturalness')", "DESC"], remotest: ["json_extract(e.view_components,'$.remoteness')", "DESC"],
};

function dailyBench(database: Database.Database, date: string): BenchFact | null {
  const maximum = database.prepare("SELECT max(row_id) value FROM benches WHERE active=1").get() as { value: number | null };
  if (!maximum.value) return null;
  const target = dateSeed(date) % maximum.value;
  const select = `SELECT b.id,${titleSql} title,${placeSql} place,e.view_score metric
    FROM benches b LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id
    LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE b.active=1 AND b.row_id>=? ORDER BY b.row_id LIMIT 1`;
  const row = database.prepare(select).get(target) as FactRow | undefined
    ?? database.prepare(select).get(0) as FactRow | undefined;
  return fact(row);
}

export function statisticsDate(now = new Date(process.env.BENCHLY_E2E_NOW ?? Date.now())): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function readStatisticsDashboard(date = statisticsDate(), database: Database.Database = sqlite): StatisticsDashboard {
  const totals = database.prepare(`SELECT count(*) total,
    sum(CASE WHEN e.bench_row_id IS NOT NULL THEN 1 ELSE 0 END) enriched,
    sum(CASE WHEN g.municipality_id IS NOT NULL THEN 1 ELSE 0 END) located,
    count(DISTINCT g.municipality_id) municipalities
    FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id WHERE b.active=1`).get() as {
      total: number; enriched: number; located: number; municipalities: number;
    };
  const municipalityRows = database.prepare(`${municipalitySelect} GROUP BY g.municipality_id`).all() as MunicipalityRow[];
  const correlation = database.prepare(`SELECT count(*) count,sum(e.sun_minutes_winter) sum_x,sum(e.view_score) sum_y,
    sum(e.sun_minutes_winter*e.sun_minutes_winter) sum_xx,sum(e.view_score*e.view_score) sum_yy,
    sum(e.sun_minutes_winter*e.view_score) sum_xy
    FROM benches b JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    WHERE b.active=1 AND e.sun_minutes_winter IS NOT NULL AND e.view_score IS NOT NULL`).get() as {
      count: number; sum_x: number | null; sum_y: number | null; sum_xx: number | null; sum_yy: number | null; sum_xy: number | null;
    };
  const step = Math.max(1, Math.floor(Number(correlation.count) / 84));
  const points = database.prepare(`SELECT b.id,${titleSql} title,e.sun_minutes_winter winter_sun_minutes,e.view_score view_score
    FROM benches b LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id
    JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    WHERE b.active=1 AND e.sun_minutes_winter IS NOT NULL AND e.view_score IS NOT NULL AND b.row_id % ?=0
    ORDER BY b.row_id LIMIT 90`).all(step) as Array<{ id: string; title: string | null; winter_sun_minutes: number; view_score: number }>;
  const boxPlots = database.prepare(`WITH sun_ranked AS (
      SELECT e.sun_minutes_winter sun,e.view_score view,ntile(4) OVER (ORDER BY e.sun_minutes_winter) sun_quartile
      FROM benches b JOIN bench_enrichments e ON e.bench_row_id=b.row_id
      WHERE b.active=1 AND e.sun_minutes_winter IS NOT NULL AND e.view_score IS NOT NULL
    ), view_ranked AS (
      SELECT sun_quartile,sun,view,row_number() OVER (PARTITION BY sun_quartile ORDER BY view) position,
        count(*) OVER (PARTITION BY sun_quartile) group_count
      FROM sun_ranked
    )
    SELECT sun_quartile quartile,count(*) count,min(sun) sun_minimum,max(sun) sun_maximum,
      min(view) minimum,
      min(CASE WHEN position >= (group_count+3)/4 THEN view END) lower_quartile,
      min(CASE WHEN position >= (group_count+1)/2 THEN view END) median,
      min(CASE WHEN position >= (3*group_count+3)/4 THEN view END) upper_quartile,
      max(view) maximum
    FROM view_ranked GROUP BY sun_quartile ORDER BY sun_quartile`).all() as Array<{
      quartile: number; count: number; sun_minimum: number; sun_maximum: number; minimum: number;
      lower_quartile: number; median: number; upper_quartile: number; maximum: number;
    }>;
  const records = dailyRecordKeys(date).flatMap((key) => {
    const [expression, direction] = recordDefinitions[key];
    const value = record(database, expression, direction);
    return value ? [{ key, fact: value }] : [];
  });
  const municipalitySummaries = municipalityRows.map(municipality);
  const eligibleMunicipalities = municipalitySummaries.filter((item) => item.benchesPerThousand !== null && item.benchCount >= minimumRankedBenches);
  const rankedMunicipalities = (eligibleMunicipalities.length ? eligibleMunicipalities : municipalitySummaries.filter((item) => item.benchesPerThousand !== null))
    .sort((left, right) => (right.benchesPerThousand ?? 0) - (left.benchesPerThousand ?? 0) || right.benchCount - left.benchCount || left.name.localeCompare(right.name))
    .slice(0, 8);
  const trendValues = { count: Number(correlation.count), sumX: Number(correlation.sum_x ?? 0), sumY: Number(correlation.sum_y ?? 0),
    sumXX: Number(correlation.sum_xx ?? 0), sumXY: Number(correlation.sum_xy ?? 0) };
  return {
    totalBenches: Number(totals.total),
    enrichedBenches: Number(totals.enriched),
    locatedBenches: Number(totals.located),
    municipalityCount: Number(totals.municipalities),
    populationYear: populationSnapshot.year,
    benchOfTheDay: dailyBench(database, date),
    records,
    municipalities: rankedMunicipalities,
    correlation: {
      coefficient: pearsonCorrelation({ count: Number(correlation.count), sumX: Number(correlation.sum_x ?? 0), sumY: Number(correlation.sum_y ?? 0),
        sumXX: Number(correlation.sum_xx ?? 0), sumYY: Number(correlation.sum_yy ?? 0), sumXY: Number(correlation.sum_xy ?? 0) }),
      trend: linearTrend(trendValues),
      boxPlots: boxPlots.map((row): BoxPlotGroup => ({ quartile: Number(row.quartile), count: Number(row.count),
        sunMinimum: Number(row.sun_minimum), sunMaximum: Number(row.sun_maximum), minimum: Number(row.minimum),
        lowerQuartile: Number(row.lower_quartile), median: Number(row.median), upperQuartile: Number(row.upper_quartile), maximum: Number(row.maximum) })),
      sampleSize: Number(correlation.count),
      points: points.map((point) => ({ id: point.id, title: point.title, winterSunMinutes: Number(point.winter_sun_minutes), viewScore: Number(point.view_score) })),
    },
  };
}

export function readMunicipalityPortrait(id: string, database: Database.Database = sqlite, now = new Date()): MunicipalityPortrait | null {
  if (!/^\d{1,8}$/.test(id)) return null;
  const row = database.prepare(`${municipalitySelect} AND g.municipality_id=? GROUP BY g.municipality_id`).get(id) as MunicipalityRow | undefined;
  if (!row) return null;
  const base = municipality(row);
  const fiveYearsAgo = new Date(now);
  fiveYearsAgo.setUTCFullYear(fiveYearsAgo.getUTCFullYear() - 5);
  const details = database.prepare(`SELECT
    sum(CASE WHEN b.wheelchair=1 THEN 1 ELSE 0 END) wheelchair_count,
    sum(CASE WHEN b.wheelchair IS NOT NULL THEN 1 ELSE 0 END) wheelchair_known,
    sum(CASE WHEN b.backrest IS NULL THEN 1 ELSE 0 END) missing_backrest,
    sum(CASE WHEN b.seats IS NULL THEN 1 ELSE 0 END) missing_seats,
    sum(CASE WHEN b.direction_degrees IS NULL THEN 1 ELSE 0 END) missing_direction,
    sum(CASE WHEN b.osm_timestamp IS NULL OR b.osm_timestamp='' THEN 1 ELSE 0 END) unknown_freshness,
    sum(CASE WHEN b.osm_timestamp IS NOT NULL AND b.osm_timestamp<>'' AND b.osm_timestamp<? THEN 1 ELSE 0 END) stale_mapping,
    sum(CASE WHEN b.verification_status='unverified' THEN 1 ELSE 0 END) unverified,
    sum((b.backrest IS NOT NULL)+(b.seats IS NOT NULL)+(b.direction_degrees IS NOT NULL)+(b.wheelchair IS NOT NULL)) known_fields
    FROM benches b JOIN bench_geography g ON g.bench_row_id=b.row_id WHERE b.active=1 AND g.municipality_id=?`)
    .get(fiveYearsAgo.toISOString(), id) as Record<string, number>;
  const portrait: MunicipalityPortrait = {
    ...base,
    sunnyKnown: Number(row.sunny_known), scenicKnown: Number(row.scenic_known), watersideKnown: Number(row.waterside_known), forestKnown: Number(row.forest_known),
    wheelchairShare: ratio(Number(details.wheelchair_count), Number(details.wheelchair_known)),
    wheelchairKnown: Number(details.wheelchair_known),
    metadataKnownShare: Number(details.known_fields) / (base.benchCount * 4),
    audit: {
      missingBackrest: Number(details.missing_backrest), missingSeats: Number(details.missing_seats), missingDirection: Number(details.missing_direction),
      unknownFreshness: Number(details.unknown_freshness), staleMapping: Number(details.stale_mapping), unverified: Number(details.unverified),
    },
    records: {
      highest: record(database, "e.elevation_meters", "DESC", id),
      sunniestWinter: record(database, "e.sun_minutes_winter", "DESC", id),
      bestView: record(database, "e.view_score", "DESC", id),
    },
    personality: "mysterious",
  };
  portrait.personality = municipalityPersonality(portrait);
  return portrait;
}

export function readRouletteBench(mode: RouletteMode, random = Math.random, database: Database.Database = sqlite): string | null {
  const condition = mode === "beautiful" ? "AND e.view_score>=80" : mode === "sunny" ? "AND e.sun_minutes_winter>=240" : "";
  const count = database.prepare(`SELECT count(*) value FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE b.active=1 ${condition}`).get() as { value: number };
  if (!count.value) return null;
  const offset = Math.min(count.value - 1, Math.floor(random() * count.value));
  const row = database.prepare(`SELECT b.id FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE b.active=1 ${condition} ORDER BY b.row_id LIMIT 1 OFFSET ?`).get(offset) as { id: string } | undefined;
  return row?.id ?? null;
}
