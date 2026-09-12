import "@/i18n/intl-number";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { dialectLocaleTag, fallbackLanguageCookie, languageCookie, localeTags, resolveLanguage, resolveLanguagePreference } from "./config";
import { loadMessages } from "./messages";

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const acceptLanguage = headerStore.get("accept-language") ?? "";
  const preference = resolveLanguagePreference(cookieStore.get(languageCookie)?.value, acceptLanguage);
  const language = preference === "dialect"
    ? resolveLanguage(cookieStore.get(fallbackLanguageCookie)?.value, acceptLanguage)
    : preference;
  return {
    locale: preference === "dialect" ? dialectLocaleTag(language) : localeTags[language],
    timeZone: "Europe/Zurich",
    messages: await loadMessages(language),
  };
});
