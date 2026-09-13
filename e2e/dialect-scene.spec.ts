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
  const sheet = page.getByRole("complementary", { name: "Détails du banc" });
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
  await expect(page.locator(".calm-detail")).toHaveAttribute("lang", "fr-CH");
  await expect(page.getByText("Français vaudois", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".bench-summary")).toContainText("En un coup d’œil");
  await expect(page.getByLabel("Ouvrir le menu")).toBeVisible();
  await page.locator(".bench-story-card").screenshot({ path: testInfo.outputPath("vaud-local-french.png"), animations: "disabled" });

  await page.goto("/bank/osm-node-110");
  await expect(page.locator(".calm-detail")).toHaveAttribute("lang", "it-CH");
  await expect(page.getByText("Italiano ticinese · Sottoceneri", { exact: false }).first()).toBeVisible();
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
