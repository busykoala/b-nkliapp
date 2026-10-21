/** Capture the actual local React viewer; no reimplementation of sky or weather. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import catalogue from "../../config/panorama-artist-review.json";
import { projection, setCaptureHeading, waitForPainting } from "../panorama-review/capture";

const args = process.argv.slice(2);
const option = (key: string, fallback: string) => { const i = args.indexOf(`--${key}`); return i < 0 ? fallback : args[i + 1]; };
const stage = option("stage", "baseline-v1");
const numbers = option("numbers", "2,5,7,14,15,18").split(",").map(Number);
const conditions = option("conditions", "noon-clear,sunrise,sunset,stars,moon-full,clouds-broken,overcast,rain-heavy,snowfall,snow-cover").split(",");
const season = option("season", "autumn");
const widths = option("widths", "1440,390").split(",").map(Number);
const variants = option("variants", "").split(",");
const output = resolve(option("output", `test-results/panorama-artist-review/${stage}/viewer-${Date.now()}`));
const origin = "http://127.0.0.1:3002";
const browser = await chromium.launch();
const results = [];
await mkdir(output, { recursive: true });
execFileSync(".venv/bin/python", ["scripts/panorama-art/source.py", "--output", output], { stdio: "ignore" });
try {
  for (const bench of catalogue.benches.filter((bench) => numbers.includes(bench.number))) {
    for (const condition of conditions) for (const width of widths) for (const variant of variants) {
      const page = await browser.newPage({ viewport: { width, height: width > 600 ? 900 : 844 }, deviceScaleFactor: 1 });
      const errors: string[] = [], failedRequests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => { if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`); });
      const direction = option("direction", ["stars", "moon-full", "moon-crescent", "sunrise", "sunset"].includes(condition) ? "sky" : "artist");
      const numericDirection = direction !== "artist" && direction !== "sky" ? Number(direction) : null;
      if (numericDirection !== null && (!direction.trim() || !Number.isFinite(numericDirection))) throw new Error(`Invalid direction: ${direction}`);
      const url = `${origin}/dev/panorama-review?bench=${bench.number}&stage=${encodeURIComponent(stage)}&condition=${condition}&season=${season}&heading=${numericDirection === null ? direction : "artist"}&variant=${encodeURIComponent(variant)}`;
      const stem = `${String(bench.number).padStart(2, "0")}-${season}-${condition}-${width}${variant ? `-${variant}` : ""}`;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
        await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
        await page.locator(".bench-panorama-expand").click();
        await waitForPainting(page, 20_000);
        await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".bench-panorama img")].every((image) => image.complete && image.naturalWidth > 0)
          && document.querySelectorAll("canvas.bench-panorama-webgl.is-ready").length === 3
          && [...document.querySelectorAll<HTMLCanvasElement>("canvas.bench-panorama-clouds")].every((canvas) => canvas.dataset.ready !== "false")
          && [...document.querySelectorAll("canvas.bench-panorama-webgl.is-ready")].every((canvas) => getComputedStyle(canvas).opacity === "1"), undefined, { timeout: 20_000 });
        const viewport = page.locator(".bench-panorama-viewport");
        if (numericDirection !== null) await setCaptureHeading(page, numericDirection);
        if (direction === "sky" && ["stars", "moon-full", "moon-crescent"].includes(condition)) {
          // Include stars above the geographical skyline while retaining the moon.
          for (let i = 0; i < (condition === "stars" ? 10 : 5); i++) await viewport.press("ArrowUp");
        }
        await page.evaluate(() => document.getAnimations().forEach((animation) => {
          if (animation.effect?.getTiming().iterations === Infinity) { animation.pause(); animation.currentTime = 1100; }
          else animation.finish();
        }));
        await page.waitForTimeout(350);
        const measuredProjection = await projection(page);
        const figure = page.locator(".bench-panorama");
        await figure.screenshot({ path: join(output, `${stem}-original.png`) });
        const diagnostics = await figure.evaluate((element) => ({ classes: element.className,
          bounds: element.getBoundingClientRect().toJSON(), track: element.querySelector(".bench-panorama-track")?.getAttribute("style"),
          stars: element.querySelectorAll(".bench-panorama-stars i").length,
          celestial: element.querySelector(".bench-panorama-celestial")?.className ?? null,
          foregroundAsset: element.querySelector(".bench-panorama-rear-bench")?.getAttribute("src"),
          renderers: [...element.querySelectorAll("canvas.bench-panorama-webgl.is-ready")].map((canvas) => canvas.className),
          rain: element.querySelectorAll(".bench-panorama-rain i").length, snow: element.querySelectorAll(".bench-panorama-snow i").length,
        }));
        if (variant && !diagnostics.foregroundAsset?.endsWith(`/${variant}.webp`)) throw new Error(`Bench variant selector mismatch: ${variant}`);
        await page.addStyleTag({ content: ".bench-panorama-foreground,.bench-panorama-hud{visibility:hidden!important}" });
        await figure.screenshot({ path: join(output, `${stem}-clean.png`) });
        results.push({ number: bench.number, id: bench.id, condition, season, width, variant, url, stem,
          requestedDirection: direction, measuredProjection, diagnostics, errors, failedRequests });
        console.log(`${stem}: ${errors.length} errors, ${failedRequests.length} failed responses`);
      } catch (error) {
        await page.screenshot({ path: join(output, `${stem}-failure.png`) });
        results.push({ number: bench.number, condition, width, error: String(error), errors, failedRequests });
      } finally { await page.close(); }
    }
  }
} finally { await browser.close(); }
const iteration = JSON.parse(await readFile(resolve(`test-results/panorama-artist-review/${stage}/manifest.json`), "utf8"));
const code = JSON.parse(await readFile(join(output, "source.json"), "utf8"));
await writeFile(join(output, "manifest.json"), JSON.stringify({ stage, renderImplementation: iteration.renderImplementation,
  viewerSourceSnapshotSha256: code.sha256,
  adjustments: ["Next.js development badge hidden", "Animation paused at 1100ms", "Original retains foreground and controls; clean hides them"], results }, null, 2) + "\n");
if (results.some((result) => "error" in result || result.errors.length || result.failedRequests.length)) process.exitCode = 1;
console.log(output);
