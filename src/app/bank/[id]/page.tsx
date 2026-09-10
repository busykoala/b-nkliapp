import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, MapPinned } from "lucide-react";
import { notFound } from "next/navigation";
import { BenchDetailContent } from "@/components/bench-detail-content";
import { getCurrentUser } from "@/lib/security";
import { AppMenu } from "@/components/app-menu";
import { readBenchPageMetadata, readVerifiedBenchDetail } from "@/features/bench-detail/service";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const t = await getTranslations();
  const bench = readBenchPageMetadata((await params).id);
  return bench ? { title: bench.title || t("common.values.bench"), description: bench.viewScore === null ? t("bench.page.description") : t("bench.page.ratedDescription", { score: bench.viewScore }) } : { title: t("common.notFound.title") };
}

export default async function BenchPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations();
  const user = await getCurrentUser();
  const bench = await readVerifiedBenchDetail((await params).id, user);
  if (!bench) notFound();
  return <main className="standalone-bench min-h-dvh">
    <header className="safe-top sticky top-0 z-20 flex min-h-16 items-center justify-between px-3">
      <Link href="/feed" aria-label={t("bench.page.backToFeed")} className="calm-menu-button"><ArrowLeft size={19} /></Link>
      <div className="flex items-center gap-2">
        <Link href={`/?bank=${bench.id}`} className="show-on-map"><MapPinned size={17} /> {t("bench.page.onMap")}</Link>
        <AppMenu user={user} />
      </div>
    </header>
    <article className="standalone-bench-card mx-auto max-w-2xl pb-12">
      <BenchDetailContent bench={bench} user={user} />
    </article>
  </main>;
}
