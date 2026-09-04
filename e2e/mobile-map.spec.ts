import { expect, test } from "@playwright/test";

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", { name: "Neu hier? Konto erstellen" }).click();
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.getByLabel("Menü öffnen").click();
  await expect(page.getByText("Mein Profil")).toBeVisible();
  await page.getByLabel("Menü schliessen").click();
}

test("opens the mobile map and a bench detail", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toBeVisible();
  await expect(page.getByLabel("Ort suchen")).toBeVisible();
  await expect(page.getByLabel("Menü öffnen")).toBeVisible();
});

test("centers near the user only after an explicit location action", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 8.5417, latitude: 47.3769 });
  await page.goto("/");
  await page.getByLabel("Meinen Standort anzeigen").click();
  await expect(page.getByText(/Standort auf etwa/)).toBeVisible();
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
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("button", { name: "App installieren" }).click();
  await expect(page.getByText(/Zum Home-Bildschirm/)).toBeVisible();
});

test("location denial leaves the map usable", async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto("/");
  await page.getByLabel("Meinen Standort anzeigen").click();
  await expect(page.getByLabel("Ort suchen")).toBeEnabled();
});

test("keeps browsing public but requires an account for contributions", async ({ page }) => {
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: /Noch unbewertet|Bewertung .* von 5|Deine Bewertung/ }).click();
  await expect(page.getByText("Zum Mitmachen kurz anmelden")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bewertung veröffentlichen" })).toHaveCount(0);
});

test("registers and writes a rating plus structured bench metadata", async ({ page, browserName }) => {
  await registerUser(page, `writer-${browserName}`);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: /Noch unbewertet|Bewertung .* von 5|Deine Bewertung/ }).click();
  await page.getByLabel("Gesamt bewerten").selectOption("5");
  await page.getByLabel("Aussicht bewerten").selectOption("4");
  await page.getByLabel("Komfort bewerten").selectOption("4");
  await page.getByLabel("Ruhe bewerten").selectOption("5");
  await page.getByPlaceholder("Was hat dir hier gefallen?").fill("Playwright-Testbewertung");
  await page.getByRole("button", { name: "Bewertung veröffentlichen" }).click();
  await expect(page.getByText("Danke – deine Bewertung ist sichtbar.")).toBeVisible();
  await page.getByRole("button", { name: "Zum Platz" }).click();
  await page.getByRole("tab", { name: "Bank" }).click();
  await page.getByRole("button", { name: /Armlehnen/ }).click();
  await page.getByRole("button", { name: "Ja", exact: true }).click();
  await expect(page.getByRole("button", { name: /Armlehnen Ja/ })).toBeVisible();
});

test("lets an authenticated user add an unverified Bänkli", async ({ page, browserName }) => {
  await registerUser(page, `scout-${browserName}`);
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Bänkli eintragen").click();
  await page.getByLabel("Name").fill("Das Testbänkli");
  await page.getByLabel("Widmung").fill("Für alle müden Tests");
  await page.getByRole("button", { name: "Eintragen", exact: true }).click();
  await expect(page.getByText(/noch 2 Bestätigungen/)).toBeVisible();
  await page.waitForTimeout(900);
  await page.getByLabel("Ort suchen").fill("Das Testbänkli");
  await expect(page.getByRole("button", { name: /Das Testbänkli/ })).toBeVisible();
});

test("shows useful sun and view information before terrain enrichment", async ({ page }) => {
  await page.goto("/bank/osm-node-101");
  await expect(page.getByRole("figure")).toBeVisible();
  await page.getByRole("tab", { name: "Licht" }).click();
  await expect(page.getByText(/Direkte Sonne|Geschätzte Sonne/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Aussicht" }).click();
  await expect(page.getByText("Was den Horizont prägt")).toBeVisible();
  await expect(page.getByText("Durchs Jahr")).toHaveCount(0);
});

test("opens the password-protected moderation view", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Passwort").fill("benchly-admin");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Bänkli App Moderation" })).toBeVisible();
});
