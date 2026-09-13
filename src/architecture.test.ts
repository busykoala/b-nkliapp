import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

describe("application boundaries", () => {
  it("uses Server Actions except for immutable media streaming", () => {
    const handlers = filesBelow(join(sourceRoot, "app"))
      .filter((path) => /^route\.(?:js|jsx|ts|tsx)$/.test(path.split("/").at(-1) ?? ""))
      .map((path) => relative(sourceRoot, path));

    expect(handlers).toEqual(["app/media/panorama/[renderKey]/route.ts"]);
  });

  it("keeps shared libraries independent of UI and application features", () => {
    const invalidImports = filesBelow(join(sourceRoot, "lib"))
      .filter((path) => /\.[jt]sx?$/.test(path))
      .flatMap((path) => {
        const matches = readFileSync(path, "utf8").matchAll(/from\s+["']@\/(app|components|features)\//g);
        return [...matches].map((match) => `${relative(sourceRoot, path)} -> ${match[1]}`);
      });

    expect(invalidImports).toEqual([]);
  });
});
