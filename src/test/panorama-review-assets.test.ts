import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "../app/dev/panorama-review/assets/route";

describe("local panorama review image confinement", () => {
  let local: string, outside: string, picture: Buffer;
  const request = (path: string) => new Request(`http://localhost/dev/panorama-review/assets?path=${encodeURIComponent(path)}`);
  beforeAll(async () => {
    const root = join(process.cwd(), "test-results/panorama-artist-review");
    await mkdir(root, { recursive: true });
    local = await mkdtemp(join(root, "asset-test-"));
    outside = await mkdtemp(join(tmpdir(), "benchly-review-assets-"));
    picture = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#467a68" } }).webp().toBuffer();
    await writeFile(join(local, "painting.webp"), picture);
    await writeFile(join(outside, "outside.webp"), picture);
    await symlink(join(outside, "outside.webp"), join(local, "escape.webp"));
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { await rm(local, { recursive: true }); await rm(outside, { recursive: true }); });

  it("denies production even with the review flag enabled", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BENCHLY_PANORAMA_REVIEW", "1");
    expect((await GET(request(`${basename(local)}/painting.webp`))).status).toBe(404);
  });
  it("requires explicit opt-in in development", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("BENCHLY_PANORAMA_REVIEW", "");
    expect((await GET(request(`${basename(local)}/painting.webp`))).status).toBe(404);
  });
  it("streams only confined images and rejects traversal and escaping symlinks", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("BENCHLY_PANORAMA_REVIEW", "1");
    const response = await GET(request(`${basename(local)}/painting.webp`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(picture);
    for (const value of [join(outside, "outside.webp"), `${basename(local)}/escape.webp`, "../../README.md", "missing.webp"])
      expect((await GET(request(value))).status).toBe(404);
  });
});
