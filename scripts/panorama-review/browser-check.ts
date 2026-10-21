/** Real-browser fixture: exercises the same capture routine without production traffic. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { captureBench, setCaptureHeading } from "./capture";
import { readJson, reusable, type Candidate, type Manifest } from "./core";

const fixture = `<!doctype html><style>
body{margin:0}.bench-panorama{position:fixed;inset:0;margin:0}.bench-panorama-viewport{position:absolute;inset:0;overflow:hidden}.bench-panorama-track{position:absolute;display:flex;top:var(--panorama-track-top);transform:translateX(var(--panorama-offset));height:var(--panorama-track-height)}.copy{width:var(--panorama-copy-width);height:100%;flex:none;background:linear-gradient(#83b5cc,#e0b378)}img{width:100%;height:100%}.bench-panorama-hud{position:absolute;z-index:10;background:white;padding:10px}
</style><figure class="bench-panorama"><div class="bench-panorama-viewport" tabindex="0"><div class="bench-panorama-track">${[0,1,2].map(() => '<div class="copy"><div class="bench-panorama-raster" style="height:100%"><img class="bench-panorama-art" src="/art.png"><canvas class="bench-panorama-webgl is-ready" style="display:none"></canvas><canvas class="bench-panorama-webgl" style="display:none"></canvas></div></div>').join("")}</div></div><div class="bench-panorama-hud"><span class="bench-panorama-bearing">45°</span><div class="bench-panorama-zoom-controls"><span>1.0×</span></div><button class="bench-panorama-expand">Open</button></div></figure><script>
let heading=45,shift=0;const track=document.querySelector('.bench-panorama-track');
function draw(){track.style.cssText='--panorama-offset:'+Math.round(720-4896*(1+heading/360))+'px;--panorama-copy-width:4896px;--panorama-track-height:1632px;--panorama-track-top:'+(-570+shift)+'px;--panorama-raster-height:1224px';document.querySelector('.bench-panorama-bearing').textContent=Math.round(heading)+'°'}
document.querySelector('button').onclick=()=>document.querySelector('figure').classList.add('is-expanded');
document.querySelector('.bench-panorama-viewport').onkeydown=e=>{e.preventDefault();if(e.key==='Home'){heading=45;shift=0}if(e.key==='ArrowUp')shift=Math.min(570,shift+40.8);if(e.key==='ArrowDown')shift=Math.max(0,shift-40.8);if(e.key==='ArrowRight')heading=(heading+(e.shiftKey?30:5))%360;draw()};draw();
</script>`;
const root = await mkdtemp(join(tmpdir(), "panorama-review-browser-"));
const art = await sharp({ create: { width: 360, height: 120, channels: 3, background: "#c8b994" } }).png().toBuffer();
const server = createServer((request, response) => {
  const url = new URL(request.url!, "http://localhost");
  if (url.pathname === "/art.png") { response.writeHead(200, { "Content-Type": "image/png" }); response.end(art); return; }
  let html = fixture;
  if (url.searchParams.get("bank") === "missing") html = fixture.replaceAll('src="/art.png"', 'src="/broken.png"');
  if (url.pathname === "/broken.png") { response.writeHead(404); response.end(); return; }
  if (url.searchParams.get("bank") === "unready") html = fixture.replaceAll(" is-ready", "");
  if (url.searchParams.get("bank") === "extended") html = fixture.replace("--panorama-raster-height:1224px", "--panorama-raster-height:1632px");
  if (url.searchParams.get("bank") === "delayed") html = fixture.replace("</script>", `
document.querySelector('button').addEventListener('click',()=>setTimeout(()=>{
 const ready=[...document.querySelectorAll('canvas.is-ready')];
 ready.forEach(c=>c.classList.remove('is-ready'));
 document.querySelector('.bench-panorama-viewport').style.opacity='.2';
 setTimeout(()=>{ready.forEach(c=>c.classList.add('is-ready'));document.querySelector('.bench-panorama-viewport').style.opacity='1'},750);
},80));</script>`);
  response.writeHead(200, { "Content-Type": "text/html" }); response.end(html);
});
server.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address() as { port: number };
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
const candidate = (id: string): Candidate => ({ id, category: "urban", latitude: 47, longitude: 8, name: null, canton: null, elevation: null, forest: null, water: null, buildings: null, land: null });
try {
  const headingPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await headingPage.goto(origin);
  assert.equal((await setCaptureHeading(headingPage, 155)).heading, 155);
  assert.equal((await setCaptureHeading(headingPage, 355)).heading, 355);
  assert.equal((await setCaptureHeading(headingPage, 5)).heading, 5);
  await assert.rejects(setCaptureHeading(headingPage, 7), /unreachable/);
  await headingPage.locator(".bench-panorama-viewport").evaluate((element) => { (element as HTMLElement).onkeydown = null; });
  await assert.rejects(setCaptureHeading(headingPage, 35), /did not move/);
  await headingPage.close();
  const capture = await captureBench(browser, candidate("fixture"), origin, root, 5000);
  assert.equal(capture.coverage.width, 4896);
  assert(capture.coverage.wrapVerified && capture.coverage.endpointsVerified);
  assert(capture.coverage.horizontalOverlap >= .3 && capture.coverage.verticalOverlap >= .3);
  assert(capture.coverage.maxAltitude > 87 && capture.coverage.minAltitude < -18);
  const extended = await captureBench(browser, candidate("extended"), origin, root, 5000);
  assert.deepEqual(extended.coverage, capture.coverage, "Changing the painting extent must not change measured camera coverage");
  const delayed = await captureBench(browser, candidate("delayed"), origin, root, 5000);
  const pixel = async (file: string) => sharp(join(root, file)).extract({ left: 1000, top: 500, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual(await pixel(delayed.expanded!), await pixel(capture.expanded!), "Expanded screenshots must wait through a delayed second renderer fade");
  assert(await reusable(capture, root));
  await rm(join(root, capture.tiles[0].clean));
  assert.equal(await reusable(capture, root), false);
  await assert.rejects(captureBench(browser, candidate("missing"), origin, root, 600), /Timeout/);
  await assert.rejects(captureBench(browser, candidate("unready"), origin, root, 600), /Timeout/);
  const database = join(root, "sample.sqlite");
  const db = new Database(database);
  db.exec(`CREATE TABLE benches(row_id INTEGER,id TEXT,latitude REAL,longitude REAL,name TEXT,location_name TEXT,location_canton TEXT,active INTEGER);
    CREATE TABLE bench_enrichments(bench_row_id INTEGER,elevation_meters REAL,in_forest INTEGER,distance_water_meters REAL,building_count_100m INTEGER,land_context TEXT);
    INSERT INTO benches VALUES (1,'missing',46.2,6.15,NULL,NULL,NULL,1),(2,'fixture',47,8,NULL,NULL,NULL,1);
    INSERT INTO bench_enrichments VALUES (1,500,0,1000,20,'mixed'),(2,500,0,1000,20,'mixed');`);
  db.close();
  const output = join(root, "cli");
  const args = ["--import", "tsx", "scripts/review-full-panorama.ts", "--origin", origin, "--database", database, "--count", "1", "--timeout", "600", "--output", output];
  await promisify(execFile)(process.execPath, args);
  const result = await readJson<Manifest>(join(output, "manifest.json"));
  assert.equal(result.status, "complete"); assert.equal(result.captures[0].bench.id, "fixture");
  assert.equal(result.failures.length, 2);
  await promisify(execFile)(process.execPath, [...args, "--resume"]);
  const resumed = await readJson<Manifest>(join(output, "manifest.json"));
  assert.equal(resumed.captures[0].completedAt, result.captures[0].completedAt);
  console.log("Browser checks passed: full turn, vertical limits, paired renderers, stitching, missing artwork, render timeout, failed-location replacement, CLI resume.");
} finally { await browser.close(); server.close(); await rm(root, { recursive: true, force: true }); }
