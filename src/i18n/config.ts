export const languages = ["de", "fr", "it", "rm"] as const;
export type Language = (typeof languages)[number];
export const languagePreferences = [...languages, "dialect"] as const;
export type LanguagePreference = (typeof languagePreferences)[number];
export const defaultLanguage: Language = "de";
export const languageCookie = "benchly_language";
export const fallbackLanguageCookie = "benchly_language_fallback";
export const languageNames: Record<Language, string> = { de: "Deutsch", fr: "Français", it: "Italiano", rm: "Rumantsch" };
export const localeTags: Record<Language, string> = { de: "de-CH", fr: "fr-CH", it: "it-CH", rm: "rm-CH" };

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && languages.includes(value as Language);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return typeof value === "string" && languagePreferences.includes(value as LanguagePreference);
}

export function isDialectLocale(locale: string) {
  return locale.toLowerCase().endsWith("-x-dialect");
}

export function languagePreferenceFromLocale(locale: string): LanguagePreference {
  return isDialectLocale(locale) ? "dialect" : languageFromLocale(locale);
}

export function dialectLocaleTag(language: Language) {
  return `${localeTags[language]}-x-dialect`;
}

export function languageFromLocale(locale: string): Language {
  const language = locale.toLowerCase().split("-")[0];
  return isLanguage(language) ? language : defaultLanguage;
}

/** An explicit choice wins; otherwise respect the browser's ordered, non-zero preferences. */
export function resolveLanguage(saved?: string, acceptLanguage = ""): Language {
  if (isLanguage(saved)) return saved;
  const preferences = acceptLanguage.split(",").map((entry, index) => {
    const [tag, ...options] = entry.trim().split(";");
    const quality = options.find((option) => option.trim().startsWith("q="));
    return { language: tag.toLowerCase().split("-")[0], quality: quality ? Number(quality.trim().slice(2)) : 1, index };
  }).filter(({ quality }) => Number.isFinite(quality) && quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  const preferred = preferences.find(({ language }) => isLanguage(language))?.language;
  return isLanguage(preferred) ? preferred : defaultLanguage;
}

/** Dialect/local is only enabled deliberately; browsers still resolve to a standard language. */
export function resolveLanguagePreference(saved?: string, acceptLanguage = ""): LanguagePreference {
  return saved === "dialect" ? "dialect" : resolveLanguage(saved, acceptLanguage);
}
