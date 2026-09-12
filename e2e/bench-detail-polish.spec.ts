import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";

test("shows nearby practical places on the map and keeps bench details readable", async ({page}, testInfo) => {
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    const bench = database.prepare("SELECT row_id,latitude,longitude FROM benches WHERE id='osm-node-101'").get() as {row_id: number; latitude: number; longitude: number};
    const sourceId = `node-detail-${testInfo.project.name}`;
    database.prepare(`INSERT OR REPLACE INTO environment_features(source,source_id,kind,center_latitude,center_longitude,min_latitude,max_latitude,min_longitude,max_longitude,raw_tags,imported_at)
      VALUES('OpenStreetMap',?,'toilets',?,?,?,?,?,?,'{}','2026-09-11')`).run(sourceId, bench.latitude + .00055, bench.longitude + .0003, bench.latitude + .00055, bench.latitude + .00055, bench.longitude + .0003, bench.longitude + .0003);
    database.prepare(`INSERT INTO bench_amenities(bench_row_id,category,nearest_source_id,distance_meters,count_100m,count_250m,count_500m,source,method_version,computed_at)
      VALUES(?,'toilets',?,68,1,1,1,'OpenStreetMap','test','2026-09-11')
      ON CONFLICT(bench_row_id,category) DO UPDATE SET nearest_source_id=excluded.nearest_source_id,distance_meters=excluded.distance_meters,source=excluded.source`).run(bench.row_id, sourceId);
  } finally { database.close(); }

  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", {name: "Bankdetails"});
  await sheet.getByRole("button", {name: "Detailhöhe ändern"}).click();
  await expect(sheet.getByRole("region", {name: "Auf einen Blick"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await sheet.getByRole("button", {name: "Toilette auf der Karte zeigen"}).scrollIntoViewIfNeeded();
  await page.screenshot({path: testInfo.outputPath("01-structured-bench-detail.png")});
  await sheet.getByRole("button", {name: "Toilette auf der Karte zeigen"}).click();
  const callout = page.getByRole("region", {name: "Ort einer Einrichtung auf der Karte"});
  await expect(callout).toContainText("Toilette");
  await expect(callout).toContainText("68 m");
  await page.waitForTimeout(800); // Let the 650 ms map camera transition reveal both markers.
  await page.screenshot({path: testInfo.outputPath("02-toilet-on-map.png")});
  await callout.getByRole("button", {name: "Zurück zum Bänkli"}).click();
  await expect(page.getByRole("complementary", {name: "Bankdetails"})).toBeVisible();
});
