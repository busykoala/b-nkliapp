/** Assemble an offline artist review from immutable capture stages and manual evidence. */
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import catalogue from "../../config/panorama-artist-review.json";
import { escapeHtml as e } from "../panorama-review/report";
import type { Manifest } from "../panorama-review/core";

type Evidence = { path: string; role: string; rect?: number[]; angles?: string };
type Finding = { id: string; status?: string; severity: string; confidence: string; benches: number[]; headings?: number[];
  finding: string; likelyCause: string; change: string; acceptance: string; result: string; evidence: Evidence[] };
type Review = { number: number; status: "accepted" | "unresolved" | "regressed"; conclusion: string;
  limitations: string[]; reviewedFiles: string[]; evidence: Evidence[] };
const args = process.argv.slice(2);
const option = (key: string, fallback = "") => { const at = args.indexOf(`--${key}`); return at < 0 ? fallback : args[at + 1]; };
const stage = option("stage");
const root = resolve(".");
const stageRoot = resolve(`test-results/panorama-artist-review/${stage}`);
const captureRoot = resolve(option("capture", join(stageRoot, "full-autumn")));
const matrixRoot = resolve(option("matrix-root", stageRoot));
const output = resolve(option("output", `test-results/panorama-artist-review/${stage}/delivery`));
if (!/^[a-zA-Z0-9_-]+$/.test(stage) || [output, captureRoot, matrixRoot].some((path) => !path.startsWith(`${root}/test-results/`))) throw new Error("Specify a stage and capture/matrix/output paths beneath test-results");
const read = async <T,>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;
const final = await read<Manifest>(join(captureRoot, "manifest.json"));
if (final.captures.some((capture) => new URL(capture.url).searchParams.get("stage") !== stage)) throw new Error("Capture artwork stage differs from the requested report stage");
const baseline = await read<Manifest>("test-results/panorama-review/manifest.json");
const log = await read<{ findings: Finding[] }>(option("log", "config/panorama-art-review-log.json"));
const review = await read<{ benches: Review[] }>(option("review", join(stageRoot, "acceptance.json")));
const performancePath = resolve(option("performance", `test-results/panorama-artist-review/performance/painter-${stage}.json`));
if (!performancePath.startsWith(`${root}/test-results/`)) throw new Error("Performance evidence must be beneath test-results");
const performance = await read<{ summary: Record<string, { medianCpuMs: number; medianWallMs: number }> }>(performancePath);
const cpuImprovement = (1 - performance.summary.current.medianCpuMs / performance.summary.baseline.medianCpuMs) * 100;
const cpuChange = `${Math.abs(cpuImprovement).toFixed(1)}% ${cpuImprovement >= 0 ? "lower" : "higher"}`;
if (new Set(review.benches.map((b) => b.number)).size !== 20 || catalogue.benches.some((b) => !review.benches.some((r) => r.number === b.number))) throw new Error("Manual review must cover all 20 numbered locations");
await mkdir(output, { recursive: false });
execFileSync(".venv/bin/python", ["scripts/panorama-art/source.py", "--output", join(output, "report-source")], { stdio: "ignore" });
await cp(captureRoot, join(output, "final"), { recursive: true });
await cp("test-results/panorama-review", join(output, "baseline"), { recursive: true });
await mkdir(join(output, "provenance"));
for (const file of ["manifest.json", "source.json", "source.patch", "source.zip", "validation.json"]) await cp(join(stageRoot, file), join(output, "provenance", file));
for (const file of ["overlap-check.json", "building-facts.json"]) await cp(join(stageRoot, file), join(output, "provenance", file));
await cp("test-results/panorama-artist-review/performance", join(output, "provenance/performance"), { recursive: true });
await cp(performancePath, join(output, "provenance/painting-performance.json"));
for (const file of ["panorama-art-provenance.json", "panorama-art-review-log.json", "panorama-artist-review.json"]) await cp(join("config", file), join(output, "provenance", file));
await cp(option("review", join(stageRoot, "acceptance.json")), join(output, "acceptance.json"));
for (const file of ["panorama-artist-review.md", "panorama-artist-review-plan.md", "panorama-artist-review-source.txt"]) await cp(join("docs", file), join(output, "provenance", file));

const copied = new Map<string, string>();
async function evidenceFile(path: string) {
  if (copied.has(path)) return copied.get(path)!;
  const source = resolve(path);
  if (!["test-results/", "config/", "data/panorama-artist-review/"].some((folder) => source.startsWith(`${root}/${folder}`))) {
    throw new Error(`Evidence outside review roots: ${path}`);
  }
  const target = `evidence/${relative(root, source)}`;
  await mkdir(dirname(join(output, target)), { recursive: true });
  await cp(source, join(output, target), { recursive: true });
  copied.set(path, target);
  return target;
}
let marker = 0;
async function evidenceList(items: Evidence[]) {
  const html = [];
  for (const item of items) {
    const file = await evidenceFile(item.path);
    if (!(await stat(join(output, file))).isFile()) {
      html.push(`<li>${e(item.role)}: <code>${e(file)}</code> (included evidence directory)</li>`); continue;
    }
    if (!item.rect) { html.push(`<li><a href="${e(file)}">${e(item.role)}</a>${item.angles ? ` · ${e(item.angles)}` : ""}</li>`); continue; }
    const [x, y, width, height] = item.rect;
    const size = await sharp(join(output, file)).metadata();
    if (item.rect.length !== 4 || !item.rect.every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > size.width! || y + height > size.height!) throw new Error(`Invalid annotation: ${item.path}`);
    const number = ++marker;
    const annotation = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#b33e25" stroke-width="5"/><circle cx="${x + 22}" cy="${y + 22}" r="20" fill="#b33e25" stroke="white" stroke-width="2"/><text x="${x + 22}" y="${y + 30}" text-anchor="middle" font-family="sans-serif" font-size="23" fill="white">${number}</text></svg>`;
    const annotated = `${file.replace(/\.[^.]+$/, "")}-note-${number}.png`;
    await sharp(join(output, file)).composite([{ input: Buffer.from(annotation) }]).png().toFile(join(output, annotated));
    html.push(`<li id="note-${number}"><a href="${e(annotated)}">${number}. ${e(item.role)}</a>${item.angles ? ` · ${e(item.angles)}` : ""}<div class="evidence"><a href="${e(annotated)}"><img loading="lazy" src="${e(annotated)}" alt="Numbered evidence ${number}: ${e(item.role)}"></a></div></li>`);
  }
  return `<ul>${html.join("")}</ul>`;
}

const findings = [];
const ordered = [...log.findings].sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved")
  || ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity));
for (const finding of ordered) findings.push(`<article id="${e(finding.id)}"><h3>${e(finding.id)} · ${e(finding.status ?? "open")} · ${e(finding.severity)} severity / ${e(finding.confidence)} confidence</h3><p>${e(finding.finding)}</p><p>Locations: ${finding.benches.map((n) => `<a href="#bench-${n}">${String(n).padStart(2, "0")}</a>`).join(", ")}. Recorded headings: ${e(finding.headings?.join(", ") ?? "see evidence")}°.</p><dl><dt>Likely cause</dt><dd>${e(finding.likelyCause)}</dd><dt>Change</dt><dd>${e(finding.change)}</dd><dt>Acceptance</dt><dd>${e(finding.acceptance)}</dd><dt>Observed result</dt><dd>${e(finding.result)}</dd></dl>${await evidenceList(finding.evidence)}</article>`);

const cards = [];
for (const bench of catalogue.benches) {
  const capture = final.captures.find((c) => c.bench.id === bench.id);
  const before = baseline.captures.find((c) => c.bench.id === bench.id);
  const assessment = review.benches.find((b) => b.number === bench.number)!;
  if (!capture || !before) throw new Error(`Missing comparison: ${bench.number}`);
  const c = capture.coverage;
  const svg = (file: string, label: string) => `<figure><figcaption>${e(label)}</figcaption><div class="scroll"><img loading="lazy" class="panorama" src="${e(file)}" alt="${e(label)} for ${e(bench.name)}"></div><a href="${e(file)}">Open full-resolution PNG</a></figure>`;
  for (const file of assessment.reviewedFiles) {
    const source = file.startsWith("test-results/") ? file : relative(root, join(stageRoot, file));
    await evidenceFile(source);
  }
  cards.push(`<article id="bench-${bench.number}"><h2>${String(bench.number).padStart(2, "0")} · ${e(bench.name)}</h2><p class="status">${e(assessment.status)} · artist heading ${bench.heading}° · <a href="https://xn--bnkliapp-0za.ch/?bank=${encodeURIComponent(bench.id)}">Location</a></p><dl><dt>Preserve</dt><dd>${e(bench.preserve)}</dd><dt>Revision</dt><dd>${e(bench.improve)}</dd><dt>Visual assessment</dt><dd>${e(assessment.conclusion)}</dd></dl>${assessment.limitations.length ? `<p><strong>Limits:</strong> ${assessment.limitations.map(e).join("; ")}</p>` : ""}<p>360° × ${c.minAltitude.toFixed(2)}°…+${c.maxAltitude.toFixed(2)}°; ${c.width}×${c.height} px; ${capture.tiles.length} tiles/pass; overlap ${(c.horizontalOverlap * 100).toFixed(1)}% horizontal / ${(c.verticalOverlap * 100).toFixed(1)}% vertical. Wrap ${c.wrapVerified ? "verified" : "unverified"}; endpoints ${c.endpointsVerified ? "verified" : "unverified"}.</p><button class="zoom" type="button">Toggle native resolution</button>${svg(`final/${capture.panorama}`, "Current local candidate")}${svg(`baseline/${before.panorama}`, "Original production capture")}
  <p>Original and candidate differ in source geometry and painting. Original capture weather/time differs; compare form and structure separately from atmospheric changes.</p><div class="pair"><a href="final/${e(capture.expanded ?? capture.initial)}"><img loading="lazy" src="final/${e(capture.expanded ?? capture.initial)}" alt="Candidate with foreground and controls"></a><a href="baseline/${e(before.expanded ?? before.initial)}"><img loading="lazy" src="baseline/${e(before.expanded ?? before.initial)}" alt="Original with foreground and controls"></a></div>${await evidenceList(assessment.evidence)}<details><summary>Original directional screenshots and diagnostics</summary><p><a href="final/report.html#${e(bench.id)}">All capture tiles, asset identities, timing and diagnostics</a></p><pre>${e(JSON.stringify({ startedAt: capture.startedAt, completedAt: capture.completedAt, errors: capture.errors, failures: capture.failures, reviewedFiles: assessment.reviewedFiles }, null, 2))}</pre></details></article>`);
}

const weather = [];
let matrixCount = 0, matrixFailures = 0;
for (const season of ["spring", "summer", "autumn", "winter"]) {
  const folder = `matrix-${season}`;
  const matrix = await read<{ stage: string; results: Array<{ number: number; stem?: string; condition: string; width: number; error?: string; errors: string[]; failedRequests: string[] }> }>(join(matrixRoot, folder, "manifest.json"));
  if (matrix.stage !== stage) throw new Error(`Weather artwork stage mismatch: ${season}`);
  await cp(join(matrixRoot, folder), join(output, "weather", season), { recursive: true });
  matrixCount += matrix.results.length;
  matrixFailures += matrix.results.filter((r) => r.error || r.errors.length || r.failedRequests.length).length;
  weather.push(`<details><summary>${e(season)} · ${matrix.results.length} cases</summary><div class="gallery">${matrix.results.map((r) => `<figure><a href="weather/${season}/${e(r.stem)}-original.png"><img loading="lazy" src="weather/${season}/${e(r.stem)}-original.png" alt="${r.number} ${e(r.condition)} ${r.width}px"></a><figcaption>${r.number} · ${e(r.condition)} · ${r.width}px${r.error ? ` · ${e(r.error)}` : ""}</figcaption></figure>`).join("")}</div></details>`);
}
const complete = final.status === "complete" && final.captures.length === 20 && new Set(final.captures.map((c) => c.bench.id)).size === 20
  && final.captures.every((c) => c.coverage.wrapVerified && c.coverage.endpointsVerified && !c.errors.length && !c.failures.length && !c.clippedViewport)
  && review.benches.every((b) => b.status === "accepted") && matrixCount === 912 && matrixFailures === 0;
const summary = { stage, status: complete ? "accepted" : "incomplete", panoramaCount: final.captures.length, matrixCount, matrixFailures,
  annotationCount: marker, reviews: review.benches, sourceManifest: "provenance/source.json", captureManifest: "final/manifest.json" };
await writeFile(join(output, "manifest.json"), JSON.stringify(summary, null, 2) + "\n");
await writeFile(join(output, "report.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bänkliview · Artist review</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f1e8;color:#26352f;font:16px/1.55 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:24px}a{color:#21675b}article{background:#fffdf7;border:1px solid #cdd4ca;border-radius:10px;margin:24px 0;padding:22px}h1,h2,h3{line-height:1.2}dt{font-weight:bold}dd{margin:0 0 12px}figure{margin:14px 0}img{display:block;max-width:100%;height:auto}.scroll{overflow:auto;border:1px solid #aab5aa}.panorama{width:100%;max-width:none}.native .panorama{width:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}.status{padding:12px;background:#e4e9dc}.evidence{max-width:900px;margin:12px 0}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}pre{white-space:pre-wrap;font-size:12px}button{padding:10px 16px;font:inherit}li{margin:8px 0}@media(max-width:600px){main{padding:12px}.pair{grid-template-columns:1fr}article{padding:12px}}</style><main><h1>Bänkliview | Artist review</h1><p>Muted, contemplative landscapes with more specific forms, connected space and purposeful marks.</p><p class="status">Review status: <strong>${summary.status}</strong>. ${summary.panoramaCount}/20 full-range panoramas. ${matrixCount}/912 weather/season/device cases; ${matrixFailures} browser/asset failures. ${marker} numbered evidence exports.</p><p>This package reviews local stage ${e(stage)}. It includes no production activation or release. These are screenshots of rendered landscapes covering 360° horizontally and the viewer's measured vertical range, rather than spherical photographs.</p><nav>${catalogue.benches.map((b) => `<a href="#bench-${b.number}">${String(b.number).padStart(2, "0")}</a>`).join(" · ")}</nav><h2>Method and limits</h2><p>Stable artist numbering and downloaded cluster data identify the comparison sample. Source corrections and paint changes are recorded separately. Candidate weather is synthetic with fixed astronomical timestamps. Original screenshots retain bench and controls; stitching hides screen-anchored foreground and controls in the capture browser and freezes animations. The capture manifests retain adjustments, coordinates, asset identity and errors. Geographic appearance and facade details remain unverified unless supported by cited source evidence.</p><p><a href="manifest.json">Review manifest</a> · <a href="acceptance.json">Manual review record</a> · <a href="provenance/panorama-art-provenance.json">Asset prompts and provenance</a> · <a href="provenance/source.zip">Painting source snapshot</a> · <a href="report-source/source.zip">Report tooling snapshot</a> · <a href="provenance/panorama-artist-review-source.txt">Supplied full artist review</a> · <a href="provenance/panorama-artist-review-plan.md">Implementation and acceptance plan</a></p><h2>Validation and remaining work</h2><p>${review.benches.filter((b) => b.status === "accepted").length} location assessments accepted; ${review.benches.filter((b) => b.status !== "accepted").length} remain open. Browser capture completion is separate from artistic acceptance.</p><p>The linked validation record contains the checks and omissions for this specific candidate, including its test results, renderer comparisons and build status. Results from earlier stages remain labelled as earlier evidence. Automated checks and successful captures do not establish artistic acceptance.</p><p>The paired six-location benchmark used identical geometry, dimensions and hardware with alternating painter order: median CPU time ${performance.summary.baseline.medianCpuMs.toFixed(0)} ms → ${performance.summary.current.medianCpuMs.toFixed(0)} ms (${cpuChange}). These are local painting measurements. <a href="provenance/painting-performance.json">Timing evidence</a> · <a href="provenance/validation.json">Checks and GPU/canvas results</a> · <a href="provenance/overlap-check.json">Every-tile overlap comparison</a>.</p><p>Prioritize source-supported facade identity, connected depth and material-specific painting. Keep corrected wall contacts, quiet passages, exact material transport and the user-requested foreground crop as regression requirements. The evidence below separates resolved corrections from remaining artistic work.</p><h2>Findings and improvement backlog</h2>${findings.join("")}<h2>All 20 locations</h2>${cards.join("")}<h2>Season, sky and weather evidence</h2><p>Four seasons × six pilot locations × 19 conditions × two widths. Scene timestamps, celestial state and viewer diagnostics are recorded in each weather manifest.</p>${weather.join("")}</main><script>document.querySelectorAll('.zoom').forEach(b=>b.addEventListener('click',()=>b.closest('article').classList.toggle('native')))</script></html>`);
console.log(JSON.stringify({ output, ...summary, reviews: undefined }));
