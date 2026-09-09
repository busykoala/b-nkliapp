import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteBenchPhoto, readBenchPhoto, storeBenchPhoto } from "./storage";

const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = send; }, GetObjectCommand: class {}, PutObjectCommand: class {}, DeleteObjectCommand: class {},
}));

const key = "benches/osm-node-42/12345678-1234-1234-1234-123456789abc.jpg";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "benchly-photo-archive-"));
  vi.stubEnv("BENCHLY_PHOTO_ARCHIVE_PATH", root);
  send.mockClear();
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

async function save(bytes = jpeg) {
  const file = join(root, key);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return file;
}

describe("local photo archive", () => {
  it("displays an existing production object without S3 credentials", async () => {
    await save();
    const photo = await readBenchPhoto(`garage:${key}`);
    expect(photo?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(photo!.bytes)).toEqual(jpeg);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects traversal and symlinks outside the archive", async () => {
    await expect(readBenchPhoto("garage:../../secret.jpg")).rejects.toThrow("Bild nicht gefunden");
    const outside = await mkdtemp(join(tmpdir(), "benchly-photo-outside-"));
    try {
      await writeFile(join(outside, "photo.jpg"), jpeg);
      const file = await save();
      await rm(file); await symlink(join(outside, "photo.jpg"), file);
      await expect(readBenchPhoto(`garage:${key}`)).rejects.toThrow("Bild nicht gefunden");
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it("rejects corrupted files and never falls back to production for a missing object", async () => {
    await expect(readBenchPhoto(`garage:${key}`)).rejects.toThrow();
    await save(new Uint8Array([1, 2, 3]));
    await expect(readBenchPhoto(`garage:${key}`)).rejects.toThrow("Bildformat");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the normal S3 reader when no archive is configured", async () => {
    vi.stubEnv("BENCHLY_PHOTO_ARCHIVE_PATH", "");
    vi.stubEnv("BENCHLY_PHOTO_S3_ENDPOINT", "https://storage.example");
    vi.stubEnv("BENCHLY_PHOTO_BUCKET", "photos");
    vi.stubEnv("BENCHLY_PHOTO_ACCESS_KEY", "test");
    vi.stubEnv("BENCHLY_PHOTO_SECRET_KEY", "test");
    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => jpeg }, ContentType: "image/jpeg" });
    await expect(readBenchPhoto(`garage:${key}`)).resolves.toEqual({ bytes: jpeg, contentType: "image/jpeg" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("prevents archived snapshots from writing to the production bucket", async () => {
    await expect(storeBenchPhoto(key, jpeg, "image/jpeg")).rejects.toThrow("Pause");
    await expect(deleteBenchPhoto(`garage:${key}`)).rejects.toThrow("Pause");
    expect(send).not.toHaveBeenCalled();
  });
});
