"use client";

import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { BenchDetail } from "@/lib/types";
import { benchFact } from "../facts";
import { comfortSummary, nearbyAmenities, visitAccessState, type NearbyAmenity } from "../overview";
import { sourceWindows } from "../source-data";
import { smoothnessLabel, surfaceLabel } from "@/i18n/approach-labels";
import { propertyValue } from "@/i18n/bench-labels";
import { NearbyAmenities } from "./nearby-amenities";
import { ObservationHistory } from "@/features/bench-community/components/observation-history";
import { BenchShareAction } from "./bench-header";
import { resolveWeatherCondition } from "@/features/weather/conditions";

export function BenchVisitDetails({ bench, onLocateAmenity, amenityMapHrefPrefix, onChanged }: {
  bench: BenchDetail; onChanged?: () => void | Promise<void>; onLocateAmenity?: (amenity: NearbyAmenity) => void; amenityMapHrefPrefix?: string;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const approach = bench.knowledge?.approach;
  const comfort = comfortSummary(bench, t);
  const material = benchFact(bench, "material");
  const space = benchFact(bench, "wheelchair");
  const materialProperty = bench.properties.find(item => item.key === "material");
  const measure = (value: number | null | undefined, unit: string) => value != null && Number.isFinite(value)
    ? `${format.number(value, { maximumFractionDigits: 1 })} ${unit}` : null;
  const accessRows = [
    [t("bench.details.bench"), comfort.value === "–" ? null : [comfort.value, comfort.detail].filter(Boolean).join(" · ")],
    [t("bench.attributes.material"), material.state === "known" && materialProperty ? propertyValue(materialProperty, t) : null],
    [t("bench.location.elevation"), bench.elevationMeters != null && Number.isFinite(bench.elevationMeters) ? t("bench.location.metresAboveSea", { value: Math.round(bench.elevationMeters) }) : null],
    [t("bench.access.atBench"), space.state === "known" ? t(space.value ? "bench.attributes.wheelchair" : "bench.summary.noWheelchair") : null],
    [t("knowledge.approach.steps"), approach?.steps == null ? null : t(approach.steps ? "knowledge.approach.recorded" : "knowledge.approach.noneRecorded")],
    [t("knowledge.approach.stepFree"), approach?.stepFreePossible == null ? null : t(approach.stepFreePossible ? "knowledge.approach.evidence" : "knowledge.approach.obstacle")],
    [t("knowledge.approach.surface"), approach?.surface ? surfaceLabel(approach.surface, t) : null],
    [t("knowledge.approach.smoothness"), approach?.smoothness ? smoothnessLabel(approach.smoothness, t) : null],
    [t("knowledge.approach.width"), measure(approach?.widthMeters, "m")],
    [t("knowledge.approach.length"), measure(approach?.lengthMeters, "m")],
    [t("knowledge.approach.maxSlope"), measure(approach?.maximumSlopePercent, "%")],
    [t("knowledge.approach.unmapped"), measure(approach?.unmappedLastMeters, "m")],
  ];
  const sun = sourceWindows(bench.sunWindows);
  const shade = sourceWindows(bench.shadeWindows);
  const condition = resolveWeatherCondition(bench.weather);
  const conditionKey = condition === "partly-cloudy" ? "partlyCloudy" : condition;
  const facilities = [...new Set(nearbyAmenities(bench).filter(item => item.category !== "fountain").map(item => t(item.category === "toilets" ? "knowledge.amenities.toilets" : "knowledge.amenities.drinking_water")))];
  const weatherRows = [
    [t("bench.overview.weatherNow"), [measure(bench.weather?.temperatureC, "°C"), condition !== "unknown" ? t(`bench.weather.conditions.${conditionKey}`) : null].filter(Boolean).join(" · ")],
    [t("bench.light.sunWindows"), sun || null],
    [t("bench.light.shadeWindows"), shade || null],
    [t("bench.light.sunrise"), bench.sunrise],
    [t("bench.light.sunset"), bench.sunset],
    [t("bench.weather.wind"), measure(bench.weather?.windKmh, "km/h")],
    [t("bench.weather.rain"), measure(bench.weather?.precipitationRateMmH, "mm/h")],
    [t("knowledge.details.snowDepth"), measure(bench.weather?.snowDepthCm, "cm")],
  ];
  return <section className="bench-visit-details" aria-label={t("bench.visit.title")}>
    <details data-sheet-section="visit"><summary data-sheet-focus="visit-details"><span>{t("bench.visit.goodToKnow")}{facilities.length > 0 && <small>{facilities.join(" · ")}</small>}</span><ChevronDown size={17} aria-hidden="true" /></summary>
      <section aria-label={t("bench.visit.seatingAccess")}><h3>{t("bench.visit.seatingAccess")}</h3>
        <VisitRows rows={accessRows} />
        {visitAccessState(bench).unknown && <p className="visit-access-unknown">{t("bench.visit.accessUnknown")}</p>}
        {bench.properties.some(item => item.evidenceState === "conflicting") && <p>{t("bench.visit.conflicting")}</p>}
        <p>{t("bench.visit.accessScope")}</p>
        {[...new Set([bench.dedication, bench.description].filter(Boolean))].map(note => <p key={note}>{note}</p>)}
      </section>
      <section aria-label={t("bench.visit.weatherSun")}><h3>{t("bench.visit.weatherSun")}</h3>
        <VisitRows rows={weatherRows} />
        <p>{t(bench.weather ? "bench.visit.sunEstimate" : "bench.weather.empty")}</p>
      </section>
      <section aria-label={t("knowledge.nearby.title")}><h3>{t("knowledge.nearby.title")}</h3>
        <NearbyAmenities bench={bench} onLocate={onLocateAmenity} hrefPrefix={amenityMapHrefPrefix} />
        <p>{t("knowledge.nearby.unknown")}</p>
      </section>
      <BenchShareAction bench={bench} />
      <ObservationHistory bench={bench} onChanged={onChanged} />
    </details>
  </section>;
}

function VisitRows({ rows }: { rows: (string | null | undefined)[][] }) {
  return <dl className="visit-detail-rows">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
