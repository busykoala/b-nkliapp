/** Install a complete, visually reviewed sprite set and derive its seat framing. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const option = (key: string, fallback = "") => { const at = args.indexOf(`--${key}`); return at < 0 ? fallback : args[at + 1]; };
const reviewPath = resolve(option("review", "test-results/panorama-artist-review/bench-cohesion-v4/review.json"));
const review = JSON.parse(await readFile(reviewPath, "utf8")) as { readyForInstallation?: boolean; selectedAssets: string };
if (!review.readyForInstallation) throw Error("The complete sprite set must have a recorded visual review before installation");
const assets = resolve(review.selectedAssets);
const originals = resolve(option("originals", join(dirname(reviewPath), "delivery-v1/original-assets")));
const manifest = JSON.parse(await readFile(join(assets, "normalization.json"), "utf8")) as {
  variants: Array<{ variant: string; normalizedSha256: string; sourceSha256: string }>;
};
const expected = ["neutral", ...["wood", "metal", "stone", "plastic"].flatMap((material) => ["back-arm", "back", "backless"].map((shape) => `${material}-${shape}`))].sort();
if (manifest.variants.length !== 13 || JSON.stringify(manifest.variants.map((row) => row.variant).sort()) !== JSON.stringify(expected)) throw Error("Review must contain exactly the13 known bench variants");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const framing: Record<string, number> = {};
const checked = [];
for (const name of expected) {
  const row = manifest.variants.find((row) => row.variant === name)!;
  const bytes = await readFile(join(assets, `${name}.webp`));
  const before = await readFile(join(originals, `${name}.webp`));
  const installed = await readFile(resolve("public/ui-art/panorama/benches", `${name}.webp`));
  if (hash(bytes) !== row.normalizedSha256 || hash(before) !== row.sourceSha256) throw Error(`Study/original hash mismatch: ${name}`);
  if (![row.sourceSha256, row.normalizedSha256].includes(hash(installed))) throw Error(`Preserving unexpected installed changes: ${name}`);
  const a = await sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== 800 || a.info.height !== 400 || b.info.width !== 800 || b.info.height !== 400) throw Error(`Invalid sprite dimensions: ${name}`);
  let intersection = 0, union = 0, lastSeatRow = -1;
  for (let y = 0; y < 400; y++) {
    let wide = 0;
    for (let x = 0; x < 800; x++) {
      const index = (y * 800 + x) * 4 + 3;
      const old = a.data[index] >= 64, next = b.data[index] >= 64;
      intersection += Number(old && next); union += Number(old || next);
      wide += Number(b.data[index] >= 128);
    }
    if (wide >= 800 * .55) lastSeatRow = y;
  }
  const silhouetteIoU = intersection / union;
  if (silhouetteIoU < .95 || lastSeatRow < 0) throw Error(`Geometry or seat row needs review: ${name}`);
  for (const index of [3, 799 * 4 + 3, 399 * 800 * 4 + 3, (800 * 400 - 1) * 4 + 3]) if (b.data[index] !== 0) throw Error(`Opaque canvas corner: ${name}`);
  framing[name] = (lastSeatRow + 1) / 4;
  checked.push({ name, sha256: row.normalizedSha256, sourceSha256: row.sourceSha256, silhouetteIoU,
    beforeBytes: before.length, afterBytes: bytes.length, seatBottomPercent: framing[name], needsWrite: hash(installed) !== row.normalizedSha256, bytes });
}
const framePath = resolve("src/features/bench-panorama/bench-framing.json");
const frameJson = JSON.stringify(framing, null, 2) + "\n";
const changed = checked.some((row) => row.needsWrite) || await readFile(framePath, "utf8") !== frameJson;
let backup: string | null = null;
if (args.includes("--install") && changed) {
  backup = join(dirname(reviewPath), `installed-before-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
  await mkdir(backup, { recursive: false });
  await copyFile(framePath, join(backup, "bench-framing.json"));
  for (const row of checked) await copyFile(resolve("public/ui-art/panorama/benches", `${row.name}.webp`), join(backup, `${row.name}.webp`));
  for (const row of checked) if (row.needsWrite) {
    const target = resolve("public/ui-art/panorama/benches", `${row.name}.webp`), temporary = `${target}.review-tmp`;
    await writeFile(temporary, row.bytes, { flag: "wx" }); await rename(temporary, target);
  }
  await writeFile(framePath, frameJson);
}
const result = { installed: args.includes("--install"), changed, backup, review: reviewPath,
  scope: "All13 source/normalized hashes, actual silhouette overlap,800x400 dimensions, transparent corners and derived seat rows checked before any write. Original assets and framing retained before installation.",
  variants: checked.map((row) => ({ name: row.name, sha256: row.sha256, sourceSha256: row.sourceSha256,
    silhouetteIoU: row.silhouetteIoU, beforeBytes: row.beforeBytes, afterBytes: row.afterBytes,
    seatBottomPercent: row.seatBottomPercent, needsWrite: row.needsWrite })) };
if (args.includes("--install") && changed) await writeFile(join(dirname(reviewPath), "installation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ installed: result.installed, changed, count: checked.length, backup, minimumSilhouetteIoU: Math.min(...checked.map((row) => row.silhouetteIoU)) }));
