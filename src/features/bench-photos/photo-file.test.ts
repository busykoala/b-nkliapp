import { describe, expect, it } from "vitest";
import { validateBenchPhoto } from "./photo-file";

describe("bench photo files", () => {
  it("recognises the supported formats from their contents", () => {
    expect(validateBenchPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg").extension).toBe("jpg");
    expect(validateBenchPhoto(new TextEncoder().encode("RIFF....WEBP"), "image/webp").extension).toBe("webp");
    expect(validateBenchPhoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png").extension).toBe("png");
  });

  it("does not trust a browser-provided MIME type", () => {
    expect(() => validateBenchPhoto(new TextEncoder().encode("not really an image"), "image/webp"))
      .toThrow("photos.server.formatMismatch");
    expect(() => validateBenchPhoto(new Uint8Array([0xff, 0xd8, 0xff]), "image/gif"))
      .toThrow("photos.server.format");
  });
});
