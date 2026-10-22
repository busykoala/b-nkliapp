import { expect, test as base } from "@playwright/test";
import Database from "better-sqlite3";
import sharp from "sharp";
import { createIsolatedPanoramaBench, installTerrainPanoramaFixture, removeIsolatedPanoramaBench } from "../support/panorama-fixture";

const test = base.extend<{ panoramaBench: string }>({
  panoramaBench: async ({ page }, provideBench) => {
    // Trigger the isolated application's migrations/seed before cloning facts.
    await page.goto("/");
    const id = createIsolatedPanoramaBench();
    try { await provideBench(id); } finally { removeIsolatedPanoramaBench(id); }
  },
});

function setCoveredFixture(id: string) {
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try { database.prepare("UPDATE benches SET covered=1 WHERE id=?").run(id); }
  finally { database.close(); }
}

// These cases replace panorama requests with controlled browser fixtures.
test.use({ serviceWorkers: "block" });

test("keeps the inline painting calm and explores the full sky in an accessible 360 view", async ({ page, browserName, panoramaBench }, testInfo) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  setCoveredFixture(panoramaBench);
  await page.goto(`/?bank=${panoramaBench}`);
  await expect(page.locator(".bench-atlas-sheet")).toHaveAttribute("data-presentation", "place");
  await installTerrainPanoramaFixture(panoramaBench, true);

  const panorama = page.locator(".bench-panorama");
  // A panorama completed by the worker appears in the open detail without a reload.
  await expect(panorama).toBeVisible({ timeout: 7_000 });
  await expect(page.locator(".bench-atlas-sheet")).toHaveAttribute("data-presentation", "place");
  await expect(panorama.locator(".bench-panorama-shelter")).toBeVisible();
  await expect(panorama.locator(".bench-panorama-ground-patch, .bench-panorama-bench-shadow")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("panorama-overlay-full.png") });
  const bearing = panorama.locator(".bench-panorama-bearing");
  await expect(bearing).toHaveCount(0);
  await expect(panorama.getByRole("slider")).toHaveCount(0);
  const zoom = panorama.locator(".bench-panorama-zoom-controls span");
  await expect(zoom).toHaveCount(0);
  await expect(panorama).toHaveClass(/is-static/);
  await expect(panorama.locator(".bench-panorama-sky").first()).toBeAttached();
  await expect(panorama.locator(".bench-panorama-viewport")).toHaveCSS("touch-action", "pan-y");
  const image = page.locator(".bench-panorama-art").first();
  await expect(image).toHaveJSProperty("complete", true);
  await expect(panorama.locator(".bench-panorama-webgl").first()).toHaveClass(/is-ready/);
  const canvasBudget = await panorama.locator(".bench-panorama-webgl").first().evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width, height: canvas.height,
  }));
  expect(canvasBudget.width).toBeGreaterThanOrEqual(512);
  expect(canvasBudget.height).toBeGreaterThanOrEqual(128);
  expect(canvasBudget.width).toBeLessThanOrEqual(2048);
  expect(canvasBudget.height).toBeLessThanOrEqual(512);
  await expect(panorama.locator(".bench-panorama-foreground")).toBeHidden();
  await panorama.screenshot({ path: testInfo.outputPath("panorama-mobile-initial.png") });

  const open = panorama.getByRole("button", { name: "Panorama gross im 360-Grad-Modus öffnen" });
  await open.click();
  await expect(panorama).toHaveClass(/is-expanded/);
  await expect(panorama.locator(".bench-panorama-foreground")).toBeVisible();
  // Read all layout rectangles together so geometry assertions describe one
  // rendered frame rather than separate browser layout turns.
  const layout = await panorama.evaluate((element) => {
    const bench = element.querySelector<HTMLElement>(".bench-panorama-rear-bench");
    if (!bench) return null;
    const panoramaBox = element.querySelector(".bench-panorama-viewport")!.getBoundingClientRect();
    const benchBox = bench.getBoundingClientRect();
    return {
      panorama: { width: panoramaBox.width, height: panoramaBox.height, y: panoramaBox.y },
      bench: { width: benchBox.width, height: benchBox.height, y: benchBox.y },
    };
  });
  expect(layout).not.toBeNull();
  // The seat meets the viewport edge; legs extend beneath its clipping boundary.
  expect(layout!.bench.width).toBeLessThan(layout!.panorama.width * .62);
  expect(layout!.bench.y + layout!.bench.height).toBeGreaterThan(layout!.panorama.y + layout!.panorama.height * .9);
  expect(layout!.bench.y).toBeLessThan(layout!.panorama.y + layout!.panorama.height * .95);
  expect(layout!.bench.y + layout!.bench.height).toBeGreaterThan(layout!.panorama.y + layout!.panorama.height);

  await expect(bearing).toHaveText("325°");
  await expect(panorama).toHaveAttribute("role", "dialog");
  await expect(panorama).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(zoom).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("panorama-quiet-controls.png") });

  const viewport = page.locator(".bench-panorama-viewport");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const before = await page.locator(".bench-panorama-track").getAttribute("style");
  // Double-click and keyboard +/- no longer magnify the painting.
  await viewport.dblclick({ position: { x: box!.width * .5, y: box!.height * .5 } });
  await viewport.press("+");
  await viewport.press("-");
  expect(await page.locator(".bench-panorama-track").getAttribute("style")).toBe(before);
  const zoomed = before;
  await page.mouse.move(box!.x + box!.width * .7, box!.y + box!.height * .32);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .65, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator(".bench-panorama-track").getAttribute("style");
  expect(after).not.toBe(before);
  const beforeTop = Number(zoomed?.match(/--panorama-track-top:\s*(-?[\d.]+)px/)?.[1]);
  const afterTop = Number(after?.match(/--panorama-track-top:\s*(-?[\d.]+)px/)?.[1]);
  expect(afterTop).toBeGreaterThan(beforeTop + 45);
  await expect(bearing).not.toHaveText("325°");
  await expect(panorama.locator(".bench-panorama-foreground .bench-panorama-rear-bench")).toBeVisible();
  const bankArrow = panorama.getByRole("button", { name: "Zur Blickrichtung der Bank" });
  await expect(bankArrow).toBeVisible();
  await bankArrow.click();
  await expect(bearing).toHaveText("325°");
  await expect(bankArrow).toHaveCount(0);
  await expect(viewport).toBeFocused();

  await viewport.focus();
  await viewport.press("Home");
  await expect(zoom).toHaveCount(0);
  await expect(bearing).toHaveText("325°");
  const homeStyle = await page.locator(".bench-panorama-track").getAttribute("style");
  const homeTop = Number(homeStyle?.match(/--panorama-track-top:\s*(-?[\d.]+)px/)?.[1]);
  let restStyle = homeStyle;
  if (browserName !== "webkit") {
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -600);
    await expect(zoom).toHaveCount(0);
    const wheelUpStyle = await page.locator(".bench-panorama-track").getAttribute("style");
    const wheelUpTop = Number(wheelUpStyle?.match(/--panorama-track-top:\s*(-?[\d.]+)px/)?.[1]);
    expect(wheelUpTop).toBeGreaterThan(homeTop + 100);
    await page.mouse.wheel(0, 5_000);
    restStyle = await page.locator(".bench-panorama-track").getAttribute("style");
    const wheelDownTop = Number(restStyle?.match(/--panorama-track-top:\s*(-?[\d.]+)px/)?.[1]);
    expect(wheelDownTop).toBeCloseTo(homeTop, 2);
  }
  const widthAtOne = Number(restStyle?.match(/--panorama-copy-width:\s*([\d.]+)px/)?.[1]);
  await viewport.press("+");
  const unchanged = await page.locator(".bench-panorama-track").getAttribute("style");
  expect(Number(unchanged?.match(/--panorama-copy-width:\s*([\d.]+)px/)?.[1])).toBe(widthAtOne);
  for (let index = 0; index < 65; index++) await viewport.press("ArrowLeft");
  await expect(bearing).toHaveText("0°");
  await viewport.press("ArrowLeft");
  await expect(bearing).toHaveText("355°");
  await expect(bankArrow).toHaveAttribute("data-turn", "left");
  await page.screenshot({ path: testInfo.outputPath("panorama-bank-left.png") });
  await bankArrow.click();
  await viewport.press("Shift+ArrowLeft");
  await expect(bankArrow).toHaveAttribute("data-turn", "right");
  await page.screenshot({ path: testInfo.outputPath("panorama-bank-right.png") });
  await bankArrow.click();
  await expect(bearing).toHaveText("325°");

  // Centre the actual sun or moon before looking up. Its percentage is the
  // projected geographic azimuth, so this works for both the day CI fixture
  // and the manually exercised night fixture.
  const celestial = panorama.locator(".bench-panorama-celestial");
  await expect(celestial).toHaveCount(3);
  const celestialAzimuth = Number.parseFloat((await celestial.first().getAttribute("style"))!.match(/left:\s*([\d.]+)%/)![1]) * 3.6;
  const currentHeading = Number.parseInt((await bearing.textContent())!, 10);
  const headingDelta = ((celestialAzimuth - currentHeading + 540) % 360) - 180;
  const turnKey = headingDelta < 0 ? "Shift+ArrowLeft" : "Shift+ArrowRight";
  for (let index = 0; index < Math.round(Math.abs(headingDelta) / 30); index++) await viewport.press(turnKey);

  const skyBox = await viewport.boundingBox();
  await page.mouse.move(skyBox!.x + skyBox!.width * .5, skyBox!.y + skyBox!.height * .12);
  await page.mouse.down();
  await page.mouse.move(skyBox!.x + skyBox!.width * .5, skyBox!.y + skyBox!.height * .9, { steps: 6 });
  await page.mouse.up();
  const skyStyle = await page.locator(".bench-panorama-track").getAttribute("style");
  const skyVertical = Number(skyStyle?.match(/--panorama-track-top:\s*(-?[\d.]+)px/)?.[1]);
  expect(skyVertical).toBeGreaterThan(-2);
  await expect(celestial.nth(1)).toBeInViewport({ ratio: .5 });
  const layers = await celestial.nth(1).evaluate((body) => ({
    body: Number.parseInt(getComputedStyle(body).zIndex, 10),
    terrain: Number.parseInt(getComputedStyle(body.parentElement!.querySelector(".bench-panorama-raster")!).zIndex, 10),
  }));
  expect(layers.terrain).toBeGreaterThan(layers.body);
  const bodyBox = await celestial.nth(1).boundingBox();
  expect(bodyBox).not.toBeNull();
  const bodyPixels = await page.screenshot({ clip: bodyBox! });
  const { data: bodyData, info: bodyInfo } = await sharp(bodyPixels).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const regionLuminance = (startY: number, endY: number, startX: number, endX: number) => {
    let total = 0; let samples = 0;
    for (let y = startY; y < endY; y += 1) for (let x = startX; x < endX; x += 1) {
      const cursor = (y * bodyInfo.width + x) * bodyInfo.channels;
      total += bodyData[cursor] * .299 + bodyData[cursor + 1] * .587 + bodyData[cursor + 2] * .114;
      samples += 1;
    }
    return total / samples;
  };
  const centreLeft = Math.floor(bodyInfo.width * .3); const centreRight = Math.ceil(bodyInfo.width * .7);
  expect(regionLuminance(Math.floor(bodyInfo.height * .18), Math.floor(bodyInfo.height * .45), centreLeft, centreRight))
    .toBeGreaterThan(regionLuminance(Math.ceil(bodyInfo.height * .55), Math.ceil(bodyInfo.height * .82), centreLeft, centreRight) + 1);
  await page.screenshot({ path: testInfo.outputPath("panorama-mobile-high-sky.png") });

  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => page.locator(".bench-panorama-track").evaluate((track) =>
    Number.parseFloat(getComputedStyle(track).top))).toBeGreaterThan(-2);
  await expect(panorama.locator(".bench-panorama-rear-bench")).not.toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("panorama-landscape-high-sky.png") });

  const close = panorama.getByRole("button", { name: "360-Grad-Grossansicht schliessen" });
  await close.click();
  await expect(panorama).toHaveClass(/is-static/);
  await expect(zoom).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(open).toBeFocused();
});

test("keeps semantic sky transparent when WebGL is unavailable", async ({ page, panoramaBench }, testInfo) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, options?: unknown) {
      if (type === "webgl" || type === "experimental-webgl") return null;
      return original.call(this, type as "2d", options as CanvasRenderingContext2DSettings);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await installTerrainPanoramaFixture(panoramaBench, false);
  await page.goto(`/?bank=${panoramaBench}`);
  const panorama = page.locator(".bench-panorama");
  const canvas = panorama.locator(".bench-panorama-webgl.is-ready").first();
  await expect(canvas).toBeVisible({ timeout: 8_000 });
  const alpha = await canvas.evaluate((surface: HTMLCanvasElement) => {
    const context = surface.getContext("2d")!;
    return {
      sky: context.getImageData(surface.width / 2, 10, 1, 1).data[3],
      terrain: context.getImageData(surface.width / 2, surface.height - 10, 1, 1).data[3],
    };
  });
  expect(alpha.sky).toBe(0);
  expect(alpha.terrain).toBe(255);
  await panorama.screenshot({ path: testInfo.outputPath("panorama-canvas2d-fallback.png") });
});

test("offers a retry without displaying an unmasked landscape when the semantic mask fails", async ({ page, panoramaBench }, info) => {
  await installTerrainPanoramaFixture(panoramaBench, false);
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  const row = database.prepare(`SELECT pr.material_key materialKey FROM benches b
    JOIN bench_panorama_renders pr ON pr.bench_row_id=b.row_id WHERE b.id=?`)
    .get(panoramaBench) as { materialKey: string };
  database.close();
  await page.route(`**/media/panorama/${row.materialKey}`, (route) => route.abort("failed"));
  await page.goto(`/?bank=${panoramaBench}`);
  const panorama = page.locator(".bench-panorama");
  await expect(panorama).toHaveAttribute("data-status", "error");
  await expect(panorama.getByRole("status")).toBeVisible();
  await expect(panorama.getByRole("button")).toBeVisible();
  await Promise.all([
    page.waitForResponse(response => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"])),
    page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))),
  ]);
  await expect(panorama).toHaveAttribute("data-status", "error");
  await page.screenshot({ path: info.outputPath("panorama-material-failure.png") });
  await expect(panorama.locator(".bench-panorama-art, .bench-panorama-celestial")).toHaveCount(0);
});

test("keeps an expanded panorama and its pose through a detail refresh", async ({ page, panoramaBench }) => {
  await installTerrainPanoramaFixture(panoramaBench, true);
  await page.goto(`/?bank=${panoramaBench}`);
  const panorama = page.locator(".bench-panorama");
  await panorama.getByRole("button", { name: "Panorama gross im 360-Grad-Modus öffnen" }).click();
  const viewport = panorama.locator(".bench-panorama-viewport");
  await viewport.press("ArrowRight");
  await viewport.press("+");
  await expect(panorama.locator(".bench-panorama-bearing")).toHaveText("330°");
  await expect(panorama.locator(".bench-panorama-zoom-controls")).toHaveCount(0);
  await panorama.evaluate((element) => element.setAttribute("data-viewer-instance", "original"));
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  try { database.prepare("UPDATE benches SET direction_degrees=90 WHERE id=?").run(panoramaBench); }
  finally { database.close(); }
  const refresh = page.waitForResponse((response) => response.request().method() === "POST"
    && response.request().postData() === JSON.stringify([panoramaBench]));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  expect((await refresh).ok()).toBe(true);
  await expect(panorama).toHaveAttribute("data-recorded-direction", "90");
  await expect(panorama).toHaveAttribute("data-viewer-instance", "original");
  await expect(panorama).toHaveClass(/is-expanded/);
  await expect(panorama.locator(".bench-panorama-bearing")).toHaveText("330°");
  await expect(panorama.locator(".bench-panorama-zoom-controls")).toHaveCount(0);
  await panorama.getByRole("button", { name: "360-Grad-Grossansicht schliessen" }).click();
  await expect(panorama).toHaveClass(/is-static/);
  await expect(panorama.locator(".bench-panorama-bearing")).toHaveCount(0);
});
