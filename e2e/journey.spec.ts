import { expect, test, type Page } from "@playwright/test";

async function openPlanner(page: Page) {
  await page.goto("/?bank=osm-node-101");
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-map-ready", "true", { timeout: 8000 });
  await page.getByLabel("Detailhöhe ändern").click();
  await page.getByRole("button", { name: "Weg hierher" }).click();
  const journal = page.getByRole("complementary", { name: "Dein Weg zum Bänkli" });
  await expect(journal).toBeVisible();
  await page.getByLabel("Reiseplan vergrössern oder verkleinern").click();
  return journal;
}

test("opens a lazy illustrated planner and returns to the selected bench", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const journal = await openPlanner(page);
  await expect(journal.getByRole("heading", { name: "Dein Weg zum Bänkli" })).toBeVisible();
  await expect(journal.getByRole("button", { name: "Meinen Weg finden" })).toBeDisabled();
  await expect(journal.getByRole("button", { name: /Gemütlich/ })).not.toBeVisible();
  await journal.locator("summary").filter({ hasText: "Anpassen" }).click();
  await journal.getByRole("button", { name: /Gemütlich/ }).click();
  await expect(journal.getByText(/500 m in etwa 10 min/)).toBeVisible();
  await journal.getByRole("button", { name: "+6 min", exact: true }).click();
  await expect(journal.getByRole("button", { name: "+6 min", exact: true })).toHaveAttribute("aria-pressed", "true");
  await journal.screenshot({ path: info.outputPath("journey-journal.png") });
  await page.getByLabel("Reiseplan schliessen").click();
  await expect(page.getByLabel("Bankdetails")).toBeVisible();
  await expect(journal).toHaveCount(0);
});

test("denied journey location leaves address input and map usable", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_success, failure) => failure?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  });
  await page.route("https://vectortiles.geo.admin.ch/styles/**", (route) => route.abort());
  const journal = await openPlanner(page);
  await journal.getByRole("button", { name: "Mein Standort", exact: true }).click();
  await expect(journal.getByRole("status")).toContainText("Standort nicht verfügbar");
  await expect(journal.getByRole("combobox", { name: "Start: Adresse oder Haltestelle" })).toBeEnabled();
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-basemap", "fallback");
});

test("uses location only on request and keeps origins out of storage and URLs", async ({ page, context, browserName }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 47.3769, longitude: 8.5417 });
  const journal = await openPlanner(page);
  await journal.getByRole("button", { name: "Mein Standort", exact: true }).click();
  await expect(journal.locator(".journey-start-summary")).toContainText("Mein Standort");
  await journal.getByRole("button", { name: "Nur zu Fuss", exact: true }).click();
  await expect(journal.getByRole("button", { name: "Meinen Weg finden" })).toBeEnabled();
  expect(page.url()).not.toContain("47.3769");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("47.3769");
  // No route is submitted here: browser tests never load the public walking service.
  await journal.getByRole("button", { name: "Ändern", exact: true }).click();
  await journal.getByRole("combobox", { name: "Start: Adresse oder Haltestelle" }).focus();
  // Safari's native full keyboard navigation uses Option-Tab for buttons.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(journal.getByRole("button", { name: "Mein Standort", exact: true })).toBeFocused();
});

test("draws a complete journal with real-provider-shaped walking and transfer data", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const journal = await openPlanner(page);
  await journal.getByRole("combobox", { name: "Start: Adresse oder Haltestelle" }).fill("Bern");
  await expect(journal.getByRole("option", { name: "Bern Haltestelle" })).toBeVisible();
  await expect(journal.getByRole("option", { name: "Bahnhofplatz 1, Zürich Adresse" })).toBeVisible();
  // Keyboard selection chooses the exact station, not a silently resolved address.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await journal.getByRole("button", { name: "Meinen Weg finden" }).click();
  const connections = journal.getByRole("region", { name: "Deine Verbindungen" });
  await expect(connections).toBeVisible({ timeout: 18000 });
  await expect(connections.getByText("Verlauf schematisch", { exact: false }).first()).toBeVisible();
  await expect(connections.getByText("Ein Stück zu Fuss", { exact: true })).toHaveCount(2);
  await expect(connections.getByText(/32 statt 31/)).toBeVisible();
  await connections.locator("summary").filter({ hasText: "Viel Luft" }).click();
  await expect(connections.getByText(/Es zählt die grössere Zeit/)).toBeVisible();
  await connections.getByRole("button", { name: /Ein Stück zu Fuss/ }).last().click();
  await journal.screenshot({ path: info.outputPath("journey-transfer-chapters.png") });
  expect(errors).toEqual([]);
});
