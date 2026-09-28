import { isLanguage, languageFromLocale, languages, type Language } from "@/i18n/config";

/** Reading language follows the interface initially, then can be chosen independently. */
export const essayLanguages = languages;
export type EssayLanguage = Language;
export type Essay = { title: string; byline: string; paragraphs: readonly string[] };
export const essayPath = "/gedanken/baenkli";

export function resolveEssayLanguage(value: unknown, locale = "de"): EssayLanguage {
  return isLanguage(value) ? value : languageFromLocale(locale);
}

export function essayHref(language: EssayLanguage): string {
  return `${essayPath}?lang=${language}`;
}
