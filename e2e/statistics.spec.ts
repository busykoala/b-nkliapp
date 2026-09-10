import { expect, test } from "@playwright/test";

test("discovers the rotating statistics and opens a municipality portrait", async ({ page }) => {
  await page.goto("/statistiken");
  await expect(page.getByRole("heading", { name: "Institut für angewandte Bänklilogie" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bänkli des Tages" })).toBeVisible();
  await expect(page.locator(".statistics-totals")).toContainText("12 vollständig landschaftlich analysiert");
  await expect(page.locator(".statistics-totals")).toContainText("12 amtlich einer Gemeinde zugeordnet");
  await expect(page.locator(".record-grid article")).toHaveCount(4);
  await expect(page.locator(".lab-sticker")).toContainText("r =");
  await expect(page.locator(".lab-months a")).toHaveCount(12);
  await expect(page.getByRole("heading", { name: "Ziehen Alpakas zusätzliche Bänkli an?" })).toBeVisible();
  await expect(page.locator(".lab-trend")).toBeVisible();
  await expect(page.locator(".box-group")).toHaveCount(4);
  await expect(page.locator(".municipality-density").first()).toContainText("1'000");

  await page.locator('.lab-months a[href="/statistiken?lab=12"]').click();
  await expect(page.getByRole("heading", { name: "Wird Holz geerntet, wo Bänkli stehen?" })).toBeVisible();

  const municipality = page.locator(".municipality-table a").first();
  await expect(municipality).toBeVisible();
  await municipality.click();
  await expect(page).toHaveURL(/\/gemeinde\/\d+$/);
  await expect(page.getByText("Bänkli in Zahlen", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bänkli-Datenaudit" })).toBeVisible();
});

test("statistics stay readable at a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/statistiken");
  await expect(page.locator(".statistics-hero")).toBeVisible();
  // Linux WebKit reserves a 15px classic scrollbar inside clientWidth. Compare
  // against the CSS viewport so a vertical scrollbar is not reported as
  // horizontal content overflow (macOS uses overlay scrollbars and hid this).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const clippedLabels = await page.locator(".statistics-totals dt, .statistics-totals dd, .daily-bench-link strong, .daily-bench-link small, .municipality-table strong, .municipality-table small, .municipality-table em").evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent));
  expect(clippedLabels).toEqual([]);
});
