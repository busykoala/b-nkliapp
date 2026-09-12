import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { languagePreferenceFromLocale, languages, resolveLanguage, resolveLanguagePreference } from "./config";
import { propertyValue, compassDirection } from "./bench-labels";
import { poemGroupSizes } from "@/lib/scene-poetry";
import { testTranslator } from "@/test/translations";

function catalog(language: string) {
  const directory = join(process.cwd(), "src/i18n/messages", language);
  const flat: Record<string, string> = {};
  function visit(value: unknown, path: string) {
    if (typeof value === "string") { flat[path] = value; return; }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid message group: ${path}`);
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
  }
  for (const name of readdirSync(directory).filter(name => name.endsWith(".json"))) {
    visit(JSON.parse(readFileSync(join(directory, name), "utf8")), name.slice(0, -5));
  }
  return flat;
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

describe("language selection", () => {
  it("remembers explicit choices ahead of browser preferences", () => {
    expect(resolveLanguage("rm", "fr-CH,de;q=0.8")).toBe("rm");
    expect(resolveLanguage("invalid", "it-CH,it;q=0.8")).toBe("it");
  });
  it("respects quality weights, exclusions, regional tags and unsupported browsers", () => {
    expect(resolveLanguage(undefined, "de;q=0.4,fr-CH;q=0.9,it;q=0.5")).toBe("fr");
    expect(resolveLanguage(undefined, "fr;q=0,rm-CH;q=0.7")).toBe("rm");
    expect(resolveLanguage(undefined, "de;q=no,fr;q=2,it;q=0.4")).toBe("it");
    expect(resolveLanguage(undefined, "en-US,en;q=0.9")).toBe("de");
    expect(resolveLanguage()).toBe("de");
  });
  it("treats local dialect as an explicit fifth choice without browser auto-detection", () => {
    expect(resolveLanguagePreference("dialect", "fr-CH")).toBe("dialect");
    expect(resolveLanguagePreference(undefined, "fr-CH")).toBe("fr");
    expect(languagePreferenceFromLocale("fr-CH-x-dialect")).toBe("dialect");
  });
});

describe("translation catalogs", () => {
  const reference = catalog("de");
  for (const language of languages) {
    it(`${language} has every message with valid ICU syntax and matching arguments`, () => {
      const messages = catalog(language);
      expect(Object.keys(messages).sort()).toEqual(Object.keys(reference).sort());
      for (const [key, value] of Object.entries(messages)) {
        expect(value.trim(), key).not.toBe("");
        expect(argumentsOf(parse(value)), key).toEqual(argumentsOf(parse(reference[key])));
      }
      for (const [group, size] of Object.entries(poemGroupSizes)) {
        for (let index = 1; index <= size; index++) expect(messages[`poetry.${group}.v${index}`]).toBeTruthy();
      }
    });
  }
  it("renders plurals and translates legacy values without changing the data", () => {
    const t = testTranslator("fr");
    expect(t("bench.panel.missing", {count: 1})).toBe("Une caractéristique n’a pas encore été relevée.");
    expect(t("bench.panel.missing", {count: 3})).toBe("3 caractéristiques n’ont pas encore été relevées.");
    const property = {key: "backrest" as const, value: "Nein"};
    expect(propertyValue(property, t)).toBe("Non");
    expect(property.value).toBe("Nein");
    expect(compassDirection(90, t)).toBe("E · 90°");
    expect(testTranslator("rm")("bench.details.weather")).toBe("Aura");
  });
});

it("explains every public data source in all four languages", async () => {
  const { dataCatalog } = await import("@/data/catalog");
  const { sourceExplanations } = await import("@/data/source-explanations");
  for (const source of dataCatalog.sources.filter((source) => source.lifecycle !== "research-only")) {
    const explanation = sourceExplanations[source.id];
    expect(explanation, source.id).toBeDefined();
    for (const language of languages) {
      const messages = catalog(language);
      expect(messages[explanation!.summary], `${language}: ${source.id}`).toBeTruthy();
      expect(messages[explanation!.description], `${language}: ${source.id}`).toBeTruthy();
    }
  }
});
