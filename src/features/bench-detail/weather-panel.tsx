import { formatDate } from "@/i18n/date";
import { useFormatter, useTranslations } from "next-intl";
import type { Translator } from "@/i18n/types";
import type { CSSProperties, ReactNode } from "react";
import { Cloud, CloudRain, Clock3, Droplets, Snowflake, Wind } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { WeatherSummary } from "@/components/weather-summary";

export function WeatherPanel({ bench }: { bench: Pick<BenchDetail, "weather" | "dayPhase"> }) {
  const t = useTranslations();
  const format = useFormatter();
  const weather = bench.weather;
  return <section className="detail-panel detail-panel-weather">
    {weather ? <>
      <header className="weather-data-header">
        <WeatherSummary weather={weather} dayPhase={bench.dayPhase} variant="illustrated" />
        {weather.location !== "diesem Bänkli" && <small>{weather.location}</small>}
        <time dateTime={weather.observedAt}><Clock3 size={14} aria-hidden="true" />{t("bench.weather.updated", {date: readableDate(weather.observedAt, t)})}</time>
      </header>
      {weather.cloudCover !== null && <CloudCover value={weather.cloudCover} label={cloudDescription(weather.cloudCover, t)} />}
      <div className="weather-measures">
        <WeatherMeasure kind="rain" icon={<CloudRain size={18} />} label={t("bench.weather.rain")} raw={weather.precipitationRateMmH} maximum={10} value={weather.precipitationRateMmH === null ? null : `${format.number(weather.precipitationRateMmH, {minimumFractionDigits: 1, maximumFractionDigits: 1})} mm/h`} />
        <WeatherMeasure kind="wind" icon={<Wind size={18} />} label={t("bench.weather.wind")} raw={weather.windKmh} maximum={80} value={weather.windKmh === null ? null : `${Math.round(weather.windKmh)} km/h`} />
        <WeatherMeasure kind="humidity" icon={<Droplets size={18} />} label={t("bench.weather.humidity")} raw={weather.humidityPercent} maximum={100} value={weather.humidityPercent === null ? null : `${Math.round(weather.humidityPercent)}%`} />
        <WeatherMeasure kind="snow" icon={<Snowflake size={18} />} label={t("bench.weather.precipitation.snow")} raw={weather.snowDepthCm} maximum={50} value={weather.snowDepthCm === null ? null : `${Math.round(weather.snowDepthCm)} cm`} />
      </div>
    </> : <p className="calm-empty">{t("bench.weather.empty")}</p>}
  </section>;
}

function CloudCover({ value, label }: {value: number; label: string}) {
  const t = useTranslations();
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const filled = Math.round(percent / 20);
  return <div className="cloud-cover-scale" aria-label={t("bench.weather.cloudCover", {percent})}>
    <span><Cloud size={17} aria-hidden="true" /><strong>{label}</strong></span>
    <i aria-hidden="true">{[1, 2, 3, 4, 5].map((step) => <b className={step <= filled ? "is-filled" : ""} key={step} />)}</i>
    <em>{percent}%</em>
  </div>;
}

function WeatherMeasure({ kind, icon, label, raw, maximum, value }: { kind: "rain" | "wind" | "humidity" | "snow"; icon: ReactNode; label: string; raw: number | null; maximum: number; value: string | null }) {
  if (value === null) return null;
  const ratio = Math.max(0, Math.min(1, (raw ?? 0) / maximum));
  return <div className={`weather-measure is-${kind}`} style={{"--measure": ratio} as CSSProperties} aria-label={`${label}: ${value}`}>
    <span className="weather-measure-visual" aria-hidden="true">{icon}<i /></span>
    <small>{label}</small><strong>{value}</strong>
  </div>;
}

function cloudDescription(value: number | null, t: Translator) {
  if (value === null) return t("bench.weather.clouds.unknown");
  const cloud = value >= .88 ? "overcast" : value >= .62 ? "mostly" : value >= .28 ? "cloudy" : value >= .1 ? "few" : "clear";
  return t(`bench.weather.clouds.${cloud}`);
}

function readableDate(value: string, t: Translator) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("common.values.unknown") : formatDate(date, t, "dateTime");
}
