import { isAbsolute, relative, resolve } from "node:path";

export function resolvePanoramaArtifactPath(
  artifactPath: string,
  cacheRoot = process.env.PANORAMA_CACHE_DIR ?? "./data/panorama-cache-v1",
) {
  if (!artifactPath.endsWith(".svg.gz")) return null;
  const root = resolve(cacheRoot);
  const candidate = resolve(artifactPath);
  const child = relative(root, candidate);
  if (!child || child.startsWith("..") || isAbsolute(child)) return null;
  return candidate;
}
