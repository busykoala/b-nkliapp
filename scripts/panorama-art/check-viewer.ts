/** Pixel comparison of the real GPU and CPU paths using downloaded landscapes. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { waitForPainting } from "../panorama-review/capture";

const args = process.argv.slice(2);
const stage = args.includes("--stage") ? args[args.indexOf("--stage") + 1] : "geography-v1";
const output = `test-results/panorama-artist-review/viewer-parity/${stage}-${Date.now()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const [bench, condition] of [[2, "noon-clear"], [5, "snow-cover"], [8, "snow-cover"],
    [9, "noon-clear"], [9, "snow-cover"], [9, "moon-full"],
    [14, "moon-full"], [18, "snow-cover"]] as const) {
    const images = [];
    const timings = [];
    for (const fallback of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
      if (fallback) await page.addInitScript(`(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: function(type, ...options) {
          return type.startsWith("webgl") ? null : original.apply(this, [type, ...options]);
        } });
      })()`);
      const lights: string[] = [];
      page.on("response", (response) => { if (response.url().includes(".light.webp") && response.ok()) lights.push(response.url()); });
      const began = Date.now();
      await page.goto(`http://127.0.0.1:3002/dev/panorama-review?bench=${bench}&stage=${encodeURIComponent(stage)}&condition=${condition}`, { waitUntil: "networkidle" });
      await page.locator(".bench-panorama-expand").click();
      await waitForPainting(page, 20_000);
      await page.waitForFunction(() => {
        const ready = [...document.querySelectorAll("canvas.bench-panorama-webgl.is-ready")];
        return ready.length === 3 && ready.every((canvas) => getComputedStyle(canvas).opacity === "1")
          && [...document.querySelectorAll<HTMLCanvasElement>(".bench-panorama-clouds")].every((canvas) => canvas.dataset.ready !== "false");
      });
      timings.push({ engine: fallback ? "canvas" : "webgl", navigationToStableExpandedReadyMs: Date.now() - began });
      const readyIndex = await page.locator(".bench-panorama-raster").first().evaluate((node) => [...node.querySelectorAll("canvas")].findIndex((canvas) => canvas.classList.contains("is-ready")));
      assert.equal(readyIndex, fallback ? 1 : 0, "requested renderer must actually be active");
      assert.ok(lights.length > 0, "measured direct-light map must be decoded by the renderer");
      if (fallback) {
        const hashes = await page.locator("canvas.bench-panorama-webgl.is-ready").evaluateAll(async (canvases) => Promise.all(canvases.map(async (element) => {
          const canvas = element as HTMLCanvasElement;
          const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(pixels).buffer);
          return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
        })));
        assert.equal(new Set(hashes).size, 1, "cached CPU world copies must have identical pixels");
      }
      await page.addStyleTag({ content: "nextjs-portal,.bench-panorama-hud,.bench-panorama-foreground{visibility:hidden!important}" });
      await page.evaluate(() => document.getAnimations().forEach((animation) => {
        if (animation.effect?.getTiming().iterations === Infinity) { animation.pause(); animation.currentTime = 1100; }
        else animation.finish();
      }));
      await page.waitForTimeout(350);
      const png = await page.locator(".bench-panorama").screenshot({ path: `${output}/${bench}-${condition}-${fallback ? "canvas" : "webgl"}.png` });
      images.push(await sharp(png).removeAlpha().raw().toBuffer());
      await page.close();
    }
    let total = 0, significant = 0;
    assert.equal(images[0].length, images[1].length);
    for (let i = 0; i < images[0].length; i++) {
      const difference = Math.abs(images[0][i] - images[1][i]);
      total += difference; if (difference > 10) significant++;
    }
    const result = { bench, condition, timings, meanAbsoluteError: total / images[0].length, fractionAbove10: significant / images[0].length };
    results.push(result);
    console.log(result);
    assert.ok(result.meanAbsoluteError < 2 && result.fractionAbove10 < .01, "GPU/canvas appearance must agree");
  }
} finally {
  await browser.close();
  await writeFile(`${output}/manifest.json`, JSON.stringify(results, null, 2) + "\n");
}
