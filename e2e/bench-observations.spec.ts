import { expect, test } from "@playwright/test";

const benchId = process.env.BENCHLY_E2E_BENCH_ID ?? "osm-node-101";

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await page.goto(`/bank/${benchId}`);
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", { name: "Neu hier? Konto erstellen" }).click();
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.getByLabel("Menü öffnen").click();
  await expect(page.getByText("Mein Profil")).toBeVisible();
  await page.getByLabel("Menü schliessen").click();
}

async function openContributionChapter(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: "Beitragen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });
  await expect(dialog).toBeVisible();
  const summary = dialog.locator("summary").filter({ hasText: title });
  await summary.click();
  return dialog;
}

async function submitViewCorrection(page: import("@playwright/test").Page, targetBench: string) {
  await page.goto(`/bank/${targetBench}`);
  await page.locator(".detail-disclosures > details > summary").filter({ hasText: "Aussicht" }).click();
  const dialog = await openContributionChapter(page, "Aussicht & Umgebung");
  const prompt = dialog.getByLabel("Aussicht vor Ort einordnen");
  await prompt.getByRole("button", { name: "Anders erlebt" }).click();
  await prompt.getByRole("button", { name: "Fast rundum" }).click();
  await prompt.getByRole("button", { name: "Offen", exact: true }).click();
  await prompt.getByRole("button", { name: "Weiter" }).click();
  await prompt.getByRole("button", { name: "Starkes Relief" }).click();
  await prompt.getByRole("button", { name: "Klar sichtbar" }).click();
  await prompt.getByRole("button", { name: "Weiter" }).click();
  await prompt.getByRole("button", { name: "Überwiegend frei" }).click();
  await prompt.getByRole("button", { name: "Weiter" }).click();
  await prompt.getByRole("button", { name: "Natürlich" }).click();
  await prompt.getByRole("button", { name: "Ruhig" }).click();
  await prompt.getByRole("button", { name: "Eintragen" }).click();
  await expect(prompt.getByText("Dein eigener Eindruck ist eingetragen")).toBeVisible();
}

test("keeps the view observation understandable in the mobile detail", async ({ page }, testInfo) => {
  // This covers registration, all four steps, back navigation, save and undo.
  // Linux WebKit spends 1–3 seconds per click; keep individual actions bounded.
  test.setTimeout(60_000);
  page.setDefaultTimeout(5_000);
  await registerUser(page, `view-${Date.now().toString().slice(-8)}`);
  await page.goto(`/bank/${benchId}`);
  await page.locator(".detail-disclosures > details > summary").filter({ hasText: "Aussicht" }).click();
  await expect(page.locator(".detail-panel-view").getByRole("heading", { name: /Horizont|Blick/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Beitragen", exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  await page.screenshot({ path: testInfo.outputPath("view-entry.png"), fullPage: false });
  await page.getByRole("button", { name: "Beitragen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(250);
  await dialog.screenshot({ path: testInfo.outputPath("contribution-hub.png") });
  await dialog.locator("summary").filter({ hasText: "Aussicht & Umgebung" }).click();
  const prompt = dialog.getByLabel("Aussicht vor Ort einordnen");
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Anders erlebt" }).click();
  const firstStep = prompt.getByText("Schritt 1 von 4").locator("..");
  await expect(firstStep).toBeVisible();
  await expect(firstStep).toBeFocused();
  await expect(prompt.getByRole("button", { name: "Abbrechen" })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath("view-editor.png"), fullPage: false });

  await prompt.getByRole("button", { name: "Fast rundum" }).click();
  await prompt.getByRole("button", { name: "Offen", exact: true }).click();
  await prompt.getByRole("button", { name: "Weiter" }).click();
  await expect(prompt.getByText("Schritt 2 von 4")).toBeVisible();
  await expect(prompt.getByText("Schritt 2 von 4").locator("..")).toBeFocused();
  await prompt.getByRole("button", { name: "Zurück" }).click();
  await expect(prompt.getByText("Schritt 1 von 4").locator("..")).toBeFocused();
  await prompt.getByRole("button", { name: "Weiter" }).click();
  await prompt.getByRole("button", { name: "Starkes Relief" }).click();
  await prompt.getByRole("button", { name: "Klar sichtbar" }).click();
  await prompt.getByRole("button", { name: "Weiter" }).click();
  await expect(prompt.getByText("Schritt 3 von 4")).toBeVisible();
  await prompt.getByRole("button", { name: "Bäume" }).click();
  await prompt.getByRole("button", { name: "Weiter" }).click();
  await expect(prompt.getByText("Schritt 4 von 4")).toBeVisible();
  await prompt.getByRole("button", { name: "Natürlich" }).click();
  await prompt.getByRole("button", { name: "Ruhig" }).click();
  await prompt.getByRole("button", { name: "Eintragen" }).click();
  await expect(prompt.getByText("Dein eigener Eindruck ist eingetragen")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("view-saved.png"), fullPage: false });

  await prompt.getByRole("button", { name: "Löschen" }).click();
  await expect(prompt.getByText("Dein Eindruck hilft, die Schätzung zu verbessern")).toBeVisible();
  await prompt.getByRole("button", { name: "Passt ungefähr" }).click();
  await expect(prompt.getByText("Von dir ungefähr bestätigt")).toBeVisible();
  await prompt.getByRole("button", { name: "Löschen" }).click();
  await expect(prompt.getByText("Dein Eindruck hilft, die Schätzung zu verbessern")).toBeVisible();
});

test("does not turn observations into disabled decoration for guests", async ({ page }) => {
  await page.goto(`/bank/${benchId}`);
  await expect(page.getByRole("button", { name: "Mitmachen" })).toBeVisible();
  await page.locator(".detail-disclosures > details > summary").filter({ hasText: "Aussicht" }).click();
  await expect(page.getByLabel("Aussicht vor Ort einordnen")).toHaveCount(0);
  await page.locator(".detail-disclosures > details > summary").filter({ hasText: "Licht" }).click();
  await expect(page.getByLabel("Licht vor Ort melden")).toHaveCount(0);
});

test("keeps observation controls calm, semantic and touchable with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await registerUser(page, `access-${Date.now().toString().slice(-8)}`);
  await page.goto(`/bank/${benchId}`);
  const viewSummary = page.locator(".detail-disclosures > details > summary").filter({ hasText: "Aussicht" });
  await viewSummary.focus();
  await page.keyboard.press("Enter");
  await expect(viewSummary.locator("..")).toHaveAttribute("open", "");
  const weatherSummary = page.locator(".detail-disclosures > details > summary").filter({ hasText: "Wetter" });
  await weatherSummary.focus();
  await page.keyboard.press("Enter");
  await expect(weatherSummary.locator("..")).toHaveAttribute("open", "");
  await expect(viewSummary.locator("..")).not.toHaveAttribute("open", "");
  const dialog = await openContributionChapter(page, "Aussicht & Umgebung");
  const prompt = dialog.getByLabel("Aussicht vor Ort einordnen");
  await prompt.getByRole("button", { name: "Anders erlebt" }).click();
  await expect(prompt.getByText("Schritt 1 von 4").locator("..")).toBeFocused();
  const animationDuration = await prompt.locator(".view-observation-editor").evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.00001);
  const undersized = await prompt.getByRole("button").evaluateAll((buttons) => buttons.filter((button) => {
    const box = button.getBoundingClientRect();
    return box.width < 44 || box.height < 44;
  }).length);
  expect(undersized).toBe(0);
});

test("saves every daylight impression and supports undo", async ({ page }, testInfo) => {
  await registerUser(page, `light-${Date.now().toString().slice(-8)}`);
  await page.goto(`/bank/${benchId}`);
  await page.locator(".detail-disclosures > details > summary").filter({ hasText: "Licht" }).click();
  await page.waitForTimeout(100);
  const dialog = await openContributionChapter(page, "Licht gerade jetzt");
  const prompt = dialog.getByLabel("Licht vor Ort melden");
  await expect(prompt).toBeVisible();
  for (const choice of ["Sonne", "Schatten", "Wechselhaft"]) {
    await prompt.getByRole("button", { name: choice, exact: true }).click();
    await expect(prompt.getByText(`Deine Beobachtung: ${choice}`)).toBeVisible();
    await expect(prompt.getByRole("button", { name: choice, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await page.screenshot({ path: testInfo.outputPath("light-observation-saved.png"), fullPage: false });
  await prompt.getByRole("button", { name: "Rückgängig" }).click();
  await expect(prompt.getByText("Ein kurzer Eindruck von vor Ort")).toBeVisible();
  await expect(prompt.getByText("Deine Beobachtung wurde zurückgenommen.")).toBeVisible();
});

test("blends three real community impressions into the bench detail", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "One exact shared-database aggregation run is sufficient; Safari covers the individual flow.");
  const targetBench = "osm-node-103";
  const run = `${Date.now().toString().slice(-7)}-${testInfo.workerIndex}`;
  for (let person = 1; person <= 3; person += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await registerUser(page, `blick-${run}-${person}`);
    await submitViewCorrection(page, targetBench);
    await context.close();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/bank/${targetBench}`);
  await page.locator(".detail-disclosures > details > summary").filter({ hasText: "Aussicht" }).click();
  await expect(page.getByText("3 Eindrücke von Menschen vor Ort · vorsichtig gestützt")).toBeVisible();
  await page.getByText("Aussicht im Detail").click();
  await expect(page.getByText("Himmelsoffenheit").locator("..").getByText("93")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("community-estimate.png"), fullPage: false });
  await context.close();
});
