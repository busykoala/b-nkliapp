import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePeopleFreePhoto } from "./moderation";

afterEach(() => { vi.unstubAllGlobals(); delete process.env.INFERENCE_API_KEY; });

function response(verdict: object) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }),
    { status: 200, headers: { "content-type": "application/json" } });
}

describe("bench photo people check", () => {
  it("accepts a confident people-free image", async () => {
    process.env.INFERENCE_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => response({ people_detected: false, confidence: .94 })));
    await expect(ensurePeopleFreePhoto(new Uint8Array([1, 2, 3]), "image/webp")).resolves.toBeUndefined();
  });

  it("rejects people with an understandable message", async () => {
    process.env.INFERENCE_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => response({ people_detected: true, confidence: .98 })));
    await expect(ensurePeopleFreePhoto(new Uint8Array([1]), "image/webp")).rejects.toThrow("photos.server.people");
  });

  it("fails closed when the result is uncertain or the key is unavailable", async () => {
    await expect(ensurePeopleFreePhoto(new Uint8Array([1]), "image/webp")).rejects.toThrow("photos.server.checkUnavailable");
    process.env.INFERENCE_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => response({ people_detected: false, confidence: .5 })));
    await expect(ensurePeopleFreePhoto(new Uint8Array([1]), "image/webp")).rejects.toThrow("photos.server.uncertain");
  });
});
