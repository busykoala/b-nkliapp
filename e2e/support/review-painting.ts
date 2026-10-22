import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { installPanoramaFixture, installTerrainPanoramaFixture } from "./panorama-fixture";

export async function installReviewPainting() {
  const root = process.env.BENCHLY_UI_REVIEW_ASSET_ROOT ?? join(process.cwd(), "e2e/fixtures/review-paintings");
  if (!existsSync(join(root, "manifest.json"))) {
    await installTerrainPanoramaFixture("osm-node-101");
    return;
  }
  const record = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).records[0];
  installPanoramaFixture("osm-node-101", false, {
    painting: readFileSync(join(root, record.files.render.path)),
    material: readFileSync(join(root, record.files.material.path)),
  });
  const db = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    db.prepare("UPDATE bench_panorama_geometry SET source_versions_json=? WHERE bench_id='osm-node-101'")
      .run(JSON.stringify({ minimum_elevation_angle: -32, maximum_elevation_angle: 88 }));
    db.prepare("UPDATE bench_panorama_renders SET height=1365 WHERE bench_row_id=(SELECT row_id FROM benches WHERE id='osm-node-101')").run();
  } finally { db.close(); }
}
