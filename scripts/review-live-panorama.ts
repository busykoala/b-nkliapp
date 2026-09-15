/** Read-only production screenshots of the expanded Bänkli sheet. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";

const origin = process.env.BENCHLY_LIVE_ORIGIN ?? "https://xn--bnkliapp-0za.ch";
const output = resolve(process.argv[2] ?? "test-results/live-panorama-review");
const selectedBench = process.argv[3];
const selectedViewport = process.argv[4];
const benches = [
  ["city", "osm-node-763529743"],
  ["forest", "osm-node-770651484"],
  ["mountain", "osm-node-768598470"],
  ["lake", "osm-node-4998419683"],
  ["spiez", "osm-node-5795964447"],
] as const;
const viewports = [
  { label: "390", width: 390, height: 844 },
  { label: "430", width: 430, height: 932 },
  { label: "1440", width: 1440, height: 900 },
] as const;

async function main() {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [name, benchId] of benches) {
      if (selectedBench && name !== selectedBench) continue;
      for (const viewport of viewports) {
        if (selectedViewport && viewport.label !== selectedViewport) continue;
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
        try {
          const started = Date.now();
          await page.goto(`${origin}/?bank=${encodeURIComponent(benchId)}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
          if (viewport.width < 768 && await page.locator(".map-sheet-bench").getAttribute("data-snap") !== "full") {
            await page.locator(".quick-preview-heading").waitFor({ timeout: 15_000 });
            // The preview is server-rendered before the resize button has its
            // client handler. Wait for map hydration instead of clicking the
            // still-inert HTML and mistaking the half sheet for an art error.
            await page.locator("[data-map-ready=true]").waitFor({ timeout: 15_000 });
            await page.locator(".map-sheet-bench .map-sheet-resize").click();
            await page.waitForFunction(() => document.querySelector(".map-sheet-bench")?.getAttribute("data-snap") === "full",
              undefined, { timeout: 5_000 });
          }
          await page.locator(".bench-panorama-art").first().waitFor({ timeout: 20_000 });
          await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>("img.bench-panorama-art"))
            .some((image) => image.complete && image.naturalWidth > 0), undefined, { timeout: 20_000 });
          await page.waitForFunction(() => {
            const canvas = document.querySelector("canvas.bench-panorama-webgl");
            return !canvas || canvas.classList.contains("is-ready");
          }, undefined, { timeout: 10_000 });
          // The canvas cross-fades over the decoded img for 280 ms. A capture
          // inside that interval can look like an empty grey painting.
          await page.waitForTimeout(330);
          const paintedInMs = Date.now() - started;
          const imageUrl = await page.locator("img.bench-panorama-art").first().getAttribute("src");
          const imageNetworkMs = await page.evaluate((url) => {
            if (!url) return null;
            const absolute = new URL(url, location.href).href;
            const entry = performance.getEntriesByType("resource").find((item) => item.name === absolute);
            return entry ? Math.round(entry.duration) : null;
          }, imageUrl);
          const layers = await page.evaluate(() => {
            const image = document.querySelector<HTMLImageElement>("img.bench-panorama-art");
            const canvas = document.querySelector<HTMLCanvasElement>("canvas.bench-panorama-webgl");
            return { imageClass: image?.className, imageOpacity: image && getComputedStyle(image).opacity,
              canvasClass: canvas?.className, canvasOpacity: canvas && getComputedStyle(canvas).opacity,
              phaseClass: document.querySelector(".bench-panorama")?.className };
          });
          const screenshot = `${name}-${viewport.label}.png`;
          await page.screenshot({ path: join(output, screenshot) });
          if (selectedBench) {
            const canvas = page.locator("canvas.bench-panorama-webgl").first();
            if (await canvas.count()) {
              await canvas.screenshot({ path: join(output, `${name}-${viewport.label}-canvas.png`) });
              await page.addStyleTag({ content: ".bench-panorama.phase-night::before { display:none!important }" });
              await page.locator(".bench-panorama").screenshot({ path: join(output, `${name}-${viewport.label}-without-night-wash.png`) });
              await page.addStyleTag({ content: ".bench-panorama-webgl { opacity:0!important } img.bench-panorama-art { opacity:1!important }" });
              await page.locator(".bench-panorama").screenshot({ path: join(output, `${name}-${viewport.label}-source-art.png`) });
            }
          }
          results.push({ name, benchId, viewport: viewport.label, paintedInMs, imageNetworkMs, imageUrl, layers, screenshot });
          console.log(`${name} ${viewport.label}: image visible in ${paintedInMs} ms`);
        } catch (error) {
          const screenshot = `${name}-${viewport.label}-error.png`;
          await page.screenshot({ path: join(output, screenshot) }).catch(() => {});
          results.push({ name, benchId, viewport: viewport.label, error: String(error), screenshot });
          console.error(`${name} ${viewport.label}: ${error}`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(output, "manifest.json"), JSON.stringify({ origin, results }, null, 2));
  if (results.some((result) => "error" in result)) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
