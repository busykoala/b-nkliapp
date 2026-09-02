import { expect, test } from "@playwright/test";

test("opens the mobile map and a bench detail", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toBeVisible();
  await expect(page.getByLabel("Ort suchen")).toBeVisible();
  await expect(page.getByText("Schöne Plätze in meiner Nähe")).toBeVisible();
});

test("centers near the user only after an explicit location action", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 8.5417, latitude: 47.3769 });
  await page.goto("/");
  await page.getByText("Schöne Plätze in meiner Nähe").click();
  await expect(page.getByText("Schöne Plätze in meiner Nähe")).toBeHidden();
  await expect(page.getByText(/Plätze/).first()).toBeVisible();
});

test("publishes an installable portrait PWA manifest", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.orientation).toBe("portrait-primary");
  expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ sizes: "192x192" }), expect.objectContaining({ purpose: "maskable" })]));
});

test("explains iOS Home Screen installation after location engagement", async ({ page, context, browserName }) => {
  test.skip(browserName !== "webkit", "Safari-specific installation guidance");
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 8.5417, latitude: 47.3769 });
  await page.goto("/");
  await page.getByText("Schöne Plätze in meiner Nähe").click();
  await expect(page.getByLabel("Benchly installieren")).toBeVisible();
  await page.getByRole("button", { name: "Installieren" }).click();
  await expect(page.getByText(/Zum Home-Bildschirm/)).toBeVisible();
});

test("location denial leaves the map usable", async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto("/");
  await page.getByLabel("Meinen Standort anzeigen").click();
  await expect(page.getByLabel("Ort suchen")).toBeEnabled();
});

test("publishes an anonymous rating and correction immediately", async ({ page }) => {
  await page.goto("/bank/osm-node-101");
  await page.getByRole("tab", { name: /Stimmen/ }).click();
  await page.getByLabel("Gesamt bewerten").selectOption("5");
  await page.getByLabel("Aussicht bewerten").selectOption("4");
  await page.getByLabel("Komfort bewerten").selectOption("4");
  await page.getByLabel("Ruhe bewerten").selectOption("5");
  await page.getByPlaceholder("Was hat dir hier gefallen?").fill("Playwright-Testbewertung");
  await page.getByRole("button", { name: "Bewertung veröffentlichen" }).click();
  await expect(page.getByText("Danke – deine Bewertung ist sichtbar.")).toBeVisible();

  await page.getByLabel("Was stimmt nicht?").selectOption("condition");
  await page.getByPlaceholder("Zum Beispiel: Die Rückenlehne fehlt").fill("Sitzfläche beschädigt");
  await page.getByRole("button", { name: "Hinweis veröffentlichen" }).click();
  await expect(page.getByText("Danke – dein Hinweis wurde veröffentlicht.")).toBeVisible();
});

test("shows useful sun and view information before terrain enrichment", async ({ page }) => {
  await page.goto("/bank/osm-node-101");
  await expect(page.getByText("Licht & Schatten")).toBeVisible();
  await expect(page.getByText("Schatten: Nacht", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Wie wir das Licht einschätzen/)).toBeVisible();
  await expect(page.getByText(/Aussicht/).first()).toBeVisible();
});

test("opens the password-protected moderation view", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Passwort").fill("benchly-admin");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Benchly Moderation" })).toBeVisible();
  await expect(page.getByText("Playwright-Testbewertung").first()).toBeVisible();
});
