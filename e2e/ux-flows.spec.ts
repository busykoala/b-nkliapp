import { expect, test, type Page } from "@playwright/test";

async function registerInOpenDialog(page: Page, prefix: string) {
  const account = page.getByRole("dialog", { name: "Willkommen zurück" });
  await account.getByRole("button", { name: "Neu hier? Konto erstellen" }).click();
  const signup = page.getByRole("dialog", { name: "Dein Bänkli-Konto" });
  await signup.getByLabel("Benutzername").fill(`${prefix}-${Date.now().toString(36)}`);
  await signup.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await signup.getByRole("button", { name: "Konto erstellen", exact: true }).click();
}

test("filters are beside search and removable after the panel closes", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Filter öffnen" }).click();
  const panel = page.getByRole("dialog", { name: "Was brauchst du?" });
  await panel.getByRole("button", { name: "Rückenlehne", exact: true }).click();
  await panel.getByRole("button", { name: "Sonne", exact: true }).click();
  await panel.getByRole("button", { name: "Karte ansehen" }).click();
  await expect(page.getByRole("button", { name: "Rückenlehne entfernen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sonne geschätzt entfernen" })).toBeVisible();
  await page.getByRole("button", { name: "Rückenlehne entfernen" }).click();
  await expect(page.getByRole("button", { name: "Rückenlehne entfernen" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("persistent-filters.png") });
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  const items = await page.getByRole("navigation", { name: "Hauptnavigation" }).locator(":scope > a, :scope > button").allTextContents();
  expect(items.slice(0, 4).map((text) => text.trim())).toEqual(["Bänkli eintragen", "Spaziergang", "Bänkli-Feed", "Anmelden"]);
});

test("guest rating resumes directly into four tap controls after authentication", async ({ page }, info) => {
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: /Noch unbewertet|Bewertung .* von 5|Deine Bewertung/ }).click();
  await registerInOpenDialog(page, `rate-${info.project.name.slice(-3)}`);
  const rating = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });
  await expect(rating.getByRole("group", { name: "Gesamt", exact: true })).toBeVisible();
  for (const label of ["Gesamt", "Aussicht", "Komfort", "Ruhe"]) await rating.getByRole("group", { name: label, exact: true }).getByRole("radio", { name: "4 Sterne" }).check();
  await rating.getByRole("button", { name: "Bewertung veröffentlichen" }).click();
  await expect(rating.getByText("Danke – deine Bewertung ist sichtbar.")).toBeVisible();
  await rating.getByRole("button", { name: "Beiträge schliessen" }).click();
  await expect(page.getByRole("region", { name: "Auf einen Blick" }).getByText(/Ruhe [0-9.]+\/5/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("bench-summary.png"), fullPage: true });
});

test("guest adding resumes into pin placement, catches neighbours and opens the saved bench without navigation", async ({ page, context }, info) => {
  await page.goto("/?bank=osm-node-101");
  await expect(page.getByRole("heading", { name: /Lindenhof/ })).toBeVisible();
  await page.getByRole("button", { name: "Bank schliessen" }).click();
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  await page.getByRole("button", { name: "Bänkli eintragen" }).click();
  await registerInOpenDialog(page, `add-${info.project.name.slice(-3)}`);
  await expect(page.getByRole("heading", { name: "Position wählen" })).toBeVisible();
  await expect(page.locator(".placement-crosshair")).toBeVisible();
  await context.setGeolocation({ latitude: 47.37674, longitude: 8.54183 });
  await context.grantPermissions(["geolocation"]);
  await page.getByRole("button", { name: "Meinen Standort verwenden" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Standort auf etwa/ })).toBeVisible();
  await page.getByRole("button", { name: "Hier eintragen" }).click();
  const dialog = page.getByRole("dialog", { name: "Bänkli eintragen", exact: true });
  await expect(dialog.getByRole("region", { name: "Bänkli in der Nähe" })).toContainText("Lindenhof");
  await expect(dialog.getByRole("button", { name: "Eintragen", exact: true })).toBeDisabled();
  await dialog.getByLabel("Geprüft: Meins ist ein weiteres Bänkli.").check();
  const title = `UX-Bänkli ${info.project.name} ${Date.now()}`;
  await dialog.getByLabel("Name", { exact: false }).fill(title);
  await page.evaluate(() => { (window as Window & { uxMarker?: boolean }).uxMarker = true; });
  await dialog.getByRole("button", { name: "Eintragen", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Bänkli eingetragen · noch 2 Bestätigungen")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Was kannst du noch ergänzen?" })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { uxMarker?: boolean }).uxMarker)).toBe(true);
  await page.goto("/profil");
  const impact = page.getByRole("heading", { name: "Kleine Dinge, die helfen" });
  const collection = page.getByRole("heading", { name: "Was du schon gefunden hast" });
  expect((await impact.boundingBox())!.y).toBeLessThan((await collection.boundingBox())!.y);
  await expect(page.getByRole("heading", { name: "Warten auf Bestätigung" })).toBeVisible();
  await expect(page.locator(".profile-pending").getByText(title)).toBeVisible();
});

test("freshness can be renewed inline and account actions use conventional labels", async ({ page }, info) => {
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: "Mitmachen", exact: true }).click();
  await registerInOpenDialog(page, `seen-${info.project.name.slice(-3)}`);
  await page.getByRole("button", { name: "Beiträge schliessen" }).click();
  const summary = page.getByRole("region", { name: "Auf einen Blick" });
  await summary.getByRole("button", { name: "Ist noch da", exact: true }).click();
  await expect(summary.getByRole("button", { name: "Heute von dir bestätigt" })).toBeDisabled();
  await expect(summary.getByText("Heute bestätigt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  await expect(page.getByText("Konto & Einstellungen", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abmelden", exact: true })).toBeVisible();
});

test("walk starts with only origin, duration and action; rest intervals are optional", async ({ page }) => {
  await page.goto("/?action=walk");
  const panel = page.getByRole("complementary", { name: "Spaziergang entdecken" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Bänkli-Spaziergang finden" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Einfache Strecke", exact: true })).not.toBeVisible();
  await panel.locator("summary").filter({ hasText: "Optionen" }).click();
  await panel.getByRole("button", { name: "5 Min.", exact: true }).click();
  await expect(panel.getByRole("button", { name: "5 Min.", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("functional text is readable and utility controls keep the illustration separate", async ({ page }) => {
  await page.goto("/bank/osm-node-101");
  const summary = page.getByRole("region", { name: "Auf einen Blick" });
  const sizes = await summary.locator("li, .summary-access-note, .bench-freshness").evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect(sizes.every((size) => size >= 13)).toBe(true);
  await expect(page.locator(".detail-disclosures > details > summary")).toHaveCount(4);
  const order = await page.evaluate(() => document.querySelector(".bench-summary")!.compareDocumentPosition(document.querySelector(".detail-disclosures")!) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(order).toBeTruthy();
  await page.goto("/?action=walk");
  const panel = page.getByRole("complementary", { name: "Spaziergang entdecken" });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe("none");
});

test("a selected rest interval reaches the routing result", async ({ page }, info) => {
  await page.goto("/?action=walk");
  const panel = page.getByRole("complementary", { name: "Spaziergang entdecken" });
  await panel.getByRole("combobox", { name: "Start: Adresse oder Haltestelle" }).fill("Zürich");
  await panel.getByRole("option", { name: "Bahnhofplatz 1, Zürich Adresse" }).click();
  await panel.locator("summary").filter({ hasText: "Optionen" }).click();
  await panel.getByRole("button", { name: "Einfache Strecke", exact: true }).click();
  await panel.getByRole("button", { name: "5 Min.", exact: true }).click();
  await panel.getByRole("button", { name: "Bänkli-Spaziergang finden", exact: true }).click();
  const pauses = panel.getByRole("region", { name: "Sitzpausen unterwegs" });
  await expect(pauses).toBeVisible({ timeout: 18_000 });
  const text = await pauses.textContent();
  const minutes = Number(text!.match(/Höchstens ca\. (\d+) Min\./)![1]);
  expect(minutes).toBeGreaterThan(0);
  expect(minutes).toBeLessThanOrEqual(5);
  await pauses.screenshot({ path: info.outputPath("rest-interval-result.png") });
});
