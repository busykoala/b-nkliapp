import { expect, test } from "@playwright/test";

test("discovers the rotating statistics and opens a municipality portrait", async ({ page }) => {
  await page.goto("/statistiken");
  await expect(page.getByRole("heading", { name: "Institut für angewandte Bänklilogie" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bänkli des Tages" })).toBeVisible();
  await expect(page.locator(".record-grid article")).toHaveCount(4);
  await expect(page.getByText("r =", { exact: false })).toBeVisible();

  const municipality = page.locator(".municipality-table a").first();
  await expect(municipality).toBeVisible();
  await municipality.click();
  await expect(page).toHaveURL(/\/gemeinde\/\d+$/);
  await expect(page.getByText("Bänkli in Zahlen", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bänkli-Datenaudit" })).toBeVisible();
});

test("statistics stay readable at a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/statistiken");
  await expect(page.locator(".statistics-hero")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
