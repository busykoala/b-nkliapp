/** Align generated paintings to the existing transparent bench asset frames. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve("test-results/panorama-artist-review/bench-assets");
const originals = resolve("test-results/panorama-artist-review/baseline-v1/bench-assets");
const output = resolve(root, "normalized-v2");
const install = process.argv.includes("--install");
const prompts = JSON.parse(await readFile(resolve(root, "prompts.json"), "utf8"));

async function alphaBounds(path: string) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const visited = new Uint8Array(info.width * info.height);
  const queue = new Int32Array(visited.length);
  const components = [];
  for (let start = 0; start < visited.length; start++) {
    if (visited[start] || data[start * 4 + 3] < 64) continue;
    let head = 0, tail = 1, left = info.width, top = info.height, right = 0, bottom = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const point = queue[head++], x = point % info.width, y = Math.floor(point / info.width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const other of [x > 0 ? point - 1 : -1, x + 1 < info.width ? point + 1 : -1,
        y > 0 ? point - info.width : -1, y + 1 < info.height ? point + info.width : -1]) {
        if (other < 0 || visited[other] || data[other * 4 + 3] < 64) continue;
        visited[other] = 1; queue[tail++] = other;
      }
    }
    components.push({ left, top, right, bottom, count: tail });
  }
  const largest = Math.max(...components.map((component) => component.count));
  // Isolated export specks must not change the bench's scale or foot baseline.
  const bodies = components.filter((component) => component.count >= largest * .001);
  if (!bodies.length) throw new Error(`No bench body: ${path}`);
  const left = Math.min(...bodies.map((body) => body.left)), top = Math.min(...bodies.map((body) => body.top));
  const right = Math.max(...bodies.map((body) => body.right)), bottom = Math.max(...bodies.map((body) => body.bottom));
  return { width: info.width, height: info.height, left, top, bodyWidth: right - left + 1, bodyHeight: bottom - top + 1 };
}

await mkdir(output, { recursive: true });
const manifest = [];
const sheetTiles = [];
for (const entry of prompts.entries as { name: string; prompt: string }[]) {
  const generated = resolve(root, entry.name, entry.name === "wood-back" ? "pilot-v2.png" : "painted-v1.png");
  const original = resolve(originals, `${entry.name}.webp`);
  const before = await alphaBounds(original), source = await alphaBounds(generated);
  const aspectChange = (source.bodyWidth / source.bodyHeight) / (before.bodyWidth / before.bodyHeight);
  if (Math.abs(aspectChange - 1) > .08) throw new Error(`Review proportions before normalization: ${entry.name}: ${aspectChange}`);
  const crop = await sharp(generated).extract({ left: source.left, top: source.top, width: source.bodyWidth, height: source.bodyHeight })
    .resize(before.bodyWidth, before.bodyHeight, { fit: "fill" }).png().toBuffer();
  const image = await sharp({ create: { width: before.width, height: before.height, channels: 4, background: "#00000000" } })
    .composite([{ input: crop, left: before.left, top: before.top }]).webp({ quality: 92, alphaQuality: 100, smartSubsample: true, effort: 6 }).toBuffer();
  const path = resolve(output, `${entry.name}.webp`);
  await writeFile(path, image);
  const after = await alphaBounds(path);
  if (after.width !== before.width || after.height !== before.height || Math.abs(after.top + after.bodyHeight - before.top - before.bodyHeight) > 1)
    throw new Error(`Canvas or foot baseline changed: ${entry.name}`);
  const a = await sharp(original).ensureAlpha().raw().toBuffer(), b = await sharp(image).ensureAlpha().raw().toBuffer();
  let intersection = 0, union = 0;
  for (let i = 3; i < a.length; i += 4) { const x = a[i] >= 64, y = b[i] >= 64; intersection += +(x && y); union += +(x || y); }
  const silhouetteIoU = intersection / union;
  if (silhouetteIoU < .85) throw new Error(`Silhouette needs visual review: ${entry.name}: ${silhouetteIoU}`);
  manifest.push({ name: entry.name, generated, original, before, source, after, aspectChange, silhouetteIoU,
    bytes: image.length, encoding: { format: "webp", quality: 92, alphaQuality: 100 },
    sha256: createHash("sha256").update(image).digest("hex"), prompt: entry.prompt });
  const backgrounds = ["#f4efe3", "#657b58", "#18242f"];
  for (let column = 0; column < backgrounds.length; column++) {
    const preview = await sharp(image).resize(400, 200).flatten({ background: backgrounds[column] }).png().toBuffer();
    sheetTiles.push({ input: preview, left: column * 400, top: (manifest.length - 1) * 230 + 25 });
  }
  const label = Buffer.from(`<svg width="1200" height="25"><text x="12" y="18" font-family="sans-serif" font-size="16" fill="#26332e">${entry.name} · silhouette IoU ${silhouetteIoU.toFixed(3)}</text></svg>`);
  sheetTiles.push({ input: label, left: 0, top: (manifest.length - 1) * 230 });
}
await sharp({ create: { width: 1200, height: manifest.length * 230, channels: 3, background: "#f4efe3" } })
  .composite(sheetTiles).png().toFile(resolve(output, "contact.png"));
await writeFile(resolve(output, "manifest.json"), JSON.stringify({ mode: "built-in image_gen; deterministic alpha/frame normalization with sharp", entries: manifest }, null, 2) + "\n");
if (install) for (const entry of manifest) await writeFile(resolve("public/ui-art/panorama/benches", `${entry.name}.webp`), await readFile(resolve(output, `${entry.name}.webp`)));
console.log(JSON.stringify({ output, count: manifest.length, installed: install, minimumSilhouetteIoU: Math.min(...manifest.map((entry) => entry.silhouetteIoU)) }));
