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
  await expect(page.locator(".desktop-sheet")).toHaveAttribute("data-snap", "full");
  installPanoramaFixture("osm-node-109", true);

  const panorama = page.locator(".bench-panorama");
  // A panorama completed by the worker appears in the open detail without a reload.
  await expect(panorama).toBeVisible({ timeout: 7_000 });
  await expect(page.locator(".desktop-sheet")).toHaveAttribute("data-snap", "full");
  await expect(panorama.locator(".bench-panorama-shelter")).toBeVisible();
  await expect(panorama.locator(".bench-panorama-ground-patch").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("panorama-overlay-full.png") });
  const bearing = panorama.locator(".bench-panorama-bearing");
  await expect(bearing).toHaveText("325°");
  await expect(panorama.getByRole("slider")).toHaveCount(0);
  const zoom = panorama.locator(".bench-panorama-zoom-controls span");
  await expect(zoom).toHaveText("1.0×");
  const image = page.locator(".bench-panorama-art").first();
  await expect(image).toHaveJSProperty("complete", true);
  // Read the three rectangles in one browser task. The light-map poll can
  // replace the figure between separate WebKit boundingBox calls, which made
  // this purely visual assertion intermittently observe a detached element.
  const layout = await panorama.evaluate((element) => {
    const ground = element.querySelector<HTMLElement>(".bench-panorama-ground-patch");
    const bench = element.querySelector<HTMLElement>(".bench-panorama-rear-bench");
    if (!ground || !bench) return null;
    const panoramaBox = element.getBoundingClientRect();
    const groundBox = ground.getBoundingClientRect();
    const benchBox = bench.getBoundingClientRect();
    return {
      panorama: { width: panoramaBox.width, height: panoramaBox.height, y: panoramaBox.y },
      ground: { width: groundBox.width, height: groundBox.height, y: groundBox.y },
      bench: { width: benchBox.width, height: benchBox.height, y: benchBox.y },
    };
  });
  expect(layout).not.toBeNull();
  expect(layout!.ground.width).toBeGreaterThan(layout!.bench.width);
  // A broad, low soil wash reaches past both crop edges so lake-facing
  // benches have land under their legs without a visible oval island.
  expect(layout!.ground.width).toBeGreaterThan(layout!.panorama.width);
  expect(layout!.ground.y).toBeGreaterThan(layout!.panorama.y + layout!.panorama.height * .75);
  expect(layout!.ground.height).toBeLessThan(layout!.panorama.height * .25);
  expect(layout!.bench.width).toBeLessThan(layout!.panorama.width * .62);
  expect(layout!.bench.y + layout!.bench.height).toBeGreaterThan(layout!.panorama.y + layout!.panorama.height * .9);
  await panorama.screenshot({ path: testInfo.outputPath("panorama-mobile-initial.png") });

  const viewport = page.locator(".bench-panorama-viewport");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const before = await page.locator(".bench-panorama-track").getAttribute("style");
  // Mobile WebKit has no mouse wheel. Double-tap/double-click exercises the
  // same touch-friendly zoom affordance on every configured browser.
  await viewport.dblclick({ position: { x: box!.width * .5, y: box!.height * .5 } });
  await expect(zoom).not.toHaveText("1.0×");
  await page.mouse.move(box!.x + box!.width * .7, box!.y + box!.height * .65);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .32, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator(".bench-panorama-track").getAttribute("style");
  expect(after).not.toBe(before);
  expect(after).not.toContain("--panorama-y: 0px");
  const vertical = Number(after?.match(/--panorama-y:\s*(-?[\d.]+)px/)?.[1]);
  expect(Math.abs(vertical)).toBeGreaterThan(45);
  await expect(bearing).not.toHaveText("325°");
  await expect(panorama.locator(".bench-panorama-foreground .bench-panorama-rear-bench")).toBeVisible();
  await panorama.locator(".bench-panorama-zoom-controls button").last().click();
  await expect(zoom).not.toHaveText("1.6×");

  await viewport.focus();
  await viewport.press("Home");
  await expect(zoom).toHaveText("1.0×");
  await expect(bearing).toHaveText("325°");
  for (let index = 0; index < 65; index++) await viewport.press("ArrowLeft");
  await expect(bearing).toHaveText("0°");
  await viewport.press("ArrowLeft");
  await expect(bearing).toHaveText("355°");
  await panorama.screenshot({ path: testInfo.outputPath("panorama-mobile-rotated.png") });
});
