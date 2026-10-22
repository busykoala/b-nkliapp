import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

const benchId = "osm-node-101";
async function registerUser(page: import("@playwright/test").Page) {
  const username = `observ-${Date.now().toString(36)}`;
  await page.goto(`/bank/${benchId}`);
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", { name: "Registrieren" }).click();
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await expect(page.getByRole("dialog", { name: "Dein Bänkli-Konto" })).toBeHidden();
  return username;
}

test("uses three concerns and preserves a concrete correction draft without manual scales", async ({ page }, info) => {
  await registerUser(page);
  await page.getByRole("button", { name: "Etwas beitragen", exact: true }).click();
  const dialog = page.locator(".contribution-dialog[open]");
  await expect(dialog.locator("[data-contribution-choice]")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Licht gerade jetzt", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Aussicht & Umgebung", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Problem melden", exact: true }).click();
  await dialog.locator("select[name=field]").selectOption("environment");
  const note = dialog.locator("textarea[name=note]");
  await note.fill("Die Aussicht ist durch neue Bäume verdeckt.");
  await dialog.getByRole("button", { name: "Alle Beiträge", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Problem melden", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Problem melden", exact: true }).click();
  await expect(note).toHaveValue("Die Aussicht ist durch neue Bäume verdeckt.");
  await dialog.getByRole("button", { name: "Hinweis veröffentlichen" }).click();
  await expect(dialog.getByRole("status")).toContainText("Danke");
  await dialog.screenshot({ path: info.outputPath("view-correction.png") });
});

test("keeps unknown traffic out of the overview and places uncertainty in visit details", async ({ page }) => {
  await page.goto(`/bank/${benchId}`);
  expect(await page.locator("[data-visit-hint]").count()).toBeLessThanOrEqual(3);
  await expect(page.locator(".bench-overview")).not.toContainText("noch nicht erfasst");
  await expect(page.locator(".bench-sources")).toHaveCount(0);
  await expect(page.locator(".bench-visit-warnings")).not.toContainText("noch nicht ausreichend bekannt");
  await page.locator(".bench-visit-details > details > summary").click();
  await expect(page.locator(".bench-visit-details")).toContainText("Der Zugang ist noch nicht ausreichend bekannt.");
});

test("preserves historical observations with private inspection and deletion, without new questionnaires", async ({ page, browser }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const username = await registerUser(page);
  const db = new Database(process.env.BENCHLY_E2E_DATABASE!);
  let rowId: number;
  try {
    const user = db.prepare("SELECT id FROM users WHERE username_key=?").get(username) as { id: number };
    const bench = db.prepare("SELECT row_id FROM benches WHERE id=?").get(benchId) as { row_id: number };
    rowId = bench.row_id;
    db.prepare("INSERT INTO bench_light_observations(bench_row_id,user_id,choice,observed_at,season,day_phase,created_at) VALUES(?,?,'shade','2026-09-05T10:00:00Z','autumn','day','2026-09-05T10:00:00Z')").run(rowId, user.id);
    db.prepare("INSERT INTO bench_view_observations(bench_row_id,user_id,kind,season,observed_at,created_at) VALUES(?,?,'agreement','autumn','2026-09-05T10:00:00Z','2026-09-05T10:00:00Z')").run(rowId, user.id);
  } finally { db.close(); }
  await page.reload();
  await page.locator(".bench-visit-details > details > summary").click();
  const history = page.locator(".observation-history");
  await expect(history).not.toHaveAttribute("open", "");
  await history.locator("summary").click();
  await expect(history).toContainText("Schatten");
  await history.getByRole("button", { name: "Licht gerade jetzt löschen", exact: true }).click();
  await expect(history.getByRole("button", { name: "Licht gerade jetzt löschen", exact: true })).toHaveCount(0);
  await history.getByRole("button", { name: "Aussicht & Umgebung löschen", exact: true }).click();
  await expect(history.getByRole("button")).toHaveCount(0);
  const check = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    for (const table of ["bench_light_observations", "bench_view_observations"]) {
      const row = check.prepare(`SELECT retracted_at FROM ${table} WHERE bench_row_id=? ORDER BY id DESC LIMIT 1`).get(rowId) as { retracted_at: string | null };
      expect(row.retracted_at).not.toBeNull();
    }
  } finally { check.close(); }
  const guest = await browser.newContext({ ignoreHTTPSErrors: true });
  try { const publicPage = await guest.newPage(); await publicPage.goto(page.url()); await expect(publicPage.locator(".observation-history")).toHaveCount(0); } finally { await guest.close(); }
  await page.screenshot({ path: info.outputPath("observation-history.png") });
});
