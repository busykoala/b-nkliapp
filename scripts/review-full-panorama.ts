/** Sequential, resumable live capture. No application database imports or writes. */
import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import { chromium } from "@playwright/test";
import { captureBench, adjustments } from "./panorama-review/capture";
import { categories, categoryFor, nextCandidate, readJson, reusable, saveJson, territoryPredicate, type Candidate, type Finding, type Manifest, type Territory } from "./panorama-review/core";
import { validateFindings, writeReport } from "./panorama-review/report";

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: "string", default: "test-results/panorama-review" },
    origin: { type: "string", default: process.env.BENCHLY_LIVE_ORIGIN ?? "https://xn--bnkliapp-0za.ch" },
    database: { type: "string", default: process.env.DATABASE_PATH ?? "data/benchly.sqlite" },
    count: { type: "string", default: "20" }, sample: { type: "string" }, resume: { type: "boolean", default: false },
    timeout: { type: "string", default: "20000" }, "max-candidates": { type: "string", default: "12" },
    "report-only": { type: "boolean", default: false }, findings: { type: "string" }, reviewed: { type: "boolean", default: false },
    "url-template": { type: "string" },
  } });
  const root = resolve(values.output!); const origin = new URL(values.origin!).origin;
  const count = Number(values.count); const timeout = Number(values.timeout); const maxCandidates = Number(values["max-candidates"]);
  const urlTemplate = values["url-template"];
  if (urlTemplate && (!urlTemplate.startsWith("/") || urlTemplate.startsWith("//") || !urlTemplate.includes("{id}")))
    throw new Error("URL template must be a same-origin relative path containing {id}");
  if (!Number.isInteger(count) || count < 1 || count > 20 || !Number.isFinite(timeout) || timeout < 100 || !Number.isInteger(maxCandidates) || maxCandidates < 1) throw new Error("Invalid count (1–20), timeout, or max-candidates");
  await mkdir(root, { recursive: true });
  const manifestPath = join(root, "manifest.json");
  let previous: Manifest | undefined;
  try { previous = await readJson<Manifest>(manifestPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (previous && !values.resume && !values["report-only"]) throw new Error("Output already has a manifest. Use --resume or a new --output directory.");
  if (values["report-only"]) {
    if (!previous) throw new Error("No manifest to review");
    previous.findings = await readJson<Finding[]>(resolve(values.findings ?? join(root, "findings.json")));
    validateFindings(previous, previous.findings);
    if (values.reviewed) previous.reviewStatus = "reviewed";
    previous.updatedAt = new Date().toISOString();
    await writeReport(root, previous);
    await saveJson(join(root, "findings.json"), previous.findings);
    await saveJson(manifestPath, previous);
    console.log(`Report: ${join(root, "report.html")}`);
    return;
  }
  if (previous && (previous.origin !== origin || previous.requested !== count || previous.version !== 1)) throw new Error("Resume origin, count and manifest version must match");
  if (previous && previous.urlTemplate !== urlTemplate && !values["report-only"]) throw new Error("Resume URL template must match the captured iteration");
  const manifest: Manifest = previous ?? {
    version: 1, origin, requested: count, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    status: "incomplete", reviewStatus: "pending",
    adjustments: urlTemplate?.startsWith("/dev/panorama-review") ? adjustments.map((value) =>
      value.startsWith("Lighting and weather are live") ? "Local review uses fixed astronomical time and explicitly synthetic weather from the capture URL. Asset hashes and timestamps are recorded; inspect original overlaps before attributing capture joins to the renderer." : value.replace("live UI", "viewer UI")) : adjustments,
    captures: [], failures: [], findings: [],
    urlTemplate,
  };
  const { territory } = await readJson<{ territory: Territory }>(resolve("config/dialects/areas.generated.json"));
  const insideSwiss = territoryPredicate(territory);
  const retained = [];
  for (const capture of manifest.captures) {
    if (!values.sample && (!insideSwiss(capture.bench.latitude, capture.bench.longitude) || categoryFor(capture.bench) !== capture.bench.category)) {
      console.warn(`Excluding location outside Swiss territory or setting criteria: ${capture.bench.id}`);
      (manifest.excluded ??= []).push(capture.bench);
    } else if (await reusable(capture, root)) retained.push(capture);
    else console.warn(`Recapturing missing/incomplete evidence: ${capture.bench.id}`);
  }
  const invalidatedEvidence = retained.length !== manifest.captures.length;
  manifest.captures = retained;
  if (invalidatedEvidence) {
    manifest.reviewStatus = "pending";
    manifest.findings = [];
  }
  let pool: Candidate[] = [];
  let sample: Candidate[] | undefined;
  if (values.sample) {
    sample = await readJson<Candidate[]>(resolve(values.sample));
    if (sample.length !== count || new Set(sample.map((row) => row.id)).size !== count || sample.some((row) => !categories.includes(row.category) || !/^[a-z0-9-]+$/.test(row.id)
      || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude))) throw new Error("Sample must contain count distinct candidates with valid categories and coordinates");
    if (manifest.captures.some((capture) => !sample!.some((row) => row.id === capture.bench.id))) throw new Error("Resume sample differs from captured selection");
  } else {
    const db = new Database(resolve(values.database!), { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(`SELECT b.id,b.latitude,b.longitude,coalesce(b.name,b.location_name) name,b.location_canton canton,
        e.elevation_meters elevation,e.in_forest forest,e.distance_water_meters water,e.building_count_100m buildings,e.land_context land
        FROM benches b JOIN bench_enrichments e ON e.bench_row_id=b.row_id WHERE b.active=1 ORDER BY b.id`).all() as Omit<Candidate, "category">[];
      pool = rows.flatMap((row) => {
        const category = categoryFor(row);
        return category && insideSwiss(row.latitude, row.longitude) ? [{ ...row, category }] : [];
      });
    } finally { db.close(); }
  }
  const persist = async () => {
    manifest.updatedAt = new Date().toISOString();
    manifest.status = manifest.captures.length === count ? "complete" : "incomplete";
    await saveJson(manifestPath, manifest);
    await saveJson(join(root, "selection.json"), manifest.captures.map((capture) => capture.bench));
    await saveJson(join(root, "findings.json"), manifest.findings);
  };
  await persist();
  const browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false });
  const used = new Set(manifest.captures.map((capture) => capture.bench.id));
  // Previous failures are retained but may be transient; allow another bounded attempt on resume.
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    for (const [categoryIndex, category] of categories.entries()) {
      const quota = sample ? sample.filter((row) => row.category === category).length : Math.floor(count / categories.length) + (categoryIndex < count % categories.length ? 1 : 0);
      let candidatesTried = 0;
      while (!interrupted && manifest.captures.filter((capture) => capture.bench.category === category).length < quota && candidatesTried < maxCandidates) {
        const candidate = sample ? sample.find((row) => row.category === category && !used.has(row.id)) : nextCandidate(pool, category, used, manifest.captures.map((capture) => capture.bench));
        if (!candidate) break;
        used.add(candidate.id); candidatesTried++;
        for (let attempt = 1; attempt <= 2 && !interrupted; attempt++) {
          console.log(`${manifest.captures.length + 1}/${count} ${category}: ${candidate.id} (attempt ${attempt})`);
          try {
            const target = urlTemplate ? new URL(urlTemplate.replaceAll("{id}", encodeURIComponent(candidate.id)), origin).href : undefined;
            const capture = await captureBench(browser, candidate, origin, root, timeout, target);
            manifest.captures.push(capture);
            manifest.reviewStatus = "pending";
            console.log(`  ${capture.coverage.width}×${capture.coverage.height}, ${capture.tiles.length} tiles/pass, vertical ${capture.coverage.minAltitude.toFixed(1)}°…${capture.coverage.maxAltitude.toFixed(1)}°`);
            await persist();
            break;
          } catch (error) {
            const at = new Date().toISOString();
            const screenshot = `${candidate.id}/failure-${at.replaceAll(/[:.]/g, "-")}.png`;
            let saved: string | undefined;
            let diagnostics: string | undefined;
            try { await copyFile(join(root, candidate.id, "failure.png"), join(root, screenshot)); saved = screenshot; } catch { /* Browser launch/navigation can fail before a screenshot exists. */ }
            try {
              diagnostics = screenshot.replace(/\.png$/, ".json");
              await copyFile(join(root, candidate.id, "failure-diagnostics.json"), join(root, diagnostics));
            } catch { diagnostics = undefined; }
            manifest.failures.push({ bench: candidate, attempt, at, error: String(error), screenshot: saved, diagnostics });
            console.warn(`  ${String(error)}`);
            await persist();
          }
        }
      }
    }
  } finally {
    await browser.close(); process.off("SIGINT", stop); process.off("SIGTERM", stop);
    await persist();
    await writeReport(root, manifest);
    console.log(`${manifest.status}: ${manifest.captures.length}/${count}. Report: ${join(root, "report.html")}`);
  }
  if (manifest.status !== "complete") process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
