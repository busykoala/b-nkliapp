import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { headingSteps, mod, stitch, verticalSteps, type Candidate, type Capture, type Projection, type Tile } from "./core";

const scene = ".bench-panorama-viewport";
const cleanStyle = `
  .bench-panorama *, .bench-panorama::before, .bench-panorama::after { animation-play-state:paused!important; transition:none!important }
  .bench-panorama-hud, .bench-panorama-foreground, .bench-panorama-shelter,
  .bench-panorama-shelter-shade, .bench-panorama-rain, .bench-panorama-snow,
  .bench-panorama > .landscape-rating-action { visibility:hidden!important }
  .bench-panorama-viewport:focus-visible { outline:none!important }
`;
export const adjustments = [
  "Original tiles and initial-page.png preserve the live UI, foreground, weather and lighting.",
  "Clean tiles hide the HUD, rating action, focus outline, screen-anchored bench/ground/shelter and precipitation overlays. CSS animations pause and transitions stop only in the capture browser.",
  "Panorama PNGs use measured cylindrical screen coordinates and exact crops without blending, generative fill, or spherical reprojection. North is the left/right boundary.",
  "Lighting and weather are live; assets and timestamps are recorded. Screen-space paper/washes can create capture joins: inspect original overlaps before attributing a join to the renderer.",
];

export async function projection(page: Page): Promise<Projection> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>(".bench-panorama-viewport")!;
    const layer = element.querySelector<HTMLElement>(".bench-panorama-track")!;
    if (!element || !layer) throw new Error("Missing panorama projection");
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(layer);
    const x = Math.max(0, Math.ceil(rect.x)); const y = Math.max(0, Math.ceil(rect.y));
    const right = Math.min(innerWidth, Math.floor(rect.right)); const bottom = Math.min(innerHeight, Math.floor(rect.bottom));
    return {
      heading: Number.parseFloat(document.querySelector(".bench-panorama-bearing")?.textContent ?? "NaN"),
      offset: Number.parseFloat(style.getPropertyValue("--panorama-offset")),
      top: Number.parseFloat(style.getPropertyValue("--panorama-track-top")),
      copyWidth: Number.parseFloat(style.getPropertyValue("--panorama-copy-width")),
      trackHeight: Number.parseFloat(style.getPropertyValue("--panorama-track-height")),
      rasterHeight: Number.parseFloat(style.getPropertyValue("--panorama-raster-height")),
      zoom: Number.parseFloat(document.querySelector(".bench-panorama-zoom-controls span")?.textContent ?? "NaN"),
      viewport: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      clip: { x, y, width: right - x, height: bottom - y },
    };
  });
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Move through the real keyboard controls and verify every measured step. */
export async function setCaptureHeading(page: Page, target: number): Promise<Projection> {
  if (!Number.isFinite(target)) throw new Error("Capture heading must be finite");
  let current = await projection(page);
  let remaining = mod(target - current.heading, 360);
  if (Math.abs(remaining / 5 - Math.round(remaining / 5)) > .01) {
    throw new Error(`Heading ${target} is unreachable in 5° keyboard steps from ${current.heading}`);
  }
  while (remaining > .01) {
    const step = remaining >= 30 ? 30 : 5;
    await page.locator(scene).press(step === 30 ? "Shift+ArrowRight" : "ArrowRight");
    await settle(page);
    const next = await projection(page);
    if (Math.abs(mod(next.heading - current.heading - step + 180, 360) - 180) > .5) {
      throw new Error(`Capture heading did not move: ${current.heading} → ${next.heading}, expected ${step}°`);
    }
    const offsetDelta = mod(current.offset - next.offset, current.copyWidth);
    if (Math.abs(offsetDelta - step / 360 * current.copyWidth) > 1) throw new Error("Capture heading and projected offset disagree");
    current = next;
    remaining -= step;
  }
  if (Math.abs(mod(current.heading - target + 180, 360) - 180) > .5) throw new Error("Requested capture heading was not reached");
  return current;
}

export async function waitForPainting(page: Page, timeout: number) {
  await page.locator(".bench-panorama-expand").waitFor({ state: "visible", timeout });
  await page.waitForFunction(() => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>("img.bench-panorama-art"));
    const renderers = Array.from(document.querySelectorAll(".bench-panorama-raster"));
    const canvases = Array.from(document.querySelectorAll("canvas.bench-panorama-webgl"));
    const ready = images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0)
      && [...document.querySelectorAll<HTMLCanvasElement>("canvas.bench-panorama-clouds")].every((canvas) => canvas.dataset.ready !== "false")
      && (canvases.length === 0 || (renderers.length > 0 && renderers.every((renderer) =>
        !renderer.querySelector("canvas") || [...renderer.querySelectorAll("canvas.is-ready")].some((canvas) => getComputedStyle(canvas).opacity === "1"))));
    const state = window as typeof window & { __panoramaCaptureReady?: { signature: string; since: number } };
    if (!ready) { state.__panoramaCaptureReady = undefined; return false; }
    const figure = document.querySelector(".bench-panorama")!;
    const viewport = figure.querySelector(".bench-panorama-viewport")!.getBoundingClientRect();
    const track = getComputedStyle(figure.querySelector(".bench-panorama-track")!);
    const signature = JSON.stringify([figure.className, viewport.width, viewport.height,
      track.getPropertyValue("--panorama-copy-width"), track.getPropertyValue("--panorama-track-height"),
      canvases.map((canvas) => [canvas.className, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height])]);
    // Expanding can briefly expose the ready inline render before ResizeObserver
    // starts a second render/fade. A single ready frame plus a sleep captured
    // that later fade in the parallel weather matrix. Require continuous ready
    // state and stable measured layout; any re-render resets this interval.
    if (state.__panoramaCaptureReady?.signature !== signature) {
      state.__panoramaCaptureReady = { signature, since: performance.now() }; return false;
    }
    return performance.now() - state.__panoramaCaptureReady.since >= 400;
  }, undefined, { timeout });
}

export async function captureBench(browser: Browser, bench: Candidate, origin: string, root: string, timeout = 20_000, targetUrl?: string): Promise<Capture> {
  const prefix = bench.id;
  const directory = join(root, prefix);
  await mkdir(directory, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(timeout);
  const errors: string[] = []; const failures: string[] = [];
  const assets: Capture["assets"] = [];
  const isPanoramaAsset = (url: string) => url.includes("/media/panorama/") || url.includes("/dev/panorama-review/assets?");
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => {
    if (isPanoramaAsset(request.url())) failures.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (isPanoramaAsset(response.url())) {
      assets.push({ url: response.url(), status: response.status(), etag: response.headers().etag ?? null });
      if (!response.ok()) failures.push(`${response.url()}: HTTP ${response.status()}`);
    }
  });
  const startedAt = new Date().toISOString(); const started = Date.now();
  const url = targetUrl ?? `${origin}/?bank=${encodeURIComponent(bench.id)}`;
  try {
    if (new URL(url).origin !== origin) throw new Error("Capture URL must stay on the requested origin");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.max(timeout, 45_000) });
    if (new URL(url).pathname.startsWith("/dev/panorama-review"))
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await waitForPainting(page, timeout);
    const paintedInMs = Date.now() - started;
    const initial = `${prefix}/initial-page.png`;
    await page.screenshot({ path: join(root, initial) });
    const imageUrl = await page.locator("img.bench-panorama-art").first().getAttribute("src");
    if (!imageUrl) throw new Error("Decoded image has no source URL");
    const phase = await page.locator(".bench-panorama").getAttribute("class") ?? "";
    await page.locator(".bench-panorama-expand").click();
    await page.locator(".bench-panorama.is-expanded").waitFor();
    await waitForPainting(page, timeout);
    const viewport = page.locator(scene);
    await viewport.focus();
    await viewport.press("Home");
    await settle(page);
    const bottom = await projection(page);
    if (![bottom.copyWidth, bottom.top, bottom.heading, bottom.rasterHeight].every(Number.isFinite) || bottom.zoom !== 1) throw new Error("Invalid 1× projection");
    const expanded = `${prefix}/expanded-page.png`;
    await page.screenshot({ path: join(root, expanded) });
    await viewport.press("ArrowDown");
    await settle(page);
    const bottomAgain = await projection(page);
    if (Math.abs(bottomAgain.top - bottom.top) > .5) throw new Error("Home did not reach lower vertical limit");
    for (let count = 0; count < 80; count++) await viewport.press("ArrowUp");
    await settle(page);
    const top = await projection(page);
    await viewport.press("ArrowUp");
    await settle(page);
    const topAgain = await projection(page);
    if (Math.abs(top.top - topAgain.top) > .5 || top.top <= bottom.top) throw new Error("Upper vertical limit not reached");
    // Horizontal and vertical cylindrical coordinates have the same scale.
    // Raster extent can be legacy 90deg or extended 120deg; never infer scale
    // from a fixed painting height/range.
    const pixelsPerDegree = bottom.copyWidth / 360;
    const headings = headingSteps(bottom.copyWidth, bottom.clip.width);
    const rows = verticalSteps(0, top.top - bottom.top, bottom.clip.height, pixelsPerDegree);
    const tiles: Tile[] = [];
    let wrapVerified = false;
    for (const pass of ["original", "clean"] as const) {
      if (pass === "clean") {
        await page.evaluate(() => document.getAnimations().forEach((animation) => {
          if (animation.effect?.getTiming().iterations === Infinity) { animation.pause(); animation.currentTime = 1100; }
          else animation.finish();
        }));
        await page.addStyleTag({ content: cleanStyle });
      }
      for (const [row, shift] of rows.entries()) {
        await viewport.press("Home");
        const presses = Math.ceil((shift - .01) / (3 * pixelsPerDegree));
        for (let i = 0; i < presses; i++) await viewport.press("ArrowUp");
        await settle(page);
        const rowStart = await projection(page);
        if (Math.abs(rowStart.top - (bottom.top + shift)) > 1) throw new Error(`Wrong vertical position: ${rowStart.top}`);
        for (const [column, heading] of headings.entries()) {
          if (column) {
            let remaining = heading - headings[column - 1];
            while (remaining >= 30) { await viewport.press("Shift+ArrowRight"); remaining -= 30; }
            while (remaining >= 5) { await viewport.press("ArrowRight"); remaining -= 5; }
          }
          await settle(page);
          const current = await projection(page);
          const expected = mod(bottom.heading + heading, 360);
          if (Math.abs(mod(current.heading - expected + 180, 360) - 180) > .5) throw new Error(`Heading mismatch: ${current.heading} vs ${expected}`);
          const expectedOffset = mod(-bottom.offset + heading / 360 * bottom.copyWidth, bottom.copyWidth);
          if (Math.abs(mod(-current.offset - expectedOffset + bottom.copyWidth / 2, bottom.copyWidth) - bottom.copyWidth / 2) > 1) throw new Error("Heading projection did not move correctly");
          if (current.copyWidth !== bottom.copyWidth || current.zoom !== 1 || Math.abs(current.top - rowStart.top) > .5
            || JSON.stringify(current.clip) !== JSON.stringify(bottom.clip)) throw new Error("Projection changed during capture");
          const file = `${prefix}/${pass}-r${row}-c${column}.png`;
          await page.screenshot({ path: join(root, file), clip: current.clip, caret: "hide" });
          if (pass === "original") {
            tiles.push({ original: file, clean: `${prefix}/clean-r${row}-c${column}.png`, capturedAt: new Date().toISOString(), projection: current,
              x: mod(Math.round(-current.offset + current.clip.x - current.viewport.x), current.copyWidth),
              y: Math.round(-current.top + current.clip.y - current.viewport.y), width: current.clip.width, height: current.clip.height });
          } else {
            const original = tiles[row * headings.length + column];
            if (Math.abs(original.projection.offset - current.offset) > 1 || Math.abs(original.projection.top - current.top) > .5) throw new Error("Clean pass diverged from original");
          }
        }
        let remaining = 360 - headings.at(-1)!;
        while (remaining >= 30) { await viewport.press("Shift+ArrowRight"); remaining -= 30; }
        while (remaining >= 5) { await viewport.press("ArrowRight"); remaining -= 5; }
        await settle(page);
        const wrapped = await projection(page);
        if (wrapped.heading !== bottom.heading || Math.abs(wrapped.offset - bottom.offset) > 1) throw new Error("360° wraparound failed");
        wrapVerified = true;
      }
    }
    if (await page.locator("img.bench-panorama-art").first().getAttribute("src") !== imageUrl) throw new Error("Artwork changed during capture; retry with one asset identity");
    const panorama = `${prefix}/panorama.png`;
    const plan = await stitch(tiles, bottom.copyWidth, root, join(root, panorama));
    const thumbnail = `${prefix}/thumbnail.jpg`;
    await sharp(join(root, panorama)).resize({ width: 1100 }).jpeg({ quality: 85 }).toFile(join(root, thumbnail));
    const durations = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => ({ name: entry.name, duration: entry.duration })));
    for (const asset of assets) asset.durationMs = durations.find((entry) => entry.name === asset.url)?.duration;
    const largestRowStep = Math.max(0, ...rows.slice(1).map((value, i) => value - rows[i]));
    // Altitude origin follows the track contract; the permitted sky ends at 88°.
    return { bench, url, startedAt, completedAt: new Date().toISOString(), paintedInMs, imageUrl, phase, assets, errors, failures,
      initial, expanded, panorama, thumbnail, tiles, clippedViewport: bottom.clip.height < bottom.viewport.height || bottom.clip.width < bottom.viewport.width,
      coverage: { width: plan.width, height: plan.height, top: plan.top, bottom: plan.bottom,
        minAltitude: 88 - plan.bottom / pixelsPerDegree, maxAltitude: 88 - plan.top / pixelsPerDegree,
        horizontalOverlap: 1 - headings[1] / 360 * bottom.copyWidth / bottom.clip.width,
        verticalOverlap: rows.length === 1 ? 1 : 1 - largestRowStep / bottom.clip.height, wrapVerified, endpointsVerified: true } };
  } catch (error) {
    await page.screenshot({ path: join(directory, "failure.png") }).catch(() => {});
    await writeFile(join(directory, "failure-diagnostics.json"), JSON.stringify({ url, at: new Date().toISOString(), error: String(error), assets, errors, failures }, null, 2));
    throw error;
  } finally { await page.close(); }
}
