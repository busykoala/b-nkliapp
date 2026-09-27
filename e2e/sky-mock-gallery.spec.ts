import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { installPanoramaFixture } from "./panorama-fixture";

type Scenario = "day-rain" | "day-snow" | "night-full-rain" | "night-new" | "night-waning";

const scenarios: Record<Scenario, { file: string; weather: "rain" | "night-rain" | "snow" | "clear"; light: string }> = {
  "day-rain": { file: "01-tag-regen-wolken.png", weather: "rain", light: "rain.light.webp" },
  "day-snow": { file: "02-tag-schnee-wolken.png", weather: "snow", light: "snow.light.webp" },
  "night-full-rain": { file: "03-nacht-regen-wolken-vollmond.png", weather: "night-rain", light: "moon-night.light.webp" },
  "night-new": { file: "04-nacht-leermond-sterne.png", weather: "clear", light: "moon-night.light.webp" },
  "night-waning": { file: "05-nacht-abnehmender-mond-sterne.png", weather: "clear", light: "moon-night.light.webp" },
};

const scenarioName = process.env.BENCHLY_SKY_GALLERY_SCENARIO as Scenario;
const scenario = scenarios[scenarioName];

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

function floatBlob(value: number) {
  const blob = Buffer.alloc(4);
  blob.writeFloatLE(value);
  return blob;
}

function installWeatherFixture(kind: "rain" | "night-rain" | "snow" | "clear") {
  const values = kind === "rain" ? {
    CLCT: .88, CLCL: .82, CLCM: .68, CLCH: .56, RZC: 3.4, RAIN_GSP: 4, SNOW_GSP: 0,
    SNOWLMT: 1_800, SNOWC: 0, H_SNOW: 0, T_2M: 282.15, HSURF: 410,
  } : kind === "night-rain" ? {
    CLCT: .72, CLCL: .64, CLCM: .55, CLCH: .44, RZC: 2.4, RAIN_GSP: 3, SNOW_GSP: 0,
    SNOWLMT: 1_800, SNOWC: 0, H_SNOW: 0, T_2M: 280.15, HSURF: 410,
  } : kind === "snow" ? {
    CLCT: .92, CLCL: .84, CLCM: .72, CLCH: .6, RZC: 1.8, RAIN_GSP: 0, SNOW_GSP: 3,
    SNOWLMT: 300, SNOWC: .82, H_SNOW: .18, T_2M: 270.15, HSURF: 410,
  } : {
    CLCT: .06, CLCL: .02, CLCM: .03, CLCH: .05, RZC: 0, RAIN_GSP: 0, SNOW_GSP: 0,
    SNOWLMT: 1_600, SNOWC: 0, H_SNOW: 0, T_2M: 278.15, HSURF: 410,
  };
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  const now = new Date().toISOString();
  const insert = database.prepare(`INSERT OR REPLACE INTO weather_snapshots
    (source,parameter,reference_at,valid_at,origin_easting,origin_northing,resolution_meters,width,height,values_blob,nodata_value,imported_at)
    VALUES('gallery',?,?,?,2600000,1200000,1000000,1,1,?,NULL,?)`);
  const transaction = database.transaction(() => {
    database.prepare("DELETE FROM weather_snapshots").run();
    for (const [parameter, value] of Object.entries(values)) insert.run(parameter, now, now, floatBlob(value), now);
  });
  transaction();
  database.close();
}

function installGalleryPanorama() {
  installPanoramaFixture("osm-node-109", false);
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  const files = database.prepare(`SELECT pr.artifact_path painting,pr.material_path material,pl.artifact_path light
    FROM benches b JOIN bench_panorama_renders pr ON pr.bench_row_id=b.row_id
    LEFT JOIN bench_panorama_lightmaps pl ON pl.bench_row_id=b.row_id
    WHERE b.id='osm-node-109'`).get() as { painting: string; material: string; light: string };
  const source = resolve("data/panorama-cache-v1/active/local-b1041b661b39");
  const key = "f390a46eadfe872da181311837d225e6f5557bd70d714a3d5d09eb93786f79d3";
  copyFileSync(resolve(source, "renders/f3", `${key}.webp`), files.painting);
  copyFileSync(resolve(source, "materials/f3", `${key}.webp`), files.material);
  copyFileSync(resolve("data/panorama-fixtures/art-review-8/osm-node-768598470", scenario.light), files.light);
  database.close();
}

test("renders the selected sky mock", async ({ page }) => {
  expect(scenario, `Unknown BENCHLY_SKY_GALLERY_SCENARIO: ${scenarioName}`).toBeTruthy();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  installWeatherFixture(scenario.weather);
  installGalleryPanorama();
  await page.goto("/?bank=osm-node-109");

  const panorama = page.locator(".bench-panorama");
  await expect(panorama).toBeVisible({ timeout: 8_000 });
  await expect(panorama.locator(".bench-panorama-webgl").first()).toHaveClass(/is-ready/, { timeout: 8_000 });
  await panorama.getByRole("button", { name: "Panorama gross im 360-Grad-Modus öffnen" }).click();
  const viewport = panorama.locator(".bench-panorama-viewport");

  const celestial = panorama.locator(".bench-panorama-celestial");
  if (await celestial.count()) {
    const left = (await celestial.first().getAttribute("style"))!.match(/left:\s*([\d.]+)%/)![1];
    const target = Number.parseFloat(left) * 3.6;
    const current = Number.parseInt((await panorama.locator(".bench-panorama-bearing").textContent())!, 10);
    const delta = ((target - current + 540) % 360) - 180;
    const key = delta < 0 ? "Shift+ArrowLeft" : "Shift+ArrowRight";
    for (let index = 0; index < Math.round(Math.abs(delta) / 30); index++) await viewport.press(key);
  }

  const box = await viewport.boundingBox();
  await page.mouse.move(box!.x + box!.width * .5, box!.y + box!.height * .12);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .5, box!.y + box!.height * .9, { steps: 5 });
  await page.mouse.up();
  await page.addStyleTag({ content: ".bench-panorama-hud{display:none!important} nextjs-portal{display:none!important}" });
  mkdirSync(resolve("docs/sky-mock-gallery"), { recursive: true });
  await panorama.screenshot({ path: resolve("docs/sky-mock-gallery", scenario.file), animations: "disabled" });
});
