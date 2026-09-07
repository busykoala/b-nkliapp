import { expect, test } from "@playwright/test";

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await page.goto("/");
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

test("keeps the community feed local, finite and centred on places", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("link", { name: "Bänkli-Feed" }).click();

  await expect(page.getByRole("heading", { name: "Bänkli-Momente" })).toBeVisible();
  await expect(page.getByText("Bänkli dieser Woche", { exact: true })).toBeVisible();
  await expect(page.getByText("Gemeinsames Thema", { exact: true })).toBeVisible();
  const entryCount = await page.locator(".feed-entry").count();
  expect(entryCount).toBeLessThanOrEqual(36);
  if (!entryCount) await expect(page.getByText("Noch weht kein neuer Eintrag herein.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("community-feed-empty.png"), fullPage: true });
});

test("leaves a moment, cares for and follows a Bänkli from one contribution place", async ({ page }, testInfo) => {
  const runId = `${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`;
  const moment = `Die Limmat klingt hier morgens besonders ruhig (${runId}).`;
  await registerUser(page, `p-${runId}`);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: "Beitragen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });

  await dialog.locator("summary").filter({ hasText: "Einen Moment hinterlassen" }).click();
  await dialog.getByLabel("Dein Bänkli-Moment").fill(moment);
  await dialog.getByRole("button", { name: "Moment veröffentlichen" }).click();
  await expect(dialog.getByText("Dein Bänkli-Moment ist jetzt am Platz zu lesen.")).toBeVisible();

  await dialog.locator("summary").filter({ hasText: "Sich ums Bänkli kümmern" }).click();
  await dialog.getByRole("button", { name: "Kurz gereinigt", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Kurz gereinigt · von dir" })).toBeDisabled();
  await dialog.getByLabel("Beiträge schliessen").click();

  await expect(page.getByText(moment)).toBeVisible();
  const follow = page.getByRole("button", { name: "Bänkli merken" });
  await follow.click();
  await expect(page.getByRole("button", { name: "Lieblingsplatz" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/\d+× gereinigt/)).toBeVisible();
});
