import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export const categories = ["urban", "forest", "waterfront", "alpine", "countryside"] as const;
export type Category = typeof categories[number];
export type Territory = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

/** Latitude-indexed ray casting, including holes, against the repository's Swiss territory. */
export function territoryPredicate(territory: Territory) {
  const polygons = (territory.type === "Polygon" ? [territory.coordinates] : territory.coordinates).map((polygon) => {
    const bands = new Map<number, number[][][]>();
    for (const ring of polygon) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]; const b = ring[i];
      if (a[1] === b[1]) continue;
      for (let band = Math.floor(Math.min(a[1], b[1]) * 100); band <= Math.floor(Math.max(a[1], b[1]) * 100); band++) {
        if (!bands.has(band)) bands.set(band, []);
        bands.get(band)!.push([a, b]);
      }
    }
    return bands;
  });
  return (latitude: number, longitude: number) => polygons.some((bands) => {
    let inside = false;
    for (const [a, b] of bands.get(Math.floor(latitude * 100)) ?? []) {
      if ((a[1] > latitude) !== (b[1] > latitude) && longitude < (b[0] - a[0]) * (latitude - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  });
}
export type Candidate = {
  id: string; latitude: number; longitude: number; name: string | null; canton: string | null;
  elevation: number | null; forest: number | null; water: number | null; buildings: number | null;
  land: string | null; category: Category;
};
export type Projection = {
  heading: number; offset: number; top: number; copyWidth: number; trackHeight: number;
  rasterHeight: number; zoom: number; viewport: { x: number; y: number; width: number; height: number };
  clip: { x: number; y: number; width: number; height: number };
};
export type Tile = {
  original: string; clean: string; capturedAt: string; projection: Projection;
  x: number; y: number; width: number; height: number;
};
export type Coverage = {
  width: number; height: number; top: number; bottom: number;
  minAltitude: number; maxAltitude: number; horizontalOverlap: number; verticalOverlap: number;
  wrapVerified: boolean; endpointsVerified: boolean;
};
export type Capture = {
  bench: Candidate; url: string; startedAt: string; completedAt: string; paintedInMs: number;
  assets: Array<{ url: string; etag: string | null; status: number; durationMs?: number }>;
  imageUrl: string; phase: string; errors: string[]; failures: string[];
  initial: string; panorama: string; thumbnail: string; annotated?: string; tiles: Tile[];
  expanded?: string; reviewNote?: string;
  coverage: Coverage; clippedViewport: boolean;
};
export type Failure = { bench: Candidate; attempt: number; at: string; error: string; screenshot?: string; diagnostics?: string };
export type Evidence = {
  benchId: string; file: string; box: { x: number; y: number; width: number; height: number };
  angles: string;
};
export type Finding = {
  id: string; title: string; severity: "high" | "medium" | "low"; confidence: "high" | "medium" | "low";
  observation: string; likelyCause: string; improvement: string; acceptance: string;
  evidence: Evidence[];
};
export type Manifest = {
  version: 1; origin: string; createdAt: string; updatedAt: string; requested: number;
  status: "incomplete" | "complete"; reviewStatus: "pending" | "reviewed";
  adjustments: string[]; captures: Capture[]; failures: Failure[]; findings: Finding[];
  excluded?: Candidate[];
  urlTemplate?: string;
};

export function categoryFor(row: Omit<Candidate, "category">): Category | null {
  if ((row.elevation ?? 0) >= 1500) return "alpine";
  if ((row.buildings ?? 0) >= 10 || row.land === "urban") return "urban";
  if (row.forest === 1 || row.land === "forest") return "forest";
  if (row.water !== null && row.water <= 100) return "waterfront";
  if (row.land === "open" || row.land === "park") return "countryside";
  return null;
}

export function distance(a: Candidate, b: Candidate) {
  const radians = Math.PI / 180;
  const lat = (a.latitude - b.latitude) * radians;
  const lon = (a.longitude - b.longitude) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Stable farthest-point sampling; successful locations across all categories repel new picks. */
export function nextCandidate(pool: Candidate[], category: Category, used: Set<string>, selected: Candidate[]) {
  let best: Candidate | undefined;
  let score = -Infinity;
  const anchor = { latitude: 46.8, longitude: 8.2 } as Candidate;
  for (const row of pool) {
    if (row.category !== category || used.has(row.id)) continue;
    const candidateScore = selected.length ? Math.min(...selected.map((other) => distance(row, other))) : distance(row, anchor);
    if (candidateScore > score || (candidateScore === score && row.id < best!.id)) {
      best = row; score = candidateScore;
    }
  }
  return best;
}

export function mod(value: number, divisor: number) { return ((value % divisor) + divisor) % divisor; }

/** Keyboard increments are 5°. Choose an exact divisor of the full circle. */
export function headingSteps(copyWidth: number, viewportWidth: number) {
  const step = [90, 60, 45, 30, 20, 15, 10, 5].find((angle) => angle / 360 * copyWidth <= viewportWidth * .7);
  if (!step) throw new Error("Viewport is too narrow for 30% overlap with 5° keyboard steps");
  return Array.from({ length: 360 / step }, (_, i) => i * step);
}

export function verticalSteps(min: number, max: number, viewportHeight: number, pixelsPerDegree: number) {
  const keyboardStep = 3 * pixelsPerDegree;
  const advance = Math.floor(viewportHeight * .7 / keyboardStep) * keyboardStep;
  if (advance <= 0) throw new Error("Viewport is too short for vertical keyboard steps");
  const result = [min];
  while (result.at(-1)! < max - .5) result.push(Math.min(max, result.at(-1)! + advance));
  return result;
}

export type Piece = { tile: number; sourceX: number; sourceY: number; width: number; height: number; left: number; top: number };

/** Assign every output pixel to an actual screenshot. Never blend away defects. */
export function stitchPlan(tiles: Pick<Tile, "x" | "y" | "width" | "height">[], width: number) {
  if (!tiles.length) throw new Error("No tiles");
  const top = Math.min(...tiles.map((tile) => tile.y));
  const bottom = Math.max(...tiles.map((tile) => tile.y + tile.height));
  const pieces: Piece[] = [];
  const rows = [...new Set(tiles.flatMap((tile) => [tile.y, tile.y + tile.height]))].sort((a, b) => a - b);
  for (let row = 0; row < rows.length - 1; row++) {
    const y = rows[row]; const endY = rows[row + 1];
    const intervals = tiles.flatMap((tile, index) => {
      if (tile.y > y || tile.y + tile.height < endY) return [];
      return [-1, 0, 1].map((wrap) => ({ tile: index, start: tile.x + wrap * width, end: tile.x + wrap * width + tile.width }));
    }).sort((a, b) => a.start - b.start || b.end - a.end);
    let cursor = 0;
    for (const segment of intervals) {
      const end = Math.min(width, segment.end);
      if (end <= cursor || segment.start >= width) continue;
      if (segment.start > cursor) throw new Error(`Horizontal coverage gap at ${cursor}, ${y}`);
      const tile = tiles[segment.tile];
      pieces.push({ tile: segment.tile, sourceX: cursor - segment.start, sourceY: y - tile.y,
        width: end - cursor, height: endY - y, left: cursor, top: y - top });
      cursor = end;
      if (cursor === width) break;
    }
    if (cursor !== width) throw new Error(`Incomplete row at ${y}: ${cursor}/${width}`);
  }
  return { width, height: bottom - top, top, bottom, pieces };
}

export async function stitch(tiles: Tile[], width: number, root: string, output: string) {
  const plan = stitchPlan(tiles, width);
  const layers = [];
  for (const piece of plan.pieces) {
    const input = await sharp(join(root, tiles[piece.tile].clean)).extract({ left: piece.sourceX, top: piece.sourceY, width: piece.width, height: piece.height }).png().toBuffer();
    layers.push({ input, left: piece.left, top: piece.top });
  }
  await sharp({ create: { width: plan.width, height: plan.height, channels: 3, background: "#ff00ff" } }).composite(layers).png().toFile(output);
  return plan;
}

export async function saveJson(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}

export async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }

export async function reusable(capture: Capture, root: string) {
  if (!capture.coverage.wrapVerified || !capture.coverage.endpointsVerified) return false;
  try {
    const plan = stitchPlan(capture.tiles, capture.coverage.width);
    const size = await sharp(join(root, capture.panorama)).metadata();
    if (size.width !== plan.width || size.height !== plan.height) return false;
    for (const file of [capture.initial, capture.thumbnail]) {
      await sharp(join(root, file)).metadata();
    }
    for (const tile of capture.tiles) for (const file of [tile.original, tile.clean]) {
      const metadata = await sharp(join(root, file)).metadata();
      if (metadata.width !== tile.width || metadata.height !== tile.height) return false;
    }
    return true;
  } catch { return false; }
}
