import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { languages } from "@/i18n/config";
import { essays, readingLabels } from "./content";
import { essayHref, essayLanguages, resolveEssayLanguage } from "./model";

describe("Urs’s essay", () => {
  it("preserves the supplied German original, including punctuation and spacing", () => {
    // Freeze the supplied wording, not a second copy that could drift with the content.
    // The author's &#x20; paragraph endings are represented as plain spaces.
    const text = [essays.de.title, ...essays.de.paragraphs].join("\n");
    expect(createHash("sha256").update(text).digest("hex")).toBe("6106b031cdb584ef8b99149e67f0550ae8e06531054a9fa24bf207ca42ee7238");
    expect(essays.de.byline).toBe("Von Urs");
  });

  it("offers exactly the four app languages and distinguishes AI translations", () => {
    expect(essayLanguages).toEqual(languages);
    expect(Object.keys(essays)).toEqual(["de", "fr", "it", "rm"]);
    for (const language of languages) {
      const essay = essays[language];
      expect(essay.paragraphs).toHaveLength(5);
      expect(essay.paragraphs.every((text) => text.trim().length > 100)).toBe(true);
      expect(essay.byline).toContain("Urs");
      if (language !== "de") expect(essay.byline).toContain("IA");
      expect(Object.keys(readingLabels[language])).toEqual(Object.keys(readingLabels.de));
    }
  });

  it("uses explicit reading language before interface language without adding English", () => {
    expect(resolveEssayLanguage("it", "fr-CH")).toBe("it");
    expect(resolveEssayLanguage(undefined, "rm-CH-x-dialect")).toBe("rm");
    expect(resolveEssayLanguage("en", "fr-CH")).toBe("fr");
    expect(resolveEssayLanguage(["fr", "de"], "it-CH")).toBe("it");
    expect(resolveEssayLanguage("<script>", "en-US")).toBe("de");
    expect(essayHref("rm")).toBe("/gedanken/baenkli?lang=rm");
  });
});
