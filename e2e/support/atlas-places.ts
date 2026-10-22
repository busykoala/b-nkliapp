import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import sharp from "sharp";
import places from "../fixtures/atlas-places.json" with { type: "json" };
import { installPanoramaFixture } from "./panorama-fixture";

/** Public place metadata and its own reviewed painting, only in Playwright's DB. */
export async function installAtlasPlaces() {
  const databasePath = process.env.BENCHLY_E2E_DATABASE;
  if (!databasePath || resolve(databasePath) === resolve("data/benchly.sqlite")) throw Error("Atlas review requires the isolated Playwright database");
  const root = process.env.BENCHLY_UI_REVIEW_ASSET_ROOT ?? resolve("e2e/fixtures/review-paintings");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { records: Array<{ id: string; files: { render: { path: string }; material: { path: string } } }> };
  const db = new Database(databasePath);
  try {
    db.transaction(() => {
      for (const { bench, enrichment, geography } of places.places) {
        const existing = db.prepare("SELECT row_id FROM benches WHERE id=?").get(bench.id) as { row_id: number } | undefined;
        const keys = Object.keys(bench);
        const row = existing?.row_id ?? Number(db.prepare(`INSERT INTO benches (${keys.map(key => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(bench)).lastInsertRowid);
        for (const [table, data] of [["bench_enrichments", enrichment], ["bench_geography", geography]] as const) {
          if (!data) continue;
          const record = { ...data, bench_row_id: row };
          db.prepare(`INSERT OR REPLACE INTO ${table} (${Object.keys(record).map(key => `"${key}"`).join(",")}) VALUES (${Object.keys(record).map(() => "?").join(",")})`).run(...Object.values(record));
        }
      }
    })();
  } finally { db.close(); }
  for (const { bench } of places.places) {
    const record = manifest.records.find(record => record.id === bench.id);
    if (!record) throw Error(`Missing reviewed painting: ${bench.id}`);
    const painting = readFileSync(join(root, record.files.render.path));
    installPanoramaFixture(bench.id, undefined, { painting, material: readFileSync(join(root, record.files.material.path)) });
    const metadata = await sharp(painting).metadata();
    const db = new Database(databasePath);
    try {
      db.prepare("UPDATE bench_panorama_renders SET width=?,height=? WHERE bench_row_id=(SELECT row_id FROM benches WHERE id=?)").run(metadata.width!, metadata.height!, bench.id);
      db.prepare("UPDATE bench_panorama_geometry SET source_versions_json=? WHERE bench_id=?").run(JSON.stringify({ minimum_elevation_angle: -32, maximum_elevation_angle: 88 }), bench.id);
    } finally { db.close(); }
  }
  return places.places.map(({ category, bench }) => ({ category, id: bench.id }));
}
