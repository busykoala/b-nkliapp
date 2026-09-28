import { useFormatter, useTranslations } from "next-intl";
import { formatDate } from "@/i18n/date";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, SourceGroup } from "./panel-ui";

export function WeatherPanel({ bench }: { bench: Pick<BenchDetail, "weather" | "dayPhase"> }) {
  const t = useTranslations();
  const format = useFormatter();
  const weather = bench.weather;
  const measure = (value: number | null, unit: string) => value === null || !Number.isFinite(value)
    ? null : `${format.number(value, { maximumFractionDigits: 1 })} ${unit}`;
  return <SourceGroup title={t("bench.details.weather")}>
    {weather ? <>
      <p className="source-note">{[weather.source, weather.location === "diesem Bänkli" ? null : weather.location].filter(Boolean).join(" · ")}</p>
      <p className="source-note"><time dateTime={weather.observedAt}>{t("bench.weather.updated", { date: formatDate(weather.observedAt, t, "dateTime") })}</time></p>
      <DetailRows title={t("bench.details.weather")} rows={[
        [t("knowledge.details.temperature"), measure(weather.temperatureC, "°C")],
        [t("bench.weather.rain"), measure(weather.precipitationRateMmH, "mm/h")],
        [t("bench.weather.wind"), measure(weather.windKmh, "km/h")],
        [t("bench.weather.humidity"), measure(weather.humidityPercent, "%")],
        [t("knowledge.details.cloudCover"), weather.cloudCover === null ? null : measure(weather.cloudCover * 100, "%")],
        [t("knowledge.details.snowDepth"), measure(weather.snowDepthCm, "cm")],
      ]} />
    </> : <p className="source-note">{t("bench.weather.empty")}</p>}
  </SourceGroup>;
}
