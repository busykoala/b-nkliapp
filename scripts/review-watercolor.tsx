/** Render the real UI components with deterministic visual-review fixtures.
 * Usage: npx tsx scripts/review-watercolor.tsx [output-directory] [chromium|webkit]
 * No app route, database mutations, external network, or test-only production code.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium, webkit } from "@playwright/test";
import { BenchLandscape } from "../src/components/bench-landscape";
import { TrailAvatar } from "../src/components/trail-avatar";
import { BadgeIllustration, type BadgeArt } from "../src/components/badge-illustration";
import { avatarOptionValues, randomAppearance } from "../src/lib/avatar";
import { LandscapeStamp, SeasonStamp } from "../src/components/profile-stamps";
import type { BenchDetail } from "../src/lib/types";

const settings = [
  { name: "meadow", landContext: "open", buildingCount100m: 0, waterfront: false, viewLabels: ["Hügel"] },
  { name: "lake", landContext: "open", buildingCount100m: 0, waterfront: true, viewLabels: ["See", "Berge"] },
  { name: "forest", landContext: "forest", buildingCount100m: 0, waterfront: false, viewLabels: [] },
  { name: "village", landContext: "urban", buildingCount100m: 8, waterfront: false, viewLabels: ["Berge"] },
  { name: "city", landContext: "urban", buildingCount100m: 40, waterfront: false, viewLabels: [] },
] as const;
const moods = [
  { name: "spring-dawn", season: "spring", dayPhase: "dawn", sunnyNow: true, sunAltitudeDegrees: 6, sunAzimuthDegrees: 85, moonVisible: false, shadeCause: "frei", temperatureC: 12, cloudCover: .12, precipitationType: "none", snowCoverPercent: 0, windKmh: 3 },
  { name: "summer-sun", season: "summer", dayPhase: "day", sunnyNow: true, sunAltitudeDegrees: 62, sunAzimuthDegrees: 180, moonVisible: false, shadeCause: "frei", temperatureC: 26, cloudCover: .08, precipitationType: "none", snowCoverPercent: 0, windKmh: 6 },
  { name: "autumn-rain", season: "autumn", dayPhase: "dusk", sunnyNow: false, sunAltitudeDegrees: -3, sunAzimuthDegrees: 280, moonVisible: false, shadeCause: "vegetation", temperatureC: 8, cloudCover: .88, precipitationType: "rain", snowCoverPercent: 0, windKmh: 22 },
  { name: "winter-moon", season: "winter", dayPhase: "night", sunnyNow: false, sunAltitudeDegrees: -25, sunAzimuthDegrees: 325, moonVisible: true, shadeCause: "nacht", temperatureC: -5, cloudCover: .1, precipitationType: "snow", snowCoverPercent: 70, windKmh: 7 },
] as const;

async function main() {
  const output = resolve(process.argv[2] ?? "test-results/watercolor-review");
  await mkdir(output, { recursive: true });
  // Use compiled app styles, with current source styles for rapid iteration.
  const compiledFiles = await readdir(".next/static/css");
  const compiled = (await Promise.all(compiledFiles.filter((f) => f.endsWith(".css")).map((f) => readFile(join(".next/static/css", f), "utf8")))).join("\n");
  const source = await readFile("src/app/globals.css", "utf8");
  const production = process.argv.includes("--production");
  const css = production ? compiled : compiled + "\n" + source.slice(source.indexOf(":root"));
  const browser = await (process.argv[3] === "webkit" ? webkit : chromium).launch();
  const page = await browser.newPage({ viewport: { width: 440, height: 460 }, deviceScaleFactor: 1 });
  const assetErrors: string[] = [];
  await page.route("https://watercolor.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") return route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" });
    try {
      const file = resolve("public", `.${pathname}`);
      if (!file.startsWith(resolve("public") + "/")) throw new Error("Invalid asset path");
      await route.fulfill({ body: await readFile(file), contentType: pathname.endsWith(".webp") ? "image/webp" : "image/png" });
    } catch { assetErrors.push(pathname); await route.abort(); }
  });
  await page.goto("https://watercolor.test/");
  const cards: Array<{ name: string; markup: string }> = [];
  const fixtures: BenchDetail[] = [];
  async function capture(name: string, bench: BenchDetail) {
    const markup = renderToStaticMarkup(<BenchLandscape bench={bench} />, { identifierPrefix: name });
    cards.push({ name, markup });
    await page.setContent(`<style>${css}</style><style>body{padding:12px;background:#faf5e9}figure{margin:0}.bench-landscape{border-radius:20px}p{font:12px system-ui;margin:10px 0}</style>${markup}<p>${name}</p>`);
    await loadedImages();
    await page.screenshot({ path: join(output, `${name}.png`) });
  }
  async function loadedImages() {
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.querySelectorAll("image")).map((el) => new Promise<void>((done, reject) => {
        const img = new Image(); img.onload = () => done(); img.onerror = reject; img.src = el.getAttribute("href")!;
      })));
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
    });
  }
  for (const [s, setting] of settings.entries()) for (const [m, mood] of moods.entries()) {
    const name = `${String(cards.length + 1).padStart(2, "0")}-${setting.name}-${mood.name}`;
    const material = ["Holz", "Metall", "Beton"][(s + m) % 3];
    // This fixture supplies only the presentation fields consumed by BenchLandscape.
    const bench = {
      ...setting, ...mood, id: name, inForest: setting.name === "forest", moonAltitudeDegrees: 22,
      moonAzimuthDegrees: 120, moonIllumination: .7, moonPhase: .3, directionDegrees: 110,
      distancePathMeters: 8, distanceBuildingMeters: setting.name === "city" ? 12 : 150,
      properties: [
        { label: "Material", value: material }, { label: "Rückenlehne", value: m === 2 ? "Nein" : "Ja" },
        { label: "Armlehnen", value: s % 2 === 0 ? "Ja" : "Nein" }, { label: "Sitzplätze", value: "3" },
        { label: "Überdacht", value: "Nein" },
      ],
      weather: { ...mood, cloudLow: mood.cloudCover, cloudMid: mood.cloudCover * .7, cloudHigh: mood.cloudCover * .4 },
    } as unknown as BenchDetail;
    fixtures.push(bench);
    await capture(name, bench);
  }
  await capture("22-forest-daylight-shade", { ...fixtures[9], sunnyNow: false, shadeCause: "vegetation" });
  await capture("23-alpine-snow-daylight", { ...fixtures[1], elevationMeters: 2400, season: "winter", weather: { ...fixtures[3].weather!, precipitationType: "none" } });
  await capture("24-city-low-moon", { ...fixtures[19], moonAltitudeDegrees: 3, moonIllumination: .2, moonPhase: .1, weather: { ...fixtures[19].weather!, precipitationType: "none" } });
  await capture("25-village-sheltered", { ...fixtures[13], sunnyNow: false, shadeCause: "überdacht", properties: fixtures[13].properties.map((p) => p.label === "Überdacht" ? { ...p, value: "Ja" } : p) });
  await capture("26-unknown-weather", { ...fixtures[0], weather: null, sunnyNow: null, landContext: null, buildingCount100m: null, properties: [] });
  // Harbour regression: water evidence must win over the dense building count,
  // even before a view label has been computed for the bench.
  const harbour = { ...fixtures[17], waterfront: true, viewLabels: [], properties: fixtures[17].properties.map((p) => p.label === "Material" ? { ...p, value: "Holz" } : p) };
  await capture("27-spiez-harbour-daylight", harbour);
  await capture("28-spiez-harbour-shade", { ...harbour, sunnyNow: false });
  await capture("29-wooded-lake-shore", { ...fixtures[9], waterfront: true, viewLabels: ["Seeblick"] });
  await capture("30-water-buildings-67-percent", { ...harbour, landContext: null, buildingCount100m: null, buildingObstructionPercent: 67, vegetationObstructionPercent: 6 });
  await capture("31-harbour-winter", { ...fixtures[19], waterfront: true, buildingObstructionPercent: 67, moonAltitudeDegrees: 3 });
  const badges: BadgeArt[] = ["discoverer", "pioneer", "scout", "checker", "detective", "poet", "expert", "guru", "legend"];
  const identities = renderToStaticMarkup(<><section className="portraits">{Array.from({ length: 10 }, (_, i) => <TrailAvatar key={i} seed={`review-${i}`} username={`Wanderer ${i}`} appearance={{ ...randomAppearance(`review-${i}`), background: avatarOptionValues.background[i % 5], skin: avatarOptionValues.skin[i % 5], hairStyle: avatarOptionValues.hairStyle[i % 5], hat: avatarOptionValues.hat[i % 4], companion: avatarOptionValues.companion[i % 4] }} progress={i * 9} />)}</section><section className="badges">{badges.map((kind) => <div key={kind}><BadgeIllustration kind={kind} label={kind} earned /><p>{kind}</p></div>)}</section><section className="stamps">{(["mountain", "hill", "water", "city", "forest", "open"] as const).map((kind) => <LandscapeStamp key={kind} kind={kind} found />)}{(["spring", "summer", "autumn", "winter"] as const).map((season) => <SeasonStamp key={season} season={season} name={season} found />)}</section></>);
  await page.setViewportSize({ width: 1000, height: 920 });
  await page.setContent(`<style>${css}</style><style>body{padding:20px;background:#faf5e9}.portraits{display:grid;grid-template-columns:repeat(5,1fr)}.badges{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.badges svg{height:132px}.badges p{text-align:center;font-size:12px}.stamps{display:flex;align-items:center;gap:14px;margin-top:20px}.stamps>*{flex:1;min-width:0}</style>${identities}`);
  await loadedImages();
  await page.screenshot({ path: join(output, "21-avatars-and-badges.png"), fullPage: true });
  const gallery = `<!doctype html><meta charset="utf-8"><title>Watercolor review</title><style>${css}</style><style>body{padding:20px;background:#faf5e9}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}figure{margin:0}.bench-landscape{border-radius:14px}p{font:12px system-ui;margin:8px 0}</style><main>${cards.map((c) => `<article>${c.markup}<p>${c.name}</p></article>`).join("")}</main>`;
  await page.setViewportSize({ width: 1600, height: 1900 });
  await page.setContent(gallery);
  await loadedImages();
  await page.screenshot({ path: join(output, "contact-sheet.png"), fullPage: true });
  // Portable review page references the screenshots alongside it, not an app server.
  await writeFile(join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Watercolor review</title><style>body{background:#faf5e9;font:14px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}img{width:100%}</style><main>${cards.map((c) => `<figure><img src="${c.name}.png" alt="${c.name}"><figcaption>${c.name}</figcaption></figure>`).join("")}</main><img src="21-avatars-and-badges.png" alt="Avatars, badges and stamps">`);
  await writeFile(join(output, "manifest.json"), JSON.stringify({ cases: cards.map((c) => c.name), browser: process.argv[3] ?? "chromium", productionCSS: production, assetErrors }, null, 2));
  await browser.close();
  if (assetErrors.length) throw new Error(`Missing artwork: ${assetErrors.join(", ")}`);
  console.log(`Rendered ${cards.length} bench combinations + avatars/badges/stamps: ${output}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
