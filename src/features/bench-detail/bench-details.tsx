"use client";

import { useTranslations } from "next-intl";
import { propertyLabel, propertyValue, viewLabel } from "@/i18n/bench-labels";
import { useId } from "react";
import { Armchair, ChevronDown, CloudSun, MountainSnow, Sun } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { BenchPanel } from "./bench-panel";
import { LightPanel } from "./light-panel";
import { ViewPanel } from "./view-panel";
import { WeatherPanel } from "./weather-panel";

export function BenchDetails({ bench, signedIn = false, onChanged }: { bench: BenchDetail; signedIn?: boolean; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const id = useId();
  const known = bench.properties.filter((item) => !/^(unbekannt|noch offen)$/i.test(item.value));
  const chapters = [
    { key: "bench", title: t("bench.details.bench"), icon: Armchair, summary: known.slice(0, 2).map((item) => `${propertyLabel(item, t)}: ${propertyValue(item, t)}`).join(" · ") || t("bench.details.unknownFeatures"), content: <BenchPanel bench={bench} signedIn={signedIn} onChanged={onChanged} /> },
    { key: "light", title: t("bench.details.light"), icon: Sun, summary: bench.dayPhase === "night" ? t("bench.details.night") : bench.sunnyNow === null ? t("bench.details.unknownLight") : t(bench.sunnyNow ? "bench.details.sunEstimate" : "bench.details.shadeEstimate"), content: <LightPanel bench={bench} /> },
    { key: "view", title: t("bench.details.view"), icon: MountainSnow, summary: bench.viewLabels.map((value) => viewLabel(value, t)).join(" · ") || t("bench.details.unknownView"), content: <ViewPanel bench={bench} /> },
    { key: "weather", title: t("bench.details.weather"), icon: CloudSun, summary: bench.weather ? t("bench.details.forecast", {temperature: Math.round(bench.weather.temperatureC)}) : t("bench.details.unknownWeather"), content: <WeatherPanel bench={bench} /> },
  ];
  return <section className="quiet-details detail-disclosures" aria-label={t("bench.details.title")}>
    {chapters.map(({ key, title, icon: Icon, summary, content }) => <details key={key} name={`bench-details-${id}`}>
      <summary><Icon size={20} /><span><strong>{title}</strong><small>{summary}</small></span><ChevronDown className="disclosure-chevron" size={18} /></summary>
      <div className="detail-panel-frame">{content}</div>
    </details>)}
  </section>;
}
