import { expect, test } from "@playwright/test";

async function openRegistration(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", { name: "Registrieren" }).click();
}

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await openRegistration(page);
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.getByLabel("Menü öffnen").click();
  await expect(page.getByText("Mein Profil")).toBeVisible();
  await page.getByLabel("Menü schliessen").click();
}

test("keeps the complete signed-in journey clear on a phone", async ({ page }, testInfo) => {
  await openRegistration(page);
  await expect(page.getByRole("button", { name: "Registrieren" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Mindestens 8 Zeichen")).toBeVisible();
  const password = page.getByLabel("Passwort", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await page.getByLabel("Passwort anzeigen").click();
  await expect(password).toHaveAttribute("type", "text");
  await page.screenshot({ path: testInfo.outputPath("01-registration.png") });

  const username = `ux-${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`;
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen" }).click();

  await page.getByLabel("Menü öffnen").click();
  await expect(page.getByText("Mein Profil")).toBeVisible();
  await expect(page.locator(".app-menu-account")).toContainText(username);
  await expect(page.locator(".app-menu-signout")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("02-authenticated-menu.png") });
  await page.getByText("Mein Profil").click();
  await expect(page.getByRole("heading", { name: username })).toBeVisible();
  await expect(page.locator(".profile-jump-links")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("03-profile-top.png") });

  const regularViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 568 });
  const counters = page.locator(".profile-numbers > div > span");
  const second = await counters.nth(1).boundingBox();
  const third = await counters.nth(2).boundingBox();
  expect(second?.y).toBeLessThan(third?.y ?? 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("03b-profile-narrow.png") });
  await page.setViewportSize(regularViewport);

  const avatarEditor = page.locator(".avatar-customizer");
  await avatarEditor.scrollIntoViewIfNeeded();
  await avatarEditor.locator("summary").click();
  await avatarEditor.locator(".avatar-customizer-preview").scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  await expect(avatarEditor.locator(".avatar-customizer-actions")).toBeInViewport();
  await avatarEditor.screenshot({ path: testInfo.outputPath("04-avatar-editor-full.png") });
  await avatarEditor.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - 76), behavior: "instant" });
  });
  await page.screenshot({ path: testInfo.outputPath("04-avatar-editor.png") });

  await page.goto("/lieblingsplaetze");
  await expect(page.locator(".favourites-empty").getByRole("link", { name: "Zur Karte" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("05-favourites-empty.png") });
});

test("keeps contribution and add-bench tasks understandable on a phone", async ({ page }, testInfo) => {
  const username = `flow-${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`;
  await registerUser(page, username);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: "Beitragen", exact: true }).click();
  const contribution = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });
  await expect(contribution).toBeVisible();
  await expect(contribution.locator(".contribution-chapter-icon")).toHaveCount(8);
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath("06-contribution-overview.png") });

  await contribution.locator("summary").filter({ hasText: "Wie war deine Pause?" }).click();
  await page.waitForTimeout(200);
  await expect(contribution.locator(".contribution-chapter[open]" )).toHaveCount(1);
  await contribution.getByLabel("4 Sterne").first().click();
  await expect(contribution.locator(".rating-control").first().locator("output")).toHaveText("4 Sterne");
  await page.screenshot({ path: testInfo.outputPath("07-rating-form.png") });
  await contribution.getByLabel("Beiträge schliessen").click();

  await page.goto("/?action=add");
  await page.getByRole("button", { name: "Hier eintragen" }).click();
  const add = page.getByRole("dialog", { name: "Bänkli eintragen" });
  await expect(add).toBeVisible();
  await expect(add.locator(".nearby-benches")).not.toContainText("werden geprüft");
  await expect(add.locator(".add-bench-steps [aria-current='step']")).toContainText("Details");
  await expect(add.getByRole("button", { name: "Eintragen", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("08-add-bench.png") });
});
