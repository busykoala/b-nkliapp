import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

test.afterEach(() => {
  const databasePath = process.env.BENCHLY_E2E_DATABASE;
  if (!databasePath) return;
  const database = new Database(databasePath);
  const row = database.prepare("SELECT row_id FROM benches WHERE id='osm-node-109'").get() as { row_id: number } | undefined;
  if (row) {
    database.prepare("DELETE FROM bench_panorama_renders WHERE bench_row_id=?").run(row.row_id);
    database.prepare("DELETE FROM bench_panorama_geometry WHERE bench_row_id=?").run(row.row_id);
    database.prepare("DELETE FROM bench_panorama_requests WHERE bench_row_id=?").run(row.row_id);
    database.prepare("UPDATE benches SET covered=0 WHERE row_id=?").run(row.row_id);
  }
  database.close();
});

function installPanoramaFixture() {
  const databasePath = process.env.BENCHLY_E2E_DATABASE!;
  const cacheRoot = process.env.BENCHLY_E2E_PANORAMA_CACHE!;
  const database = new Database(databasePath);
  const bench = database.prepare("SELECT row_id,id,latitude,longitude FROM benches WHERE id='osm-node-109'")
    .get() as { row_id: number; id: string; latitude: number; longitude: number };
  const directory = join(cacheRoot, "renders", "aa");
  const artifact = join(directory, "panorama-fixture.svg.gz");
  mkdirSync(directory, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3600 900">
    <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#d7e2dc"/><stop offset="1" stop-color="#f5e8c9"/></linearGradient></defs>
    <rect width="3600" height="900" fill="url(#sky)"/>
    <path d="M0 590Q300 360 600 570T1200 490T1800 575T2400 390T3000 540T3600 440V900H0Z" fill="#6f8a6d"/>
    <path d="M0 670Q450 520 900 655T1800 600T2700 660T3600 570V900H0Z" fill="#9cad78" opacity=".88"/>
    <path d="M2550 640Q2860 580 3200 645V770H2550Z" fill="#91b8bb"/>
    <g fill="#c2a681"><path d="M920 560h120v160H920z"/><path d="M2070 535h170v185h-170z"/></g>
    <g font-family="sans-serif" font-size="70" fill="#385348" opacity=".65"><text x="40" y="110">N</text><text x="920" y="110">E</text><text x="1790" y="110">S</text><text x="2690" y="110">W</text></g>
  </svg>`;
  writeFileSync(artifact, gzipSync(svg));
  const geometryKey = "g".repeat(64);
  database.prepare("UPDATE benches SET covered=1 WHERE row_id=?").run(bench.row_id);
  database.prepare(`INSERT OR REPLACE INTO bench_panorama_geometry(
    bench_row_id,bench_id,bench_latitude,bench_longitude,geometry_key,artifact_path,status,complete,
    source_versions_json,algorithm_version,warnings_json,artifact_bytes,started_at,generated_at,updated_at,error
  ) VALUES(?,?,?,?,?,?,'ready',1,'{}','e2e','[]',1,?,?,?,NULL)`).run(
    bench.row_id, bench.id, bench.latitude, bench.longitude, geometryKey,
    join(cacheRoot, "geometry", "fixture.json.gz"), "2026-09-12", "2026-09-12", "2026-09-12",
  );
  database.prepare(`INSERT OR REPLACE INTO bench_panorama_renders(
    bench_row_id,geometry_key,render_key,artifact_path,status,style_version,center_azimuth_degrees,
    horizontal_fov_degrees,width,height,weather_bucket,solar_lunar_bucket,bench_variant,covered,
    artifact_bytes,generated_at,updated_at,error
  ) VALUES(?,?,?,?,'ready','e2e',0,360,3600,900,'clear','day','wood-back',1,?,?,?,NULL)`).run(
    bench.row_id, geometryKey, "r".repeat(64), artifact, gzipSync(svg).byteLength, "2026-09-12", "2026-09-12",
  );
  database.close();
}

function setCoveredFixture() {
  const database = new Database(process.env.BENCHLY_E2E_DATABASE!);
  database.prepare("UPDATE benches SET covered=1 WHERE id='osm-node-109'").run();
  database.close();
}

test("starts in bench direction and pans the panorama in both axes on mobile", async ({ page }, testInfo) => {
  // The first navigation lets the isolated test server migrate and seed its DB.
  await page.goto("/");
  setCoveredFixture();
  await page.goto("/?bank=osm-node-109");
  await expect(page.locator(".bench-landscape")).toBeVisible();
  installPanoramaFixture();

  const panorama = page.locator(".bench-panorama");
  // A panorama completed by the worker appears in the open detail without a reload.
  await expect(panorama).toBeVisible({ timeout: 7_000 });
  await expect(page.locator(".desktop-sheet")).toHaveAttribute("data-snap", "half");
  await expect(panorama.locator(".bench-panorama-shelter")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("panorama-overlay-half.png") });
  const bearing = panorama.locator(".bench-panorama-bearing");
  await expect(bearing).toHaveText("325°");
  await expect(panorama.getByRole("slider")).toHaveCount(0);
  const image = page.locator(".bench-panorama-art").first();
  await expect(image).toHaveJSProperty("complete", true);
  await panorama.screenshot({ path: testInfo.outputPath("panorama-mobile-initial.png") });

  const viewport = page.locator(".bench-panorama-viewport");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const before = await page.locator(".bench-panorama-track").getAttribute("style");
  await page.mouse.move(box!.x + box!.width * .7, box!.y + box!.height * .65);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .32, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator(".bench-panorama-track").getAttribute("style");
  expect(after).not.toBe(before);
  expect(after).not.toContain("--panorama-y: 0px");
  await expect(bearing).not.toHaveText("325°");

  await viewport.focus();
  await viewport.press("Home");
  await expect(bearing).toHaveText("325°");
  for (let index = 0; index < 65; index++) await viewport.press("ArrowLeft");
  await expect(bearing).toHaveText("0°");
  await viewport.press("ArrowLeft");
  await expect(bearing).toHaveText("355°");
  await panorama.screenshot({ path: testInfo.outputPath("panorama-mobile-rotated.png") });
});
