import { devices, expect, test } from "@playwright/test";

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", { name: "Registrieren" }).click();
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.getByLabel("Menü öffnen").click();
  await expect(page.getByText("Mein Profil")).toBeVisible();
  await page.getByLabel("Menü schliessen").click();
}

test("opens the mobile map and a bench detail", async ({ page }, testInfo) => {
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
  await expect(page.getByLabel("Ort suchen")).toBeVisible();
  await expect(page.getByLabel("Menü öffnen")).toBeVisible();
  await page.goto("/bank/osm-node-101");
  const painting = page.locator(".bench-landscape");
  await expect(painting).toBeVisible();
  const environments = await painting.locator(".painting-environment").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(environments.length).toBeGreaterThanOrEqual(2);
  for (const environment of environments) {
    expect(environment).toMatch(/^\/ui-art\/scenes\//);
    const artwork = await page.request.get(environment!);
    expect(artwork.ok()).toBeTruthy();
    expect(artwork.headers()["cache-control"]).toContain("max-age=3600");
    expect(artwork.headers()["cache-control"]).not.toContain("immutable");
  }
  await expect(painting.locator('.painting-water[href^="/ui-art/scenes/"]')).toHaveCount(1);
  await painting.screenshot({ path: testInfo.outputPath("production-bench.png") });
  await page.getByRole("button", { name: "Mitmachen", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Willkommen zurück" })).toBeVisible();
  await expect(page).toHaveURL(/\/bank\/osm-node-101$/);
});

test("renders calm watercolor markers from overview to close range", async ({ page }, testInfo) => {
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
  await map.screenshot({ path: testInfo.outputPath("watercolor-markers-overview.png") });
  const search = page.getByRole("combobox", { name: "Ort suchen" });
  await search.fill("Lindenhof");
  await page.locator(".map-search-results").getByRole("option").first().click();
  await expect(page.getByRole("complementary", { name: "Bankdetails" })).toBeVisible();
  await page.getByLabel("Bank schliessen").click();
  await expect(map).toHaveAttribute("aria-busy", "false");
  await map.screenshot({ path: testInfo.outputPath("watercolor-marker-close.png") });
});

test("keeps map search and filters clear with keyboard input", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
  const search = page.getByRole("combobox", { name: "Ort suchen" });
  // The dev server can finish its first search-action compilation after the
  // initial page is interactive. If that cold reload clears the field, repeat
  // the real user action instead of failing a compatibility check.
  await expect(async () => {
    await search.fill("Lindenhof");
    await expect(search).toHaveAttribute("aria-expanded", "true");
  }).toPass({ timeout: 15_000 });
  const firstResult = page.getByRole("option").first();
  await expect(firstResult).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("map-search-results.png"), fullPage: false });
  await search.press("ArrowDown");
  await expect(firstResult).toHaveAttribute("aria-selected", "true");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: "Filter öffnen" }).click();
  const filters = page.getByRole("dialog", { name: "Was brauchst du?" });
  await expect(filters).toBeVisible();
  await expect(filters.getByLabel("Filter schliessen")).toBeFocused();
  await filters.getByLabel("Filter schliessen").press("Shift+Tab");
  await expect(filters.getByRole("button", { name: "Karte ansehen" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(filters.getByLabel("Filter schliessen")).toBeFocused();
  const sun = filters.getByRole("button", { name: "Sonne", exact: true });
  const shade = filters.getByRole("button", { name: "Schatten", exact: true });
  await shade.click();
  await expect(filters.getByText("1 Filter aktiv")).toBeVisible();
  await expect(shade).toHaveAttribute("aria-pressed", "true");
  await sun.click();
  await expect(sun).toHaveAttribute("aria-pressed", "true");
  await expect(shade).toHaveAttribute("aria-pressed", "false");
  await expect(filters.getByText("1 Filter aktiv")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("map-filters.png"), fullPage: false });
  const backrest = filters.getByRole("button", { name: "Rückenlehne" });
  await expect(backrest).toBeVisible();
  await expect(filters.getByRole("button", { name: "Feuerstelle" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Abfalleimer" })).toBeVisible();
  await filters.getByText("Mehr Wünsche", { exact: true }).click();
  await expect(filters.getByRole("button", { name: "Mit Rollstuhl nutzbar" })).toBeVisible();
  await backrest.click();
  await expect(filters.getByText("2 Filter aktiv")).toBeVisible();
  await expect(page.getByText("Bänke konnten nicht geladen werden.")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("map-filters-more.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(filters).toHaveCount(0);
  await expect(page.getByLabel("Filter öffnen")).toBeFocused();
});

test("keeps core pages contained from tablet to large desktop", async ({ page }, testInfo) => {
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 1600, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/bank/osm-node-101");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator(".standalone-bench-card")).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath("bench-desktop.png"), fullPage: false });

  await page.goto("/");
  await page.getByRole("button", { name: "Filter öffnen" }).click();
  const panel = page.getByRole("dialog", { name: "Was brauchst du?" });
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1600);
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
});

test("keeps primary map decisions usable on a narrow phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
  await expect(page.locator(".maplibregl-ctrl-attrib-button")).toBeHidden();
  await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toContainText("OpenStreetMap");
  await expect(page.getByRole("combobox", { name: "Ort suchen" })).toHaveAttribute("placeholder", "Ort oder Bänkli");
  await expect(page.locator(".map-filter-button > span")).toBeHidden();
  const walk = await page.getByRole("button", { name: "Spaziergang" }).boundingBox();
  const list = await page.getByRole("button", { name: "Liste", exact: true }).boundingBox();
  expect(walk).not.toBeNull();
  expect(list).not.toBeNull();
  expect(Math.abs(walk!.y - list!.y)).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    class TestOrientationEvent extends Event {
      static requestPermission(absolute?: boolean) {
        (window as Window & { __orientationPermissionAbsolute?: boolean }).__orientationPermissionAbsolute = absolute;
        return Promise.resolve("granted" as const);
      }
    }
    Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: TestOrientationEvent });
  });
  const orientation = page.getByRole("button", { name: "Karte nach Handyrichtung ausrichten" });
  await orientation.click();
  await expect(page.locator(".map-orientation-control")).toHaveAttribute("aria-busy", "true");
  expect(await page.evaluate(() => (window as Window & { __orientationPermissionAbsolute?: boolean }).__orientationPermissionAbsolute)).toBe(true);
  const expectedHeading = await page.evaluate(() => {
    const event = new Event("deviceorientationabsolute");
    Object.defineProperties(event, { alpha: { value: 270 }, absolute: { value: true } });
    window.dispatchEvent(event);
    const angle = window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
    return String((90 + angle) % 360);
  });
  await expect(page.locator(".map-orientation-control")).toHaveAttribute("aria-pressed", "true");
  await expect(map).toHaveAttribute("data-device-heading", expectedHeading);

  // Holding or dragging the map pauses sensor updates instead of fighting the
  // gesture. Direction following resumes as soon as the pointer is released.
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "mouse", button: 1, bubbles: true });
  await page.evaluate(() => {
    const event = new Event("deviceorientationabsolute");
    Object.defineProperties(event, { alpha: { value: 180 }, absolute: { value: true } });
    window.dispatchEvent(event);
  });
  await page.waitForTimeout(100);
  await expect(map).toHaveAttribute("data-device-heading", expectedHeading);
  await canvas.dispatchEvent("pointerup", { pointerId: 7, pointerType: "mouse", button: 1, bubbles: true });
  const resumedHeading = await page.evaluate(() => {
    const event = new Event("deviceorientationabsolute");
    Object.defineProperties(event, { alpha: { value: 180 }, absolute: { value: true } });
    window.dispatchEvent(event);
    const angle = window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
    return String((180 + angle) % 360);
  });
  await expect(map).toHaveAttribute("data-device-heading", resumedHeading);
  await page.screenshot({ path: testInfo.outputPath("narrow-heading-active.png") });
  await page.getByRole("button", { name: "Norden wieder oben anzeigen" }).click();
  await expect(map).toHaveAttribute("data-orientation-mode", "north");

  await page.evaluate(() => {
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", {
      configurable: true,
      value: () => Promise.resolve("denied"),
    });
  });
  await orientation.click();
  const orientationStatus = page.getByRole("status");
  await expect(orientationStatus).toContainText("Der Kompasszugriff ist blockiert.");
  await expect(orientation).toBeEnabled();
  await expect(orientation).toHaveAttribute("aria-pressed", "false");
  await expect(map).toHaveAttribute("data-orientation-mode", "north");
  const statusBox = await orientationStatus.boundingBox();
  expect(statusBox).not.toBeNull();
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".benchly-map") !== null, {
    x: statusBox!.x + statusBox!.width / 2,
    y: statusBox!.y + statusBox!.height / 2,
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("narrow-map-actions.png") });

  await page.getByLabel("Filter öffnen").click();
  const filters = page.getByRole("dialog", { name: "Was brauchst du?" });
  await expect(filters.getByRole("button", { name: "Karte ansehen" })).toBeVisible();
  await expect(page.locator(".filter-modal-backdrop")).toBeVisible();
  const nearbyGroup = filters.locator(".filter-group").nth(1);
  const facilityNote = filters.getByText("Erfasste Einrichtungen", { exact: false });
  const [nearbyBox, noteBox] = await Promise.all([nearbyGroup.boundingBox(), facilityNote.boundingBox()]);
  expect(nearbyBox).not.toBeNull();
  expect(noteBox).not.toBeNull();
  expect(noteBox!.y - (nearbyBox!.y + nearbyBox!.height)).toBeGreaterThanOrEqual(8);
  await page.screenshot({ path: testInfo.outputPath("narrow-filter-actions.png") });
  await page.locator(".filter-modal-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(filters).toHaveCount(0);
});

test("reveals a bench name and a clear sheet action on a short phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("h2").first()).toBeInViewport();
  await expect(sheet.getByText("Details zeigen", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("short-phone-bench-sheet.png") });
  await sheet.getByRole("button", { name: "Detailhöhe ändern" }).click();
  const [chrome, landscape] = await Promise.all([sheet.locator(".sheet-chrome").boundingBox(), sheet.locator(".bench-landscape").boundingBox()]);
  expect(chrome).not.toBeNull();
  expect(landscape).not.toBeNull();
  expect(landscape!.y).toBeGreaterThanOrEqual(chrome!.y + chrome!.height - 1);
  await page.screenshot({ path: testInfo.outputPath("short-phone-full-bench-sheet.png") });

  await page.goto("/?action=walk");
  const title = page.getByRole("heading", { name: "Spaziergang entdecken" });
  await expect(title).toBeFocused();
  expect(await title.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
  await page.screenshot({ path: testInfo.outputPath("walk-heading-focus.png") });
});

test("keeps long-page navigation available and returns to the calling section", async ({ page }, testInfo) => {
  await page.goto("/danke");
  const catalog = page.locator(".about-source-catalog");
  await expect(catalog).not.toHaveAttribute("open", "");
  await catalog.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("collapsed-source-catalog.png") });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByLabel("Menü öffnen").click();
  await expect(page.getByRole("dialog", { name: "Bänkli App" }).getByRole("link", { name: "Zur Karte" })).toBeVisible();
  await page.getByLabel("Menü schliessen").click();
  await page.evaluate(() => window.scrollTo(0, 1_200));
  const navBox = await page.locator(".thanks-nav").boundingBox();
  expect(navBox?.y).toBeLessThanOrEqual(1);
  await catalog.locator(":scope > summary").click();
  await expect(catalog.getByText("OpenStreetMap", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("sticky-about-source-catalog.png") });

  await page.goto("/statistiken");
  await page.locator(".daily-bench-link").click();
  await expect(page).toHaveURL(/\/bank\/[^?]+\?from=statistics$/);
  await page.getByRole("link", { name: "Zurück", exact: true }).click();
  await expect(page).toHaveURL(/\/statistiken$/);
});

test("activates the raster fallback when the vector style fails", async ({ page }) => {
  await page.route("https://vectortiles.geo.admin.ch/styles/**", (route) => route.abort("failed"));
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-basemap", "fallback", { timeout: 5_000 });
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(page.getByLabel("Ort suchen")).toBeEnabled();
});

test("stops waiting for a delayed vector style after three seconds", async ({ page }) => {
  await page.route("https://vectortiles.geo.admin.ch/styles/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.abort("timedout").catch(() => undefined);
  });
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-basemap", "fallback", { timeout: 5_000 });
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(page.getByLabel("Menü öffnen")).toBeEnabled();
});

test.describe("native mobile rendering performance", () => {
  test.use({ deviceScaleFactor: devices["Pixel 7"].deviceScaleFactor });

  test("keeps the mobile controls and map responsive under Fast 4G and CPU throttling", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Chromium DevTools throttling is required");
    const client = await context.newCDPSession(page);
    await client.send("Network.enable");
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 20,
      downloadThroughput: 4 * 1024 * 1024 / 8,
      uploadThroughput: 3 * 1024 * 1024 / 8,
    });
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    await page.goto("/");
    await expect(page.getByLabel("Ort suchen")).toBeVisible();
    await expect(page.getByLabel("Menü öffnen")).toBeVisible();
    const map = page.getByLabel("Karte der Schweizer Sitzbänke");
    await expect(map).toHaveAttribute("aria-busy", "false", { timeout: 3_500 });
    await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
    await client.detach();
  });
});

test("centers near the user only after an explicit location action", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 8.5417, latitude: 47.3769 });
  await page.goto("/");
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
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
  await expect(page.getByRole("dialog", { name: "Willkommen zurück" })).toBeVisible();
  await expect(page.getByText("Danach geht es weiter: Bewertung abgeben.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bewertung veröffentlichen" })).toHaveCount(0);
});

test("registers and writes a rating plus structured bench metadata", async ({ page, browserName }) => {
  await registerUser(page, `writer-${browserName}`);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: /Noch unbewertet|Bewertung .* von 5|Deine Bewertung/ }).click();
  const contribution = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });
  await contribution.getByRole("group", { name: "Gesamt", exact: true }).getByRole("radio", { name: "5 Sterne" }).check();
  await contribution.getByRole("group", { name: "Aussicht", exact: true }).getByRole("radio", { name: "4 Sterne" }).check();
  await contribution.getByRole("group", { name: "Komfort", exact: true }).getByRole("radio", { name: "4 Sterne" }).check();
  await contribution.getByRole("group", { name: "Ruhe", exact: true }).getByRole("radio", { name: "5 Sterne" }).check();
  await page.getByPlaceholder("Was hat dir hier gefallen?").fill("Playwright-Testbewertung");
  await page.getByRole("button", { name: "Bewertung veröffentlichen" }).click();
  await expect(page.getByText("Danke – deine Bewertung ist sichtbar.")).toBeVisible();
  await contribution.locator("summary").filter({ hasText: "Bänkli beschreiben" }).click();
  await contribution.getByRole("button", { name: /Armlehnen/ }).click();
  await contribution.getByRole("button", { name: "Ja", exact: true }).click();
  await expect(contribution.getByRole("button", { name: /Armlehnen Ja/ })).toBeVisible();
});

test("lets an authenticated user add an unverified Bänkli", async ({ page, browserName }) => {
  const benchName = `Testbänkli ${browserName} ${Date.now().toString().slice(-6)}`;
  await registerUser(page, `scout-${browserName}`);
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Bänkli eintragen").click();
  await expect(page.getByRole("heading", { name: "Position wählen" })).toBeVisible();
  await page.getByRole("button", { name: "Hier eintragen" }).click();
  await page.getByLabel("Name", { exact: false }).fill(benchName);
  await page.getByLabel("Widmung").fill("Für alle müden Tests");
  await expect(page.getByText("Bestehende Bänkli in der Nähe werden geprüft …")).toHaveCount(0);
  const duplicateCheck = page.getByLabel("Geprüft: Meins ist ein weiteres Bänkli.");
  if (await duplicateCheck.isVisible()) await duplicateCheck.check();
  await page.getByRole("button", { name: "Eintragen", exact: true }).click();
  await expect(page.getByText(/noch 2 Bestätigungen/)).toBeVisible();
  await expect(page.getByRole("heading", { name: benchName, exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-map-ready", "true", { timeout: 5_000 });
  await page.getByLabel("Ort suchen").fill(benchName);
  await expect(page.getByRole("button", { name: new RegExp(benchName) })).toBeVisible({ timeout: 10_000 });
});

test("lets a user compose and persist a watercolor avatar", async ({ page, browserName }) => {
  await registerUser(page, `ava-${browserName}-${Date.now().toString().slice(-5)}`);
  await page.goto("/profil");
  await page.locator("summary").filter({ hasText: "Avatar gestalten" }).click();
  await page.getByRole("radio", { name: "Locken", exact: true }).check();
  await page.getByRole("radio", { name: "Wald", exact: true }).check();
  await page.getByRole("radio", { name: "Fuchs", exact: true }).check();
  await page.getByRole("button", { name: "Avatar speichern" }).click();
  await expect(page.getByText("Dein Aquarell-Avatar ist gespeichert.")).toBeVisible();
  await page.reload();
  await page.locator("summary").filter({ hasText: "Avatar gestalten" }).click();
  await expect(page.getByRole("radio", { name: "Locken", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Wald", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Fuchs", exact: true })).toBeChecked();
});

test("shows useful sun and view information before terrain enrichment", async ({ page }) => {
  await page.goto("/bank/osm-node-101");
  await expect(page.getByRole("figure")).toBeVisible();
  await page.locator(".detail-disclosures > details > summary").filter({ hasText: "Licht" }).click();
  await expect(page.getByText(/Direkte Sonne|Geschätzte Sonne/).first()).toBeVisible();
  await page.locator(".detail-disclosures > details > summary").filter({ hasText: "Aussicht" }).click();
  await page.getByText("Aussicht im Detail").click();
  await expect(page.locator(".detail-panel-view").getByText("Was den Horizont prägt")).toBeVisible();
  await expect(page.locator(".distance-ribbon")).toContainText("Weg oder Strasse");
  await expect(page.locator(".distance-ribbon")).toContainText("direkt");
  await expect(page.getByText("Durchs Jahr")).toHaveCount(0);
});

test("opens the password-protected moderation view", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Passwort").fill("benchly-admin");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("heading", { name: "Bänkli App Moderation" })).toBeVisible();
});
