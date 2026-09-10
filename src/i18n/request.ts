import "@/i18n/intl-number";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { languageCookie, localeTags, resolveLanguage } from "./config";
import { loadMessages } from "./messages";

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const language = resolveLanguage(cookieStore.get(languageCookie)?.value, headerStore.get("accept-language") ?? "");
  return { locale: localeTags[language], timeZone: "Europe/Zurich", messages: await loadMessages(language) };
});
