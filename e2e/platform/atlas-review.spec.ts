import { expect, test, type Page, type TestInfo } from "@playwright/test";
import Database from "better-sqlite3";
import { installReviewPainting } from "../support/review-painting";
import { installAtlasPlaces } from "../support/atlas-places";

test.use({ serviceWorkers: "block", deviceScaleFactor: 1 });

async function capture(page: Page, info: TestInfo, name: string, fullPage = false) {
  if (/^(preview|discovery)-/.test(name)) {
    await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-camera-moving", "false");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  }
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled", fullPage });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

test("atlas phone discovery, painting and return state", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await installReviewPainting();
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await page.waitForLoadState("networkidle");
  await capture(page, info, "discovery-390");
  const navigation = page.getByRole("navigation", { name: "Dein Atlas" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("button", { name: "Mein Buch", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Mein Buch", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Willkommen zurück" })).toBeHidden();
  await page.getByRole("dialog", { name: "Mein Buch", exact: true }).getByRole("button", { name: "schliessen", exact: true }).first().click();
  await expect(navigation.getByRole("button", { name: "Mein Buch", exact: true })).toBeFocused();
  const search = page.getByRole("combobox", { name: "Ort suchen", exact: true });
  await search.fill("Lindenhof");
  await expect(page.locator(".map-search-results [role=option]").first()).toBeVisible();
  await capture(page, info, "search-390");
  await search.press("ArrowDown");
  await search.press("Enter");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".bench-header")).toBeVisible();
  // Both URL and marker entry points share the same two-state presentation.
  if (await sheet.getAttribute("data-presentation") === "preview") await sheet.getByRole("button", { name: "Zum Bänkli", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-presentation", "place");
  await expect(sheet.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached();
  const panorama = sheet.locator(".bench-panorama");
  await panorama.evaluate(node => { (node as HTMLElement).dataset.retained = "yes"; });
  const poem = await sheet.locator(".bench-poem").textContent();
  await capture(page, info, "bench-390");
  await sheet.getByRole("button", { name: "Vorschau", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-presentation", "preview");
  await capture(page, info, "preview-390");
  await sheet.getByRole("button", { name: "Zum Bänkli", exact: true }).click();
  await expect(panorama).toHaveAttribute("data-retained", "yes");
  await expect(sheet.locator(".bench-poem")).toHaveText(poem!);
  await expect(sheet.locator(".bench-actions")).toHaveCount(1);
  const save = sheet.getByRole("button", { name: "Merken", exact: true });
  await save.click();
  const account = page.getByRole("dialog", { name: "Willkommen zurück" });
  await expect(account).toBeVisible();
  await account.getByRole("button", { name: "Schliessen", exact: true }).first().click();
  await expect(save).toBeFocused();
  await sheet.getByRole("button", { name: "Panorama gross im 360-Grad-Modus öffnen", exact: true }).click();
  await expect(panorama).toHaveClass(/is-expanded/);
  await capture(page, info, "panorama-390");
  await sheet.getByRole("button", { name: "360-Grad-Grossansicht schliessen", exact: true }).click();
  await expect(panorama).toHaveAttribute("data-retained", "yes");
  await expect(sheet.locator(".bench-poem")).toHaveText(poem!);
  expect(await sheet.locator(".visit-essentials p").count()).toBeLessThanOrEqual(3);
  await sheet.locator(".bench-visit-details > details > summary").click();
  const scroller = sheet.locator(".map-sheet-content");
  await scroller.evaluate(node => { node.scrollTop = 150; });
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBe(150);
  await sheet.getByRole("button", { name: "Weg planen", exact: true }).click();
  const route = page.locator(".map-sheet-planner");
  await expect(route).toBeVisible();
  await route.locator(".map-sheet-close").click();
  await expect(sheet.locator(".bench-visit-details > details")).toHaveAttribute("open", "");
  await expect.poll(() => sheet.locator(".map-sheet-content").evaluate(node => node.scrollTop)).toBe(150);
  await sheet.locator(".map-sheet-close").click();
  await expect(navigation).toBeVisible();
});

test("atlas short phone, enlarged text and keyboard-safe search", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await installReviewPainting();
  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(sheet).toHaveAttribute("data-presentation", "place");
  await expect(sheet.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached();
  await capture(page, info, "bench-320");
  await expect(sheet.locator(".atlas-place-toggle")).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(sheet).toHaveAttribute("data-reading-layout", "flow");
  await sheet.locator(".bench-save-action").scrollIntoViewIfNeeded();
  await expect(sheet.locator(".bench-save-action")).toBeInViewport();
  await expect(sheet.locator(".bench-route-action")).toBeInViewport();
  await capture(page, info, "bench-320-large-text");
  const dimensions = await sheet.locator(".bench-route-action").boundingBox();
  expect(dimensions!.height).toBeGreaterThanOrEqual(48);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.setViewportSize({ width: 844, height: 390 });
  await capture(page, info, "bench-landscape");
  await expect(sheet.locator(".bench-save-action")).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Ort suchen", exact: true });
  await search.fill("Lindenhof");
  await page.setViewportSize({ width: 390, height: 430 });
  await expect(page.locator(".map-search-results [role=option]").first()).toBeVisible();
  await capture(page, info, "search-short-viewport");
  await page.getByRole("button", { name: "Zur Karte", exact: true }).click();
  await expect(page.getByRole("search", { name: "Ort suchen", exact: true })).toBeFocused();
  await expect(search).toHaveValue("Lindenhof");
  await expect(page.locator('.atlas-search')).toHaveAttribute("data-focused", "false");
});

test("atlas real urban, waterfront and alpine place paintings", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const places = await installAtlasPlaces();
  for (const place of places) {
    await page.goto(`/?bank=${place.id}`);
    const sheet = page.getByRole("complementary", { name: "Bankdetails" });
    await expect(sheet.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached();
    await expect(sheet.locator(".bench-poem")).not.toBeEmpty();
    await capture(page, info, `${place.category}-390`);
    await page.setViewportSize({ width: 320, height: 568 });
    await capture(page, info, `${place.category}-320`);
    await page.setViewportSize({ width: 390, height: 844 });
  }
});

test("atlas personal journal preserves entries and saved places", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await installReviewPainting();
  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await sheet.getByRole("button", { name: "Merken", exact: true }).click();
  await page.getByRole("button", { name: "Registrieren", exact: true }).click();
  const username = `Atlas-${Date.now().toString(36)}`;
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  await expect(sheet.locator(".bench-save-action")).toHaveAttribute("aria-pressed", "true");
  const db = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    const user = db.prepare("SELECT id FROM users WHERE username_key=?").get(username.toLowerCase()) as { id: number };
    const bench = db.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number };
    const insert = db.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,created_at,updated_at,visible) VALUES(?,?,'memory',?,?,?,1)");
    insert.run(bench.row_id, user.id, "Der Weg hatte es eilig. Wir nicht.", "2026-10-20T12:00:00Z", "2026-10-20T12:00:00Z");
    insert.run(bench.row_id, user.id, "Eine Pause zwischen zwei Verabredungen. Hier durfte die nächste noch warten.", "2026-10-18T12:00:00Z", "2026-10-18T12:00:00Z");
  } finally { db.close(); }
  await sheet.locator(".map-sheet-close").click();
  await page.getByRole("navigation", { name: "Dein Atlas" }).getByRole("link", { name: "Mein Buch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mein Buch", exact: true })).toBeVisible();
  await expect(page.locator(".journal-memory")).toHaveCount(2);
  await page.locator(".journal-entry .place-painting img").nth(1).evaluate(node => (node as HTMLImageElement).decode());
  await capture(page, info, "journal-390");
  await capture(page, info, "journal-full", true);
  await expect(page.locator(".journal-collection")).not.toHaveAttribute("open", "");
  await page.getByRole("link", { name: /Lieblingsplätze/ }).click();
  await expect(page.locator(".saved-bench-item")).toHaveCount(1);
  // Primary navigation is a client transition: returning from the book keeps
  // the map and wishes, rather than constructing a fresh country overview.
  await page.getByRole("link", { name: "Zur Karte", exact: true }).click();
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await page.getByRole("button", { name: "Filter öffnen", exact: true }).click();
  await page.getByRole("button", { name: "Rückenlehne", exact: true }).click();
  await page.getByRole("button", { name: "Karte ansehen", exact: true }).click();
  const camera = await map.evaluate(node => ({ latitude: node.getAttribute("data-center-latitude"), longitude: node.getAttribute("data-center-longitude"), zoom: node.getAttribute("data-zoom") }));
  await page.getByRole("navigation", { name: "Dein Atlas" }).getByRole("link", { name: "Mein Buch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mein Buch", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Dein Atlas" }).getByRole("link", { name: "Karte", exact: true }).click();
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(map).toHaveAttribute("data-center-latitude", camera.latitude!);
  await expect(map).toHaveAttribute("data-center-longitude", camera.longitude!);
  await expect(map).toHaveAttribute("data-zoom", camera.zoom!);
  await expect(page.getByRole("button", { name: "Rückenlehne entfernen", exact: true })).toBeVisible();
});
