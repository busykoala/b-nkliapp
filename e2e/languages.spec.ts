import { expect, test } from "@playwright/test";

const labels = {
  de: {menu: "Menü öffnen", close: "Menü schliessen", language: "Sprache", search: "Ort suchen"},
  fr: {menu: "Ouvrir le menu", close: "Fermer le menu", language: "Langue", search: "Chercher un lieu"},
  it: {menu: "Apri il menu", close: "Chiudi il menu", language: "Lingua", search: "Cerca un luogo"},
  rm: {menu: "Avrir il menu", close: "Serrar il menu", language: "Lingua", search: "Tschertgar in lieu"},
} as const;

test("switches all four languages, preserves the map, and remembers the choice", async ({page, context}) => {
  await page.goto("/");
  await expect(page.locator("[data-map-ready=true]")).toBeVisible();
  await page.getByRole("combobox", {name: labels.de.search}).fill("Lindenhof");
  await page.getByRole("option").first().click();
  await expect(page.locator(".calm-title h2")).toContainText("Lindenhof");
  const location = page.url();
  // Keep a DOM identity marker: changing language must not rebuild the map.
  await page.locator(".maplibregl-canvas").evaluate(canvas => {canvas.setAttribute("data-language-test", "original");});
  let previous: keyof typeof labels = "de";
  for (const language of ["fr", "it", "rm", "de"] as const) {
    await page.getByRole("button", {name: labels[previous].menu, exact: true}).click();
    await page.getByRole("combobox", {name: labels[previous].language, exact: true}).selectOption(language);
    await expect(page.locator("html")).toHaveAttribute("lang", `${language}-CH`);
    await expect(page.getByRole("combobox", {name: labels[language].language, exact: true})).toHaveValue(language);
    await page.getByRole("button", {name: labels[language].close, exact: true}).click();
    await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("data-language-test", "original");
    await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("aria-label", testTranslator(language)("map.canvas.interactive"));
    await expect(page.locator(".maplibregl-ctrl-attrib-button")).toHaveAttribute("title", testTranslator(language)("map.canvas.attribution"));
    await expect(page.locator(".calm-title h2")).toContainText("Lindenhof");
    await expect(page).toHaveURL(location);
    previous = language;
  }
  await page.getByRole("button", {name: labels.de.menu, exact: true}).click();
  await page.getByRole("combobox", {name: labels.de.language, exact: true}).selectOption("fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CH");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CH");
  const cookie = (await context.cookies()).find(cookie => cookie.name === "benchly_language");
  expect(cookie).toMatchObject({value: "fr", httpOnly: true, sameSite: "Lax"});
});

test.describe("browser language", () => {
  test.use({locale: "it-CH"});
  test("uses a supported browser language before a preference is saved", async ({page}) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "it-CH");
    await expect(page.getByRole("button", {name: labels.it.menu, exact: true})).toBeVisible();
  });
});

// Catalog-driven labels let the same interaction test exercise every translation.
// Names and user content are deliberately checked separately.
import { testTranslator } from "../src/test/translations";

for (const language of ["de", "fr", "it", "rm"] as const) {
  test(`${language}: translates information pages, bench details, form errors and installed-app metadata`, async ({ page, context, baseURL }) => {
    const t = testTranslator(language);
    await context.addCookies([{ name: "benchly_language", value: language, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    // Drain prefetches before deliberately replacing each document. WebKit reports
    // a cancelled prefetch as an access-control error during hard navigation.
    const visit = async (path: string) => {
      await page.waitForLoadState("networkidle");
      await page.goto(path);
    };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await visit("/danke");
    await expect(page.locator("html")).toHaveAttribute("lang", `${language}-CH`);
    await expect(page.getByRole("heading", { name: t("about.methods.sun.title"), exact: true })).toBeVisible();
    const source = page.locator(".about-sources details").filter({ hasText: "swissBUILDINGS3D" });
    await source.locator("summary").click();
    await expect(source).toContainText(t("about.sources.entries.swissbuildings3d.description"));
    await page.getByRole("button", { name: t("privacy.flow.photo.label"), exact: true }).click();
    await expect(page.getByRole("heading", { name: t("privacy.flow.photo.check.title"), exact: true })).toBeVisible();
    await visit("/datenschutz");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("privacy.title"));
    await expect(page.getByText(t("privacy.storage.language"), { exact: true })).toBeVisible();
    await visit("/impressum");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("about.links.imprint"));
    await visit("/feed");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("feed.page.title"));
    await visit("/bank/osm-node-101");
    await expect(page.locator(".calm-title h2")).toContainText("Lindenhof");
    await expect(page.getByRole("link", { name: t("bench.page.onMap"), exact: true })).toBeVisible();
    await expect(page.locator(".detail-disclosures")).toContainText(t("bench.details.weather"));
    await page.getByRole("button", { name: t("common.navigation.open"), exact: true }).click();
    await page.getByRole("button", { name: t("common.navigation.signIn"), exact: true }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel(t("account.fields.username"), { exact: true }).fill("no.such.user.language");
    await dialog.getByLabel(t("account.fields.password"), { exact: true }).fill("invalid-password");
    await dialog.getByRole("button", { name: t("common.navigation.signIn"), exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(t("account.result.credentialsInvalid"));
    const manifest = await context.request.get("/manifest.webmanifest");
    expect(await manifest.json()).toMatchObject({ lang: `${language}-CH`, name: t("common.metadata.title") });
    await visit("/bank/does-not-exist");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("common.notFound.title"));
    expect(errors).toEqual([]);
  });
}

test("existing walk results and directions follow language changes without another route search", async ({ page, context, baseURL }) => {
  test.setTimeout(60_000);
  await context.addCookies([{ name: "benchly_language", value: "fr", url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  const fr = testTranslator("fr");
  await page.goto("/");
  await page.getByRole("button", { name: fr("walks.planner.title"), exact: true }).click();
  const panel = page.getByRole("complementary");
  await panel.getByRole("combobox", { name: fr("routing.origin.input"), exact: true }).fill("Zürich");
  await panel.getByRole("option", { name: `Bahnhofplatz 1, Zürich ${fr("routing.origin.address")}` }).click();
  await panel.getByRole("button", { name: fr("walks.planner.submit"), exact: true }).click();
  await expect(panel.locator(".walk-suggestion-picker button")).toHaveCount(3, { timeout: 18_000 });
  const count = await panel.locator(".journey-thread li").count();
  await panel.locator("summary").filter({ hasText: fr("routing.controls.directions") }).click();
  await expect(panel.locator(".walk-instructions")).toContainText("Lindenhofweg");
  let previous = fr;
  for (const language of ["it", "rm"] as const) {
    const t = testTranslator(language);
    await page.getByRole("button", { name: previous("common.navigation.open"), exact: true }).click();
    await page.getByRole("combobox", { name: previous("common.language.label"), exact: true }).selectOption(language);
    await expect(page.locator("html")).toHaveAttribute("lang", `${language}-CH`);
    await page.getByRole("button", { name: t("common.navigation.close"), exact: true }).click();
    await expect(panel.getByRole("heading", { name: t("walks.planner.title"), exact: true })).toBeVisible();
    await expect(panel.locator(".journey-thread li")).toHaveCount(count);
    await expect(panel.locator(".walk-instructions")).toContainText("Lindenhofweg");
    await expect(panel.locator(".walk-instructions")).toContainText(t("routing.instructions.continue"));
    await expect(panel.locator(".walk-instructions")).toContainText(t("routing.instructions.arrive"));
    previous = t;
  }
});
