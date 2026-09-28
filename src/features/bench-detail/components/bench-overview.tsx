"use client";

import { Armchair, CloudSun, Ear, Footprints, Moon, Mountain, Star, Sun } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { BenchDetail } from "@/lib/types";
import { WeatherSummary } from "@/features/weather/components/weather-summary";
import { accessSummary, comfortSummary, lightSummary, quietSummary, validRating, viewSummary, type OverviewFact } from "../overview";

export function BenchOverview({ bench, onReviews }: { bench: BenchDetail; onReviews?: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const number = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const LightIcon = bench.dayPhase === "night" ? Moon : bench.sunnyNow === false ? CloudSun : Sun;
  const rating = validRating(bench.ratingAverage, bench.ratingCount);
  const ratingContent = <>
    <Star size={17} aria-hidden="true" />
    <span>{rating === null ? t("bench.overview.noRatings") : <><strong>{number(rating)} / 5</strong><span> · {t("bench.overview.ratings", { count: bench.ratingCount })}</span></>}</span>
  </>;
  return <section className="bench-overview" aria-label={t("bench.summary.title")}>
    <h3 className="sr-only">{t("bench.summary.title")}</h3>
    <div className="bench-overview-grid">
      <div className="overview-fact overview-weather">
        <span className="overview-label">{t("bench.details.weather")}</span>
        <WeatherSummary weather={bench.weather} dayPhase={bench.dayPhase} />
        {bench.weather?.windKmh != null && Number.isFinite(bench.weather.windKmh) && <small>{t("bench.weather.wind")} {number(bench.weather.windKmh)} km/h</small>}
      </div>
      <Fact icon={<LightIcon />} label={t("bench.overview.light")} fact={lightSummary(bench, t)} />
      <Fact icon={<Armchair />} label={t("bench.details.bench")} fact={comfortSummary(bench, t)} />
      <Fact icon={<Footprints />} label={t("bench.overview.access")} fact={accessSummary(bench, t)} />
      <Fact icon={<Mountain />} label={t("bench.details.view")} fact={viewSummary(bench, t)} />
      <Fact icon={<Ear />} label={t("bench.weather.quiet.title")} fact={quietSummary(bench, t, number)} />
    </div>
    {onReviews
      ? <button type="button" className="overview-rating rating-summary-action" aria-label={`${t("bench.story.ratings")}${rating === null ? "" : `: ${number(rating)} / 5 · ${t("bench.overview.ratings", { count: bench.ratingCount })}`}`} onClick={onReviews}>{ratingContent}</button>
      : <div className="overview-rating">{ratingContent}</div>}
  </section>;
}

function Fact({ icon, label, fact }: { icon: ReactNode; label: string; fact: OverviewFact }) {
  const t = useTranslations();
  return <div className="overview-fact">
    <span className="overview-label"><span aria-hidden="true">{icon}</span>{label}</span>
    <strong aria-label={fact.value === "–" ? t("common.values.notRecorded") : undefined}>{fact.value}</strong>
    {fact.detail && <small>{fact.detail}</small>}
  </div>;
}
