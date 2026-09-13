import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { DIALECT_AREAS, DIALECT_PACK_MANIFEST } from "./dialects/registry.generated";

function flatten(value: unknown, prefix = "", result: Record<string, string> = {}) {
  if (typeof value === "string") { result[prefix] = value; return result; }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid message node at ${prefix}`);
  for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, result);
  return result;
}

function argumentsOf(elements: MessageFormatElement[], found = new Set<string>()): string[] {
  for (const element of elements) {
    if (element.type !== TYPE.literal && element.type !== TYPE.pound) found.add(`${element.type}:${element.value}`);
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      for (const option of Object.values(element.options)) argumentsOf(option.value, found);
    } else if (element.type === TYPE.tag) argumentsOf(element.children, found);
  }
  return [...found].sort();
}

function standard(language: string) {
  const namespaces = ["account", "avatar", "bench", "common", "community", "knowledge", "photos", "submission"];
  return flatten(Object.fromEntries(namespaces.map((namespace) => [namespace, JSON.parse(readFileSync(join(process.cwd(), `src/i18n/messages/${language}/${namespace}.json`), "utf8"))])));
}

describe("generated dialect data", () => {
  it("contains 38 stable packs and all 140 research areas", () => {
    expect(DIALECT_PACK_MANIFEST).toHaveLength(38);
    expect(DIALECT_AREAS).toHaveLength(140);
    expect(new Set(DIALECT_PACK_MANIFEST.map((pack) => pack.id)).size).toBe(38);
    expect(new Set(DIALECT_AREAS.map((area) => area.id)).size).toBe(140);
  });

  it("keeps every area attached to a complete pack", () => {
    const ids = new Set(DIALECT_PACK_MANIFEST.map((pack) => pack.id));
    for (const area of DIALECT_AREAS) expect(ids.has(area.parentPackId), area.id).toBe(true);
  });

  it("publishes stable local variants without review-state gates", () => {
    const runtimeRegistry = JSON.stringify({ packs: DIALECT_PACK_MANIFEST, areas: DIALECT_AREAS });
    expect(runtimeRegistry).not.toContain("nativeReviewed");
    expect(runtimeRegistry).not.toContain("publicationReady");
    const variantIds = DIALECT_AREAS.flatMap((area) => area.variants.map((variant) => `${area.id}:${variant.id}`));
    expect(variantIds.length).toBeGreaterThan(20);
    expect(new Set(variantIds).size).toBe(variantIds.length);
  });

  for (const pack of DIALECT_PACK_MANIFEST) {
    it(`${pack.id} has every overlay message with matching ICU arguments`, () => {
      const reference = standard(pack.language);
      const file = join(process.cwd(), `src/i18n/dialects/generated/${pack.id}.json`);
      const messages = flatten(JSON.parse(readFileSync(file, "utf8")));
      expect(Object.keys(messages).sort()).toEqual(Object.keys(reference).sort());
      for (const [key, value] of Object.entries(messages)) {
        expect(value, key).toBe(value.normalize("NFC"));
        expect(value.trim(), key).not.toBe("");
        expect(argumentsOf(parse(value)), key).toEqual(argumentsOf(parse(reference[key])));
      }
    });
  }

  it("has no stale generated packs", () => {
    const files = readdirSync(join(process.cwd(), "src/i18n/dialects/generated")).filter((name) => name.endsWith(".json"));
    expect(files.sort()).toEqual(DIALECT_PACK_MANIFEST.map((pack) => `${pack.id}.json`).sort());
  });
});
