import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { AppMenu } from "@/components/app-menu";
import { getCurrentUser } from "@/lib/security";
import { essays } from "@/features/reading/content";
import { resolveEssayLanguage } from "@/features/reading/model";
import { ReadingView } from "@/features/reading/components/reading-view";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const language = resolveEssayLanguage((await searchParams).lang, await getLocale());
  return { title: essays[language].title, authors: [{ name: "Urs" }] };
}

export default async function ReadingPage({ searchParams }: Props) {
  const [query, locale, t, user] = await Promise.all([searchParams, getLocale(), getTranslations(), getCurrentUser()]);
  const language = resolveEssayLanguage(query.lang, locale);
  return <main className="reading-page safe-bottom">
    <header className="reading-page-bar safe-top">
      <Link href="/" className="reading-map-link"><ArrowLeft size={18} aria-hidden="true" />{t("common.navigation.map")}</Link>
      <AppMenu user={user} />
    </header>
    <ReadingView key={language} initialLanguage={language} standalone />
  </main>;
}
