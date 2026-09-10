import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { localeTags, type Language } from "@/i18n/config";
import { testMessages } from "./translations";

export function renderTranslated(children: ReactNode, language: Language = "de") {
  return renderToStaticMarkup(<NextIntlClientProvider locale={localeTags[language]} messages={testMessages(language)} timeZone="Europe/Zurich">{children}</NextIntlClientProvider>);
}
