import { expect, test } from "@playwright/test";

test("opens a separate calm walk planner without requesting location or routing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = () => { throw new Error("Unexpected location request"); }; });
  await page.goto("/");
  await page.getByRole("button", { name: "Spaziergang entdecken", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Spaziergang entdecken" });
  await expect(panel).toBeVisible();
  await page.getByLabel("Spaziergang vergrössern oder verkleinern").click();
  await expect(panel.getByRole("button", { name: "ca. 50 min" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("button", { name: "Mein Bänkli entdecken" })).toBeDisabled();
  await expect(panel.getByRole("combobox", { name: "Schwierigkeit" })).not.toBeVisible();
  await panel.getByRole("button", { name: "Einfache Strecke", exact: true }).click();
  await expect(panel.getByText(/Keine Zusage zu Barrierefreiheit/)).not.toBeVisible();
  const notes = panel.locator("summary").filter({ hasText: "Gut zu wissen" });
  await notes.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText(/Keine Zusage zu Barrierefreiheit/)).toBeVisible();
  await expect(panel.getByRole("link", { name: "Datenquellen & Danksagung" })).toHaveAttribute("href", "/danke");
  await notes.click();
  await panel.locator("summary").filter({ hasText: "Anpassen" }).click();
  await expect(panel.getByRole("combobox", { name: "Schwierigkeit" })).toHaveValue("easy");
  await panel.getByLabel("Spaziergang schliessen").click();
  await expect(panel).toHaveCount(0);
});

test("denied walk location leaves address fallback and preserves privacy", async ({ page }) => {
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); });
  await page.goto("/");
  await page.getByRole("button", { name: "Spaziergang entdecken", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Spaziergang entdecken" });
  await panel.getByRole("button", { name: "Mein Standort", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Standort nicht verfügbar");
  await panel.getByRole("combobox", { name: "Start: Adresse oder Haltestelle" }).fill("Bern");
  await expect(panel.getByRole("option", { name: "Bern Haltestelle" })).toBeVisible();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(panel.locator(".journey-start-summary")).toContainText("Bern");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("46.949");
  expect(page.url()).not.toContain("46.949");
});

test("shows a Bänkli-centred route and opens a private return journey", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Spaziergang entdecken", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Spaziergang entdecken" });
  await panel.getByLabel("Spaziergang vergrössern oder verkleinern").click();
  await panel.getByRole("combobox", { name: "Start: Adresse oder Haltestelle" }).fill("Zürich");
  await panel.getByRole("option", { name: "Bahnhofplatz 1, Zürich Adresse" }).click();
  await panel.getByRole("button", { name: "Einfache Strecke", exact: true }).click();
  await panel.getByRole("button", { name: "Mein Bänkli entdecken", exact: true }).click();
  const route = panel.getByRole("region", { name: "Dein Spaziergang" });
  await expect(route).toBeVisible({ timeout: 18000 });
  await expect(route.getByRole("heading", { name: /Ein Spaziergang zum/ })).toBeVisible();
  await expect(route.getByText(/Landschaftsdaten noch unvollständig/)).not.toBeVisible();
  await expect(panel.getByText(/Leichte Wege nach verfügbaren Kartendaten/)).not.toBeVisible();
  await route.screenshot({ path: info.outputPath("walk-bench-journal.png") });
  const explanation = route.locator("summary").filter({ hasText: "Warum dieser Vorschlag?" });
  await explanation.click();
  await expect(route.getByText(/Landschaftsdaten noch unvollständig/)).toBeVisible();
  await explanation.click();
  await route.getByRole("button", { name: "Rückweg planen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dein Rückweg" })).toBeVisible();
  expect(page.url()).not.toContain("47.378");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("47.378");
  expect(errors).toEqual([]);
});
