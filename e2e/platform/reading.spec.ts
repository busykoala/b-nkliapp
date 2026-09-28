import { expect, test } from "@playwright/test";
import { languageCookie, languages } from "../../src/i18n/config";
import { essays } from "../../src/features/reading/content";
import { essayHref } from "../../src/features/reading/model";

// Reading is deliberately not a new map task: closing it must leave the visit untouched.
test("reads over the menu and returns to the same bench, map and focus", async ({ page }, info) => {
  await page.goto("/?bank=osm-node-101");
  const sheet = page.getByRole("complementary", { name: "Bankdetails" });
  await expect(sheet).toHaveAttribute("data-snap", "full");
  const map = page.locator(".benchly-map");
  await expect(map).toHaveAttribute("data-map-ready", "true");
  await expect(map).toHaveAttribute("data-camera-moving", "false");
  const content = sheet.locator(".map-sheet-content");
  await content.evaluate((node) => node.scrollTo({ top: 120 }));
  const position = await content.evaluate((node) => node.scrollTop);
  await map.evaluate((node) => node.setAttribute("data-reading-context", "original"));
  const location = page.url();
  const menuButton = page.getByRole("button", { name: "Menü öffnen", exact: true });
  await menuButton.click();
  const menu = page.locator(".app-menu-dialog");
  await expect(menu.locator("header h2")).toBeFocused();
  const read = menu.getByRole("button", { name: /Gedanken am Bänkli/ });
  await read.click();
  const reader = page.locator(".reading-dialog");
  await expect(reader).toBeVisible();
  await expect(reader.locator(".reading-prose p")).toHaveCount(5);
  expect(await reader.locator(".reading-prose p").allTextContents()).toEqual(essays.de.paragraphs);
  await reader.getByRole("combobox", { name: "Sprache des Textes" }).selectOption("rm");
  await expect(reader.locator(".reading-byline")).toHaveText(essays.rm.byline);
  await expect(reader.locator(".reading-view")).toHaveAttribute("lang", "rm");
  await expect(page.locator("html")).toHaveAttribute("lang", "de-CH");
  await expect(page).toHaveURL(location);
  await reader.screenshot({ path: info.outputPath("reading-rm.png") });
  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(read).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(map).toHaveAttribute("data-reading-context", "original");
  await expect(sheet).toHaveAttribute("data-snap", "full");
  expect(await content.evaluate((node) => node.scrollTop)).toBe(position);
  await expect(page).toHaveURL(location);
});

for (const language of languages) {
  test(`${language}: serves an attributed, shareable essay and preserves its text`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: languageCookie, value: language, url: baseURL! }]);
    await page.goto(essayHref(language));
    await expect(page.locator(".reading-heading h1")).toHaveText(essays[language].title);
    await expect(page.locator(".reading-byline")).toHaveText(essays[language].byline);
    expect(await page.locator(".reading-prose p").allTextContents()).toEqual(essays[language].paragraphs);
    await expect(page.locator(".reading-view")).toHaveAttribute("lang", language);
    expect(await page.locator(".reading-language option").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value")))).toEqual([...languages]);
    await page.locator(".reading-language select").selectOption("fr");
    await expect(page).toHaveURL(/\/gedanken\/baenkli\?lang=fr$/);
    await expect(page).toHaveTitle(`${essays.fr.title} · Bänkli App`);
    await page.reload();
    await expect(page.locator(".reading-view")).toHaveAttribute("lang", "fr");
    await page.locator(".reading-footer button").click();
    await expect(page.locator(".reading-heading h1")).toBeFocused();
    await expect(page.locator(".reading-view")).toHaveAttribute("lang", "de");
    await expect(page).toHaveURL(/\/gedanken\/baenkli\?lang=de$/);
    // Choosing a reading language must not change the person's interface preference.
    expect((await context.cookies()).find((cookie) => cookie.name === languageCookie)?.value).toBe(language);
  });
}

test("keeps the menu and reading controls usable with enlarged text on a narrow phone", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/gedanken/baenkli?lang=de");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.getByRole("button", { name: "Menü öffnen", exact: true }).click();
  const menu = page.locator(".app-menu-dialog");
  await expect(menu.getByRole("button", { name: "Menü schliessen", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await menu.locator(".app-menu-scroll").evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await menu.getByRole("button", { name: /Gedanken am Bänkli/ }).click();
  const reader = page.locator(".reading-dialog");
  await expect(reader.locator(".reading-prose p")).toHaveCount(5);
  expect(await reader.locator(".reading-dialog-scroll").evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await expect(reader.getByRole("button", { name: "Lesetext schliessen" })).toBeInViewport({ ratio: 1 });
  await reader.screenshot({ path: info.outputPath("reading-320-200.png") });
});
