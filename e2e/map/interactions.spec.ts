import { devices, expect, test } from "@playwright/test";
import { testTranslator } from "../../src/test/translations";

async function renderedContrast(locator: import("@playwright/test").Locator) {
  return locator.evaluate((element) => {
    const parse = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return { red: channels[0] ?? 0, green: channels[1] ?? 0, blue: channels[2] ?? 0, alpha: channels[3] ?? 1 };
    };
    const composite = (foreground: ReturnType<typeof parse>, background: ReturnType<typeof parse>) => {
      const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
      const channel = (front: number, back: number) => alpha === 0 ? 0 : (front * foreground.alpha + back * background.alpha * (1 - foreground.alpha)) / alpha;
      return { red: channel(foreground.red, background.red), green: channel(foreground.green, background.green), blue: channel(foreground.blue, background.blue), alpha };
    };
    let background = { red: 255, green: 255, blue: 255, alpha: 1 };
    const layers = [];
    for (let node: Element | null = element; node; node = node.parentElement) layers.unshift(parse(getComputedStyle(node).backgroundColor));
    for (const layer of layers) background = composite(layer, background);
    const foreground = composite(parse(getComputedStyle(element).color), background);
    const luminance = (color: typeof background) => {
      const linear = [color.red, color.green, color.blue].map((channel) => {
        const value = channel / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };
    const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
    return (light + .05) / (dark + .05);
  });
}

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", { name: "Registrieren" }).click();
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await expect(page.getByRole("dialog", { name: "Dein Bänkli-Konto" })).toBeHidden({ timeout: 15_000 });
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
  const painting = page.locator(".bench-panorama");
  await expect(painting).toBeVisible();
  await expect(painting.locator(".bench-panorama-art, .panorama-paper-wash").first()).toBeVisible();
  await painting.screenshot({ path: testInfo.outputPath("production-bench.png") });
  await page.getByRole("button", { name: "Bänkli beschreiben", exact: true }).click();
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
  const search = page.getByRole("combobox", { name: "Ort suchen" });
  const firstResult = page.locator(".map-search-results").getByRole("option").first();
  // This scenario exercises the search/filter UI, not basemap startup. On a
  // cold CI shard MapLibre and the server action can compile after the page is
  // already interactive. Wait for the user-visible search result itself and
  // repeat the input if a cold dev reload clears it. Dedicated rendering tests
  // cover map readiness and the three-second basemap fallback separately.
  await expect(async () => {
    await search.fill("");
    await search.fill("Lindenhof");
    await expect(firstResult).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath("map-search-results.png"), fullPage: false });
  await search.press("ArrowDown");
  await expect(firstResult).toHaveAttribute("aria-selected", "true");
  // Dismissing suggestions keeps the query; only the explicit clear action erases it.
  await search.press("Escape");
  await expect(search).toHaveValue("Lindenhof");
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await expect(search).toBeFocused();
  await search.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await expect(firstResult).toHaveAttribute("aria-selected", "true");
  await search.press("Escape");
  await page.getByRole("button", { name: "Suche leeren", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  const locationSuggestion = page.getByRole("listbox", { name: "Suchergebnisse" }).getByRole("option");
  await expect(locationSuggestion).toHaveCount(1);
  await expect(locationSuggestion).toContainText("Meinen Standort anzeigen");

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
  await expect(filters.getByRole("button", { name: "Abfalleimer" })).toHaveCount(0);
  await filters.getByText("Mehr Wünsche", { exact: true }).click();
  await expect(filters.getByRole("button", { name: "Ebener Platz am Bänkli" })).toBeVisible();
  await backrest.click();
  await expect(filters.getByText("2 Filter aktiv")).toBeVisible();
  await expect(page.getByText("Bänke konnten nicht geladen werden.")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("map-filters-more.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(filters).toHaveCount(0);
  await expect(page.getByLabel("Filter öffnen")).toBeFocused();
});

test("Escape closes a filter over a bench without dismissing the bench", async ({ page }) => {
  await page.goto("/?bank=osm-node-101");
  const bench = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(bench).toBeVisible();
  await page.getByRole("button", { name: "Filter öffnen" }).click();
  const filter = page.getByRole("dialog", { name: "Was brauchst du?" });
  await expect(filter).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filter).toHaveCount(0);
  await expect(bench).toBeVisible();
  await expect(page).toHaveURL(/bank=osm-node-101/);
});

test("browser Back and Forward restore an internally opened bench", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Ort suchen" });
  const firstResult = page.locator(".map-search-results").getByRole("option").first();
  await expect(async () => {
    await search.fill("");
    await search.fill("Lindenhof");
    await expect(firstResult).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await firstResult.click();
  const bench = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(bench).toBeVisible();
  await expect(bench.getByRole("heading", { name: "Lindenhof, Zürich" })).toBeVisible();
  await expect(page).toHaveURL(/bank=osm-node-101/);

  await page.goBack();
  await expect(bench).toHaveCount(0);
  await expect(page).not.toHaveURL(/bank=/);
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-last-inspected-bench", "osm-node-101");

  await page.goForward();
  await expect(bench).toBeVisible();
  await expect(page).toHaveURL(/bank=osm-node-101/);
  await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).not.toHaveAttribute("data-last-inspected-bench", "osm-node-101");
});

test("closing a directly linked bench clears its URL without a stale reopen", async ({ page }) => {
  await page.goto("/?bank=osm-node-101");
  const bench = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(bench).toBeVisible();
  await bench.getByRole("button", { name: "Bank schliessen" }).click();
  await expect(bench).toHaveCount(0);
  await expect(page).not.toHaveURL(/bank=/);

  await page.reload();
  await expect(bench).toHaveCount(0);
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

test("keeps primary map decisions usable on a narrow phone", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 8.5417, latitude: 47.3769 });
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
  await page.getByRole("button", { name: "Meinen Standort anzeigen" }).click();
  await expect(map).toHaveAttribute("data-location-mode", "north");
  const orientation = page.getByRole("button", { name: "Karte nach Handyrichtung ausrichten" });
  await orientation.click();
  await expect(page.locator(".map-location-control")).toHaveAttribute("aria-busy", "true");
  expect(await page.evaluate(() => (window as Window & { __orientationPermissionAbsolute?: boolean }).__orientationPermissionAbsolute)).toBe(true);
  const expectedHeading = await page.evaluate(() => {
    const event = new Event("deviceorientationabsolute");
    Object.defineProperties(event, { alpha: { value: 270 }, absolute: { value: true } });
    window.dispatchEvent(event);
    const angle = window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
    return String((90 + angle) % 360);
  });
  await expect(page.locator(".map-location-control")).toHaveAttribute("data-mode", "heading");
  await expect(map).toHaveAttribute("data-device-heading", expectedHeading);

  // Holding the map pauses sensor updates. An actual pan releases following
  // until the location button is pressed again (tested below).
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
  // One accepted reading must settle even when the sensor then becomes quiet.
  // Do not feed more samples from the assertion to drive the application.
  await expect.poll(async () => {
    const heading = Number(await map.getAttribute("data-device-heading"));
    return Math.abs(((heading - Number(resumedHeading) + 540) % 360) - 180);
  }, { intervals: [100, 150, 200] }).toBeLessThanOrEqual(1);
  await expect(map).toHaveAttribute("data-location-mode", "heading");
  await page.screenshot({ path: testInfo.outputPath("narrow-heading-active.png") });
  await page.getByRole("button", { name: "Norden wieder oben anzeigen" }).click();
  await expect(map).toHaveAttribute("data-orientation-mode", "north");

  // Moving the map releases tracking and its sensor subscription.
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(map).toHaveAttribute("data-location-mode", "browse");
  await page.getByRole("button", { name: "Meinen Standort anzeigen" }).click();
  await expect(map).toHaveAttribute("data-location-mode", "north");
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
  await expect(orientation).toHaveAttribute("data-mode", "north");
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
  await expect(sheet).toHaveAttribute("data-snap", "full");
  // On short phones the title and visit action lead; the panorama follows the
  // compact facts. Check the first screen before scrolling to the illustration.
  await expect(sheet.getByRole("heading", { name: "Lindenhof, Zürich", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(sheet.getByRole("button", { name: "Weg planen", exact: true })).toBeInViewport({ ratio: 1 });
  const resize = sheet.getByRole("button", { name: "Kompakter. Detailhöhe ändern", exact: true });
  await expect(resize).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("short-phone-full-bench-sheet.png") });
  const panorama = sheet.locator(".bench-panorama");
  await panorama.scrollIntoViewIfNeeded();
  await expect(panorama).toBeInViewport();
  const positions = await sheet.evaluate((element) => {
    const chrome = element.querySelector(".map-sheet-chrome")!.getBoundingClientRect();
    const landscape = element.querySelector(".bench-panorama")!.getBoundingClientRect();
    return { chromeBottom: chrome.bottom, landscapeTop: landscape.top };
  });
  expect(positions.landscapeTop).toBeGreaterThanOrEqual(positions.chromeBottom - 1);
  await resize.click();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  await page.screenshot({ path: testInfo.outputPath("short-phone-collapsed-bench-sheet.png") });

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
  const dailyBench = page.locator(".daily-bench-link");
  await dailyBench.scrollIntoViewIfNeeded();
  const sourceScroll = await page.evaluate(() => window.scrollY);
  await dailyBench.click();
  await expect(page).toHaveURL(/\/bank\/[^?]+\?from=statistics&return=/);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(page).toHaveURL(/\/statistiken$/);
  await expect(dailyBench).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(sourceScroll);
});

test("activates the raster fallback when the vector style fails", async ({ page }, testInfo) => {
  await page.route("https://vectortiles.geo.admin.ch/styles/**", (route) => route.abort("failed"));
  await page.goto("/");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-basemap", "fallback", { timeout: 5_000 });
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(page.getByLabel("Ort suchen")).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("map-raster-fallback.png"), fullPage: false });
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
  await page.getByRole("button", { name: /Bewertungen ansehen/ }).first().click();
  await page.getByRole("button", { name: "Zum Mitmachen kurz anmelden" }).click();
  await expect(page.getByRole("dialog", { name: "Willkommen zurück" })).toBeVisible();
  const t = testTranslator();
  await expect(page.getByRole("dialog", { name: "Willkommen zurück" }).locator(".auth-intent"))
    .toHaveText(t("account.dialog.intent", { intent: t("bench.story.rateIntent") }));
  await expect(page.getByRole("button", { name: "Bewertung veröffentlichen" })).toHaveCount(0);
});

test("registers and writes a rating plus structured bench metadata", async ({ page, browserName }) => {
  await registerUser(page, `writer-${browserName}`);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: /Bewertungen ansehen/ }).first().click();
  await page.getByRole("button", { name: /Einen Eindruck beitragen|Meinen Beitrag bearbeiten/ }).click();
  const contribution = page.getByRole("dialog", { name: "Wie war deine Pause?" });
  await contribution.getByRole("group", { name: "Gesamt", exact: true }).getByRole("radio", { name: "5 Sterne" }).check();
  await contribution.locator(".rating-detail-disclosure summary").click();
  await contribution.getByRole("group", { name: "Aussicht", exact: true }).getByRole("radio", { name: "4 Sterne" }).check();
  await contribution.getByRole("group", { name: "Komfort", exact: true }).getByRole("radio", { name: "4 Sterne" }).check();
  await contribution.getByRole("group", { name: "Ruhe", exact: true }).getByRole("radio", { name: "5 Sterne" }).check();
  await page.getByPlaceholder("Was hat dir hier gefallen?").fill("Playwright-Testbewertung");
  await page.getByRole("button", { name: "Bewertung veröffentlichen" }).click();
  await expect(page.getByText("Danke – deine Bewertung ist sichtbar.")).toBeVisible();
  await contribution.getByRole("button", { name: "Beiträge schliessen" }).click();
  await page.getByRole("button", { name: "Zum Platz" }).click();
  await page.getByRole("button", { name: "Bänkli beschreiben", exact: true }).click();
  const features = page.getByRole("dialog", { name: "Bänkli beschreiben" });
  await features.getByRole("button", { name: /Armlehnen/ }).click();
  await features.getByRole("button", { name: "Ja", exact: true }).click();
  await expect(features.getByRole("button", { name: /Armlehnen Ja/ })).toBeVisible();
});

test("publishes an overall rating without optional detail stars", async ({ page, browserName }) => {
  await registerUser(page, `overall-only-${browserName}`);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: /Bewertungen ansehen/ }).first().click();
  await page.getByRole("button", { name: /Einen Eindruck beitragen|Meinen Beitrag bearbeiten/ }).click();
  const contribution = page.getByRole("dialog", { name: "Wie war deine Pause?" });
  await contribution.getByRole("group", { name: "Gesamt", exact: true }).getByRole("radio", { name: "5 Sterne" }).check();
  await expect(contribution.getByRole("group", { name: "Aussicht", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Bewertung veröffentlichen" }).click();
  await expect(page.getByText("Danke – deine Bewertung ist sichtbar.")).toBeVisible();
});

test("fine-tunes the bench direction to one degree using the landscape preview", async ({ page, browserName }, testInfo) => {
  await registerUser(page, `bearing-${browserName}-${Date.now().toString().slice(-5)}`);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: "Bänkli beschreiben", exact: true }).click();
  const features = page.getByRole("dialog", { name: "Bänkli beschreiben" });
  await features.getByRole("button", { name: /Blickrichtung/ }).click();
  const slider = features.getByRole("slider", { name: "Blickrichtung feinjustieren" });
  await slider.fill("213");
  await expect(features.locator("output")).toHaveText("SW · 213°");
  await page.screenshot({ path: testInfo.outputPath("direction-fine-tuner.png") });
  await features.getByRole("button", { name: "Ausrichtung speichern" }).click();
  await expect(features.getByRole("button", { name: /Blickrichtung SW · 213°/ })).toBeVisible();
});

test("bench, journey and walk use one mobile sheet handle with consistent snap gestures", async ({ page }, testInfo) => {
  await page.goto("/?bank=osm-node-101");
  const shell = page.locator(".map-sheet-shell");
  await expect(shell).toHaveAttribute("data-snap", "full");
  await expect(shell.locator(".map-sheet-close")).toContainText("Karte");
  await expect(shell.locator(".map-sheet-minimize")).toHaveAccessibleName("Details auf eine Leiste minimieren");
  await expect(shell.locator(".map-sheet-resize")).toHaveAccessibleName("Kompakter. Detailhöhe ändern");
  await shell.locator(".map-sheet-resize").click();
  await expect(shell).toHaveAttribute("data-snap", "half");
  await shell.locator(".map-sheet-resize").click();
  await expect(shell).toHaveAttribute("data-snap", "full");
  const content = shell.locator(".map-sheet-content");
  const readingPosition = await content.evaluate((node) => {
    node.scrollTop = Math.min(240, node.scrollHeight - node.clientHeight);
    return node.scrollTop;
  });
  expect(readingPosition).toBeGreaterThan(0);
  await shell.getByRole("button", { name: "Details auf eine Leiste minimieren" }).click();
  await expect(shell).toHaveAttribute("data-snap", "peek");
  await expect(shell.locator(".map-sheet-resize")).toHaveAccessibleName("Ganz öffnen. Detailhöhe ändern");
  await expect(shell.locator(".map-sheet-collapsed-title")).toHaveText("Bankdetails");
  await expect(shell.locator(".map-sheet-content")).not.toBeVisible();
  await expect(page.locator(".map-location-control")).toHaveCount(0);
  await expect.poll(async () => (await shell.boundingBox())?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(90);
  await page.screenshot({ path: testInfo.outputPath("minimized-detail-bar.png") });
  await shell.locator(".map-sheet-resize").click();
  await expect(shell).toHaveAttribute("data-snap", "full");
  await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBe(readingPosition);
  // Zero is also a deliberate reading position, not a missing saved value.
  await content.evaluate((node) => { node.scrollTop = 0; });
  await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBe(0);
  await shell.locator(".map-sheet-minimize").click();
  await expect(shell).toHaveAttribute("data-snap", "peek");
  await shell.locator(".map-sheet-resize").click();
  await expect(shell).toHaveAttribute("data-snap", "full");
  await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBe(0);
  await shell.locator(".map-sheet-resize").click();
  await expect(shell).toHaveAttribute("data-snap", "half");
  await shell.locator(".map-sheet-resize").dispatchEvent("touchstart", { touches: [{ identifier: 1, clientY: 200 }] });
  await shell.locator(".map-sheet-resize").dispatchEvent("touchend", { changedTouches: [{ identifier: 1, clientY: 300 }] });
  await expect(shell).toHaveAttribute("data-snap", "peek");
  await page.waitForTimeout(400);
  await shell.locator(".map-sheet-resize").click();
  await expect(shell).toHaveAttribute("data-snap", "half");
  await shell.getByRole("button", { name: "Weg planen" }).click();
  await expect(shell).toHaveAttribute("aria-label", "Dein Weg zum Bänkli");
  await expect(shell.locator(".map-sheet-handle")).toBeVisible();
  await shell.locator(".map-sheet-close").click();
  await expect(shell).toHaveAttribute("aria-label", "Bankdetails");
  await shell.locator(".map-sheet-close").click();
  await expect(page.getByRole("complementary", { name: "Bankdetails" })).toHaveCount(0);
  await page.locator(".walk-entry").click();
  await expect(shell).toHaveAttribute("aria-label", "Spaziergang entdecken");
  await expect(shell.locator(".map-sheet-handle")).toBeVisible();
});

test("keeps the bench task readable at 200% text on a 320 CSS-pixel viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?bank=osm-node-101");
  await page.addStyleTag({ content: ":root { font-size: 200% !important; }" });

  const shell = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(shell.getByRole("heading", { name: "Lindenhof, Zürich" })).toBeVisible();
  await expect(shell.getByRole("button", { name: "Weg planen" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  await shell.getByRole("button", { name: "Details auf eine Leiste minimieren" }).click();
  await expect(shell).toHaveAttribute("data-snap", "peek");
  const chrome = shell.locator(".map-sheet-chrome");
  const bounds = await chrome.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-2);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(322);
  await expect(shell.getByRole("button", { name: "Bank schliessen" })).toBeVisible();
  await expect(shell.getByRole("button", { name: "Ganz öffnen. Detailhöhe ändern" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("bench-task-200-percent-text.png") });
});

test("renders task, selected-filter, muted, and watercolor text with sufficient contrast", async ({ page }) => {
  await page.goto("/?bank=osm-node-101");
  const shell = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(shell.getByRole("heading", { name: "Lindenhof, Zürich" })).toBeVisible();
  expect(await renderedContrast(shell.getByRole("heading", { name: "Lindenhof, Zürich" }))).toBeGreaterThanOrEqual(4.5);
  const muted = shell.locator(".bench-location").first();
  await expect(muted).toBeVisible();
  expect(await renderedContrast(muted)).toBeGreaterThanOrEqual(4.5);

  await shell.getByRole("button", { name: "Details auf eine Leiste minimieren" }).click();
  expect(await renderedContrast(shell.locator(".map-sheet-collapsed-title"))).toBeGreaterThanOrEqual(4.5);
  await page.getByRole("button", { name: "Filter öffnen" }).click();
  const shade = page.getByRole("dialog", { name: "Was brauchst du?" }).getByRole("button", { name: "Schatten", exact: true });
  await shade.click();
  expect(await renderedContrast(shade)).toBeGreaterThanOrEqual(4.5);
});

test("opens a shared bench with the map already focused underneath", async ({ page }) => {
  await page.goto("/?bank=osm-node-101");
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true", { timeout: 8_000 });
  await expect(map).toHaveAttribute("data-focus-bench", "osm-node-101");
  await expect.poll(async () => Number(await map.getAttribute("data-zoom"))).toBeGreaterThan(16);
  const center = await map.evaluate((element) => ({ latitude: Number((element as HTMLElement).dataset.centerLatitude), longitude: Number((element as HTMLElement).dataset.centerLongitude) }));
  expect(Math.abs(center.latitude - 47.37674)).toBeLessThan(.01);
  expect(Math.abs(center.longitude - 8.54183)).toBeLessThan(.01);
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
  await expect(page.getByText("Bestehende Bänkli in der Nähe werden geprüft …")).toHaveCount(0, { timeout: 15_000 });
  const duplicateCheck = page.getByLabel("Geprüft: Meins ist ein weiteres Bänkli.");
  if (await duplicateCheck.isVisible()) await duplicateCheck.check();
  await page.evaluate(() => { (window as Window & { benchCreationDocument?: boolean }).benchCreationDocument = true; });
  await page.getByRole("button", { name: "Eintragen", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Bänkli eintragen", exact: true })).toBeHidden();
  await expect(page.getByText("Bänkli eingetragen", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: benchName, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]bank=community-[^&#]+/);
  expect(await page.evaluate(() => (window as Window & { benchCreationDocument?: boolean }).benchCreationDocument)).toBe(true);
  // Keep the hard navigation: creation must commit before success is exposed,
  // and a fresh page must find the persisted bench, not just optimistic state.
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
  await expect(page.locator(".bench-overview").getByText("Sonne & Schatten", { exact: true })).toBeVisible();
  await page.locator(".bench-sources > summary").click();
  await expect(page.locator(".detail-panel-view").getByText("Was den Horizont prägt")).toBeVisible();
  await expect(page.locator(".distance-ribbon")).toContainText("Weg oder Strasse");
  await expect(page.locator(".distance-ribbon")).toContainText("direkt");
  await expect(page.getByText("Durchs Jahr")).toHaveCount(0);
});

test("does not expose a web moderation view", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByLabel("Passwort")).toHaveCount(0);
});
