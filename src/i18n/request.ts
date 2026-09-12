import "@/i18n/intl-number";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { dialectCookie, dialectLocaleTag, languageCookie, localeTags, resolveDialectEnabled, resolveLanguage } from "./config";
import { loadMessages } from "./messages";

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const acceptLanguage = headerStore.get("accept-language") ?? "";
  const language = resolveLanguage(cookieStore.get(languageCookie)?.value, acceptLanguage);
  const dialectEnabled = resolveDialectEnabled(cookieStore.get(dialectCookie)?.value);
  return {
    locale: dialectEnabled ? dialectLocaleTag(language) : localeTags[language],
    timeZone: "Europe/Zurich",
    messages: await loadMessages(language),
  };
});
