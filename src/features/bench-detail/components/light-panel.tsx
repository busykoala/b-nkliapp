import { useFormatter, useTranslations } from "next-intl";
import { compassDirection } from "@/i18n/bench-labels";
import { formatDate } from "@/i18n/date";
import type { BenchDetail } from "@/lib/types";
import { minuteClock, sourceDuration, sourceWindows } from "../source-data";
import { DetailRows, SourceGroup, SourceSection } from "./panel-ui";
import { WeatherPanel } from "./weather-panel";

export function LightPanel({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const format = useFormatter();
  const seasons: Array<[string, number | null]> = [
    [t("bench.light.seasons.spring"), bench.sunMinutesSpring],
    [t("bench.light.seasons.summer"), bench.sunMinutesSummer],
    [t("bench.light.seasons.autumn"), bench.sunMinutesAutumn],
    [t("bench.light.seasons.winter"), bench.sunMinutesWinter],
  ];
  return <SourceSection title={t("bench.details.lightWeather")}>
    <SourceGroup title={t("bench.light.today")}>
      <p className="source-note">{t(`bench.light.confidence.${bench.sunConfidence}`)}</p>
      <p className="source-note">{bench.skyObservedAt ? formatDate(bench.skyObservedAt, t, "dateTime") : t("bench.light.calculatedFor", { time: minuteClock(bench.localMinutesNow) })}</p>
      <DetailRows title={t("bench.light.today")} rows={[
        [t("bench.light.sunWindows"), sourceWindows(bench.sunWindows) || t("bench.light.noSun")],
        [t("bench.light.shadeWindows"), sourceWindows(bench.shadeWindows) || t("bench.light.noShade")],
        [t(bench.sunConfidence === "niedrig" ? "bench.light.estimatedSun" : "bench.light.directSun"), sourceDuration(bench.sunMinutesToday)],
        [t("bench.light.shade"), sourceDuration(bench.shadeMinutesToday)],
      ]} />
    </SourceGroup>
    <SourceGroup title={t("bench.light.skyValues")}>
      <DetailRows title={t("bench.light.skyValues")} rows={[
        [t("bench.light.sunrise"), bench.sunrise],
        [t("bench.light.sunset"), bench.sunset],
        [t("bench.light.altitude"), Number.isFinite(bench.sunAltitudeDegrees) ? `${format.number(bench.sunAltitudeDegrees, { maximumFractionDigits: 1 })}°` : null],
        [t("bench.light.azimuth"), Number.isFinite(bench.sunAzimuthDegrees) ? compassDirection(bench.sunAzimuthDegrees, t) : null],
        [t("knowledge.details.moonFraction"), Number.isFinite(bench.moonIllumination) ? `${Math.round(bench.moonIllumination * 100)}%` : null],
        [t("bench.light.moonrise"), bench.moonrise],
        [t("bench.light.moonset"), bench.moonset],
      ]} />
    </SourceGroup>
    {seasons.some(([, value]) => sourceDuration(value) !== null) && <SourceGroup title={t("bench.light.seasons.label")}>
      <DetailRows title={t("bench.light.seasons.label")} rows={seasons.map(([label, value]) => [label, sourceDuration(value)])} />
    </SourceGroup>}
    <WeatherPanel bench={bench} />
  </SourceSection>;
}
