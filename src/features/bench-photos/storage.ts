import "server-only";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function config() {
  const endpoint = process.env.BENCHLY_PHOTO_S3_ENDPOINT;
  const bucket = process.env.BENCHLY_PHOTO_BUCKET;
  const accessKeyId = process.env.BENCHLY_PHOTO_ACCESS_KEY;
  const secretAccessKey = process.env.BENCHLY_PHOTO_SECRET_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Der Foto-Speicher macht gerade Pause.");
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

function client(settings: ReturnType<typeof config>) {
  return new S3Client({ endpoint: settings.endpoint, region: "garage", forcePathStyle: true,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } });
}

export async function storeBenchPhoto(key: string, body: Uint8Array, contentType: string) {
  const settings = config();
  await client(settings).send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: body, ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable" }));
  return `garage:${key}`;
}

export async function deleteBenchPhoto(url: string) {
  if (!url.startsWith("garage:")) return;
  const settings = config();
  await client(settings).send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: url.slice(7) }));
}

export async function readBenchPhoto(url: string) {
  if (!url.startsWith("garage:")) return null;
  const settings = config();
  const object = await client(settings).send(new GetObjectCommand({ Bucket: settings.bucket, Key: url.slice(7) }));
  if (!object.Body) return null;
  return { bytes: await object.Body.transformToByteArray(), contentType: object.ContentType ?? "image/webp" };
}
