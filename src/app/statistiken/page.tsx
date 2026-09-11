import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Activity, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Droplets, Eye, MapPin, MountainSnow, Shuffle, Sparkles, Sun, Trees } from "lucide-react";
import { spinBenchRoulette } from "@/app/actions/statistics";
import { AppMenu } from "@/components/app-menu";
import { BoxPlot } from "@/components/statistics/box-plot";
import { CorrelationPlot } from "@/components/statistics/correlation-plot";
import type { BenchFact, StatisticsRecordKey } from "@/features/statistics/model";
import { readStatisticsDashboard, statisticsDate } from "@/features/statistics/repository";
import { getCurrentUser } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("statistics.metadata");
  return { title: t("title"), description: t("description") };
}

export default async function StatisticsPage({ searchParams }: { searchParams: Promise<{ lab?: string | string[] }> }) {
  const [t, format, user, query] = await Promise.all([getTranslations(), getFormatter(), getCurrentUser(), searchParams]);
  const date = statisticsDate();
  const requestedMonth = typeof query.lab === "string" ? Number(query.lab) : Number.NaN;
  const labMonth = Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12 ? requestedMonth : Number(date.slice(5, 7));
  const data = readStatisticsDashboard(date, undefined, labMonth);
  const number = (value: number) => format.number(value, { maximumFractionDigits: 0 });
  const decimal = (value: number, digits = 1) => format.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const percent = (value: number | null) => value === null ? t("common.values.unknown") : format.number(value, { style: "percent", maximumFractionDigits: 0 });
  const coveragePercent = (value: number | null) => {
    if (value === null) return t("common.values.unknown");
    return format.number(value, { style: "percent", maximumFractionDigits: value > 0 && value < .001 ? 2 : 1 });
  };
  const correlation = data.correlation.coefficient;
  const explainedVariance = correlation === null ? null : correlation * correlation;
  const slope = data.correlation.trend?.slope ?? null;
  const correlationTone = correlation === null ? t("statistics.lab.unknown") : Math.abs(correlation) < .2 ? t("statistics.lab.tiny") : Math.abs(correlation) < .5 ? t("statistics.lab.middling") : t("statistics.lab.strong");
  const labMetric = (value: number) => data.correlation.benchMetric === "benchCount" ? number(value)
    : data.correlation.benchMetric === "averageElevation" ? `${number(value)} m`
      : data.correlation.benchMetric === "winterSun" ? `${decimal(value, 1)} h`
        : data.correlation.benchMetric === "averageSeats" ? decimal(value, 1) : `${decimal(value, 1)}%`;
  const seriesAxis = t(`statistics.lab.series.${data.correlation.series}.axis`, { year: data.correlation.sourceYear })
    + (data.correlation.perCapita ? ` · ${t("statistics.lab.perHundredThousand")}` : "");
  const recordPresentation: Record<StatisticsRecordKey, { icon: React.ReactNode; value: (fact: BenchFact) => string }> = {
    highest: { icon: <MountainSnow />, value: (item) => `${number(item.metric ?? 0)} m` }, lowest: { icon: <MountainSnow />, value: (item) => `${number(item.metric ?? 0)} m` },
    sunniestWinter: { icon: <Sun />, value: (item) => t("statistics.units.hours", { value: number((item.metric ?? 0) / 60) }) }, shadiestWinter: { icon: <Sun />, value: (item) => t("statistics.units.hours", { value: number((item.metric ?? 0) / 60) }) },
    sunniestSummer: { icon: <Sun />, value: (item) => t("statistics.units.hours", { value: number((item.metric ?? 0) / 60) }) }, shadiestSummer: { icon: <Sun />, value: (item) => t("statistics.units.hours", { value: number((item.metric ?? 0) / 60) }) },
    bestView: { icon: <Eye />, value: (item) => `${number(item.metric ?? 0)}/100` },
    closestWater: { icon: <Droplets />, value: (item) => `${number(item.metric ?? 0)} m` }, furthestWater: { icon: <Droplets />, value: (item) => `${number(item.metric ?? 0)} m` },
    densestCanopy: { icon: <Trees />, value: (item) => `${number(item.metric ?? 0)}%` }, clearestCanopy: { icon: <Trees />, value: (item) => `${number(item.metric ?? 0)}%` },
    closestPath: { icon: <MapPin />, value: (item) => `${number(item.metric ?? 0)} m` },
    mostSeats: { icon: <BarChart3 />, value: (item) => number(item.metric ?? 0) }, mostBuildings: { icon: <BarChart3 />, value: (item) => number(item.metric ?? 0) }, fewestBuildings: { icon: <BarChart3 />, value: (item) => number(item.metric ?? 0) },
    mostBlockedView: { icon: <Eye />, value: (item) => `${number(item.metric ?? 0)}%` }, wildest: { icon: <Trees />, value: (item) => `${number((item.metric ?? 0) * 100)}/100` }, remotest: { icon: <MountainSnow />, value: (item) => `${number((item.metric ?? 0) * 100)}/100` },
  };

  return <main className="statistics-page min-h-dvh safe-bottom">
    <header className="statistics-nav safe-top"><Link href="/" aria-label={t("common.navigation.map")} className="calm-menu-button"><ArrowLeft size={19} /></Link><AppMenu user={user} /></header>
    <section className="statistics-hero">
      <div className="statistics-kicker"><Sparkles size={15} /> {t("statistics.hero.eyebrow")}</div>
      <div className="statistics-hero-copy"><h1>{t("statistics.hero.title")}</h1><p>{t("statistics.hero.description")}</p></div>
      <div className="statistics-seal" aria-hidden="true"><span>IB</span><small>CH · {date.slice(0, 4)}</small></div>
      <dl className="statistics-totals">
        <div><dt>{t("statistics.totals.benches")}</dt><dd>{number(data.totalBenches)}</dd></div>
        <div><dt>{t("statistics.totals.enriched", { count: number(data.enrichedBenches) })}</dt><dd>{coveragePercent(data.totalBenches ? data.enrichedBenches / data.totalBenches : null)}</dd></div>
        <div><dt>{t("statistics.totals.located", { count: number(data.locatedBenches) })}</dt><dd>{coveragePercent(data.totalBenches ? data.locatedBenches / data.totalBenches : null)}</dd></div>
      </dl>
    </section>

    <section className="statistics-section daily-and-roulette">
      <article className="daily-bench-card">
        <div className="section-heading"><div><small>{t("statistics.daily.eyebrow")}</small><h2>{t("statistics.daily.title")}</h2></div><span className="daily-date">{date}</span></div>
        {data.benchOfTheDay ? <Link href={`/bank/${data.benchOfTheDay.id}?from=statistics`} className="daily-bench-link"><span className="daily-bench-illustration"><Trees /><span /></span><span><strong>{data.benchOfTheDay.title ?? t("common.values.bench")}</strong><small><MapPin size={14} /> {data.benchOfTheDay.place ?? t("statistics.values.somewhere")}</small></span><ArrowUpRight /></Link> : <p>{t("statistics.values.noData")}</p>}
        <p className="card-note">{t("statistics.daily.note")}</p>
      </article>
      <article className="roulette-card">
        <div className="section-heading"><div><small>{t("statistics.roulette.eyebrow")}</small><h2>{t("statistics.roulette.title")}</h2></div><Shuffle /></div>
        <p>{t("statistics.roulette.description")}</p>
        <div className="roulette-buttons">
          {(["beautiful", "sunny", "wild"] as const).map((mode) => <form action={spinBenchRoulette} key={mode}><input type="hidden" name="mode" value={mode} /><button><span>{mode === "beautiful" ? <Eye /> : mode === "sunny" ? <Sun /> : <Shuffle />}</span><strong>{t(`statistics.roulette.${mode}.title`)}</strong><small>{t(`statistics.roulette.${mode}.description`)}</small></button></form>)}
        </div>
      </article>
    </section>

    <section className="statistics-section records-section">
      <div className="section-heading"><div><small>{t("statistics.records.eyebrow")}</small><h2>{t("statistics.records.title")}</h2></div><BarChart3 /></div>
      <div className="record-grid">{data.records.map(({ key, fact: item }) => <article key={key}>
        <span className="record-icon">{recordPresentation[key].icon}</span><small>{t(`statistics.records.${key}`)}</small>
        <><strong>{recordPresentation[key].value(item)}</strong><Link href={`/bank/${item.id}?from=statistics`}>{item.title ?? t("common.values.bench")} <ArrowUpRight size={15} /></Link><p>{item.place ?? t("statistics.values.somewhere")}</p></>
      </article>)}</div>
      <p className="record-scroll-cue"><ArrowRight /> {t("statistics.records.scrollCue")}</p>
      <p className="method-note">{t("statistics.records.note")}</p>
    </section>

    <section className="statistics-section municipality-section">
      <div className="section-heading"><div><small>{t("statistics.municipalities.eyebrow")}</small><h2>{t("statistics.municipalities.title")}</h2></div><MapPin /></div>
      <p className="section-lead">{t("statistics.municipalities.description", { count: number(data.municipalityCount) })}</p>
      {data.municipalities.length ? <div className="municipality-table" role="list">{data.municipalities.map((item, index) => <Link href={`/gemeinde/${item.id}`} key={item.id} role="listitem">
        <span className="municipality-rank">{String(index + 1).padStart(2, "0")}</span><span className="municipality-name"><strong>{item.name}</strong><small>{item.canton ?? t("statistics.values.somewhere")}</small></span><span className="municipality-density"><strong>{decimal(item.benchesPerThousand ?? 0)}</strong><small>{t("statistics.municipalities.perThousand")}</small><em>{t("statistics.municipalities.benchCount", { count: number(item.benchCount) })}</em></span><span className="municipality-pills"><i><Sun /> {percent(item.sunnyShare)}</i><i><Eye /> {percent(item.scenicShare)}</i></span><ArrowUpRight />
      </Link>)}</div> : <p className="empty-statistics">{t("statistics.municipalities.empty")}</p>}
      <p className="method-note">{t("statistics.municipalities.note", { coverage: coveragePercent(data.totalBenches ? data.locatedBenches / data.totalBenches : null), year: data.populationYear })} <a href="https://www.pxweb.bfs.admin.ch/pxweb/de/px-x-0102010000_101/px-x-0102010000_101/px-x-0102010000_101.px/" target="_blank" rel="noreferrer">{t("statistics.municipalities.source")}</a></p>
    </section>

    <section className="statistics-section lab-section">
      <div className="section-heading"><div><small>{t("statistics.lab.eyebrow")}</small><h2>{t("statistics.lab.title")}</h2></div><span className="lab-sticker">r = {correlation === null ? "?" : format.number(correlation, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
      <nav className="lab-months" aria-label={t("statistics.lab.archive")}>
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <Link key={month} href={`/statistiken?lab=${month}`} aria-current={month === data.correlation.month ? "page" : undefined} scroll={false}>{format.dateTime(new Date(Date.UTC(2026, month - 1, 15)), { month: "short" })}</Link>)}
      </nav>
      <div className="lab-console">
        <header className="lab-console-header"><span><i /> {t("statistics.lab.status")}</span><strong>{t("statistics.lab.observations", { count: number(data.correlation.sampleSize) })}</strong></header>
        <div className="lab-copy"><div><h3>{t(`statistics.lab.series.${data.correlation.series}.question`)}</h3><p>{t("statistics.lab.answer", { tone: correlationTone })}</p></div><dl><div><dt>{t("statistics.lab.coefficient")}</dt><dd>{correlation === null ? "—" : decimal(correlation, 2)}</dd></div><div><dt>{t("statistics.lab.explained")}</dt><dd>{explainedVariance === null ? "—" : percent(explainedVariance)}</dd></div><div><dt>{t(`statistics.lab.metrics.${data.correlation.benchMetric}.slope`)}</dt><dd>{slope === null ? "—" : t("statistics.lab.slopeValue", { value: decimal(slope, 1) })}</dd></div></dl></div>
        <div className="lab-verdict"><Activity /><div><small>{t("statistics.lab.verdictLabel")}</small><strong>{t("statistics.lab.verdict")}</strong></div></div>
        <div className="lab-visual-grid">
          <CorrelationPlot points={data.correlation.points} trend={data.correlation.trend} label={t("statistics.lab.plotLabel", { series: seriesAxis })} trendLabel={t("statistics.lab.trendLabel")} xLabel={t(`statistics.lab.metrics.${data.correlation.benchMetric}.axis`)} yLabel={seriesAxis} />
          <BoxPlot groups={data.correlation.boxPlots} label={t("statistics.lab.boxLabel", { series: seriesAxis })} title={t("statistics.lab.boxTitle")} description={t("statistics.lab.boxDescription")} groupLabel={(group) => t("statistics.lab.quartileRange", { from: labMetric(group.xMinimum), to: labMetric(group.xMaximum) })} />
        </div>
        <div className="lab-reality-checks"><span><small>{t("statistics.lab.sample")}</small><strong>{t("statistics.lab.cantons", { count: number(data.correlation.sampleSize) })}</strong></span><span><small>{t("statistics.lab.causality")}</small><strong>{t("statistics.lab.none")}</strong></span><span><small>{t("statistics.lab.hypotheses")}</small><strong>{number(data.correlation.hypothesesTested)}</strong></span></div>
      </div>
      <p className="method-note">{t("statistics.lab.note", { year: data.correlation.sourceYear, count: number(data.correlation.hypothesesTested) })} <a href={data.correlation.sourceUrl} target="_blank" rel="noreferrer">{t("statistics.lab.source")}</a></p>
    </section>

    <footer className="statistics-footer"><span>{t("statistics.footer")}</span><Link href="/danke">{t("statistics.methodsLink")}</Link></footer>
  </main>;
}
