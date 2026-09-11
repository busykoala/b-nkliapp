import { expect, test } from "@playwright/test";
import { fixtureDatabase } from "./support/database";

let fixtureUser: string | undefined;
test.afterEach(() => {
  if (!fixtureUser) return;
  const database = fixtureDatabase();
  try { database.prepare("DELETE FROM bench_moments WHERE user_id=(SELECT id FROM users WHERE username=?)").run(fixtureUser); }
  finally { database.close(); fixtureUser = undefined; }
});

test("groups a busy bench across pages without mixing its neighbour", async ({ page }, info) => {
  await page.goto("/feed");
  const database = fixtureDatabase();
  const username = `feed-${Date.now().toString(36)}`;
  fixtureUser = username;
  const day = "2029-06-15T12:00:00.000Z";
  try {
    const user = Number(database.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES(?,?,?,?)").run(username, username, "fixture-only", day).lastInsertRowid);
    const first = database.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number };
    const next = database.prepare("SELECT row_id FROM benches WHERE id='osm-node-102'").get() as { row_id: number };
    for (let i = 0; i < 55; i++) database.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,created_at,updated_at) VALUES(?,?,'memory',?,?,?)").run(i === 0 ? next.row_id : first.row_id, user, `Seitenprobe ${i}`, new Date(Date.parse(day) + i * 1000).toISOString(), day);
  } finally { database.close(); }
  await page.reload();
  const groups = page.locator(".feed-bench-group").filter({ hasText: "15. Juni 2029" });
  await expect(groups).toHaveCount(1);
  await page.getByRole("button", { name: "Mehr Beiträge laden" }).click();
  await expect(groups).toHaveCount(2);
  await expect(groups.filter({ has: page.locator("a[href^='/bank/osm-node-101']") })).toHaveCount(1);
  await expect(groups.filter({ has: page.locator("a[href^='/bank/osm-node-101']") }).locator("summary")).toHaveText(/Beiträge ansehen \(54\)/);
  await expect(groups.filter({ has: page.locator("a[href^='/bank/osm-node-102']") }).locator("summary")).toHaveText(/Beiträge ansehen \(1\)/);
  await page.screenshot({ path: info.outputPath("grouped-feed.png"), fullPage: true });
});

test("does not reveal favourite lists to guests", async ({ page }) => {
  await page.goto("/lieblingsplaetze");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Meine Lieblingsplätze" })).toHaveCount(0);
});
