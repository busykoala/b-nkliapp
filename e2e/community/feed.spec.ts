import { randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fixtureDatabase } from "../support/database";

let fixtureUser: string | undefined;
let fixtureBenchIds: string[] = [];

function cloneBench(database: ReturnType<typeof fixtureDatabase>, sourceId: string) {
  const source = database.prepare("SELECT * FROM benches WHERE id=?").get(sourceId) as Record<string, unknown> | undefined;
  if (!source) throw new Error(`Missing feed fixture source bench ${sourceId}`);
  const id = `community-${randomUUID()}`;
  const columns = Object.keys(source).filter((name) => name !== "row_id");
  const values: Record<string, unknown> = { ...source, id, osm_id: -randomInt(1, 2_000_000_000) };
  const result = database.prepare(`INSERT INTO benches (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .run(...columns.map((name) => values[name]));
  fixtureBenchIds.push(id);
  return { id, rowId: Number(result.lastInsertRowid) };
}

test.afterEach(() => {
  if (!fixtureUser && !fixtureBenchIds.length) return;
  const database = fixtureDatabase();
  try {
    if (fixtureUser) database.prepare("DELETE FROM bench_moments WHERE user_id=(SELECT id FROM users WHERE username=?)").run(fixtureUser);
    for (const id of fixtureBenchIds) database.prepare("DELETE FROM benches WHERE id=?").run(id);
    if (fixtureUser) database.prepare("DELETE FROM users WHERE username=?").run(fixtureUser);
  } finally {
    database.close();
    fixtureUser = undefined;
    fixtureBenchIds = [];
  }
});

test("groups a busy bench across pages without mixing its neighbour", async ({ page }, info) => {
  await page.goto("/feed");
  const database = fixtureDatabase();
  const username = `feed-${Date.now().toString(36)}`;
  fixtureUser = username;
  const day = "2029-06-15T12:00:00.000Z";
  try {
    const user = Number(database.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES(?,?,?,?)").run(username, username, "fixture-only", day).lastInsertRowid);
    // Keep this pagination stress fixture off the shared Lindenhof seed. Its
    // future-dated rows otherwise occupy the bench detail's 12-moment window
    // while parallel contribution tests are verifying newly published text.
    const first = cloneBench(database, "osm-node-101");
    const next = cloneBench(database, "osm-node-102");
    for (let i = 0; i < 55; i++) database.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,created_at,updated_at) VALUES(?,?,'memory',?,?,?)").run(i === 0 ? next.rowId : first.rowId, user, `Seitenprobe ${i}`, new Date(Date.parse(day) + i * 1000).toISOString(), day);
    fixtureBenchIds = [first.id, next.id];
    const sharedRows = database.prepare(`SELECT count(*) count FROM bench_moments m JOIN benches b ON b.row_id=m.bench_row_id WHERE m.user_id=? AND b.id IN ('osm-node-101','osm-node-102')`).get(user) as { count: number };
    expect(sharedRows.count).toBe(0);
  } finally { database.close(); }
  await page.reload();
  const groups = page.locator(".feed-bench-group").filter({ hasText: "15. Juni 2029" });
  await expect(groups).toHaveCount(1);
  await page.getByRole("button", { name: "Mehr Beiträge laden" }).click();
  await expect(groups).toHaveCount(2);
  const firstId = fixtureBenchIds[0];
  const nextId = fixtureBenchIds[1];
  await expect(groups.filter({ has: page.locator(`a[href^='/bank/${firstId}']`) })).toHaveCount(1);
  await expect(groups.filter({ has: page.locator(`a[href^='/bank/${firstId}']`) }).locator("summary")).toHaveText(/Beiträge ansehen \(54\)/);
  await expect(groups.filter({ has: page.locator(`a[href^='/bank/${nextId}']`) }).locator("summary")).toHaveText(/Beiträge ansehen \(1\)/);
  await page.screenshot({ path: info.outputPath("grouped-feed.png"), fullPage: true });
});

test("does not reveal favourite lists to guests", async ({ page }) => {
  await page.goto("/lieblingsplaetze");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Meine Lieblingsplätze" })).toHaveCount(0);
});
