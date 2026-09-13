/** Render already-calculated 360° WebP artifacts without an app server.
 * Usage:
 *   npx tsx scripts/review-panorama.ts <output-dir> name:path.webp:heading [...]
 *
 * This intentionally uses the production panorama CSS and public bench asset,
 * but never reads or mutates the application database.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

type Case = { name: string; path: string; heading: number };
const viewports = [
  { label: "390", width: 390, height: 520, figureWidth: 390 },
  { label: "430", width: 430, height: 560, figureWidth: 430 },
  { label: "1440", width: 1440, height: 800, figureWidth: 540 },
] as const;

function parseCase(value: string): Case {
  const separator = value.lastIndexOf(":");
  const first = value.indexOf(":");
  if (first <= 0 || separator <= first) throw new Error(`Invalid panorama case: ${value}`);
  const heading = Number(value.slice(separator + 1));
  if (!Number.isFinite(heading)) throw new Error(`Invalid heading: ${value}`);
  return { name: value.slice(0, first), path: resolve(value.slice(first + 1, separator)), heading: ((heading % 360) + 360) % 360 };
}

async function main() {
  const output = resolve(process.argv[2] ?? "test-results/panorama-review");
  const cases = process.argv.slice(3).map(parseCase);
  if (!cases.length) throw new Error("At least one name:path.webp:heading case is required");
  await mkdir(output, { recursive: true });
  const css = await readFile("src/app/globals.css", "utf8");
  const bench = await readFile("public/ui-art/panorama/benches/wood-back.webp");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 1 });
  const manifest = [];

  for (const fixture of cases) {
    const artifact = await readFile(fixture.path);
    const artPath = `/fixture/${encodeURIComponent(basename(fixture.path))}`;
    await page.route("https://panorama.test/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === artPath) return route.fulfill({ body: artifact, contentType: "image/webp" });
      if (pathname === "/bench.webp") return route.fulfill({ body: bench, contentType: "image/webp" });
      return route.fulfill({ body: "", contentType: "text/plain" });
    });
    await page.goto("https://panorama.test/");
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const figureHeight = Math.round(viewport.figureWidth * 5 / 6);
      const copyWidth = Math.round(figureHeight * 1.36 * 4);
      const offset = Math.round(viewport.figureWidth / 2 - copyWidth * (1 + fixture.heading / 360));
      const markup = `<main><figure class="bench-panorama"><div class="bench-panorama-viewport"><div class="bench-panorama-track" style="--panorama-offset:${offset}px;--panorama-y:0px;--panorama-copy-width:${copyWidth}px">${[0, 1, 2].map(() => `<div class="bench-panorama-copy"><img class="bench-panorama-art" src="${artPath}"><span class="bench-panorama-ground-patch" style="left:${fixture.heading / 360 * 100}%"></span><img class="bench-panorama-rear-bench" style="left:${fixture.heading / 360 * 100}%" src="/bench.webp"></div>`).join("")}</div></div></figure></main>`;
      await page.setContent(`<style>${css}</style><style>html,body{margin:0;min-height:100%;background:#faf5e9}main{min-height:100vh;display:grid;place-items:center}.bench-panorama{width:${viewport.figureWidth}px;height:${figureHeight}px;aspect-ratio:auto;border-radius:${viewport.label === "1440" ? "2rem" : "0"}}</style>${markup}`);
      await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
      const screenshot = `${fixture.name}-${viewport.label}.png`;
      await page.screenshot({ path: join(output, screenshot) });
      manifest.push({ ...fixture, viewport: viewport.label, artifact: basename(fixture.path), screenshot });
    }
    await page.unrouteAll({ behavior: "wait" });
  }
  await writeFile(join(output, "manifest.json"), JSON.stringify({ cases: manifest }, null, 2));
  await browser.close();
  console.log(`Rendered ${cases.length} panorama reviews: ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
