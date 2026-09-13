import { readFile } from "node:fs/promises";
import { resolvePanoramaArtifactPath } from "@/features/bench-panorama/artifact";
import { readArtifactByKey } from "@/features/bench-panorama/repository";

export async function GET(request: Request, context: { params: Promise<{ renderKey: string }> }) {
  const { renderKey } = await context.params;
  const artifact = readArtifactByKey(renderKey);
  const path = artifact && resolvePanoramaArtifactPath(artifact.artifactPath);
  if (!artifact || !path) return new Response("Not found", { status: 404 });
  const etag = `"${artifact.etag}"`;
  const cacheHeaders = { "Cache-Control": "public, max-age=31536000, immutable", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: cacheHeaders });
  try {
    const bytes = await readFile(path);
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.byteLength),
        ...cacheHeaders,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
