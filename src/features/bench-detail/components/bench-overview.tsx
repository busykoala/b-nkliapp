"use client";

import { Armchair, ChevronRight, CloudSun, Ear, Eye, Footprints, Moon, Star, Sun } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { BenchDetail } from "@/lib/types";
import { resolveWeatherCondition } from "@/features/weather/conditions";
import { WeatherConditionIcon } from "@/features/weather/components/weather-summary";
import { accessSummary, comfortSummary, lightSummary, quietSummary, validRating, viewSummary, type OverviewFact } from "../overview";

type FactTone = "sky" | "sun" | "sage" | "earth" | "view" | "quiet";

export function BenchOverview({ bench, onReviews }: { bench: BenchDetail; onReviews?: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const number = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const LightIcon = bench.dayPhase === "night" ? Moon : bench.sunnyNow === false ? CloudSun : Sun;
  const rating = validRating(bench.ratingAverage, bench.ratingCount);
  const condition = resolveWeatherCondition(bench.weather);
  const conditionLabelKey = condition === "partly-cloudy" ? "partlyCloudy" : condition;
  const conditionLabel = condition === "unknown" ? null : t(`bench.weather.conditions.${conditionLabelKey}`);
  const windLabel = bench.weather?.windKmh != null && Number.isFinite(bench.weather.windKmh)
    ? `${t("bench.weather.wind")} ${number(bench.weather.windKmh)} km/h`
    : null;
  const weatherFact: OverviewFact = {
    value: bench.weather && Number.isFinite(bench.weather.temperatureC)
      ? `${format.number(bench.weather.temperatureC, { maximumFractionDigits: 0 })} °C`
      : "–",
    detail: [conditionLabel, windLabel].filter(Boolean).join(" · ") || undefined,
  };
  const access = accessSummary(bench, t);
  const ratingAriaLabel = rating === null
    ? `${t("bench.story.ratings")}. ${t("bench.story.ratingEmpty")}`
    : `${t("bench.story.ratings")}. ${t("bench.story.ratingSummary", { score: number(rating), count: bench.ratingCount })}`;
  const ratingContent = <>
    <span className="overview-rating-copy">
      <Star size={17} aria-hidden="true" />
      <span>{rating === null
        ? t("bench.overview.noRatings")
        : <><strong>{number(rating)} / 5</strong><span> · {t("bench.overview.ratings", { count: bench.ratingCount })}</span></>}
      </span>
    </span>
    {onReviews && <span className="overview-rating-action">{t(rating === null ? "bench.overview.rate" : "bench.overview.viewRatings")}<ChevronRight size={16} aria-hidden="true" /></span>}
  </>;

  return <section className="bench-overview" aria-label={t("bench.summary.title")}>
    <h3 className="sr-only">{t("bench.summary.title")}</h3>
    <div className="bench-overview-grid">
      <Fact
        icon={<WeatherConditionIcon condition={condition} night={bench.dayPhase === "night"} />}
        label={t("bench.details.weather")}
        fact={weatherFact}
        tone="sky"
        className="overview-weather"
      />
      <Fact icon={<LightIcon />} label={t("bench.overview.light")} fact={lightSummary(bench, t)} tone="sun" />
      <Fact icon={<Armchair />} label={t("bench.details.bench")} fact={comfortSummary(bench, t)} tone="sage" />
      <Fact icon={<Footprints />} label={access.label ?? t("bench.overview.access")} fact={access} tone="earth" />
      <Fact icon={<Eye />} label={t("bench.details.view")} fact={viewSummary(bench, t)} tone="view" />
      <Fact icon={<Ear />} label={t("bench.weather.quiet.title")} fact={quietSummary(bench, t, number)} tone="quiet" />
    </div>
    {onReviews
      ? <button
          type="button"
          className="overview-rating rating-summary-action"
          aria-label={ratingAriaLabel}
          onClick={onReviews}
        >{ratingContent}</button>
      : <div className="overview-rating">{ratingContent}</div>}
  </section>;
}

function Fact({ icon, label, fact, tone, className }: { icon: ReactNode; label: string; fact: OverviewFact; tone: FactTone; className?: string }) {
  const t = useTranslations();
  return <div className={["overview-fact", className].filter(Boolean).join(" ")}>
    <span className="overview-label"><span className={`overview-icon is-${tone}`} aria-hidden="true">{icon}</span>{label}</span>
    <strong aria-label={fact.value === "–" ? t("common.values.notRecorded") : undefined}>{fact.value}</strong>
    {fact.detail && <small>{fact.detail}</small>}
  </div>;
}
