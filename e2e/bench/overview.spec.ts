import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";

test("shows nearby practical places on the map and keeps bench details readable", async ({page}, testInfo) => {
  await page.setViewportSize({width: 430, height: 780});
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    const bench = database.prepare("SELECT row_id,latitude,longitude FROM benches WHERE id='osm-node-101'").get() as {row_id: number; latitude: number; longitude: number};
    for (const [index, category, distance] of [[0, "toilets", 68], [1, "waste_basket", 96], [2, "drinking_water", 124]] as const) {
      const sourceId = `node-detail-${category}-${testInfo.project.name}`;
      const latitude = bench.latitude + .00055 + index * .0001;
      const longitude = bench.longitude + .0003 + index * .0001;
      database.prepare(`INSERT OR REPLACE INTO environment_features(source,source_id,kind,center_latitude,center_longitude,min_latitude,max_latitude,min_longitude,max_longitude,raw_tags,imported_at)
        VALUES('OpenStreetMap',?,?,?,?,?,?,?,?,'{}','2026-09-11')`).run(sourceId, category, latitude, longitude, latitude, latitude, longitude, longitude);
      database.prepare(`INSERT INTO bench_amenities(bench_row_id,category,nearest_source_id,distance_meters,count_100m,count_250m,count_500m,source,method_version,computed_at)
        VALUES(?,?,?,?,1,1,1,'OpenStreetMap','test','2026-09-11')
        ON CONFLICT(bench_row_id,category) DO UPDATE SET nearest_source_id=excluded.nearest_source_id,distance_meters=excluded.distance_meters,source=excluded.source`).run(bench.row_id, category, sourceId, distance);
    }
  } finally { database.close(); }

  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", {name: "Bankdetails"});
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(sheet.getByRole("region", {name: "Auf einen Blick"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await sheet.locator(".bench-visit-details > details > summary").click();
  const amenityItems = sheet.locator(".bench-nearby-amenities li");
  await expect(amenityItems).toHaveCount(2);
  await expect(sheet.locator(".bench-nearby-amenities").getByText("Abfalleimer", { exact: true })).toHaveCount(0);
  await expect(amenityItems.nth(0).locator(".amenity-icon")).toHaveAttribute("data-amenity-icon", "toilets");
  await expect(amenityItems.nth(1).locator(".amenity-icon")).toHaveAttribute("data-amenity-icon", "drinking-water");
  const itemBoxes = await amenityItems.evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    return {top: box.top, bottom: box.bottom};
  }));
  for (let index = 1; index < itemBoxes.length; index += 1) expect(itemBoxes[index].top).toBeGreaterThanOrEqual(itemBoxes[index - 1].bottom - 1);
  for (const item of await amenityItems.all()) {
    const [icon, cue] = await Promise.all([item.locator(".amenity-icon").boundingBox(), item.locator(".amenity-map-cue").boundingBox()]);
    expect(icon).not.toBeNull();
    expect(cue).not.toBeNull();
    expect(icon!.x + icon!.width).toBeLessThan(cue!.x);
  }
  await sheet.getByRole("button", {name: "Toilette auf der Karte zeigen"}).scrollIntoViewIfNeeded();
  const content = sheet.locator(".map-sheet-content");
  const scrollBefore = await content.evaluate((node) => node.scrollTop);
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const cameraBefore = await map.evaluate((node) => ({
    latitude: node.getAttribute("data-center-latitude"),
    longitude: node.getAttribute("data-center-longitude"),
    zoom: node.getAttribute("data-zoom"),
  }));
  await page.screenshot({path: testInfo.outputPath("01-structured-bench-detail.png")});
  await sheet.getByRole("button", {name: "Toilette auf der Karte zeigen"}).click();
  const callout = page.getByRole("region", {name: "Ort einer Einrichtung auf der Karte"});
  await expect(callout).toContainText("Toilette");
  await expect(callout).toContainText("68 m");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await page.screenshot({path: testInfo.outputPath("02-toilet-on-map.png")});
  await callout.getByRole("button", {name: "Zurück zum Bänkli"}).click();
  const restored = page.getByRole("complementary", {name: "Bankdetails"});
  await expect(restored).toBeVisible();
  await expect(restored).toHaveAttribute("data-snap", "full");
  await expect.poll(() => restored.locator(".map-sheet-content").evaluate((node) => node.scrollTop)).toBe(scrollBefore);
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await expect(map).toHaveAttribute("data-center-latitude", cameraBefore.latitude!);
  await expect(map).toHaveAttribute("data-center-longitude", cameraBefore.longitude!);
  await expect(map).toHaveAttribute("data-zoom", cameraBefore.zoom!);
  const route = restored.getByRole("button", { name: "Weg planen", exact: true });
  await route.click();
  await page.getByLabel("Reiseplan schliessen").click();
  await expect(route).toBeFocused();
  await expect.poll(() => restored.locator(".map-sheet-content").evaluate(node => node.scrollTop)).toBe(scrollBefore);
});

test("keeps the compact visit summary readable and returns from reviews", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(sheet.locator(".bench-overview-grid")).toHaveCount(0);
  const actions = sheet.locator(".bench-actions");
  await expect(actions.getByRole("button", { name: "Weg planen", exact: true })).toBeInViewport();
  await expect(actions.getByRole("button", { name: "Merken", exact: true })).toBeInViewport();
  await expect(sheet.locator(".bench-action-group")).toHaveCount(1);
  await expect(sheet.locator(".bench-contribute button")).toHaveCount(1);
  await expect(sheet.locator(".bench-sources")).toHaveCount(0);
  await expect(sheet.locator(".bench-visit-details > details")).toHaveCount(1);
  expect(await sheet.locator(".bench-panorama").evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector(".bench-overview")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const content = sheet.locator(".map-sheet-content");
  const ratingSummary = sheet.locator(".overview-rating");
  if (await ratingSummary.count()) {
    await ratingSummary.scrollIntoViewIfNeeded();
    const before = await content.evaluate(node => node.scrollTop);
    await ratingSummary.click();
    await expect(sheet.locator(".community-page")).toBeVisible();
    await expect(sheet.locator(".quiet-back")).toBeFocused();
    await sheet.locator(".quiet-back").click();
    await expect(ratingSummary).toBeFocused();
    await expect.poll(() => content.evaluate(node => node.scrollTop)).toBe(before);
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await content.evaluate(node => node.scrollTo({ top: 0 }));
  await expect(sheet.locator(".bench-header > h2")).toHaveText("Lindenhof, Zürich");
  await expect(sheet.locator(".bench-header > h2")).toBeVisible();
  const bounds = await sheet.locator(".map-sheet-chrome button, .bench-actions > button").evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width, height: box.height };
  }));
  // At enlarged text the preview cannot fit: back, directions and save remain.
  await expect(sheet.locator(".atlas-place-toggle")).toHaveCount(0);
  expect(bounds).toHaveLength(3);
  for (const box of bounds) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(321);
    expect(box.width).toBeGreaterThanOrEqual(43);
    expect(box.height).toBeGreaterThanOrEqual(43);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("compact-overview-large-text.png") });
});
