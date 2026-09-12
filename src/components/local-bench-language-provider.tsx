"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { NextIntlClientProvider, useLocale, useMessages } from "next-intl";
import { isDialectLocale, localeTags } from "@/i18n/config";
import { localBenchMessages } from "@/i18n/local-bench-messages";
import { localBenchProfile, type LocalBenchProfile } from "@/lib/dialect";
import type { BenchDetail } from "@/lib/types";

type LocalBenchLanguageState = { active: false; profile: null } | { active: true; profile: LocalBenchProfile };

const LocalBenchLanguageContext = createContext<LocalBenchLanguageState>({ active: false, profile: null });

export function LocalBenchLanguageProvider({ bench, children }: { bench: BenchDetail; children: ReactNode }) {
  const rootLocale = useLocale();
  const currentMessages = useMessages();
  const active = isDialectLocale(rootLocale);
  const profile = useMemo(() => localBenchProfile(bench), [bench]);
  const messages = useMemo(() => ({ ...currentMessages, ...localBenchMessages(profile) }), [currentMessages, profile]);
  const state: LocalBenchLanguageState = active ? { active: true, profile } : { active: false, profile: null };
  const content = <LocalBenchLanguageContext.Provider value={state}>{children}</LocalBenchLanguageContext.Provider>;

  return active
    ? <NextIntlClientProvider locale={localeTags[profile.uiLanguage]} messages={messages}>{content}</NextIntlClientProvider>
    : content;
}

export function useLocalBenchLanguage() {
  return useContext(LocalBenchLanguageContext);
}
