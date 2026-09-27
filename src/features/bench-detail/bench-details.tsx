"use client";

import { useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { BenchPanel } from "./bench-panel";
import { LightPanel } from "./light-panel";
import { ViewPanel } from "./view-panel";
import { WeatherPanel } from "./weather-panel";
import { AccessPanel } from "./access-panel";
import { Ear, UsersRound } from "lucide-react";
import { useFormatter } from "next-intl";

export function BenchDetails({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  return <section className="quiet-details visit-sections" aria-label={t("bench.details.title")}>
    <section className="visit-section"><h2>{t("bench.details.bench")}</h2><BenchPanel bench={bench} /></section>
    <section className="visit-section"><h2>{t("bench.details.lightWeather")}</h2><LightPanel bench={bench} /><WeatherPanel bench={bench} /></section>
    <section className="visit-section"><h2>{t("bench.details.access")}</h2><AccessPanel bench={bench} /></section>
    <section className="visit-section"><h2>{t("bench.details.view")}</h2><ViewPanel bench={bench} /></section>
    <section className="visit-section"><h2>{t("bench.details.visits")}</h2><QuietScale bench={bench} /></section>
  </section>;
}

function QuietScale({bench}: {bench: BenchDetail}) {
  const t = useTranslations();
  const format = useFormatter();
  const score = bench.ratingBreakdown?.quiet ?? null;
  const count = bench.ratingBreakdown?.counts.quiet ?? 0;
  const label = score === null
    ? `${t("bench.weather.quiet.title")}. ${t("bench.weather.quiet.unknown")}`
    : `${t("bench.weather.quiet.community")}. ${t("bench.weather.quiet.score", {score: format.number(score, {minimumFractionDigits: 1, maximumFractionDigits: 1})})}. ${t("bench.weather.quiet.explanation")}`;
  return <div className={`quiet-scale${score === null ? " is-empty" : ""}`} aria-label={label}>
    <header><Ear size={21} aria-hidden="true" /><span>{t("bench.weather.quiet.title")}</span><strong>{score === null ? "–" : format.number(score, {minimumFractionDigits: 1, maximumFractionDigits: 1})}<small>/5</small></strong></header>
    <div aria-hidden="true">{[1, 2, 3, 4, 5].map((value) => <i key={value}><b style={{width: score === null ? "0%" : `${Math.max(0, Math.min(1, score - value + 1)) * 100}%`}} /></i>)}</div>
    <footer><UsersRound size={15} aria-hidden="true" /><span>{count || t("bench.weather.quiet.empty")}</span></footer>
  </div>;
}
