import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.resolve("maplibre-gl/package.json")));
const { version } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const destination = new URL(`../public/maplibre/${version}/`, import.meta.url);
await mkdir(destination, { recursive: true });
// The module worker imports its sibling shared module; both must be served intact.
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  await copyFile(join(packageRoot, "dist", name), new URL(name, destination));
}
await copyFile(join(packageRoot, "LICENSE.txt"), new URL("LICENSE.txt", destination));
