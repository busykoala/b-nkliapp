import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Accessibility, ArrowLeft, ArrowUpRight, Armchair, CircleHelp, Compass, Eye, MapPin, MountainSnow, SearchCheck, Sun, Trees, Waves } from "lucide-react";
import { AppMenu } from "@/components/app-menu";
import type { BenchFact } from "@/features/statistics/model";
import { readMunicipalityPortrait } from "@/features/statistics/repository";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [t, { id }] = await Promise.all([getTranslations("statistics.municipality"), params]);
  const municipality = readMunicipalityPortrait(id);
  return municipality ? { title: t("metadataTitle", { name: municipality.name }), description: t("metadataDescription", { name: municipality.name, count: municipality.benchCount }) } : { title: t("notFound") };
}

export default async function MunicipalityPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, t, format, user] = await Promise.all([params, getTranslations(), getFormatter(), getCurrentUser()]);
  const data = readMunicipalityPortrait(id);
  if (!data) notFound();
  const number = (value: number) => format.number(value, { maximumFractionDigits: 0 });
  const percent = (value: number | null) => value === null ? t("common.values.unknown") : format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const records: Array<{ key: "highest" | "sunniestWinter" | "bestView"; icon: React.ReactNode; fact: BenchFact | null; value: (fact: BenchFact) => string }> = [
    { key: "highest", icon: <MountainSnow />, fact: data.records.highest, value: (item) => `${number(item.metric ?? 0)} m` },
    { key: "sunniestWinter", icon: <Sun />, fact: data.records.sunniestWinter, value: (item) => t("statistics.units.hours", { value: number((item.metric ?? 0) / 60) }) },
    { key: "bestView", icon: <Eye />, fact: data.records.bestView, value: (item) => `${number(item.metric ?? 0)}/100` },
  ];
  const audit = [
    ["backrest", <Armchair key="i" />, data.audit.missingBackrest], ["seats", <CircleHelp key="i" />, data.audit.missingSeats],
    ["direction", <Compass key="i" />, data.audit.missingDirection], ["freshness", <SearchCheck key="i" />, data.audit.unknownFreshness + data.audit.staleMapping],
  ] as const;

  return <main className="statistics-page municipality-page min-h-dvh safe-bottom">
    <header className="statistics-nav safe-top"><Link href="/statistiken" aria-label={t("statistics.municipality.back")} className="calm-menu-button"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <section className="municipality-hero">
      <div className="statistics-kicker"><MapPin size={15} /> {data.canton ?? t("statistics.values.somewhere")} · BFS {data.id}</div>
      <h1>{data.name}</h1><p>{t("statistics.municipality.title")}</p>
      <div className={`personality-card personality-${data.personality}`}><span aria-hidden="true">{data.personality === "sunny" ? <Sun /> : data.personality === "scenic" ? <Eye /> : data.personality === "waterside" ? <Waves /> : data.personality === "forest" ? <Trees /> : data.personality === "collector" ? <Armchair /> : <CircleHelp />}</span><div><small>{t("statistics.municipality.personality.eyebrow")}</small><strong>{t(`statistics.municipality.personality.${data.personality}.title`)}</strong><p>{t(`statistics.municipality.personality.${data.personality}.description`)}</p></div></div>
    </section>

    <section className="statistics-section portrait-metrics">
      <div className="section-heading"><div><small>{t("statistics.municipality.numbers.eyebrow")}</small><h2>{t("statistics.municipality.numbers.title")}</h2></div><Armchair /></div>
      <div className="portrait-grid">
        <article><Armchair /><strong>{number(data.benchCount)}</strong><span>{t("statistics.municipality.numbers.benches")}</span></article>
        <article><Sun /><strong>{percent(data.sunnyShare)}</strong><span>{t("statistics.municipality.numbers.sunny")}</span><small>{t("statistics.municipality.known", { count: number(data.sunnyKnown) })}</small></article>
        <article><Eye /><strong>{percent(data.scenicShare)}</strong><span>{t("statistics.municipality.numbers.scenic")}</span><small>{t("statistics.municipality.known", { count: number(data.scenicKnown) })}</small></article>
        <article><Waves /><strong>{percent(data.watersideShare)}</strong><span>{t("statistics.municipality.numbers.water")}</span><small>{t("statistics.municipality.known", { count: number(data.watersideKnown) })}</small></article>
        <article><Trees /><strong>{percent(data.forestShare)}</strong><span>{t("statistics.municipality.numbers.forest")}</span><small>{t("statistics.municipality.known", { count: number(data.forestKnown) })}</small></article>
        <article><Accessibility /><strong>{percent(data.wheelchairShare)}</strong><span>{t("statistics.municipality.numbers.wheelchair")}</span><small>{t("statistics.municipality.known", { count: number(data.wheelchairKnown) })}</small></article>
      </div>
      <p className="method-note">{t("statistics.municipality.numbers.note")}</p>
    </section>

    <section className="statistics-section municipal-records">
      <div className="section-heading"><div><small>{t("statistics.municipality.records.eyebrow")}</small><h2>{t("statistics.municipality.records.title")}</h2></div><MountainSnow /></div>
      <div className="record-grid">{records.map(({ key, icon, fact: item, value }) => <article key={key}><span className="record-icon">{icon}</span><small>{t(`statistics.records.${key}`)}</small>{item ? <><strong>{value(item)}</strong><Link href={`/bank/${item.id}?from=statistics`}>{item.title ?? t("common.values.bench")} <ArrowUpRight size={15} /></Link></> : <strong>{t("statistics.values.noData")}</strong>}</article>)}</div>
    </section>

    <section className="statistics-section audit-section">
      <div className="section-heading"><div><small>{t("statistics.municipality.audit.eyebrow")}</small><h2>{t("statistics.municipality.audit.title")}</h2></div><SearchCheck /></div>
      <p className="section-lead">{t("statistics.municipality.audit.description")}</p>
      <div className="audit-grid">{audit.map(([key, icon, count]) => <article key={key}><span>{icon}</span><strong>{number(count)}</strong><p>{t(`statistics.municipality.audit.${key}`)}</p></article>)}</div>
      <div className="coverage-strip"><span style={{ width: `${Math.round(data.metadataKnownShare * 100)}%` }} /><strong>{t("statistics.municipality.audit.coverage", { coverage: percent(data.metadataKnownShare) })}</strong></div>
      <p className="method-note">{t("statistics.municipality.audit.note", { stale: number(data.audit.staleMapping), unknown: number(data.audit.unknownFreshness) })}</p>
    </section>

    <footer className="statistics-footer"><Link href="/statistiken">{t("statistics.municipality.allStatistics")}</Link><Link href="/">{t("common.navigation.map")}</Link></footer>
  </main>;
}
