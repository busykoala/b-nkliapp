import { expect, test, type Page, type TestInfo } from "@playwright/test";
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { installReviewPainting } from "../support/review-painting";

test.use({ serviceWorkers: "block", deviceScaleFactor: 1 });

async function shot(page: Page, info: TestInfo, name: string) {
  const map = page.getByLabel("Karte der Schweizer Sitzbänke");
  if (await map.count()) {
    await expect(map).toHaveAttribute("data-map-ready", "true");
    await expect(map).toHaveAttribute("data-camera-moving", "false");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter(img => {
      const r = img.getBoundingClientRect();
      let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right);
      let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
      for (let parent = img.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
        if (style.overflowX !== "visible") { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
        if (style.overflowY !== "visible") { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
      return right > left && bottom > top;
    }).map(img => img.decode().catch(() => {})));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

for (const { width, height } of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 900 }, { width: 844, height: 390 }, { width: 768, height: 1024 }]) {
  test(`refinement matched tour ${width}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    await page.clock.setFixedTime(new Date("2026-10-22T12:00:00Z"));
    const requests: object[] = [];
    const errors: string[] = [];
    page.on("response", response => {
      if (/geo.admin|\.pbf|style.*json/.test(response.url())) requests.push({ url: response.url(), status: response.status() });
    });
    page.on("requestfailed", request => requests.push({ url: request.url(), failure: request.failure()?.errorText }));
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await installReviewPainting();
    await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-map-ready", "true");
    await page.waitForLoadState("networkidle");
    await shot(page, info, "discovery");
    expect((await page.getByLabel("Menü öffnen").locator("svg").boundingBox())!.width).toBeGreaterThanOrEqual(20);
    await page.getByLabel("Menü öffnen").click();
    await shot(page, info, "menu");
    await page.getByLabel("Menü schliessen").click();
    await page.getByRole("button", { name: "Filter öffnen", exact: true }).click();
    await page.getByRole("button", { name: "Rückenlehne", exact: true }).click();
    await shot(page, info, "filters");
    await page.getByLabel("Filter schliessen").click();
    await page.getByRole("combobox", { name: "Ort suchen", exact: true }).fill("Lindenhof");
    await expect(page.locator(".map-search-results [role=option]").first()).toBeVisible();
    await shot(page, info, "search");
    await page.locator(".map-search-results [role=option]").first().click();
    const sheet = page.locator(".bench-atlas-sheet");
    await expect(sheet.locator(".bench-header")).toBeVisible();
    // The full-size C30 artwork and mask must really render. Hosted WebKit
    // also performs cold dev compilation and software rendering: keep a
    // bounded readiness budget, without reducing or replacing the artwork.
    await expect(sheet.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached({ timeout: process.env.CI ? 15_000 : 5_000 });
    await expect(page.getByLabel("Karte der Schweizer Sitzbänke")).toHaveAttribute("data-camera-moving", "false");
    await page.waitForLoadState("networkidle");
    await shot(page, info, "bench-entry");
    if (await sheet.getAttribute("data-presentation") === "preview") await sheet.locator(".atlas-place-toggle").click();
    await shot(page, info, "bench");
    if (await sheet.locator(".atlas-place-toggle").count()) {
      await sheet.locator(".atlas-place-toggle").click();
      await page.waitForLoadState("networkidle");
      await shot(page, info, "preview");
      await sheet.locator(".atlas-place-toggle").click();
    }
    await sheet.locator(".bench-panorama-expand").click();
    await expect(sheet.locator(".bench-panorama.is-expanded")).toBeVisible();
    await shot(page, info, "panorama");
    await sheet.locator(".bench-panorama-expand").click();
    await sheet.getByRole("button", { name: "Weg planen", exact: true }).click();
    await expect(page.locator(".map-sheet-planner")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Start: Adresse oder Haltestelle", exact: true })).toBeVisible();
    await shot(page, info, "directions");
    await page.locator(".map-sheet-planner .map-sheet-close").click();
    await sheet.getByRole("button", { name: "Merken", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Willkommen zurück" })).toBeVisible();
    await shot(page, info, "authentication");
    await page.getByRole("button", { name: "Registrieren", exact: true }).click();
    const username = `Nora-${info.project.name === "mobile-chrome" ? "C" : "W"}-${width}`;
    await page.getByLabel("Benutzername").fill(username);
    await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    await expect(sheet.locator(".bench-save-action")).toHaveAttribute("aria-pressed", "true");
    await shot(page, info, "bench-saved");
    await sheet.getByRole("button", { name: "Etwas beitragen", exact: true }).click();
    const contribution = page.locator(".contribution-dialog[open]");
    await expect(contribution).toBeVisible();
    await shot(page, info, "contributions");
    await contribution.getByRole("button", { name: "Erinnerung teilen", exact: true }).click();
    await expect(contribution.locator("h2")).toBeFocused();
    const memory = contribution.getByLabel("Dein Bänkli-Moment");
    await memory.click();
    await memory.fill("Der Weg hatte es eilig. Wir nicht.");
    await expect(memory).toHaveValue("Der Weg hatte es eilig. Wir nicht.");
    await shot(page, info, "memory-form");
    await contribution.getByRole("button", { name: "Beiträge schliessen" }).click();
    await contribution.getByRole("button", { name: "Verwerfen und schliessen", exact: true }).click();
    const db = new Database(process.env.BENCHLY_E2E_DATABASE!);
    try {
      const user = db.prepare("SELECT id FROM users WHERE username_key=?").get(username.toLowerCase()) as { id: number };
      const bench = db.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number };
      db.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,created_at,updated_at,visible) VALUES(?,?,'memory',?,'2026-10-20T12:00:00Z','2026-10-20T12:00:00Z',1)")
        .run(bench.row_id, user.id, "Der Weg hatte es eilig. Wir nicht.");
    } finally { db.close(); }
    await sheet.locator(".map-sheet-close").click();
    await page.getByLabel("Menü öffnen").click();
    await shot(page, info, "menu-signed-in");
    await page.getByLabel("Menü schliessen").click();
    await page.getByRole("navigation", { name: "Dein Atlas" }).getByRole("link", { name: "Mein Buch", exact: true }).click();
    await expect(page.locator(".journal-memory")).toHaveCount(1);
    if (process.env.BENCHLY_ATLAS_REFINEMENT === "1") {
      if (width === 390) expect((await page.locator(".journal-entry").first().boundingBox())!.y).toBeLessThanOrEqual(320);
      await expect(page.locator(".journal-account")).not.toHaveAttribute("open", "");
      await expect(page.locator(".journal-entry .place-painting")).toHaveAttribute("data-crop-heading", "205");
    }
    await shot(page, info, "journal");
    if (process.env.BENCHLY_ATLAS_REFINEMENT === "1") {
      await page.locator(".journal-entry").first().click();
      await expect(page.locator(".standalone-bench .bench-header")).toBeVisible();
      await page.getByRole("button", { name: "Zurück", exact: true }).click();
      await expect(page.locator(".journal-entry").first()).toBeFocused();
      await expect(page).toHaveURL(/\/profil$/);
    }
    await page.locator(".profile-favourites").click();
    await expect(page.locator(".saved-bench-item")).toHaveCount(1);
    await shot(page, info, "favourites");
    await page.goto("/?action=walk");
    await expect(page.locator(".map-sheet-planner")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Start: Adresse oder Haltestelle", exact: true })).toBeVisible();
    await shot(page, info, "walk");
    for (const [path, name] of [["/feed", "feed"], ["/gedanken/baenkli", "reading"], ["/impressum", "legal"], ["/statistiken", "statistics"]]) {
      await page.goto(path);
      await shot(page, info, name);
    }
    writeFileSync(info.outputPath("diagnostics.json"), JSON.stringify({ requests, errors }, null, 2));
    expect(errors).toEqual([]);
  });
}

test("refinement matched performance samples", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await installReviewPainting();
  const samples = [];
  for (let index = 0; index < 3; index++) {
    await page.goto("/?bank=osm-node-101");
    await expect(page.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached();
    const readyMs = await page.evaluate(() => performance.now());
    const openStarted = Date.now();
    await page.locator(".bench-panorama-expand").click();
    await expect(page.locator(".bench-panorama.is-expanded")).toBeVisible();
    const interactionMs = Date.now() - openStarted;
    await page.waitForLoadState("networkidle");
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => {
      const resource = entry as PerformanceResourceTiming;
      return { url: resource.name, type: resource.initiatorType, bytes: resource.transferSize, encodedBytes: resource.encodedBodySize };
    }));
    samples.push({ readyMs, interactionMs, resources });
  }
  writeFileSync(info.outputPath("performance.json"), JSON.stringify({ viewport: [390, 844], samples }, null, 2));
});

test("refinement bench composition preserves the place and gives enlarged text its own scroll", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await installReviewPainting();
  await page.goto("/?bank=osm-node-101");
  const sheet = page.locator(".bench-atlas-sheet");
  await expect(sheet.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached({ timeout: process.env.CI ? 15_000 : 5_000 });
  await expect(sheet.getByRole("button", { name: "Vorschau", exact: true })).toBeVisible();
  await expect(sheet.locator(".atlas-wordmark")).toHaveCount(0);
  await expect(sheet.locator(".bench-panorama-foreground")).toBeHidden();
  const painting = sheet.locator(".bench-panorama");
  const poem = await sheet.locator(".bench-poem").textContent();
  await painting.evaluate(node => { (node as HTMLElement).dataset.kept = "yes"; });
  await sheet.getByRole("button", { name: "Vorschau", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-presentation", "preview");
  await expect(sheet.locator(".bench-panorama-viewport")).toHaveCSS("height", "128px");
  await shot(page, info, "bench-preview");
  await sheet.getByRole("button", { name: "Zum Bänkli", exact: true }).click();
  await expect(painting).toHaveAttribute("data-kept", "yes");
  await expect(sheet.locator(".bench-poem")).toHaveText(poem!);
  await expect(sheet.locator(".bench-actions")).toHaveCount(1);
  await shot(page, info, "bench-390");
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate(node => node.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(sheet.locator(".atlas-place-toggle")).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(sheet).toHaveAttribute("data-reading-layout", "flow");
  await sheet.locator(".bench-poem").scrollIntoViewIfNeeded();
  await expect(sheet.locator(".bench-poem")).toBeInViewport();
  await shot(page, info, "reading-200-poem");
  await sheet.locator(".bench-visit-details > details > summary").scrollIntoViewIfNeeded();
  await shot(page, info, "reading-200-details");
  await sheet.getByRole("button", { name: "Etwas beitragen", exact: true }).scrollIntoViewIfNeeded();
  await expect(sheet.getByRole("button", { name: "Etwas beitragen", exact: true })).toBeInViewport();
  await sheet.locator(".bench-save-action").scrollIntoViewIfNeeded();
  await expect(sheet.locator(".bench-route-action")).toBeInViewport();
  await expect(sheet.locator(".bench-save-action")).toBeInViewport();
  await shot(page, info, "reading-200-actions");
  await sheet.locator(".bench-save-action").click();
  const account = page.getByRole("dialog", { name: "Willkommen zurück" });
  await expect(account).toBeVisible();
  await account.getByRole("button", { name: "Schliessen", exact: true }).first().click();
  await expect(sheet.locator(".bench-save-action")).toBeFocused();
});

test("refinement wishes use explicit choices with an unrestricted light option", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Filter öffnen", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "Was brauchst du?", exact: true });
  await expect(filter.locator("input[type=checkbox],.filter-choice-mark path[d^='m3.7']")).toHaveCount(0);
  const any = filter.getByRole("button", { name: "Egal", exact: true });
  const sun = filter.getByRole("button", { name: "Sonne", exact: true });
  const shade = filter.getByRole("button", { name: "Schatten", exact: true });
  await expect(any).toHaveAttribute("aria-pressed", "true");
  await sun.click();
  await expect(sun).toHaveAttribute("aria-pressed", "true");
  await expect(any).toHaveAttribute("aria-pressed", "false");
  await shade.click();
  await expect(sun).toHaveAttribute("aria-pressed", "false");
  await expect(shade).toHaveAttribute("aria-pressed", "true");
  await any.click();
  await expect(any).toHaveAttribute("aria-pressed", "true");
  await expect(shade).toHaveAttribute("aria-pressed", "false");
  await filter.getByRole("button", { name: "Rückenlehne", exact: true }).click();
  await shot(page, info, "wishes-explicit-390");
  await filter.getByLabel("Filter schliessen").click();
  await page.getByLabel("Menü öffnen").click();
  await expect(page.locator('.atlas-wordmark > path[stroke]')).toHaveCount(0);
  await shot(page, info, "wordmark-without-underline");
});

test("refinement panorama controls retain pose and search has a clear return", async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await installReviewPainting();
  await page.goto("/?bank=osm-node-101");
  const sheet = page.locator(".bench-atlas-sheet");
  await expect(sheet.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached({ timeout: process.env.CI ? 15_000 : 5_000 });
  const panorama = sheet.locator(".bench-panorama");
  await panorama.locator(".bench-panorama-expand").click();
  const viewport = panorama.locator(".bench-panorama-viewport");
  await viewport.press("ArrowRight");
  await viewport.press("ArrowUp");
  await expect(panorama.locator(".bench-panorama-zoom-controls,.panorama-tools")).toHaveCount(0);
  await shot(page, info, "panorama-controls-390");
  const help = panorama.locator("summary");
  await help.click();
  await expect(panorama.locator("details p")).toBeVisible();
  await shot(page, info, "panorama-help-390");
  await help.click();
  for (const control of await panorama.locator("button,summary").all()) {
    const rect = await control.boundingBox();
    expect(rect?.width).toBeGreaterThanOrEqual(48);
    expect(rect?.height).toBeGreaterThanOrEqual(48);
  }
  const pose = await panorama.locator(".bench-panorama-track").getAttribute("style");
  await panorama.locator(".bench-panorama-expand").click();
  await expect(sheet.locator(".bench-panorama-expand")).toBeFocused();
  await panorama.locator(".bench-panorama-expand").click();
  await expect(panorama.locator(".bench-panorama-track")).toHaveAttribute("style", pose!);
  await viewport.press("Escape");
  await expect(panorama).toHaveClass(/is-static/);
  await expect(sheet).toBeVisible();
  await sheet.locator(".map-sheet-close").click();
  const search = page.getByRole("combobox", { name: "Ort suchen", exact: true });
  await search.fill("Lindenhof");
  await expect(page.locator(".map-search-results [role=option]").first()).toBeVisible();
  const back = page.getByRole("button", { name: "Zur Karte", exact: true });
  const clear = page.getByRole("button", { name: "Suche leeren", exact: true });
  expect((await back.boundingBox())!.x).toBeLessThan((await clear.boundingBox())!.x);
  await shot(page, info, "search-focused-390");
  await back.click();
  await expect(page.getByRole("search", { name: "Ort suchen", exact: true })).toBeFocused();
  await expect(search).toHaveValue("Lindenhof");
});

test("refinement larger-screen reading panels and full-screen viewer have real bounds", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await installReviewPainting();
  for (const size of [{ width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await page.goto("/?bank=osm-node-101");
    const sheet = page.locator(".bench-atlas-sheet");
    await expect(sheet.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached({ timeout: process.env.CI ? 15_000 : 5_000 });
    const panel = (await sheet.boundingBox())!;
    if (size.width === 768) expect(panel.width).toBeLessThanOrEqual(640);
    else {
      expect(panel.width).toBeGreaterThanOrEqual(440);
      expect(panel.width).toBeLessThanOrEqual(520);
      const map = (await page.getByLabel("Karte der Schweizer Sitzbänke").boundingBox())!;
      expect(map.x + map.width).toBeLessThanOrEqual(panel.x + 1);
    }
    await shot(page, info, `panel-${size.width}`);
    await sheet.locator(".bench-panorama-expand").click();
    const viewer = sheet.locator(".bench-panorama.is-expanded");
    await expect.poll(async () => {
      const bounds = (await viewer.boundingBox())!;
      return Math.abs(bounds.x) + Math.abs(bounds.y) + Math.abs(bounds.width - size.width) + Math.abs(bounds.height - size.height);
    }).toBeLessThanOrEqual(2);
    await shot(page, info, `viewer-${size.width}`);
    await viewer.locator(".bench-panorama-expand").click();
  }
});

test("refinement sparse, conflicting and access facts stay honest in the reading layout", async ({ page }, info) => {
  const { createIsolatedPanoramaBench, removeIsolatedPanoramaBench, installTerrainPanoramaFixture } = await import("../support/panorama-fixture");
  const id = createIsolatedPanoramaBench();
  const db = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    const row = (db.prepare("SELECT row_id FROM benches WHERE id=?").get(id) as { row_id: number }).row_id;
    db.prepare("UPDATE benches SET name=NULL,backrest=NULL,armrest=NULL WHERE id=?").run(id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?bank=${id}`);
    const sheet = page.locator(".bench-atlas-sheet");
    await expect(sheet.locator(".bench-header h2")).toBeVisible();
    expect(await sheet.locator("[data-visit-hint]").count()).toBeLessThanOrEqual(3);
    await expect(sheet.locator(".bench-overview")).not.toContainText(/noch nicht erfasst|dB|Sitzplätze/);
    await shot(page, info, "unnamed-sparse-artwork-missing");
    db.prepare("UPDATE benches SET name=?,backrest=1 WHERE id=?").run("Ein Bänkli mit einem aussergewöhnlich langen Namen am Ende unseres gemeinsamen Spaziergangs",id);
    db.prepare(`INSERT INTO bench_attribute_state(bench_row_id,attribute,value_json,confidence,conflicting,evidence_count,source_types_json,method_version,resolved_at)
      VALUES(?,'backrest','1','low',1,2,'["community"]','test','2026-10-22')`).run(row);
    db.prepare(`INSERT INTO bench_approaches(bench_row_id,steps,step_free_possible,barriers_json,confidence,evidence_json,method_version,computed_at)
      VALUES(?,1,0,'[]','high','{}','test','2026-10-22')`).run(row);
    await installTerrainPanoramaFixture(id);
    await page.goto(`/?bank=${id}`);
    await expect(sheet.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached({ timeout: process.env.CI ? 15_000 : 5_000 });
    await expect(sheet.locator(".bench-visit-warnings")).toContainText("Stufen");
    await expect(sheet.locator(".visit-essentials")).not.toContainText("Rückenlehne");
    await shot(page, info, "long-name-conflict-access");
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await sheet.locator(".bench-panorama-expand").click();
    const viewer = sheet.locator(".bench-panorama.is-expanded");
    await expect(viewer).toBeVisible();
    await viewer.locator("summary").focus();
    await shot(page, info, "forced-colors-reduced-motion");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
  } finally { db.close(); removeIsolatedPanoramaBench(id); }
});

test("refinement supporting pages and adding a bench retain the shared controls", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path,name] of [["/danke","about"],["/datenschutz","privacy"],["/gedanken/baenkli","essay"]]) {
    await page.goto(path); await shot(page,info,name);
  }
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.getByRole("button", { name: "Registrieren", exact: true }).click();
  await page.getByLabel("Benutzername").fill(`Pages-${info.project.name}`);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Dein Bänkli-Konto" })).toBeHidden();
  await page.goto("/profil");
  await expect(page.locator(".journal-welcome")).toBeVisible();
  await shot(page,info,"journal-empty");
  await page.goto("/lieblingsplaetze");
  await expect(page.locator(".favourites-empty")).toBeVisible();
  await shot(page,info,"favourites-empty");
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Bänkli eintragen").click();
  await expect(page.getByRole("heading",{name:"Position wählen"})).toBeVisible();
  await shot(page,info,"add-position");
  await page.getByRole("button",{name:"Hier eintragen"}).click();
  const form = page.getByRole("dialog",{name:"Bänkli eintragen",exact:true});
  await expect(form).toBeVisible();
  await expect(page.getByText("Bestehende Bänkli in der Nähe werden geprüft …")).toHaveCount(0);
  await shot(page,info,"add-details");
});

test("refinement alternate-time scene retains an accessible description and readable controls", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/"); await installReviewPainting();
  await page.goto("/?bank=osm-node-101");
  const painting=page.locator(".bench-panorama");
  await expect(painting.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached();
  const expectedNight = process.env.BENCHLY_E2E_NOW?.includes("23:00");
  if(expectedNight) await expect(painting).toHaveClass(/phase-night/);
  await expect(painting.locator(".bench-panorama-viewport")).toHaveAttribute("aria-label", /Landschaft/);
  await shot(page,info,expectedNight?"night-bench":"day-bench");
  await painting.locator(".bench-panorama-expand").click();
  await shot(page,info,expectedNight?"night-panorama":"day-panorama");
  for(const control of await painting.locator("button,summary").all()) {
    const b=await control.boundingBox(); if(b) { expect(b.width).toBeGreaterThanOrEqual(48); expect(b.height).toBeGreaterThanOrEqual(48); }
  }
});
