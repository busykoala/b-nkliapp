import { expect, test } from "@playwright/test";

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", {name: "Registrieren"}).click();
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", {exact: true}).fill("sicheres-passwort-2026");
  await page.getByRole("button", {name: "Konto erstellen"}).click();
  await page.getByLabel("Menü öffnen").click();
  await expect(page.getByText("Mein Profil")).toBeVisible();
  await page.getByLabel("Menü schliessen").click();
}

test("credits a secret invitation only after a new account is created", async ({page, browser}, testInfo) => {
  const suffix = `${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`;
  const inviter = `invite-${suffix}`;
  await registerUser(page, inviter);
  await page.goto("/profil");
  await expect(page).toHaveURL(/\/profil$/);
  const referrals = page.locator(".referral-card");
  await referrals.scrollIntoViewIfNeeded();
  await referrals.getByRole("button", {name: "Geheimen Einladungslink erstellen"}).click();
  const invitationUrl = await referrals.getByLabel("Dein geheimer Link").inputValue();
  expect(invitationUrl).toMatch(/\/einladung\/[A-Za-z0-9_-]{43}$/);
  await referrals.screenshot({path: testInfo.outputPath("01-referral-link.png")});

  const invitedContext = await browser.newContext();
  const invitedPage = await invitedContext.newPage();
  await invitedPage.goto(invitationUrl);
  await expect(invitedPage.getByRole("heading", {name: `${inviter} lädt dich zur Bänkli App ein`})).toBeVisible();
  await invitedPage.screenshot({path: testInfo.outputPath("02-referral-invitation.png")});
  await invitedPage.getByLabel("Benutzername").fill(`guest-${suffix}`);
  await invitedPage.getByLabel("Passwort", {exact: true}).fill("anderes-sicheres-passwort");
  await invitedPage.getByRole("button", {name: "Konto erstellen"}).click();
  await expect(invitedPage).toHaveURL(/\/profil$/);
  await invitedContext.close();

  await page.reload();
  await referrals.scrollIntoViewIfNeeded();
  await expect(referrals.getByText("eingeladenes Konto", {exact: true})).toBeVisible();
  await expect(referrals.getByText("Noch 2 Einladungen bis zum Abzeichen.")).toBeVisible();
});
