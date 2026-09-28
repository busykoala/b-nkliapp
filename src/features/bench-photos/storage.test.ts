import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { storeBenchPhoto } from "./storage";

const transport = vi.hoisted(() => ({ options: vi.fn(), send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(readonly input: Record<string, unknown>) {} }
  return { S3Client: class {
    constructor(options: unknown) { transport.options(options); }
    send(command: unknown) { return transport.send(command); }
  }, PutObjectCommand: Command, GetObjectCommand: Command, DeleteObjectCommand: Command };
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); transport.options.mockReset(); transport.send.mockReset(); });

function configure() {
  vi.stubEnv("BENCHLY_PHOTO_ARCHIVE_PATH", ""); vi.stubEnv("BENCHLY_PHOTO_LOCAL_PATH", "");
  vi.stubEnv("BENCHLY_PHOTO_S3_ENDPOINT", "https://storage.invalid");
  vi.stubEnv("BENCHLY_PHOTO_BUCKET", "test"); vi.stubEnv("BENCHLY_PHOTO_ACCESS_KEY", "test");
  vi.stubEnv("BENCHLY_PHOTO_SECRET_KEY", "not-a-real-secret");
}
it("uses Garage-compatible checksum settings and explicitly checks uploaded bytes", async () => {
  configure(); transport.send.mockResolvedValue({});
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  await expect(storeBenchPhoto("benches/osm-node-101/test.jpg", bytes, "image/jpeg")).resolves.toMatch(/^garage:/);
  expect(transport.options).toHaveBeenCalledWith(expect.objectContaining({
    forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  }));
  expect(transport.send.mock.calls[0][0].input).toMatchObject({
    Body: bytes, ContentLength: 4, ContentType: "image/jpeg", ContentMD5: createHash("md5").update(bytes).digest("base64"),
  });
});
it("returns a useful storage error without leaking the service response", async () => {
  configure(); const log = vi.spyOn(console, "error").mockImplementation(() => {});
  transport.send.mockRejectedValue(new Error("private endpoint, signature and credentials"));
  await expect(storeBenchPhoto("test.jpg", new Uint8Array([1]), "image/jpeg")).rejects.toThrow("photos.server.storageUnavailable");
  expect(log).toHaveBeenCalledWith("bench-photo-storage", { stage: "put", error: "Error" });
});
it("never writes from an archived production snapshot", async () => {
  configure(); vi.stubEnv("BENCHLY_PHOTO_ARCHIVE_PATH", "/snapshot");
  await expect(storeBenchPhoto("test.jpg", new Uint8Array([1]), "image/jpeg")).rejects.toThrow("photos.server.storageUnavailable");
  expect(transport.send).not.toHaveBeenCalled();
});
