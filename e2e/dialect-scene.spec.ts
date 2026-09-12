import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

test("keeps most of the map visible and carries the local voice between benches", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("combobox", { name: "Ortsstimme" }).selectOption("playful");
  await page.screenshot({ path: testInfo.outputPath("local-voice-menu.png") });
  await page.getByLabel("Menü schliessen").click();

  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(sheet).toHaveAttribute("data-snap", "half");
  const collapsed = await sheet.boundingBox();
  expect(collapsed?.y).toBeGreaterThan(844 * .58);
  await expect(sheet.locator("h2").first()).toBeInViewport();
  await expect(sheet.getByText("Züridütsch", { exact: false })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath("map-first-local-preview.png") });

  await sheet.locator(".overlay-resize").click();
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(sheet.locator(".landscape-light-badge")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("zurich-local-scene.png") });
  await sheet.locator(".scene-caption").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("zurich-playful-voice.png") });

  await page.goto("/bank/osm-node-102");
  await expect(page.getByText("Bärndütsch", { exact: false })).toBeVisible();
  await expect(page.locator(".scene-caption")).toContainText(/Premium-Lounge|Tempo/);
});

test("draws direct sun and cast shade as visibly different scene layers", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/bank/osm-node-101");
  let scene = page.locator(".bench-landscape");
  await expect(scene.locator('[data-light-layer="sun"]')).toBeVisible();
  await expect(scene.locator(".landscape-light-badge.is-sunny")).toBeVisible();
  await scene.screenshot({ path: testInfo.outputPath("scene-direct-sun.png") });

  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    database.prepare("UPDATE benches SET covered=1 WHERE id='osm-node-112'").run();
    await page.goto("/bank/osm-node-112");
    scene = page.locator(".bench-landscape");
    await expect(scene.locator('[data-light-layer="shade"]')).toBeVisible();
    await expect(scene.locator(".landscape-light-badge.is-shade")).toBeVisible();
    await scene.screenshot({ path: testInfo.outputPath("scene-cast-shade.png") });
  } finally {
    database.prepare("UPDATE benches SET covered=0 WHERE id='osm-node-112'").run();
    database.close();
  }
});
