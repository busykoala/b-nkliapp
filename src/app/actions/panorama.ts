"use server";

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolvePanoramaArtifactPath } from "@/features/bench-panorama/artifact";
import { enqueuePanoramaRequest, readPanoramaArtifact } from "@/features/bench-panorama/repository";

const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_SVG_BYTES = 12 * 1024 * 1024;

export async function loadBenchPanorama(benchId: string) {
  const artifact = readPanoramaArtifact(benchId);
  const path = artifact && resolvePanoramaArtifactPath(artifact.artifactPath);
  if (!artifact || !path) return null;
  try {
    const compressed = await readFile(path);
    if (compressed.byteLength > MAX_COMPRESSED_BYTES) return null;
    const svg = gunzipSync(compressed, { maxOutputLength: MAX_SVG_BYTES });
    const text = svg.toString("utf8");
    if (!/^\s*<svg[\s>]/i.test(text) || /<(?:script|foreignObject)\b/i.test(text)) return null;
    return {
      dataUrl: `data:image/svg+xml;base64,${svg.toString("base64")}`,
      renderKey: artifact.renderKey,
    };
  } catch {
    return null;
  }
}

export async function requestBenchPanorama(benchId: string) {
  return enqueuePanoramaRequest(benchId);
}
