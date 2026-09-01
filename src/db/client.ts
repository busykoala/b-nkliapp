import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrations } from "./migrations";
import { sampleBenches } from "./seed-data";

const globalForDatabase = globalThis as unknown as { benchlySqlite?: Database.Database };

function migrate(sqlite: Database.Database) {
  sqlite.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = sqlite.prepare("SELECT 1 FROM _migrations WHERE id = ?");
  const mark = sqlite.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)");
  for (const migration of migrations) {
    if (applied.get(migration.id)) continue;
    sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      mark.run(migration.id, new Date().toISOString());
    })();
  }
}

function seed(sqlite: Database.Database) {
  if (process.env.BENCHLY_SEED_DEMO === "false") return;
  const count = sqlite.prepare("SELECT count(*) AS count FROM benches").get() as { count: number };
  if (count.count > 0) return;
  const now = new Date().toISOString();
  const insertBench = sqlite.prepare(`
    INSERT INTO benches (id, osm_type, osm_id, latitude, longitude, backrest, armrest, covered,
      wheelchair, seats, material, direction_degrees, description, raw_tags, active, source_updated_at, imported_at)
    VALUES (@id, 'node', @osmId, @lat, @lon, @backrest, @armrest, @covered, @wheelchair, @seats,
      @material, @direction, @place, @tags, 1, @now, @now)
  `);
  const insertEnrichment = sqlite.prepare(`
    INSERT INTO bench_enrichments (bench_row_id, elevation_meters, in_forest, canopy_percent,
      distance_water_meters, distance_path_meters, horizon_profile, sun_minutes_summer,
      sun_minutes_winter, sun_confidence, view_score, view_confidence, view_components,
      obstruction_types, obstruction_distances, building_obstruction_percent, vegetation_obstruction_percent,
      distance_building_meters, building_count_100m, view_labels, pipeline_version, computed_at)
    VALUES (@rowId, @elevation, @forest, @canopy, @water, @path, @horizon, @summer, @winter,
      @confidence, @view, @confidence, @components, @obstructionTypes, @obstructionDistances,
      @buildingObstruction, @vegetationObstruction, @distanceBuilding, @buildingCount, @viewLabels, 'demo-2.0', @now)
  `);
  sqlite.transaction(() => {
    for (const bench of sampleBenches) {
      const result = insertBench.run({ ...bench, tags: JSON.stringify({ amenity: "bench", material: bench.material }), now });
      const horizon = Array.from({ length: 72 }, (_, i) => Number((2 + 5 * Math.abs(Math.sin((i * Math.PI) / 36))).toFixed(1)));
      const obstructionTypes = Array.from({ length: 72 }, (_, i) => i % 13 === 0 ? "building" : i % 7 === 0 && bench.canopy > 15 ? "vegetation" : "terrain");
      const viewLabels = [bench.components[1] > 0.7 ? "Bergblick" : null, bench.components[2] > 0.75 ? "Seeblick" : null, bench.components[0] > 0.85 ? "Weitsicht" : null].filter(Boolean);
      insertEnrichment.run({ ...bench, rowId: Number(result.lastInsertRowid), horizon: JSON.stringify(horizon), components: JSON.stringify({ openness: bench.components[0], relief: bench.components[1], water: bench.components[2], naturalness: bench.components[3], remoteness: bench.components[4] }), obstructionTypes: JSON.stringify(obstructionTypes), obstructionDistances: JSON.stringify(Array(72).fill(85)), buildingObstruction: 8.3, vegetationObstruction: bench.canopy / 3, distanceBuilding: 42, buildingCount: 5, viewLabels: JSON.stringify(viewLabels), now });
    }
  })();
}

function createDatabase() {
  const configuredPath = process.env.DATABASE_PATH ?? "./data/benchly.sqlite";
  const databasePath = resolve(configuredPath);
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath, { timeout: 5000 });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  migrate(sqlite);
  seed(sqlite);
  return sqlite;
}

export const sqlite = globalForDatabase.benchlySqlite ?? createDatabase();
if (process.env.NODE_ENV !== "production") globalForDatabase.benchlySqlite = sqlite;
export const db = drizzle({ client: sqlite });
