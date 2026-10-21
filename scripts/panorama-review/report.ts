import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { type Finding, type Manifest } from "./core";

export const escapeHtml = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function validateFindings(manifest: Manifest, findings: Finding[]) {
  const ids = new Set<string>();
  for (const finding of findings) {
    if (!/^[A-Za-z0-9-]+$/.test(finding.id) || ids.has(finding.id)) throw new Error("Finding IDs must be unique and URL-safe");
    ids.add(finding.id);
    if (!["high", "medium", "low"].includes(finding.severity) || !["high", "medium", "low"].includes(finding.confidence)
      || ![finding.title, finding.observation, finding.likelyCause, finding.improvement, finding.acceptance].every((value) => typeof value === "string" && value.trim().length)
      || !finding.evidence.length) throw new Error(`Incomplete finding: ${finding.id}`);
    for (const evidence of finding.evidence) {
      const capture = manifest.captures.find((item) => item.bench.id === evidence.benchId);
      if (!capture) throw new Error(`Unknown bench in finding ${finding.id}`);
      const tile = capture.tiles.find((item) => item.original === evidence.file);
      const isPanorama = evidence.file === capture.panorama;
      const isInitial = evidence.file === capture.initial || evidence.file === capture.expanded;
      const width = isPanorama ? capture.coverage.width : tile?.width ?? (isInitial ? 1440 : 0);
      const height = isPanorama ? capture.coverage.height : tile?.height ?? (isInitial ? 900 : 0);
      const { x, y, width: w, height: h } = evidence.box;
      if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height || !evidence.angles) {
        throw new Error(`Invalid evidence rectangle: ${finding.id}, ${evidence.file}`);
      }
    }
  }
}

export async function writeReport(root: string, manifest: Manifest) {
  validateFindings(manifest, manifest.findings);
  const e = escapeHtml;
  const findings = [...manifest.findings].sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity));
  const exports: string[] = [];
  for (const capture of manifest.captures) {
    const evidence = findings.flatMap((finding) => finding.evidence.filter((item) => item.benchId === capture.bench.id).map((item) => ({ ...item, id: finding.id })));
    for (const file of new Set(evidence.map((item) => item.file))) {
      const image = sharp(join(root, file)); const size = await image.metadata();
      const rectangles = evidence.filter((item) => item.file === file).map(({ box, id }) => `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#ff2858" stroke-width="5"/><rect x="${box.x}" y="${box.y}" width="120" height="32" fill="#87122e"/><text x="${box.x + 5}" y="${box.y + 24}" fill="white" font-size="21">${e(id)}</text>`).join("");
      const annotation = `<svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg">${rectangles}</svg>`;
      const output = file.replace(/\.png$/, "-annotated.png");
      await image.composite([{ input: Buffer.from(annotation) }]).png().toFile(join(root, output));
      exports.push(output);
      if (file === capture.panorama) capture.annotated = output;
    }
  }
  const cards = manifest.captures.map((capture, index) => {
    const coverage = capture.coverage;
    const markers = findings.flatMap((finding) => finding.evidence.filter((item) => item.file === capture.panorama).map((item) => `<a class="marker" href="#${e(finding.id)}" title="${e(finding.title)}" style="left:${item.box.x / coverage.width * 100}%;top:${item.box.y / coverage.height * 100}%;width:${item.box.width / coverage.width * 100}%;height:${item.box.height / coverage.height * 100}%">${e(finding.id)}</a>`)).join("");
    return `<article id="${e(capture.bench.id)}"><h2>${index + 1}. ${e(capture.bench.category)} · ${e(capture.bench.name ?? capture.bench.id)}</h2>
      <p><a href="${e(capture.url)}">Open live bench</a> · ${capture.bench.latitude.toFixed(5)}, ${capture.bench.longitude.toFixed(5)} · ${e(capture.bench.canton ?? "canton unknown")}</p>
      <p>360° × ${coverage.minAltitude.toFixed(1)}°…+${coverage.maxAltitude.toFixed(1)}° · ${coverage.width} × ${coverage.height} px · ${capture.tiles.length} tiles per pass · overlaps ${(coverage.horizontalOverlap * 100).toFixed(0)}% / ${(coverage.verticalOverlap * 100).toFixed(0)}% · painted ${capture.paintedInMs} ms · wrap and endpoints verified.</p>
      <p>${e(capture.startedAt)} — ${e(capture.completedAt)} · ${e(capture.phase)} · ${capture.clippedViewport ? "Viewer extends beyond browser bounds; captured visible intersection." : "Viewer fits browser bounds."}</p>
      <button class="zoom" type="button">Toggle native-resolution view</button>
      <div class="scroll"><div class="image" style="--native:${coverage.width}px"><img loading="lazy" src="${e(capture.panorama)}" width="${coverage.width}" height="${coverage.height}" alt="Complete rendered panorama for ${e(capture.bench.id)}">${markers}</div></div>
      <p><a href="${e(capture.panorama)}">Full PNG</a> · <a href="${e(capture.initial)}">Untouched initial page</a>${capture.expanded ? ` · <a href="${e(capture.expanded)}">Expanded page</a>` : ""}${capture.annotated ? ` · <a href="${e(capture.annotated)}">Annotated PNG</a>` : ""}</p>
      ${capture.reviewNote ? `<p><strong>Visual review:</strong> ${e(capture.reviewNote)}</p>` : ""}
      <details><summary>Original tiles and diagnostics</summary><p>Original tiles retain controls, foreground and screen-space weather. Clean tiles are the stitching inputs.</p><div class="tiles">${capture.tiles.map((tile) => `<a href="${e(tile.original)}"><img loading="lazy" src="${e(tile.original)}" alt="${tile.projection.heading} degrees, vertical track ${tile.projection.top}"><span>${tile.projection.heading}° · y=${tile.y}</span></a>`).join("")}</div><pre>${e(JSON.stringify({ assets: capture.assets, errors: capture.errors, failures: capture.failures }, null, 2))}</pre></details>
      </article>`;
  }).join("");
  const backlog = findings.map((finding) => `<article id="${e(finding.id)}"><h3>${e(finding.id)} · ${e(finding.title)}</h3><p><strong>${e(finding.severity)} priority · ${e(finding.confidence)} confidence · ${new Set(finding.evidence.map((item) => item.benchId)).size} evidenced locations</strong></p><p>${e(finding.observation)}</p><p><strong>Likely cause:</strong> ${e(finding.likelyCause)}</p><p><strong>Proposed improvement:</strong> ${e(finding.improvement)}</p><p><strong>Acceptance:</strong> ${e(finding.acceptance)}</p><ul>${finding.evidence.map((item) => `<li><a href="${e(item.file.replace(/\.png$/, "-annotated.png"))}">${e(item.benchId)} · ${e(item.angles)} · annotated evidence</a></li>`).join("")}</ul></article>`).join("");
  await writeFile(join(root, "report.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bänkliview panorama review</title><style>
    *{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f5f2e9;color:#20382e}main{max-width:1500px;margin:auto}a{color:#17624e}article{background:#fffdf7;padding:20px;margin:24px 0;border:1px solid #d6d9cd;border-radius:12px}h1,h2,h3{line-height:1.2}.scroll{overflow:auto;border:1px solid #acb9ae;margin-top:12px}.image{position:relative;width:100%}.image.native{width:var(--native)}.image>img{display:block;width:100%;height:auto}.marker{position:absolute;border:3px solid #ff2858;background:#ff285818;color:white;text-shadow:0 1px 3px black;font-weight:bold}.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.tiles img{width:100%;display:block}pre{overflow:auto;font-size:12px}button{padding:9px 15px;cursor:pointer}.status{padding:16px;background:#e4ece0}.pending{background:#ffe5b3}
    </style><main><h1>Bänkliview: full-range panorama review</h1><p class="status ${manifest.status === "complete" && manifest.reviewStatus === "reviewed" ? "" : "pending"}">Capture: ${e(manifest.status)} (${manifest.captures.length}/${manifest.requested}). Visual review: ${e(manifest.reviewStatus)}. ${manifest.failures.length} failed attempts retained.</p>
    <p>Updated ${e(manifest.updatedAt)}. Images are live rendered landscapes, with 360° horizontal coverage and the viewer’s reachable vertical range; they are not full spherical photographs.</p>
    <details><summary>Capture method and limits</summary><ul>${manifest.adjustments.map((item) => `<li>${e(item)}</li>`).join("")}</ul><p>Geographic accuracy is unverified unless a finding cites independent reference evidence. CSS screen-space overlays and time differences can cause capture joins; original overlaps are the evidence for renderer defects. Category and location metadata come from a read-only local snapshot.</p></details>
    <h2>Prioritized improvement plan</h2>${backlog || "<p>Visual review pending; no findings have been asserted.</p>"}
    <h2>Panoramas</h2>${cards}<h2>Failed attempts</h2><ul>${manifest.failures.map((failure) => `<li>${e(failure.bench.id)} attempt ${failure.attempt}: ${e(failure.error)}${failure.screenshot ? ` · <a href="${e(failure.screenshot)}">screenshot</a>` : ""}${failure.diagnostics ? ` · <a href="${e(failure.diagnostics)}">diagnostics</a>` : ""}</li>`).join("")}</ul><p>${manifest.excluded?.length ?? 0} earlier sample entries excluded by Swiss territory/setting validation; their metadata remain in the manifest.</p><p><a href="manifest.json">Manifest</a> · <a href="selection.json">Repeatable selection</a> · <a href="findings.json">Findings</a></p></main><script>document.querySelectorAll('.zoom').forEach(button=>button.addEventListener('click',()=>button.nextElementSibling.querySelector('.image').classList.toggle('native')))</script></html>`);
  return exports;
}
