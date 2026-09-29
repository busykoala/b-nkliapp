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
  await expect(page.getByText("Dieser Name erscheint öffentlich im Feed. Bitte keine E-Mail-Adresse und keinen echten Namen verwenden.")).toBeVisible();
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
  await page.getByRole("button", { name: "Verbessern", exact: true }).click();
  const contribution = page.locator(".contribution-dialog[open]");
  await expect(contribution).toBeVisible();
  await expect(contribution.locator("[data-contribution-choice]")).toHaveCount(8);
  await expect(contribution.locator("details")).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath("06-contribution-overview.png") });

  await contribution.getByRole("button", { name: "Wie war deine Pause?", exact: true }).click();
  await page.waitForTimeout(200);
  await expect(contribution.locator("[data-contribution-task]:visible")).toHaveCount(1);
  await expect(contribution).toHaveAccessibleName("Wie war deine Pause?");
  await contribution.getByLabel("4 Sterne").first().click();
  await expect(contribution.locator(".rating-control").first().locator("output")).toHaveText("4 Sterne");
  await page.screenshot({ path: testInfo.outputPath("07-rating-form.png") });
  await contribution.getByLabel("Beiträge schliessen").click();
  await expect(contribution).toHaveAccessibleName("Entwurf verwerfen?");
  await contribution.getByRole("button", { name: "Weiter bearbeiten", exact: true }).click();
  await expect(contribution.getByRole("group", { name: "Gesamt", exact: true }).getByRole("radio", { name: "4 Sterne", exact: true })).toBeChecked();
  await contribution.getByLabel("Beiträge schliessen").click();
  await contribution.getByRole("button", { name: "Verwerfen und schliessen", exact: true }).click();
  await expect(contribution).toBeHidden();

  await page.goto("/?action=add");
  await page.getByRole("button", { name: "Hier eintragen" }).click();
  const add = page.getByRole("dialog", { name: "Bänkli eintragen" });
  await expect(add).toBeVisible();
  await expect(add.locator(".nearby-benches")).not.toContainText("werden geprüft");
  await expect(add.locator(".add-bench-steps [aria-current='step']")).toContainText("Details");
  await expect(add.getByRole("button", { name: "Eintragen", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("08-add-bench.png") });
});

test("checks for duplicate benches before optional reverse geocoding finishes", async ({ page }, testInfo) => {
  await registerUser(page, `nearby-${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`);
  await page.goto("/?action=add");
  let coordinateRequests = 0;
  let release!: () => void;
  const pendingGeocoder = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      let args: unknown;
      try { args = JSON.parse(request.postData() ?? "null"); } catch { /* Other action encodings are unrelated. */ }
      if (Array.isArray(args) && args.length === 2 && args.every((value) => typeof value === "number")) {
        coordinateRequests += 1;
        // Both lookups accept two coordinates. Let the first finish and hold
        // the second: reversing their priority leaves the nearby panel stuck.
        if (coordinateRequests === 2) await pendingGeocoder;
      }
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Hier eintragen" }).click();
    await expect.poll(() => coordinateRequests).toBe(2);
    const add = page.getByRole("dialog", { name: "Bänkli eintragen", exact: true });
    await expect(add.locator(".nearby-benches")).not.toContainText("werden geprüft");
    await expect(add.locator(".add-location")).toHaveText("Ort wird gesucht …");
    await expect(add.getByRole("button", { name: "Eintragen", exact: true })).toBeEnabled();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
