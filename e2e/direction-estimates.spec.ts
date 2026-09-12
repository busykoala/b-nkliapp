import { expect, test } from "@playwright/test";
import { fixtureDatabase } from "./support/database";

async function openDirectionCard(page: import("@playwright/test").Page) {
  const benchChapter = page.locator(".detail-disclosures > details").first();
  await benchChapter.locator(":scope > summary").click();
  const card = benchChapter.locator(".bearing-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  return card;
}

test("renders observed, estimated and missing directions at mobile and desktop sizes", async ({ page }, testInfo) => {
  const database = fixtureDatabase();
  try {
    const unknown = database.prepare(
      "SELECT row_id,id,latitude,longitude FROM benches WHERE id='osm-node-112'",
    ).get() as { row_id: number; id: string; latitude: number; longitude: number };
    database.prepare(`INSERT OR REPLACE INTO bench_direction_estimates(
      bench_row_id,bench_id,bench_latitude,bench_longitude,direction_degrees,top_probability,entropy,
      probabilities_json,signals_json,source_versions_json,analysis_run_id,method_version,computed_at,published_at
    ) VALUES(?,?,?,?,90,.82,.31,'{}','[]','{}','e2e','bench-direction-3','2026-09-12','2026-09-12')`)
      .run(unknown.row_id, unknown.id, unknown.latitude, unknown.longitude);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/bank/osm-node-112");
    let card = await openDirectionCard(page);
    await expect(card.locator("strong")).not.toContainText(/nicht erfasst/i);
    await card.screenshot({ path: testInfo.outputPath("estimated-direction-mobile.png"), animations: "disabled" });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/bank/osm-node-101");
    card = await openDirectionCard(page);
    await expect(card.locator("strong")).not.toContainText(/nicht erfasst/i);
    await card.screenshot({ path: testInfo.outputPath("observed-direction-desktop.png"), animations: "disabled" });

    database.prepare("DELETE FROM bench_direction_estimates WHERE bench_row_id=?").run(unknown.row_id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/bank/osm-node-112");
    card = await openDirectionCard(page);
    await expect(card.locator("strong")).toContainText(/nicht erfasst/i);
    await card.screenshot({ path: testInfo.outputPath("missing-direction-mobile.png"), animations: "disabled" });
  } finally {
    database.close();
  }
});
