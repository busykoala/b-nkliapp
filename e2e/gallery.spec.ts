import { expect, test } from "@playwright/test";
import { fixtureDatabase } from "./support/database";

test("opens photos in a swipeable modal and restores focus without navigation", async ({ page }, info) => {
  await page.goto("/bank/osm-node-101");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 450;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#d7e3cf"; context.fillRect(0, 0, 600, 450);
    context.fillStyle = "#756049"; context.fillRect(140, 200, 320, 24); context.fillRect(140, 265, 320, 20);
    context.fillRect(165, 220, 16, 110); context.fillRect(420, 220, 16, 110);
    return canvas.toDataURL("image/png");
  });
  const database = fixtureDatabase();
  const username = `photo-${Date.now().toString(36)}`;
  try {
    const user = Number(database.prepare("INSERT INTO users(username,username_key,password_hash,created_at) VALUES(?,?,?,?)").run(username, username, "fixture-only", "2026-01-01").lastInsertRowid);
    const row = database.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number };
    for (let index = 0; index < 2; index++) database.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,photo_url,created_at,updated_at) VALUES(?,?,'photo',?,?,?,?)").run(row.row_id, user, `Galerie ${index}`, image, new Date().toISOString(), new Date().toISOString());
  } finally { database.close(); }
  await page.reload();
  const thumbnail = page.getByRole("button", { name: `Bänkli-Foto von ${username} gross ansehen` }).first();
  await thumbnail.click();
  const gallery = page.getByRole("dialog", { name: `Bänkli-Foto von ${username}`, exact: true });
  await expect(gallery).toBeVisible();
  await expect(gallery.locator(".photo-stage img")).toBeVisible();
  await expect.poll(() => gallery.locator(".photo-stage img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(600);
  const initial = await gallery.locator("header > span").textContent();
  await gallery.getByRole("button", { name: "Nächstes Foto" }).click();
  await expect(gallery.locator("header > span")).not.toHaveText(initial!);
  await gallery.locator(".photo-stage").dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 100, clientY: 180 }] });
  await gallery.locator(".photo-stage").dispatchEvent("touchend", { changedTouches: [{ identifier: 1, clientX: 280, clientY: 185 }] });
  await expect(gallery.locator("header > span")).toHaveText(initial!);
  await page.screenshot({ path: info.outputPath("photo-gallery.png") });
  await page.keyboard.press("Escape");
  await expect(gallery).not.toBeVisible();
  await expect(thumbnail).toBeFocused();
  await expect(page).toHaveURL(/\/bank\/osm-node-101$/);
  expect(page.context().pages()).toHaveLength(1);
});
