import { expect, test } from "@playwright/test";

test("opens catalog-driven thanks, sources and refreshes", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("link", { name: "Danke und Daten" }).click();
  await expect(page).toHaveURL(/\/danke$/);
  await expect(page.getByRole("heading", { name: "Danke fürs Bänkli." })).toBeVisible();
  for (const name of ["Stephan", "Matthias", "Jonas", "Community", "GraphHopper", "Qwen3-VL 8B · Bänkli Vision"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("in Prüfung", { exact: false })).toHaveCount(0);
  await expect(page.getByText(/Geprüft, aber nicht produktiv genutzt/)).toBeVisible();
  await page.locator(".source-card").filter({ hasText: "Qwen3-VL 8B · Bänkli Vision" }).screenshot({ path: testInfo.outputPath("inference-model-source.png") });
  await expect(page.getByText(/^stündlich/)).toBeVisible();
  await expect(page.locator(".refresh-list details")).toHaveCount(21);
  await page.locator(".refresh-list details").first().locator("summary").click();
  await expect(page.getByText(/Noch kein erfolgreicher Lauf gemeldet|Stand/).first()).toBeVisible();
});
