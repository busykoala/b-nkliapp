import "server-only";

import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validateBenchPhoto } from "./photo-file";

const photoKey = /^benches\/(?:osm-(?:node|way)-\d+|community-[0-9a-f-]{36}|inventory-[0-9a-f]{24})\/[0-9a-f-]{36}\.(webp|jpg|png)$/;
const contentTypes = { webp: "image/webp", jpg: "image/jpeg", png: "image/png" } as const;

export async function readArchivedBenchPhoto(root: string, key: string) {
  const match = photoKey.exec(key);
  if (!match) throw new Error("Bild nicht gefunden.");
  const archive = await realpath(root);
  const file = await realpath(resolve(archive, key));
  const location = relative(archive, file);
  if (isAbsolute(location) || location === ".." || location.startsWith(`..${sep}`)) {
    throw new Error("Bild nicht gefunden.");
  }
  const bytes = await readFile(file);
  const contentType = contentTypes[match[1] as keyof typeof contentTypes];
  validateBenchPhoto(bytes, contentType);
  return { bytes, contentType };
}
