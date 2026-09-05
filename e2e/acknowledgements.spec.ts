import { expect, test } from "@playwright/test";

test("opens catalog-driven thanks, sources and refreshes", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("link", { name: "Danke und Datenquellen" }).click();
  await expect(page).toHaveURL(/\/danke$/);
  await expect(page.getByRole("heading", { name: "Danke fürs Bänkli." })).toBeVisible();
  for (const name of ["Stephan", "Matthias", "Jonas", "Community", "GraphHopper"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("stündlich", { exact: true })).toBeVisible();
  await expect(page.locator(".refresh-list details")).toHaveCount(14);
});

