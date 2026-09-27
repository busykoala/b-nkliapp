/** Capture a real bench's resting and interactive panorama at diagnostic bearings.
 * Usage: npx tsx scripts/review-terrain-depth.ts OUTPUT BENCH_ID [ORIGIN]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const output = resolve(process.argv[2] ?? "test-results/terrain-depth-review");
const benchId = process.argv[3];
const origin = process.argv[4] ?? "http://localhost:3102";
const headings = [45, 90, 180, 270, 315] as const;
const viewports = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

if (!benchId) throw new Error("BENCH_ID is required");

async function waitForPainting(page: Page) {
  await page.locator("img.bench-panorama-art").first().waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>("img.bench-panorama-art"))
    .some((image) => image.complete && image.naturalWidth > 0), undefined, { timeout: 20_000 });
  await page.waitForFunction(() => {
    const canvases = Array.from(document.querySelectorAll("canvas.bench-panorama-webgl"));
    return canvases.length === 0 || canvases.some((canvas) => canvas.classList.contains("is-ready"));
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(350);
}

async function setHeading(page: Page, heading: number) {
  const viewport = page.locator(".bench-panorama-viewport");
  await viewport.focus();
  await viewport.press("Home");
  const initial = Number((await page.locator(".bench-panorama-bearing").textContent())?.replace(/\D/g, ""));
  let delta = ((heading - initial + 540) % 360) - 180;
  const direction = delta >= 0 ? "ArrowRight" : "ArrowLeft";
  delta = Math.abs(delta);
  for (let step = 0; step < Math.floor(delta / 30); step += 1) await viewport.press(`Shift+${direction}`);
  for (let step = 0; step < Math.round((delta % 30) / 5); step += 1) await viewport.press(direction);
  await page.waitForFunction((target) => {
    const text = document.querySelector(".bench-panorama-bearing")?.textContent ?? "";
    return Number(text.replace(/\D/g, "")) === target;
  }, heading);
}

async function main() {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      try {
        await page.goto(`${origin}/bank/${encodeURIComponent(benchId)}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await waitForPainting(page);
        // Next's development status portal is not product UI and can overlap
        // the lower-left panorama edge while a route finishes compiling.
        await page.evaluate(() => document.querySelectorAll<HTMLElement>("nextjs-portal")
          .forEach((portal) => { portal.style.display = "none"; }));
        await page.screenshot({ path: join(output, `${viewport.label}-rest-page.png`), fullPage: true });
        await page.locator(".bench-panorama").screenshot({ path: join(output, `${viewport.label}-rest-panorama.png`) });
        await page.locator(".bench-panorama-expand").click();
        await page.locator(".bench-panorama.is-expanded").waitFor();
        for (const heading of headings) {
          await setHeading(page, heading);
          const label = await page.locator(".bench-panorama-viewport").getAttribute("aria-label");
          const file = `${viewport.label}-heading-${heading}.png`;
          await page.locator(".bench-panorama").screenshot({ path: join(output, file) });
          results.push({ viewport: viewport.label, heading, label, file: join(output, file) });
        }
        results.push({ viewport: viewport.label, errors });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(output, "manifest.json"), `${JSON.stringify({ origin, bench: benchId, results }, null, 2)}\n`);
  if (results.some((result) => Array.isArray(result.errors) && result.errors.length)) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
