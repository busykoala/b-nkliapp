import { expect, test } from "@playwright/test";

test("opens the mobile map and a bench detail", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toBeVisible();
  await expect(page.getByLabel("Ort suchen")).toBeVisible();
  await expect(page.getByText("Finde deinen Lieblingsplatz")).toBeVisible();
});

test("location denial leaves the map usable", async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto("/");
  await page.getByLabel("Meinen Standort anzeigen").click();
  await expect(page.getByLabel("Ort suchen")).toBeEnabled();
});

test("publishes an anonymous rating and correction immediately", async ({ page }) => {
  await page.goto("/bank/osm-node-101");
  await page.getByRole("tab", { name: /Community/ }).click();
  await page.getByLabel("Gesamt bewerten").selectOption("5");
  await page.getByLabel("Aussicht bewerten").selectOption("4");
  await page.getByLabel("Komfort bewerten").selectOption("4");
  await page.getByLabel("Ruhe bewerten").selectOption("5");
  await page.getByPlaceholder("Was hat dir gefallen?").fill("Playwright-Testbewertung");
  await page.getByRole("button", { name: "Bewertung veröffentlichen" }).click();
  await expect(page.getByText("Danke – deine Bewertung ist sichtbar.")).toBeVisible();

  await page.getByLabel("Was stimmt nicht?").selectOption("condition");
  await page.getByPlaceholder("Zum Beispiel: Rückenlehne fehlt").fill("Sitzfläche beschädigt");
  await page.getByRole("button", { name: "Hinweis veröffentlichen" }).click();
  await expect(page.getByText("Danke – dein Hinweis wurde veröffentlicht.")).toBeVisible();
});

test("opens the password-protected moderation view", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Passwort").fill("benchly-admin");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Benchly Moderation" })).toBeVisible();
  await expect(page.getByText("Playwright-Testbewertung").first()).toBeVisible();
});
