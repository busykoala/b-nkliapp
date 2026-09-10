import { AsyncLocalStorage } from "node:async_hooks";
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from "next-intl";
import { testMessages } from "./translations";
import type { Messages } from "@/i18n/messages";
import type { Language } from "@/i18n/config";

const languageContext = new AsyncLocalStorage<Language>();
/** Model independent request locales without Next's request runtime or shared globals. */
export function withTestLanguage<T>(language: Language, operation: () => T): T {
  return languageContext.run(language, operation);
}
export async function getLocale() { return languageContext.getStore() ?? "de"; }
export async function getTranslations(namespace?: NamespaceKeys<Messages, NestedKeyOf<Messages>>) {
  const locale = await getLocale();
  return createTranslator({ locale, messages: testMessages(locale), namespace });
}
