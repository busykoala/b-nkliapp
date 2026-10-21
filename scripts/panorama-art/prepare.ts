/** Install only downloaded public facts into an isolated, migrated review DB. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { artScenarios, artSeasons } from "./scenarios";

const root = resolve("data/panorama-artist-review");
const databasePath = join(root, "review.sqlite");
if (process.env.DATABASE_PATH && resolve(process.env.DATABASE_PATH) !== databasePath) {
  throw new Error(`This command only writes ${databasePath}`);
}
process.env.DATABASE_PATH = databasePath;
process.env.BENCHLY_SEED_DEMO = "false";
const { sqlite } = await import("../../src/db/client");
const raw = readFileSync(join(root, "cluster/records.json"));
const records = JSON.parse(raw.toString()) as Record<string, Record<string, unknown>[]>;
const catalogue = JSON.parse(readFileSync("config/panorama-artist-review.json", "utf8")) as { benches: { number: number; id: string; heading: number }[] };

sqlite.transaction(() => {
  for (const table of ["benches", "bench_enrichments", "bench_geography"]) {
    const allowed = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name));
    for (const row of records[table]) {
      const fields = Object.keys(row).filter((field) => allowed.has(field));
      const key = table === "benches" ? "row_id" : "bench_row_id";
      sqlite.prepare(`INSERT INTO ${table} (${fields.map((field) => `"${field}"`).join(",")})
        VALUES (${fields.map(() => "?").join(",")}) ON CONFLICT(${key}) DO UPDATE SET
        ${fields.filter((field) => field !== key).map((field) => `"${field}"=excluded."${field}"`).join(",")}`)
        // The isolated art DB contains no production user accounts.
        .run(...fields.map((field) => field === "created_by_user_id" ? null : row[field]));
    }
  }
})();
const benches = catalogue.benches.map((entry) => {
  const record = records.benches.find((bench) => bench.id === entry.id);
  if (!record) throw new Error(`Downloaded records missing ${entry.id}`);
  const latitude = Number(record.latitude), longitude = Number(record.longitude);
  return { ...entry, latitude, longitude, scenarios: artSeasons.flatMap((season) => artScenarios(latitude, longitude, season)) };
});
writeFileSync(join(root, "scenarios.json"), JSON.stringify({ recordsSha256: createHash("sha256").update(raw).digest("hex"), benches }, null, 2) + "\n");
console.log(JSON.stringify({ databasePath, benches: benches.length, scenarios: benches[0].scenarios.length }));
sqlite.close();
