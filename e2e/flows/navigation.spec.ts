import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function registerInOpenDialog(page: Page, prefix: string) {
  const account = page.getByRole("dialog", { name: "Willkommen zurück" });
  await account.getByRole("button", { name: "Registrieren" }).click();
  const signup = page.getByRole("dialog", { name: "Dein Bänkli-Konto" });
  await signup.getByLabel("Benutzername").fill(`${prefix}-${Date.now().toString(36)}`);
  await signup.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await signup.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  await expect(signup).toBeHidden({ timeout: 15_000 });
}

// Each browser/repeat gets a different seeded neighbour. The add-bench action
// intentionally rejects a stale 25 m neighbour snapshot, so sharing one point
// between parallel Playwright workers makes the test invalidate itself. These
// fixtures preserve that production guard while keeping the E2E data isolated.
const ADD_BENCH_FIXTURES = [
  { latitude: 47.37674, longitude: 8.54183, nearbyName: "Lindenhof" },
  { latitude: 46.94812, longitude: 7.45131, nearbyName: "Rosengarten" },
  { latitude: 46.51973, longitude: 6.63263, nearbyName: "Esplanade de Montbenon" },
  { latitude: 47.05202, longitude: 8.30741, nearbyName: "Musegg" },
  { latitude: 46.68654, longitude: 7.86468, nearbyName: "Höhematte" },
  { latitude: 46.99809, longitude: 6.93833, nearbyName: "Chaumont" },
  { latitude: 46.20157, longitude: 6.14747, nearbyName: "Promenade de la Treille" },
  { latitude: 47.55911, longitude: 7.58915, nearbyName: "Pfalz" },
  { latitude: 47.42382, longitude: 9.37821, nearbyName: "Drei Weieren" },
  { latitude: 46.00672, longitude: 8.95234, nearbyName: "Parco Ciani" },
] as const;

function isolatedAddBenchFixture(info: TestInfo) {
  const projectLane = info.project.name === "mobile-safari" ? 1 : 0;
  const index = info.repeatEachIndex * 2 + projectLane;
  return ADD_BENCH_FIXTURES[index % ADD_BENCH_FIXTURES.length];
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
  const menu = page.getByRole("dialog", { name: "Bänkli App", exact: true });
  const navigation = menu.getByRole("navigation", { name: "Hauptnavigation" });
  // The grouped menu keeps practical navigation separate from reading and account actions.
  const outside = navigation.getByRole("region", { name: "Unterwegs", exact: true });
  await expect(outside.getByRole("button", { name: "Spaziergang", exact: true })).toBeVisible();
  const reading = navigation.getByRole("button", { name: /Gedanken am Bänkli/ });
  await expect(reading).toBeVisible();
  await expect(reading).toHaveAttribute("aria-haspopup", "dialog");
  const community = navigation.getByRole("region", { name: "Rund ums Bänkli", exact: true });
  await expect(community.getByRole("link").or(community.getByRole("button"))).toHaveText([
    "Bänkli-Feed", "Bänkli eintragen", "Bänklilogie", "Über die Bänkli App",
  ]);
  await expect(community.getByRole("link", { name: "Bänkli-Feed", exact: true })).toHaveAttribute("href", "/feed");
  await expect(community.getByRole("button", { name: "Bänkli eintragen", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Anmelden", exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "Menü schliessen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sonne geschätzt entfernen" })).toBeVisible();
});

test("direct bench link opens the painting and resumes saving after sign-in", async ({ page }, info) => {
  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(sheet.locator(".bench-header")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Weg planen" })).toBeVisible();
  const save = sheet.getByRole("button", { name: "Merken" });
  await expect(save).toBeVisible();
  await save.click();
  await registerInOpenDialog(page, `save-${info.project.name.slice(-3)}`);
  await expect(sheet.getByRole("button", { name: "Gemerkt" })).toHaveAttribute("aria-pressed", "true");
  const order = await page.evaluate(() => document.querySelector(".bench-header")!.compareDocumentPosition(document.querySelector(".bench-panorama")!) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(order).toBeTruthy();
  await expect(sheet.getByRole("button", { name: "Weg planen" })).toBeVisible();
  await sheet.screenshot({ path: info.outputPath("bench-full-decision.png") });
  await sheet.getByRole("button", { name: "Bänkli beschreiben", exact: true }).click();
  const factEditor = page.getByRole("dialog", { name: "Bänkli beschreiben" });
  await expect(factEditor.locator(".contribution-feature-list > section").first()).toBeVisible();
  await expect(factEditor.locator(".contribution-metadata-form")).toBeVisible();
  await factEditor.getByRole("button", { name: /Rückenlehne/ }).click();
  await expect(factEditor.getByRole("button", { name: "Nein", exact: true })).toBeVisible();
  await factEditor.getByRole("button", { name: "Beiträge schliessen" }).click();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(sheet.locator(".bench-quick-preview")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await sheet.screenshot({ path: info.outputPath("bench-tablet-rail.png") });
});

test("offers an accessible nearby list with zoom guidance and decision evidence", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  const list = page.getByRole("complementary", { name: "Bänkli in diesem Ausschnitt" });
  await expect(list.getByText(/Zoome näher heran/)).toBeVisible();
  await list.getByRole("button", { name: "Bänkliliste schliessen" }).click();
  const search = page.getByRole("combobox", { name: "Ort suchen" });
  await search.fill("Lindenhof");
  await page.locator(".map-search-results").getByRole("option").first().click();
  const searchedBench = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(searchedBench).toBeVisible();
  await expect(page).toHaveURL(/\?bank=osm-node-101$/);
  await searchedBench.getByRole("button", { name: "Bank schliessen", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(searchedBench).toBeHidden();
  await expect(page.locator("main[data-active-task]")).toHaveAttribute("data-active-task", "browse");
  await page.goForward();
  await expect(page).toHaveURL(/\?bank=osm-node-101$/);
  await expect(searchedBench.locator(".bench-header > h2")).toHaveText("Lindenhof, Zürich");
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(searchedBench).toBeHidden();
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  await expect(list.getByRole("button", { name: /Lindenhof/ })).toBeVisible();
  await expect(list.getByText(/Rückenlehne/).first()).toBeVisible();
  await expect(list.getByText(/Ebener Platz am Bänkli/).first()).toBeVisible();
  await expect(list.getByText(/Luftlinie/)).toBeVisible();
  await list.screenshot({ path: info.outputPath("nearby-bench-list.png") });
  const row = list.getByRole("button", { name: /Lindenhof/ }).first();
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  // A visible sheet does not imply that a MapLibre camera animation has ended.
  // Compare two settled views, while keeping exact coordinate/zoom assertions.
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const cameraBefore = await map.evaluate((map) => ({
    latitude: map.getAttribute("data-center-latitude"),
    longitude: map.getAttribute("data-center-longitude"),
    zoom: map.getAttribute("data-zoom"),
  }));
  const scrollBefore = await list.locator("ol").evaluate((items) => {
    items.scrollTop = Math.min(24, items.scrollHeight - items.clientHeight);
    return items.scrollTop;
  });
  await row.click();
  const detail = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(detail.getByRole("button", { name: "Bänkli in diesem Ausschnitt" })).toBeVisible();
  await detail.getByRole("button", { name: "Bänkli in diesem Ausschnitt" }).click();
  await expect(list).toBeVisible();
  await expect(row).toBeFocused();
  expect(await list.locator("ol").evaluate((items) => items.scrollTop)).toBe(scrollBefore);
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  await expect(map).toHaveAttribute("data-center-latitude", cameraBefore.latitude!);
  await expect(map).toHaveAttribute("data-center-longitude", cameraBefore.longitude!);
  await expect(map).toHaveAttribute("data-zoom", cameraBefore.zoom!);
});

test("rating summary opens reviews and guest writing resumes after authentication", async ({ page }, info) => {
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: /Bewertungen ansehen/ }).first().click();
  await expect(page.getByRole("heading", { name: "Wie war die Pause?" })).toBeVisible();
  await page.getByRole("button", { name: "Zum Mitmachen kurz anmelden" }).click();
  await registerInOpenDialog(page, `rate-${info.project.name.slice(-3)}`);
  const rating = page.getByRole("dialog", { name: "Wie war deine Pause?" });
  await expect(rating.getByRole("group", { name: "Gesamt", exact: true })).toBeVisible();
  await rating.getByRole("group", { name: "Gesamt", exact: true }).getByRole("radio", { name: "4 Sterne" }).check();
  await rating.getByText("Aussicht, Komfort und Ruhe ergänzen (freiwillig)").click();
  for (const label of ["Aussicht", "Komfort", "Ruhe"]) await rating.getByRole("group", { name: label, exact: true }).getByRole("radio", { name: "4 Sterne" }).check();
  await rating.getByRole("button", { name: "Bewertung veröffentlichen" }).click();
  await expect(rating.getByText("Danke – deine Bewertung ist sichtbar.")).toBeVisible();
  await rating.getByRole("button", { name: "Beiträge schliessen" }).click();
  await page.getByRole("button", { name: "Zum Platz" }).click();
  await expect(page.locator(".rating-summary-action strong")).toContainText("4");
  await page.screenshot({ path: info.outputPath("bench-summary.png"), fullPage: true });
});

test("guest adding resumes into pin placement, catches neighbours and opens the saved bench without navigation", async ({ page, context }, info) => {
  const placement = isolatedAddBenchFixture(info);
  await page.goto("/?bank=osm-node-101");
  await expect(page.getByRole("heading", { name: /Lindenhof/ })).toBeVisible();
  await page.getByRole("button", { name: "Bank schliessen" }).click();
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  await page.getByRole("button", { name: "Bänkli eintragen" }).click();
  await registerInOpenDialog(page, `add-${info.project.name.slice(-3)}-${info.repeatEachIndex}`);
  await expect(page.getByRole("heading", { name: "Position wählen" })).toBeVisible();
  await expect(page.locator(".placement-crosshair")).toBeVisible();
  await context.setGeolocation({ latitude: placement.latitude, longitude: placement.longitude, accuracy: 12.4 });
  await context.grantPermissions(["geolocation"]);
  await page.getByRole("button", { name: "Meinen Standort verwenden" }).click();
  const locationStatus = page.getByRole("status").filter({ hasText: /Standort auf etwa/ });
  await expect(locationStatus).toHaveText("Standort auf etwa 12 m genau.");
  await expect(locationStatus).toBeVisible();
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-location-mode", "browse");
  await page.getByRole("button", { name: "Hier eintragen" }).click();
  const dialog = page.getByRole("dialog", { name: "Bänkli eintragen", exact: true });
  await expect(dialog.getByRole("region", { name: "Bänkli in der Nähe" })).toContainText(placement.nearbyName);
  await expect(dialog.getByRole("button", { name: "Eintragen", exact: true })).toBeDisabled();
  await dialog.getByLabel("Geprüft: Meins ist ein weiteres Bänkli.").check();
  const title = `UX-Bänkli ${info.project.name} ${info.repeatEachIndex}-${Date.now()}`;
  await dialog.getByLabel("Name", { exact: false }).fill(title);
  await page.evaluate(() => { (window as Window & { uxMarker?: boolean }).uxMarker = true; });
  await dialog.getByRole("button", { name: "Eintragen", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const createdBench = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(createdBench.locator(".bench-created-status")).toHaveText("Bänkli eingetragen");
  await expect(createdBench.locator(".bench-created-status")).toBeVisible();
  const contributions = createdBench.getByRole("region", { name: "Zum Bänkli beitragen" });
  await expect(contributions.getByRole("heading", { name: "Diesen Ort mitgestalten" })).toBeVisible();
  for (const name of ["Verbessern", "Foto hinzufügen", "Gedanken teilen"]) {
    await expect(contributions.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // Verification belongs in the source details, not the compact success notice.
  const sources = createdBench.locator(".bench-sources");
  await expect(sources).not.toHaveAttribute("open", "");
  await sources.locator("summary").click();
  await expect(sources.getByText("Neu entdeckt · noch unbestätigt", { exact: true })).toBeVisible();
  await sources.locator("summary").click();
  expect(await page.evaluate(() => (window as Window & { uxMarker?: boolean }).uxMarker)).toBe(true);
  await page.goto("/profil");
  const impact = page.getByRole("heading", { name: "Kleine Dinge, die helfen" });
  const collection = page.getByRole("heading", { name: "Was du schon gefunden hast" });
  expect((await impact.boundingBox())!.y).toBeLessThan((await collection.boundingBox())!.y);
  await expect(page.getByRole("heading", { name: "Warten auf Bestätigung" })).toBeVisible();
  await expect(page.locator(".profile-pending").getByText(title)).toBeVisible();
});

test("a logged-out map long-press resumes at the same position after sign-in", async ({ page }, info) => {
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Willkommen zurück" })).toBeVisible();
  await registerInOpenDialog(page, `press-${info.project.name.slice(-3)}`);
  await expect(page.getByRole("heading", { name: "Position wählen" })).toBeVisible();
  await expect(page.locator(".placement-crosshair")).toBeVisible();
});

test("confirmation is an intentional contribution, not a default-page interruption", async ({ page }, info) => {
  await page.goto("/bank/osm-node-101");
  await expect(page.getByRole("region", { name: "Auf einen Blick" }).getByRole("button", { name: "Ist noch da", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Verbessern", exact: true }).click();
  await registerInOpenDialog(page, `seen-${info.project.name.slice(-3)}`);
  const hub = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });
  await hub.locator("summary").filter({ hasText: "Sich ums Bänkli kümmern" }).click();
  await hub.getByRole("button", { name: "Ist noch da", exact: true }).click();
  await expect(hub.getByRole("button", { name: "Heute von dir bestätigt" })).toBeDisabled();
  await hub.getByRole("button", { name: "Beiträge schliessen" }).click();
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  await expect(page.getByRole("button", { name: "Abmelden", exact: true })).toBeVisible();
});

test("walk keeps origin, duration and route shape visible; rest intervals remain optional", async ({ page }) => {
  await page.goto("/?action=walk");
  const panel = page.getByRole("complementary", { name: "Spaziergang entdecken" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Bänkli-Spaziergang finden" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Einfache Strecke", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "5 Min.", exact: true })).not.toBeVisible();
  await panel.locator("summary").filter({ hasText: "Optionen" }).click();
  await panel.getByRole("button", { name: "5 Min.", exact: true }).click();
  await expect(panel.getByRole("button", { name: "5 Min.", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("functional text is readable and utility controls keep the illustration separate", async ({ page }) => {
  await page.goto("/bank/osm-node-101");
  const summary = page.getByRole("region", { name: "Auf einen Blick" });
  const facts = summary.locator(".overview-fact > strong");
  await expect(facts).toHaveCount(6);
  const sizes = await facts.evaluateAll(elements => elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
  expect(sizes.length).toBe(6);
  expect(sizes.every(size => size >= 14)).toBe(true);
  const sources = page.locator(".bench-sources");
  await expect(sources).not.toHaveAttribute("open", "");
  await expect(sources.locator("details")).toHaveCount(0);
  expect(await page.locator(".bench-overview").evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector(".bench-sources")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.goto("/?action=walk");
  const panel = page.getByRole("complementary", { name: "Spaziergang entdecken" });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe("none");
});

test("refreshes time-sensitive map data when the app returns to the foreground", async ({ page }) => {
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(map).toHaveAttribute("data-time-refresh", /T/);
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
  await expect(panel.getByRole("region", { name: "Zugang auf dieser Route" })).toContainText("Treppen auf ca.");
  const text = await pauses.textContent();
  const minutes = Number(text!.match(/Höchstens ca\. (\d+) Min\./)![1]);
  expect(minutes).toBeGreaterThan(0);
  expect(minutes).toBeLessThanOrEqual(5);
  await pauses.screenshot({ path: info.outputPath("rest-interval-result.png") });
  await panel.locator(".journey-thread .journey-leg").first().click();
  const bench = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(bench).toBeVisible();
  await expect(bench.getByRole("button", { name: "Spaziergang fortsetzen" }).first()).toBeVisible();
  await bench.getByRole("button", { name: "Spaziergang fortsetzen" }).first().click();
  await expect(panel.getByRole("region", { name: "Dein Spaziergang" })).toBeVisible();
  await expect(pauses).toBeVisible();
});
