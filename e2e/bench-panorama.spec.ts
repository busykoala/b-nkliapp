import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { installPanoramaFixture } from "./panorama-fixture";

test.afterEach(() => {
  const databasePath = process.env.BENCHLY_E2E_DATABASE;
  if (!databasePath) return;
  const database = new Database(databasePath);
  const row = database.prepare("SELECT row_id FROM benches WHERE id='osm-node-109'").get() as { row_id: number } | undefined;
  if (row) {
    database.prepare("DELETE FROM bench_panorama_lightmaps WHERE bench_row_id=?").run(row.row_id);
    database.prepare("DELETE FROM bench_panorama_renders WHERE bench_row_id=?").run(row.row_id);
    database.prepare("DELETE FROM bench_panorama_geometry WHERE bench_row_id=?").run(row.row_id);
    database.prepare("DELETE FROM bench_panorama_requests WHERE bench_row_id=?").run(row.row_id);
    database.prepare("UPDATE benches SET covered=0 WHERE row_id=?").run(row.row_id);
  }
  database.close();
});

function setCoveredFixture() {
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  database.prepare("UPDATE benches SET covered=1 WHERE id='osm-node-109'").run();
  database.close();
}

test("starts in bench direction and pans the panorama in both axes on mobile", async ({ page }, testInfo) => {
  // The first navigation lets the isolated test server migrate and seed its DB.
  await page.goto("/");
  setCoveredFixture();
  await page.goto("/?bank=osm-node-109");
  await expect(page.locator(".bench-panorama-placeholder")).toBeVisible();
  installPanoramaFixture("osm-node-109", true);

  const panorama = page.locator(".bench-panorama");
  // A panorama completed by the worker appears in the open detail without a reload.
  await expect(panorama).toBeVisible({ timeout: 7_000 });
  await expect(page.locator(".desktop-sheet")).toHaveAttribute("data-snap", "half");
  await expect(panorama.locator(".bench-panorama-shelter")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("panorama-overlay-half.png") });
  const bearing = panorama.locator(".bench-panorama-bearing");
  await expect(bearing).toHaveText("325°");
  await expect(panorama.getByRole("slider")).toHaveCount(0);
  const image = page.locator(".bench-panorama-art").first();
  await expect(image).toHaveJSProperty("complete", true);
  await panorama.screenshot({ path: testInfo.outputPath("panorama-mobile-initial.png") });

  const viewport = page.locator(".bench-panorama-viewport");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const before = await page.locator(".bench-panorama-track").getAttribute("style");
  await page.mouse.move(box!.x + box!.width * .7, box!.y + box!.height * .65);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .32, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator(".bench-panorama-track").getAttribute("style");
  expect(after).not.toBe(before);
  expect(after).not.toContain("--panorama-y: 0px");
  await expect(bearing).not.toHaveText("325°");

  await viewport.focus();
  await viewport.press("Home");
  await expect(bearing).toHaveText("325°");
  for (let index = 0; index < 65; index++) await viewport.press("ArrowLeft");
  await expect(bearing).toHaveText("0°");
  await viewport.press("ArrowLeft");
  await expect(bearing).toHaveText("355°");
  await panorama.screenshot({ path: testInfo.outputPath("panorama-mobile-rotated.png") });
});
