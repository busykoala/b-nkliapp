import { expect, test } from "@playwright/test";
import { installReviewPainting } from "../support/review-painting";

test.use({ serviceWorkers: "block" });

// An isolated, repeatable visual tour; capture the same places before and after.
for (const viewport of [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 900 }]) {
  for (const signedIn of [false, true]) {
    test(`field guide review ${viewport.name} ${signedIn ? "signed-in" : "anonymous"}`, async ({ page }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      const shot = async (name: string) => {
        const map = page.getByLabel("Karte der Schweizer Sitzbänke");
        if (await map.count()) {
          await expect(map).toHaveAttribute("data-map-ready", "true");
          await expect(map).toHaveAttribute("data-camera-moving", "false");
          // Interactive overlays become available before the basemap tiles.
          // For visual evidence, also let their resource loads and paint settle.
          await page.waitForLoadState("networkidle", { timeout: 15_000 });
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        await page.locator(".guide-illustration img").evaluateAll(async images => {
          await Promise.all(images.filter(image => {
            const rect = image.getBoundingClientRect();
            return rect.width > 0 && rect.top < innerHeight && rect.bottom > 0;
          }).map(async image => { const img = image as HTMLImageElement; img.loading = "eager"; await img.decode(); }));
        });
        await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled", style: process.env.BENCHLY_ART_REVIEW === "1" ? "nextjs-portal { display: none !important; }" : undefined });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      };
      await page.goto("/");
      if (signedIn) {
        await page.getByLabel("Menü öffnen").click();
        await page.getByRole("button", { name: "Anmelden", exact: true }).click();
        await page.getByRole("button", { name: "Registrieren", exact: true }).click();
        await page.getByLabel("Benutzername").fill(`Nora-${Date.now().toString(36).slice(-5)}`);
        await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
        await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Dein Bänkli-Konto" })).toBeHidden();
      }
      await installReviewPainting();
      await page.goto("/?bank=osm-node-101");
      const bench = page.getByRole("complementary", { name: "Bankdetails" });
      await expect(bench.locator(".bench-panorama-webgl.is-ready").first()).toBeAttached({ timeout: 30_000 });
      await shot("bench");
      if (signedIn) {
        await bench.locator(".bench-contribute button").first().click();
        await expect(page.locator(".contribution-dialog[open]")).toBeVisible();
        await shot("contribute");
        await page.getByLabel("Beiträge schliessen").click();
        await page.goto("/profil");
        await expect(page.locator(".profile-journal")).toBeVisible();
        await shot("journal");
        await page.goto("/lieblingsplaetze");
        await expect(page.locator(".favourites-empty")).toBeVisible();
        await shot("saved");
      }
      await page.goto("/");
      await page.getByRole("button", { name: "Menü öffnen" }).click();
      await shot("menu");
      await page.getByLabel("Menü schliessen").click();
      await page.getByRole("button", { name: "Filter öffnen" }).click();
      await shot("filters");
      await page.getByLabel("Filter schliessen").click();
      // Continue from the existing map, as a visitor does; do not replace its
      // fully drawn terrain with a newly constructed map for this comparison.
      await page.getByRole("button", { name: "Unterwegs", exact: true }).click();
      await expect(page.locator(".map-sheet-planner")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Start: Adresse oder Haltestelle", exact: true })).toBeVisible();
      await shot("routing");
    });
  }
}

test("field guide retains painting, actions and focus across sheet sizes", async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await installReviewPainting();
  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  const panorama = sheet.locator(".bench-panorama");
  await panorama.evaluate(node => { (node as HTMLElement).dataset.retained = "yes"; });
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await expect(sheet.locator(".bench-actions")).toHaveCount(1);
    await expect(sheet.getByRole("button", { name: "Weg planen", exact: true })).toBeInViewport();
    await expect(sheet.locator(".bench-save-action")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`bench-${size.width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(sheet).toHaveAttribute("data-reading-layout", "flow");
  await sheet.locator(".bench-save-action").scrollIntoViewIfNeeded();
  await expect(sheet.locator(".bench-save-action")).toBeInViewport();
  await page.screenshot({ path: info.outputPath("bench-large-text.png") });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  const save = sheet.getByRole("button", { name: "Merken", exact: true });
  await save.click();
  await expect(page.getByRole("dialog", { name: "Willkommen zurück" })).toBeVisible();
  await page.locator("dialog[open]").getByRole("button", { name: "Schliessen", exact: true }).first().click();
  await expect(save).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await sheet.getByRole("button", { name: "Vorschau", exact: true }).click();
  await expect(sheet.locator(".map-sheet-footer")).toBeVisible();
  await sheet.getByRole("button", { name: "Zum Bänkli", exact: true }).click();
  await expect(sheet.locator(".map-sheet-footer")).toBeVisible();
  await expect(panorama).toHaveAttribute("data-retained", "yes");
});
