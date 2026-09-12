import "server-only";

import type Database from "better-sqlite3";
import { sqlite } from "@/db/client";
import externalSnapshot from "./external-by-canton.json";
import populationSnapshot from "./municipality-population.json";
import {
  correlationSummary,
  dateSeed,
  dailyRecordKeys,
  linearTrend,
  municipalityPersonality,
  pearsonCorrelation,
  quartileBoxPlots,
  ratio,
  type BenchFact,
  type LabBenchMetric,
  type LabExternalSeries,
  type LabStudyKey,
  type MunicipalityPortrait,
  type MunicipalitySummary,
  type RouletteMode,
  type StatisticsDashboard,
  type StatisticsRecordKey,
} from "./model";

const municipalityPopulation = populationSnapshot.population as Record<string, number>;
const minimumRankedBenches = 10;
const hypothesesTested = 242;

type LabDefinition = { study: LabStudyKey; benchMetric: LabBenchMetric; perCapita?: boolean };
const labStudies: LabDefinition[] = [
  { study: "centenarians", benchMetric: "benchCount" },
  { study: "hotelNights", benchMetric: "benchCount" },
  { study: "cinemaSeats", benchMetric: "benchCount" },
  { study: "motorcycles", benchMetric: "benchCount" },
  { study: "greenVotes", benchMetric: "averageElevation" },
  { study: "crimes", benchMetric: "averageSeats", perCapita: true },
  { study: "mri", benchMetric: "benchCount" },
  { study: "carePlaces", benchMetric: "averageSeats", perCapita: true },
  { study: "alpacas", benchMetric: "benchCount" },
  { study: "populationGrowth", benchMetric: "namedShare" },
  { study: "roadAccidents", benchMetric: "canopy", perCapita: true },
  { study: "woodHarvest", benchMetric: "benchCount" },
];
const externalSeries = externalSnapshot.series as Record<LabExternalSeries, { label: string; year: number; source: string; byCanton: Record<string, number | null> }>;
const externalSources = externalSnapshot.sources as Record<string, { url: string }>;
const cantonRanges: Array<[number, number]> = [[1,299],[301,999],[1001,1199],[1201,1299],[1301,1399],[1401,1499],[1501,1599],[1601,1699],[1701,1799],[2001,2399],[2401,2699],[2701,2759],[2760,2899],[2900,2999],[3000,3099],[3100,3199],[3200,3499],[3500,3999],[4000,4399],[4400,4999],[5000,5399],[5400,5999],[6000,6399],[6400,6599],[6600,6699],[6700,6999]];
const cantonPopulation = Object.fromEntries(cantonRanges.map(([minimum, maximum], index) => [String(index + 1), Object.entries(municipalityPopulation)
  .filter(([id]) => Number(id) >= minimum && Number(id) <= maximum).reduce((sum, [, value]) => sum + value, 0)]));

type FactRow = { id: string; title: string | null; place: string | null; metric: number | null };
type MunicipalityRow = {
  id: string; name: string; canton: string | null; bench_count: number; average_elevation: number | null;
  sunny_count: number; sunny_known: number; scenic_count: number; scenic_known: number;
  waterside_count: number; waterside_known: number; forest_count: number; forest_known: number;
};
type LabCantonRow = {
  canton_id: string; canton_name: string | null; bench_count: number; named_share: number;
  backrest_share: number | null; covered_share: number | null; average_elevation: number | null; winter_sun: number | null;
  average_seats: number | null; canopy: number | null;
};

const fallbackCantonSql = `CASE b.location_canton
  WHEN 'Zürich' THEN '1' WHEN 'Bern' THEN '2' WHEN 'Luzern' THEN '3' WHEN 'Uri' THEN '4' WHEN 'Schwyz' THEN '5'
  WHEN 'Obwalden' THEN '6' WHEN 'Nidwalden' THEN '7' WHEN 'Glarus' THEN '8' WHEN 'Zug' THEN '9' WHEN 'Fribourg' THEN '10'
  WHEN 'Solothurn' THEN '11' WHEN 'Basel-Stadt' THEN '12' WHEN 'Basel-Landschaft' THEN '13' WHEN 'Schaffhausen' THEN '14'
  WHEN 'Appenzell Ausserrhoden' THEN '15' WHEN 'Appenzell Innerrhoden' THEN '16' WHEN 'St. Gallen' THEN '17'
  WHEN 'Graubünden' THEN '18' WHEN 'Aargau' THEN '19' WHEN 'Thurgau' THEN '20' WHEN 'Ticino' THEN '21' WHEN 'Vaud' THEN '22'
  WHEN 'Valais' THEN '23' WHEN 'Neuchâtel' THEN '24' WHEN 'Genève' THEN '25' WHEN 'Jura' THEN '26' END`;
const effectiveCantonSql = `coalesce(nullif(g.canton_id,''),${fallbackCantonSql})`;

function labMetric(row: LabCantonRow, metric: LabBenchMetric): number | null {
  const value = metric === "benchCount" ? row.bench_count : metric === "namedShare" ? row.named_share
    : metric === "backrestShare" ? row.backrest_share : metric === "coveredShare" ? row.covered_share
      : metric === "averageElevation" ? row.average_elevation : metric === "winterSun" ? row.winter_sun
        : metric === "averageSeats" ? row.average_seats : row.canopy;
  return value === null ? null : Number(value);
}

function monthlyCorrelation(database: Database.Database, month: number) {
  const definition = labStudies[Math.max(1, Math.min(12, month)) - 1];
  const series = externalSeries[definition.study];
  const rows = database.prepare(`SELECT ${effectiveCantonSql} canton_id,
      max(coalesce(nullif(g.canton_name,''),nullif(b.location_canton,''))) canton_name,
      count(*) bench_count,
      100.0*sum(CASE WHEN b.name IS NOT NULL AND b.name<>'' THEN 1 ELSE 0 END)/count(*) named_share,
      100.0*avg(CASE WHEN b.backrest IS NOT NULL THEN b.backrest END) backrest_share,
      100.0*avg(CASE WHEN b.covered IS NOT NULL THEN b.covered END) covered_share,
      avg(e.elevation_meters) average_elevation,
      avg(e.sun_minutes_winter)/60.0 winter_sun,
      avg(b.seats) average_seats,
      avg(e.canopy_percent) canopy
    FROM benches b LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id
    LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    WHERE b.active=1 AND ${effectiveCantonSql} IS NOT NULL GROUP BY 1 ORDER BY 1`).all() as LabCantonRow[];
  const points = rows.flatMap((row) => {
    const xValue = labMetric(row, definition.benchMetric);
    const rawValue = series.byCanton[row.canton_id];
    const population = cantonPopulation[row.canton_id];
    const yValue = rawValue === null || rawValue === undefined ? null : definition.perCapita ? rawValue / population * 100_000 : rawValue;
    return xValue === null || typeof yValue !== "number" ? [] : [{
      id: row.canton_id,
      title: row.canton_name ?? row.canton_id,
      xValue,
      yValue: Number(yValue),
    }];
  });
  const summary = correlationSummary(points);
  return {
    study: definition.study,
    month: Math.max(1, Math.min(12, month)),
    benchMetric: definition.benchMetric,
    series: definition.study as LabExternalSeries,
    sourceYear: series.year,
    sourceUrl: externalSources[series.source].url,
    perCapita: Boolean(definition.perCapita),
    hypothesesTested,
    coefficient: pearsonCorrelation(summary),
    trend: linearTrend(summary),
    boxPlots: quartileBoxPlots(points),
    sampleSize: points.length,
    points,
  };
}

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

const distanceMappedWaySql = "CASE WHEN e.distance_path_meters IS NULL THEN e.distance_major_road_meters WHEN e.distance_major_road_meters IS NULL THEN e.distance_path_meters ELSE min(e.distance_path_meters,e.distance_major_road_meters) END";

const recordDefinitions: Record<StatisticsRecordKey, [string, "ASC" | "DESC"]> = {
  highest: ["e.elevation_meters", "DESC"], lowest: ["e.elevation_meters", "ASC"],
  sunniestWinter: ["e.sun_minutes_winter", "DESC"], shadiestWinter: ["e.sun_minutes_winter", "ASC"],
  sunniestSummer: ["e.sun_minutes_summer", "DESC"], shadiestSummer: ["e.sun_minutes_summer", "ASC"],
  bestView: ["e.view_score", "DESC"], closestWater: ["e.distance_water_meters", "ASC"], furthestWater: ["e.distance_water_meters", "DESC"],
  densestCanopy: ["e.canopy_percent", "DESC"], clearestCanopy: ["e.canopy_percent", "ASC"],
  closestPath: [distanceMappedWaySql, "ASC"],
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

export function readStatisticsDashboard(date = statisticsDate(), database: Database.Database = sqlite, labMonth = Number(date.slice(5, 7))): StatisticsDashboard {
  const totals = database.prepare(`SELECT count(*) total,
    sum(CASE WHEN e.pipeline_version IS NOT NULL
      AND e.elevation_meters IS NOT NULL AND e.canopy_percent IS NOT NULL
      AND e.sun_minutes_winter IS NOT NULL AND e.sun_minutes_summer IS NOT NULL
      AND e.view_score IS NOT NULL THEN 1 ELSE 0 END) enriched,
    sum(CASE WHEN g.municipality_id IS NOT NULL THEN 1 ELSE 0 END) located,
    count(DISTINCT g.municipality_id) municipalities
    FROM benches b LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    LEFT JOIN bench_geography g ON g.bench_row_id=b.row_id WHERE b.active=1`).get() as {
      total: number; enriched: number; located: number; municipalities: number;
    };
  const municipalityRows = database.prepare(`${municipalitySelect} GROUP BY g.municipality_id`).all() as MunicipalityRow[];
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
  return {
    totalBenches: Number(totals.total),
    enrichedBenches: Number(totals.enriched),
    locatedBenches: Number(totals.located),
    municipalityCount: Number(totals.municipalities),
    populationYear: populationSnapshot.year,
    benchOfTheDay: dailyBench(database, date),
    records,
    municipalities: rankedMunicipalities,
    correlation: monthlyCorrelation(database, labMonth),
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
    sum(CASE WHEN b.direction_degrees IS NULL AND
      (de.direction_degrees IS NULL OR de.bench_id<>b.id OR de.bench_latitude<>b.latitude OR de.bench_longitude<>b.longitude)
      THEN 1 ELSE 0 END) missing_direction,
    sum(CASE WHEN b.osm_timestamp IS NULL OR b.osm_timestamp='' THEN 1 ELSE 0 END) unknown_freshness,
    sum(CASE WHEN b.osm_timestamp IS NOT NULL AND b.osm_timestamp<>'' AND b.osm_timestamp<? THEN 1 ELSE 0 END) stale_mapping,
    sum(CASE WHEN b.verification_status='unverified' THEN 1 ELSE 0 END) unverified,
    sum((b.backrest IS NOT NULL)+(b.seats IS NOT NULL)+(coalesce(b.direction_degrees,de.direction_degrees) IS NOT NULL)+(b.wheelchair IS NOT NULL)) known_fields
    FROM benches b JOIN bench_geography g ON g.bench_row_id=b.row_id
    LEFT JOIN bench_direction_estimates de ON de.bench_row_id=b.row_id
      AND de.bench_id=b.id AND de.bench_latitude=b.latitude AND de.bench_longitude=b.longitude
    WHERE b.active=1 AND g.municipality_id=?`)
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
