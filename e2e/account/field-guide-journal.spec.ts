import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

test("keeps a personal journal, public memories and private saved places distinct", async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.getByRole("button", { name: "Registrieren", exact: true }).click();
  const username = `journal-${Date.now().toString(36)}`;
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Dein Bänkli-Konto" })).toBeHidden();
  const db = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    const user = db.prepare("SELECT id FROM users WHERE username_key=?").get(username) as { id: number };
    const bench = db.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number };
    for (let i = 0; i < 3; i++) db.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,created_at,updated_at,visible) VALUES(?,?,'memory',?,'2026-10-20','2026-10-20',1)").run(bench.row_id, user.id, `Ein stiller Augenblick ${i + 1}.`);
    db.prepare("INSERT INTO bench_follows(user_id,bench_row_id,created_at) VALUES(?,?,'2026-10-20')").run(user.id, bench.row_id);
  } finally { db.close(); }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/profil");
    await expect(page.locator(".profile-moments")).toContainText("Ein stiller Augenblick");
    await expect(page.locator(".journal-collection")).not.toHaveAttribute("open", "");
    await expect(page.locator(".profile-numbers")).toBeHidden();
    await expect(page.locator(".profile-pending")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`journal-populated-${width}.png`), fullPage: true });
    await page.goto("/lieblingsplaetze");
    await expect(page.locator(".saved-bench-item")).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`saved-populated-${width}.png`) });
  }
  await page.goto("/bank/osm-node-101");
  await expect(page.locator(".bench-moment-list > article")).toHaveCount(2);
  await page.locator(".moments-toggle").click();
  expect(await page.locator(".bench-moment-list > article").count()).toBeGreaterThan(2);
  await page.locator(".moments-toggle").click();
  await expect(page.locator(".bench-moment-list > article")).toHaveCount(2);
  const origin = new URL(page.url()).origin;
  const publicContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`${origin}/profil/${username}`);
    await expect(publicPage.locator(".profile-moments")).toContainText("Ein stiller Augenblick");
    await expect(publicPage.locator(".profile-favourites,.avatar-customizer,.journal-invite,.referral-progress,.profile-numbers")).toHaveCount(0);
    await expect(publicPage.locator(".journal-collection")).toHaveCount(0);
    await publicPage.screenshot({ path: info.outputPath("journal-public.png"), fullPage: true });
  } finally { await publicContext.close(); }
});

test("saved-place pagination keeps unavailable places removable and return focus intact", async ({ page }, info) => {
  const { createIsolatedPanoramaBench, removeIsolatedPanoramaBench } = await import("../support/panorama-fixture");
  const ids: string[] = [];
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("button",{name:"Anmelden",exact:true}).click();
  await page.getByRole("button",{name:"Registrieren",exact:true}).click();
  const username=`saved-${info.project.name}`;
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort",{exact:true}).fill("sicheres-passwort-2026");
  await page.getByRole("button",{name:"Konto erstellen",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Dein Bänkli-Konto"})).toBeHidden();
  const db=new Database(process.env.BENCHLY_E2E_DATABASE!);
  try {
    const user=(db.prepare("SELECT id FROM users WHERE username_key=?").get(username.toLowerCase()) as {id:number}).id;
    for(let index=0;index<49;index++) {
      const id=createIsolatedPanoramaBench(); ids.push(id);
      db.prepare("UPDATE benches SET name=? WHERE id=?").run(`Prüfplatz ${index+1}`,id);
      db.prepare("INSERT INTO bench_follows(user_id,bench_row_id,created_at) SELECT ?,row_id,'2026-10-20' FROM benches WHERE id=?").run(user,id);
    }
    db.prepare("UPDATE benches SET active=0 WHERE id=?").run(ids.at(-1)!);
    await page.goto("/lieblingsplaetze");
    await expect(page.locator(".saved-bench-item")).toHaveCount(47);
    const unavailable=page.locator(".saved-bench-unavailable");
    await expect(unavailable).toContainText("Prüfplatz 49");
    await page.screenshot({path:info.outputPath("saved-unavailable.png")});
    await unavailable.getByRole("button",{name:/Entfernen/}).click();
    await expect(unavailable).toHaveCount(0);
    await page.screenshot({path:info.outputPath("saved-removal-undo.png")});
    await page.getByRole("status").getByRole("button",{name:/Rückgängig/}).click();
    await expect(unavailable).toContainText("Prüfplatz 49");
    const more=page.locator('a[href^="/lieblingsplaetze?before="]');
    await more.click();
    await expect(page.locator(".saved-bench-item")).toHaveCount(1);
    await page.screenshot({path:info.outputPath("saved-next-page.png")});
    const place=page.locator(".saved-bench-item > a").first();
    await place.click();
    await expect(page.locator(".standalone-bench .bench-header")).toBeVisible();
    await page.getByRole("button",{name:"Zurück",exact:true}).click();
    await expect(place).toBeFocused();
    await expect(page).toHaveURL(/lieblingsplaetze\?before=/);
  } finally { db.close(); for(const id of ids)removeIsolatedPanoramaBench(id); }
});
