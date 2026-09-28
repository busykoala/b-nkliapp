"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { NextIntlClientProvider, useLocale, useMessages } from "next-intl";
import { isDialectLocale } from "@/i18n/config";
import type { LocalBenchProfile } from "@/lib/dialect";
import type { BenchDetail } from "@/lib/types";

type LocalBenchLanguageState = { active: false; profile: null } | { active: true; profile: LocalBenchProfile };

const LocalBenchLanguageContext = createContext<LocalBenchLanguageState>({ active: false, profile: null });

export function LocalBenchLanguageProvider({ bench, children }: { bench: BenchDetail; children: ReactNode }) {
  const rootLocale = useLocale();
  const currentMessages = useMessages();
  const presentation = bench.dialectPresentation;
  const active = isDialectLocale(rootLocale) && Boolean(presentation);
  const profile = useMemo<LocalBenchProfile | null>(() => presentation ? ({
    region: presentation.resolution.areaId ?? presentation.voice.id,
    regionLabel: presentation.voice.label,
    voiceId: presentation.voice.id,
    languageTag: presentation.voice.languageTag,
    formatLocale: presentation.voice.formatLocale,
    uiLanguage: presentation.voice.language,
  }) : null, [presentation]);
  const messages = useMemo(() => presentation ? ({ ...currentMessages, ...presentation.messages }) : currentMessages, [currentMessages, presentation]);
  const state: LocalBenchLanguageState = active && profile ? { active: true, profile } : { active: false, profile: null };
  const content = <LocalBenchLanguageContext.Provider value={state}>{children}</LocalBenchLanguageContext.Provider>;

  return active && presentation
    ? <NextIntlClientProvider locale={presentation.voice.formatLocale} messages={messages}>{content}</NextIntlClientProvider>
    : content;
}

export function useLocalBenchLanguage() {
  return useContext(LocalBenchLanguageContext);
}
