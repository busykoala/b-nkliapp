import { expect, test } from "@playwright/test";
import { fixtureDatabase } from "../support/database";
import { installTerrainPanoramaFixture } from "../support/panorama-fixture";

test("keeps observed, estimated and missing directions in the painted view", async ({ page }, info) => {
  await page.goto("/");
  const database = fixtureDatabase();
  let reviewRowId: number | null = null;
  try {
    const unknown = database.prepare("SELECT row_id,id,latitude,longitude FROM benches WHERE id='osm-node-112'").get() as { row_id: number; id: string; latitude: number; longitude: number };
    database.prepare(`INSERT OR REPLACE INTO bench_direction_estimates(
      bench_row_id,bench_id,bench_latitude,bench_longitude,direction_degrees,top_probability,entropy,
      probabilities_json,signals_json,source_versions_json,analysis_run_id,method_version,computed_at,published_at
    ) VALUES(?,?,?,?,90,.82,.31,'{}','[]','{}','e2e','bench-direction-3','2026-09-12','2026-09-12')`)
      .run(unknown.row_id, unknown.id, unknown.latitude, unknown.longitude);
    await installTerrainPanoramaFixture(unknown.id);
    await installTerrainPanoramaFixture("osm-node-101");
    for (const [id, width] of [[unknown.id, 390], ["osm-node-101", 1280]] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/bank/${id}`);
      const panorama = page.locator(".bench-panorama");
      await expect(panorama.locator(".bench-panorama-expand")).toBeVisible();
      await expect(panorama.locator(".bench-panorama-bearing")).toHaveCount(0);
      const heading = Number(await panorama.getAttribute("data-recorded-direction"));
      if (id === unknown.id) expect(heading).toBe(90);
      await panorama.locator(".bench-panorama-expand").click();
      await expect(panorama.locator(".bench-panorama-bearing")).toHaveText(`${Math.round(heading)}°`);
      await page.screenshot({ path: info.outputPath(`direction-${width}.png`) });
      await panorama.locator(".bench-panorama-viewport").press("Escape");
    }
    database.prepare("DELETE FROM bench_direction_estimates WHERE bench_row_id=?").run(unknown.row_id);
    await page.goto(`/bank/${unknown.id}`);
    await expect(page.locator(".bench-panorama")).toHaveAttribute("data-recorded-direction", "0");
    const unknownPanorama = page.locator(".bench-panorama");
    await unknownPanorama.locator(".bench-panorama-expand").click();
    await unknownPanorama.locator(".bench-panorama-viewport").press("Shift+ArrowRight");
    await expect(unknownPanorama.getByRole("button", { name: "Zur Blickrichtung der Bank" })).toHaveCount(0);
    await unknownPanorama.locator(".bench-panorama-viewport").press("Escape");
    database.prepare(`INSERT OR REPLACE INTO bench_attribute_state(
      bench_row_id,attribute,value_json,confidence,conflicting,evidence_count,source_types_json,
      latest_at,method_version,resolved_at
    ) VALUES(?,'backrest','true','low',1,2,'["osm","community"]','2026-09-05','e2e-review','2999-01-01')`).run(unknown.row_id);
    reviewRowId = unknown.row_id;
    await page.reload();
    await expect(page.locator(".bench-overview")).not.toContainText("Rückenlehne");
    await expect(page.locator(".bench-sources")).toHaveCount(0);
  } finally {
    if (reviewRowId !== null) database.prepare("DELETE FROM bench_attribute_state WHERE bench_row_id=? AND attribute='backrest' AND method_version='e2e-review'").run(reviewRowId);
    database.close();
  }
});
