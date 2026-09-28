import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePeopleFreePhoto } from "./moderation";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.INFERENCE_API_KEY; });

function response(verdict: object) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }),
    { status: 200, headers: { "content-type": "application/json" } });
}

describe("bench photo people check", () => {
  it("accepts a confident people-free image", async () => {
    process.env.INFERENCE_API_KEY = "test";
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => response({ people_detected: false, confidence: .94 })));
    await expect(ensurePeopleFreePhoto(new Uint8Array([1, 2, 3]), "image/webp")).resolves.toBeUndefined();
    expect(timeout).toHaveBeenCalledWith(90_000);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.body).toContain('"max_tokens":256');
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
  it("accepts complete JSON and fenced JSON without using hidden reasoning", async () => {
    process.env.INFERENCE_API_KEY = "test";
    const content = '```json\n{"people_detected":false,"confidence":0.94}\n```';
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] })));
    await expect(ensurePeopleFreePhoto(new Uint8Array([1]), "image/jpeg")).resolves.toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.body).toContain('"enable_thinking":false');
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ finish_reason: "length", message: { content } }] })));
    await expect(ensurePeopleFreePhoto(new Uint8Array([1]), "image/jpeg")).rejects.toThrow("photos.server.checkUnavailable");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { reasoning_content: content } }] })));
    await expect(ensurePeopleFreePhoto(new Uint8Array([1]), "image/jpeg")).rejects.toThrow("photos.server.checkUnavailable");
  });

  it("reports unavailable and malformed checks instead of silently accepting them", async () => {
    process.env.INFERENCE_API_KEY = "test";
    for (const payload of [{}, { choices: [{ message: { content: "not JSON" } }] }]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
      await expect(ensurePeopleFreePhoto(new Uint8Array([1]), "image/jpeg")).rejects.toThrow("photos.server.checkUnavailable");
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(ensurePeopleFreePhoto(new Uint8Array([1]), "image/jpeg")).rejects.toThrow("photos.server.checkUnavailable");
  });

});
