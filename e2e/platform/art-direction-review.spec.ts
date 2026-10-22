import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { installReviewPainting } from "../support/review-painting";

test.use({ serviceWorkers: "block" });

for (const device of [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 900 }]) {
  test(`art direction reading and writing ${device.name}`, async ({ page }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize(device);
    const shot = async (name: string, fullPage = false) => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage, animations: "disabled", style: process.env.BENCHLY_ART_REVIEW === "1" ? "nextjs-portal { display: none !important; }" : undefined });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    };
    await page.goto("/");
    await installReviewPainting();
    await page.goto("/?bank=osm-node-101");
    const sheet = page.getByRole("complementary", { name: "Bankdetails" });
    const save = sheet.getByRole("button", { name: "Merken", exact: true });
    const poem = await sheet.locator(".bench-poem").textContent();
    await save.click();
    const account = page.getByRole("dialog", { name: "Willkommen zurück" });
    await expect(account).toBeVisible();
    await shot("authentication");
    await account.getByRole("button", { name: "Schliessen", exact: true }).first().click();
    await expect(save).toBeFocused();
    await expect(sheet.locator(".bench-poem")).toHaveText(poem!);
    await save.click();
    await account.getByRole("button", { name: "Registrieren", exact: true }).click();
    const username = `Nora-${Date.now().toString(36).slice(-5)}`;
    await page.getByLabel("Benutzername").fill(username);
    await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
    await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
    await expect(sheet.locator(".bench-save-action")).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "Etwas beitragen", exact: true }).click();
    const contribution = page.locator(".contribution-dialog[open]");
    await expect(contribution).toBeVisible();
    await contribution.getByRole("button", { name: "Erinnerung teilen", exact: true }).click();
    const draft = "Vor dem nächsten Wegstück noch ein Augenblick hier. Mehr brauchte der Nachmittag nicht.";
    await contribution.getByLabel("Dein Bänkli-Moment").fill(draft);
    await expect(contribution.locator(".moment-kind")).not.toHaveAttribute("open", "");
    await expect(contribution.locator(".contribution-character-count")).toHaveCount(0);
    await shot("memory-form");
    await contribution.locator(".moment-kind > summary").click();
    await contribution.getByRole("button", { name: "Gedicht", exact: true }).click();
    await expect(contribution.locator('input[name="kind"]')).toHaveValue("poem");
    await expect(contribution.getByLabel("Dein Bänkli-Moment")).toHaveValue(draft);
    await contribution.locator(".moment-kind > summary").click();
    await contribution.getByRole("button", { name: "Gesamteindruck bewerten", exact: true }).click();
    const ratingNote = contribution.locator('.contribution-rating-form textarea');
    await expect(ratingNote).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(ratingNote).toHaveCSS("border-radius", "0px");
    await shot("rating-form");
    await contribution.getByRole("button", { name: "Alle Beiträge", exact: true }).click();
    await contribution.getByRole("button", { name: "Angaben ergänzen", exact: true }).click();
    await shot("facts-form");
    await contribution.locator('[data-feature="backrest"]').click();
    await shot("seating-form");
    await contribution.getByRole("button", { name: "Alle Beiträge", exact: true }).click();
    await contribution.getByRole("button", { name: "Problem melden", exact: true }).click();
    await expect(contribution.locator(".contribution-correction-form")).toBeVisible();
    await expect(contribution.locator('.contribution-correction-form textarea')).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await shot("correction-form");
    await contribution.getByRole("button", { name: "Alle Beiträge", exact: true }).click();
    await contribution.getByRole("button", { name: "Erinnerung teilen", exact: true }).click();
    await expect(contribution.getByLabel("Dein Bänkli-Moment")).toHaveValue(draft);
    await contribution.getByRole("button", { name: "Beiträge schliessen" }).click();
    await contribution.getByRole("button", { name: "Verwerfen und schliessen", exact: true }).click();
    const db = new Database(process.env.BENCHLY_E2E_DATABASE!);
    try {
      const user = db.prepare("SELECT id FROM users WHERE username_key=?").get(username.toLowerCase()) as { id: number };
      const bench = db.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number };
      const insert = db.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,created_at,updated_at,visible) VALUES(?,?,'memory',?,?,?,1)");
      insert.run(bench.row_id, user.id, "Der Weg hatte es eilig. Wir nicht.", "2026-10-20T12:00:00Z", "2026-10-20T12:00:00Z");
      insert.run(bench.row_id, user.id, "Eine Pause zwischen zwei Verabredungen. Hier durfte die nächste noch warten.", "2026-10-18T12:00:00Z", "2026-10-18T12:00:00Z");
    } finally { db.close(); }
    await page.goto("/profil");
    const painting = page.locator(".journal-entry .place-painting img");
    await expect(painting).toHaveCount(3);
    await expect.poll(() => painting.nth(1).evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const source = await painting.nth(1).getAttribute("src");
    expect(source).toContain("/_next/image?");
    expect(source).toContain("media%2Fpanorama");
    await expect(page.locator(".journal-memory").first()).toContainText("Der Weg hatte es eilig");
    await shot("journal-populated", true);
    await page.goto("/lieblingsplaetze");
    await expect(page.locator(".saved-bench-item")).toHaveCount(1);
    await shot("saved-populated", true);
    // Missing painting must remove only the decoration, never the person's entry.
    await page.route("**/_next/image?*", route => route.abort());
    await page.goto("/profil");
    await expect(page.locator(".journal-memory").first()).toContainText("Der Weg hatte es eilig");
    await expect(page.locator(".journal-entry .place-painting")).toHaveCount(0);
    await shot("journal-artwork-failure", true);
    await page.unroute("**/_next/image?*");
    await page.goto("/");
    await page.getByRole("button", { name: "Filter öffnen" }).click();
    const filters = page.locator(".calm-filter-panel");
    await filters.getByRole("button", { name: "Rückenlehne", exact: true }).click();
    await filters.getByRole("button", { name: "Schatten", exact: true }).click();
    await shot("filters-selected");
    await filters.getByRole("button", { name: "Karte ansehen" }).click();
    const search = page.getByRole("combobox", { name: "Ort suchen" });
    await search.fill("Lindenhof");
    await expect(search).toBeFocused();
    await expect(page.locator(".map-search-results [role=option]").first()).toBeVisible();
    await expect(page.locator(".map-search-results [role=option] strong")).toHaveText(["Lindenhof, Zürich", "Lindenhof, Zürich"]);
    await expect(page.locator(".map-search-results [role=option] small")).toHaveText(["Bänkli", "Ort"]);
    await search.press("ArrowDown");
    await shot("search-results");
  });
}

test("signing out clears the immediate contribution permission hint", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.getByRole("button", { name: "Registrieren", exact: true }).click();
  await page.getByLabel("Benutzername").fill(`Logout-${Date.now().toString(36).slice(-5)}`);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Dein Bänkli-Konto" })).toBeHidden();
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Ort suchen" });
  await search.fill("Lindenhof");
  await page.locator('.map-search-results [role="option"]').first().click();
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Etwas beitragen", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Willkommen zurück" })).toBeVisible();
  await expect(page.locator(".contribution-dialog[open]")).toHaveCount(0);
});

test("closing filters preserves a newly chosen search focus", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Filter öffnen" }).click();
  await page.locator(".filter-done").click();
  await expect(page.locator(".calm-filter-panel")).toHaveCount(0);
  const search = page.getByRole("combobox", { name: "Ort suchen" });
  // The background becomes focusable only after the covering task closes.
  // The deferred return callback must not steal a newly chosen focus.
  await search.focus();
  await expect(search).toBeFocused();
  // Search results have their own keyboard/navigation tests. Keep this same-frame
  // focus regression independent of provider timing and server-action queues.
  await search.press("L");
  await expect(search).toHaveValue("L");
  await expect(search).toBeFocused();
});
