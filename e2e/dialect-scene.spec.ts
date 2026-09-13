import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { installPanoramaFixture } from "./panorama-fixture";

test("keeps four app languages and applies dialect only to the opened bench", async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  const language = page.getByRole("combobox", { name: "Sprache" });
  await expect(language.locator("option")).toHaveText(["Deutsch", "Français", "Italiano", "Rumantsch"]);
  await language.selectOption("fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CH");
  const frenchLanguage = page.getByRole("combobox", { name: "Langue" });
  const dialect = page.getByRole("switch", { name: /Dialecte du banc/ });
  await expect(dialect).toHaveAttribute("aria-checked", "false");
  await dialect.click();
  await expect(page.locator("html")).toHaveAttribute("data-language-mode", "dialect");
  await expect(frenchLanguage).toHaveValue("fr");
  await expect(dialect).toHaveAttribute("aria-checked", "true");
  await page.locator(".app-menu-sheet").screenshot({ path: testInfo.outputPath("local-language-menu.png"), animations: "disabled" });
  await page.getByLabel("Fermer le menu").click();
  const cookies = await context.cookies();
  expect(cookies.find(cookie => cookie.name === "benchly_language")?.value).toBe("fr");
  expect(cookies.find(cookie => cookie.name === "benchly_dialect")?.value).toBe("on");

  installPanoramaFixture("osm-node-101");
  await page.goto("/?bank=osm-node-101");
  const sheet = page.locator(".desktop-sheet");
  await expect(sheet).toHaveAttribute("lang", "gsw-CH");
  await expect(sheet).toHaveAttribute("data-local-voice", "gsw-zurich");
  await expect(sheet).toHaveAttribute("data-snap", "half");
  const collapsed = await sheet.boundingBox();
  expect(collapsed?.y).toBeGreaterThan(844 * .5);
  await expect(sheet.locator(".bench-panorama")).toBeInViewport();
  await expect(sheet.getByText("Züridütsch", { exact: false }).first()).toBeVisible();
  await expect(sheet.locator(".bench-summary")).toContainText("Uf en Blick");
  await page.waitForTimeout(800);
  await sheet.screenshot({ path: testInfo.outputPath("map-first-local-preview.png"), animations: "disabled" });

  await sheet.locator(".overlay-resize").click();
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(sheet.locator(".bench-panorama-art").first()).toBeVisible();
  await sheet.locator(".bench-story-card").screenshot({ path: testInfo.outputPath("zurich-local-scene.png"), animations: "disabled" });
  await expect(sheet.locator(".calm-detail")).toHaveAttribute("lang", "gsw-CH");
  await sheet.locator(".scene-caption").scrollIntoViewIfNeeded();
  await sheet.locator(".scene-caption").screenshot({ path: testInfo.outputPath("zurich-local-voice.png"), animations: "disabled" });

  await page.goto("/bank/osm-node-103");
  await expect(page.locator(".calm-detail")).toHaveAttribute("lang", "frp-CH");
  await expect(page.getByText("Patois romand occidental", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".bench-summary")).toContainText("En un coup d’œil");
  await expect(page.getByLabel("Ouvrir le menu")).toBeVisible();
  await page.locator(".bench-story-card").screenshot({ path: testInfo.outputPath("vaud-local-french.png"), animations: "disabled" });

  await page.goto("/bank/osm-node-110");
  await expect(page.locator(".calm-detail")).toHaveAttribute("lang", "lmo-CH");
  await expect(page.getByText("Dialett dal Sottoceneri", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".bench-summary")).toContainText("A colpo d’occhio");
  await expect(page.getByLabel("Ouvrir le menu")).toBeVisible();
  await page.locator(".bench-story-card").screenshot({ path: testInfo.outputPath("ticino-local-italian.png"), animations: "disabled" });

  await page.getByLabel("Ouvrir le menu").click();
  const localToggle = page.getByRole("switch", { name: /Dialecte du banc/ });
  await localToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-language-mode", "fixed");
  await expect(page.locator(".calm-detail")).not.toHaveAttribute("lang", /.+/);
  await expect(page.locator(".bench-summary")).toContainText("En un coup d’œil");
});

test("keeps sun and covered shade states on the panorama", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  installPanoramaFixture("osm-node-101");
  await page.goto("/bank/osm-node-101");
  let scene = page.locator(".bench-panorama");
  await expect(scene).toBeVisible();
  await expect(scene).toHaveClass(/is-sunny/);
  await expect(scene.locator(".bench-panorama-bench-shadow").first()).toBeVisible();
  await scene.screenshot({ path: testInfo.outputPath("scene-direct-sun.png") });

  try {
    installPanoramaFixture("osm-node-112", true);
    await page.goto("/bank/osm-node-112");
    scene = page.locator(".bench-panorama");
    await expect(scene).toBeVisible();
    await expect(scene).toHaveClass(/is-shaded/);
    await expect(scene.locator(".bench-panorama-shelter")).toBeVisible();
    await scene.screenshot({ path: testInfo.outputPath("scene-cast-shade.png") });
  } finally {
    const cleanup = new Database(process.env.BENCHLY_E2E_DATABASE!);
    cleanup.prepare("UPDATE benches SET covered=0 WHERE id='osm-node-112'").run();
    cleanup.close();
  }
});

test("keeps the Romansh local overlay readable at 430px and desktop", async ({ page, context }, testInfo) => {
  await page.goto("/");
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  const bench = database.prepare("SELECT row_id FROM benches WHERE id='osm-node-111'").get() as { row_id: number };
  database.prepare("UPDATE benches SET latitude=46.79512,longitude=10.29477,name='Plaz, Scuol',location_name='Plaz, Scuol',location_canton='Graubünden' WHERE row_id=?").run(bench.row_id);
  database.prepare("UPDATE bench_geography SET municipality_id='3762',municipality_name='Scuol',canton_id='18',canton_name='Graubünden',locality_name='Scuol',source_version='e2e-swissboundaries-2026' WHERE bench_row_id=?").run(bench.row_id);
  database.close();
  installPanoramaFixture("osm-node-111");
  await context.addCookies([
    { name: "benchly_language", value: "fr", url: "http://localhost:3100" },
    { name: "benchly_dialect", value: "on", url: "http://localhost:3100" },
  ]);

  for (const width of [430, 1440]) {
    await page.setViewportSize({ width, height: width === 430 ? 932 : 1000 });
    await page.goto("/bank/osm-node-111");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr-CH");
    await expect(page.getByLabel("Ouvrir le menu")).toBeVisible();
    const detail = page.locator(".calm-detail");
    await expect(detail).toHaveAttribute("lang", "rm-CH");
    await expect(detail.getByText("Vallader", { exact: false }).first()).toBeVisible();
    await expect(detail.locator(".bench-summary")).toContainText("En in’egliada");
    const overflow = await detail.locator("h2,h3,p,button,strong,small").evaluateAll((elements) => elements
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => ({ text: element.textContent?.trim().slice(0, 80), width: element.clientWidth, scrollWidth: element.scrollWidth })));
    expect(overflow).toEqual([]);
    await detail.locator(".bench-story-card").screenshot({ path: testInfo.outputPath(`vallader-${width}.png`), animations: "disabled" });
  }

  await page.setViewportSize({ width: 430, height: 932 });
  await page.getByRole("button", { name: "Sa participar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.closest("[lang]")?.getAttribute("lang"))).toBe("rm-CH");
  await expect(dialog.getByRole("heading", { name: "Bainvegni enavos" })).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath("vallader-account-dialog-430.png"), animations: "disabled" });
});
