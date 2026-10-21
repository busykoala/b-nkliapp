import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { categoryFor, headingSteps, mod, nextCandidate, reusable, stitch, stitchPlan, territoryPredicate, verticalSteps,
  type Candidate, type Capture, type Manifest, type Tile } from "../../scripts/panorama-review/core";
import { escapeHtml, validateFindings } from "../../scripts/panorama-review/report";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
const bench = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({ id, latitude: 47, longitude: 8,
  category: "countryside", name: null, canton: null, elevation: null, forest: null, water: null, buildings: null, land: null, ...overrides });

describe("panorama review coverage", () => {
  it("covers a complete turn with keyboard-reachable headings and >=30% overlap", () => {
    for (const width of [390, 884, 1440]) {
      const headings = headingSteps(4896, width);
      const increment = headings[1];
      expect(increment % 5).toBe(0);
      expect(360 % increment).toBe(0);
      expect(increment / 360 * 4896 / width).toBeLessThanOrEqual(.7);
      expect(headings.at(-1)! + increment).toBe(360);
    }
    expect(() => headingSteps(4896, 10)).toThrow();
  });

  it("includes both vertical endpoints without losing overlap", () => {
    const rows = verticalSteps(0, 2000, 884, 13.6);
    expect(rows[0]).toBe(0); expect(rows.at(-1)).toBe(2000);
    rows.slice(1).forEach((row, i) => expect((row - rows[i]) / 884).toBeLessThanOrEqual(.7));
  });

  it("rejects horizontal and vertical gaps", () => {
    expect(() => stitchPlan([{ x: 0, y: 0, width: 50, height: 90 }], 360)).toThrow(/gap|Incomplete/);
    expect(() => stitchPlan([{ x: 0, y: 0, width: 360, height: 20 }, { x: 0, y: 30, width: 360, height: 20 }], 360)).toThrow();
  });

  it("stitches angular markers pixel-exactly, retaining a deliberate north seam defect", async () => {
    const root = await mkdtemp(join(tmpdir(), "panorama-review-unit-")); directories.push(root);
    const width = 360; const height = 160;
    const expected = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      expected[i] = x === 0 ? 255 : x % 256;
      expected[i + 1] = y;
      expected[i + 2] = x === 359 ? 255 : Math.floor(x / 45) * 20;
    }
    const tiles: Tile[] = [];
    for (const y of [0, 70]) for (const x of [0, 90, 180, 270]) {
      const pixels = Buffer.alloc(160 * 90 * 3);
      for (let sy = 0; sy < 90; sy++) for (let sx = 0; sx < 160; sx++) {
        const from = ((y + sy) * width + mod(x + sx, width)) * 3;
        expected.copy(pixels, (sy * 160 + sx) * 3, from, from + 3);
      }
      const file = `tile-${x}-${y}.png`;
      await sharp(pixels, { raw: { width: 160, height: 90, channels: 3 } }).png().toFile(join(root, file));
      tiles.push({ x, y, width: 160, height: 90, clean: file, original: file, capturedAt: "fixture", projection: {} as Tile["projection"] });
    }
    const plan = await stitch(tiles, width, root, join(root, "panorama.png"));
    expect([plan.width, plan.height]).toEqual([width, height]);
    expect(await sharp(join(root, "panorama.png")).removeAlpha().raw().toBuffer()).toEqual(expected);
    const capture = { tiles, panorama: "panorama.png", initial: tiles[0].original, thumbnail: tiles[1].original,
      coverage: { width, wrapVerified: true, endpointsVerified: true } } as Capture;
    expect(await reusable(capture, root)).toBe(true);
    await rm(join(root, tiles[2].clean));
    expect(await reusable(capture, root)).toBe(false);
    expect(await reusable({ ...capture, coverage: { ...capture.coverage, wrapVerified: false } }, root)).toBe(false);
  });
});

describe("sample and review evidence", () => {
  it("excludes cross-border points and holes, including multipolygon territory", () => {
    const contains = territoryPredicate({ type: "MultiPolygon", coordinates: [
      [[[6, 46], [9, 46], [9, 48], [6, 48], [6, 46]], [[7, 47], [8, 47], [8, 47.5], [7, 47.5], [7, 47]]],
      [[[10, 46], [11, 46], [11, 47], [10, 47], [10, 46]]],
    ] });
    expect(contains(46.5, 6.5)).toBe(true);
    expect(contains(47.2, 7.5)).toBe(false);
    expect(contains(46.5, 5.8)).toBe(false);
    expect(contains(46.5, 10.5)).toBe(true);
  });
  it("classifies using explicit priority and handles missing metadata", () => {
    expect(categoryFor(bench("a", { elevation: 1600, forest: 1 }))).toBe("alpine");
    expect(categoryFor(bench("b", { buildings: 12, water: 1 }))).toBe("urban");
    expect(categoryFor(bench("c", { forest: 1 }))).toBe("forest");
    expect(categoryFor(bench("d", { water: 30 }))).toBe("waterfront");
    expect(categoryFor(bench("e"))).toBeNull();
    expect(categoryFor(bench("f", { land: "open" }))).toBe("countryside");
    expect(categoryFor(bench("g", { land: "urban" }))).toBe("urban");
  });

  it("replaces failed locations, favors separation, and resolves ties by ID", () => {
    const pool = [bench("b", { longitude: 6 }), bench("a", { longitude: 6 }), bench("c", { longitude: 9 })];
    const selected = [bench("chosen", { longitude: 9.1 })];
    expect(nextCandidate(pool, "countryside", new Set(), selected)?.id).toBe("a");
    expect(nextCandidate(pool, "countryside", new Set(["a"]), selected)?.id).toBe("b");
    expect(nextCandidate(pool, "countryside", new Set(["a", "b"]), selected)?.id).toBe("c");
  });

  it("escapes report content and rejects unsupported findings", () => {
    expect(escapeHtml('<script x="&">')).toBe("&lt;script x=&quot;&amp;&quot;&gt;");
    const manifest = { captures: [] } as unknown as Manifest;
    expect(() => validateFindings(manifest, [{ id: "F1", title: "test", severity: "high", confidence: "high", observation: "x", likelyCause: "x", improvement: "x", acceptance: "x", evidence: [{ benchId: "missing", file: "../outside.png", angles: "0°", box: { x: 0, y: 0, width: 10, height: 10 } }] }])).toThrow(/Unknown bench/);
  });
});
