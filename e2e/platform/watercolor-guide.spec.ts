import { expect, test } from "@playwright/test";
import { installTerrainPanoramaFixture } from "../support/panorama-fixture";

test.use({ serviceWorkers: "block", deviceScaleFactor: 1 });

test("keeps a complete lyrical passage mounted through live refresh, panorama and visit details", async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await installTerrainPanoramaFixture("osm-node-101");
  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  const poem = sheet.locator(".bench-poem");
  const text = await poem.textContent();
  expect(text!.length).toBeGreaterThan(30);
  await poem.evaluate(node => { (node as HTMLElement).dataset.retained = "yes"; });
  const hints = sheet.locator("[data-visit-hint]");
  expect(await hints.count()).toBeLessThanOrEqual(3);
  await expect(sheet.locator(".bench-overview")).not.toContainText(/°C|Bergblick|noch nicht erfasst/);
  await expect(sheet.locator(".bench-actions > button")).toHaveCount(2);
  const details = sheet.locator(".bench-visit-details > details");
  await expect(details).toHaveCount(1);
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator(":scope > summary").click();
  await expect(details.getByRole("heading", { name: "Wetter & Sonne", exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "Bänkli teilen", exact: true })).toBeVisible();
  await details.locator(":scope > summary").click();
  await Promise.all([
    page.waitForResponse(response => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"])),
    page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))),
  ]);
  await expect(poem).toHaveAttribute("data-retained", "yes");
  await expect(poem).toHaveText(text!);
  await sheet.locator(".bench-panorama-expand").click();
  const panorama = page.getByRole("dialog", { name: "360-Grad-Himmel und Landschaft" });
  await expect(panorama).toBeVisible();
  const viewport = panorama.locator(".bench-panorama-viewport");
  expect(await viewport.evaluate(node => getComputedStyle(node).maskImage)).toBe("none");
  await page.keyboard.press("Escape");
  await expect(poem).toHaveText(text!);
  await page.screenshot({ path: info.outputPath("poetry-and-visit.png") });
});

test("keeps secondary filters closed while retaining selected preferences", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Filter öffnen" }).click();
  const panel = page.locator(".calm-filter-panel");
  await expect(panel.getByRole("button", { name: "Rückenlehne", exact: true })).toBeVisible();
  const shelter = panel.getByRole("button", { name: "Überdacht", exact: true });
  await expect(shelter).toBeHidden();
  await panel.locator(".filter-more > summary").click();
  await shelter.click();
  await expect(shelter).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Karte ansehen" }).click();
  await page.getByRole("button", { name: /Filter öffnen/ }).click();
  await panel.locator(".filter-more > summary").click();
  await expect(shelter).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("secondary-filters.png") });
});

test("keeps the illustrated menu and filter usable on a small enlarged-text screen", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  const menu = page.locator(".app-menu-sheet");
  await menu.locator(".app-menu-reading").scrollIntoViewIfNeeded();
  await expect(menu.locator(".app-menu-reading .atlas-drawing")).toBeVisible();
  expect(await menu.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("menu-200-reading.png") });
  await page.getByRole("button", { name: "Menü schliessen" }).click();
  await page.getByRole("button", { name: "Filter öffnen" }).click();
  const filters = page.locator(".calm-filter-panel");
  const backrest = filters.getByRole("button", { name: "Rückenlehne", exact: true });
  await backrest.click();
  await expect(backrest).toHaveAttribute("aria-pressed", "true");
  const box = await backrest.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await backrest.scrollIntoViewIfNeeded();
  const label=backrest.locator(".filter-name");
  const labelLines=await label.evaluate(node=>node.getBoundingClientRect().height/parseFloat(getComputedStyle(node).lineHeight));
  expect(labelLines).toBeLessThanOrEqual(1.05);
  await page.screenshot({ path: info.outputPath("filter-200-choices.png") });
  await filters.locator(".filter-more > summary").click();
  await filters.locator(".filter-material select").selectOption("wood");
  expect(await filters.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  expect(await filters.locator(".filter-scroll").evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  for (const overflow of await filters.locator(".filter-actions > button").evaluateAll(buttons => buttons.map(button => button.scrollWidth - button.clientWidth))) {
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath("illustrated-small-large-text.png") });
  await filters.getByRole("button", { name: "Karte ansehen" }).click();
  await expect(page.locator(".calm-filter-panel")).toHaveCount(0);
});
