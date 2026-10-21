import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

/** Local review assets are never available in a production build. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development" || process.env.BENCHLY_PANORAMA_REVIEW !== "1") {
    return new Response(null, { status: 404 });
  }
  const value = new URL(request.url).searchParams.get("path") ?? "";
  if (!/^[a-zA-Z0-9_./-]+\.webp$/.test(value)) return new Response(null, { status: 404 });
  try {
    const root = await realpath(resolve("test-results/panorama-artist-review"));
    const path = await realpath(resolve(root, value));
    const child = relative(root, path);
    if (child.startsWith("..") || isAbsolute(child)) return new Response(null, { status: 404 });
    const bytes = await readFile(path);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "Cache-Control": "no-store",
      "ETag": `"${createHash("sha256").update(bytes).digest("hex")}"`,
    } });
  } catch { return new Response(null, { status: 404 }); }
}
