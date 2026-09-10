import { formatDate } from "@/i18n/date";
import { useFormatter, useTranslations } from "next-intl";
import type { Translator } from "@/i18n/types";
import type { ReactNode } from "react";
import { CloudRain, CloudSun, Droplets, MessageCircleHeart, Snowflake, Wind } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { PanelHeading } from "./panel-ui";

export function WeatherPanel({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const format = useFormatter();
  const weather = bench.weather;
  return <section className="detail-panel detail-panel-weather">
    <PanelHeading eyebrow={t("bench.weather.title")} title={weather ? weather.location === "diesem Bänkli" ? t("bench.weather.temperatureHere", { temperature: Math.round(weather.temperatureC) }) : t("bench.weather.temperatureAt", {temperature: Math.round(weather.temperatureC), location: weather.location}) : t("bench.weather.unknown")}>
      {weather && <p>{cloudDescription(weather.cloudCover, t)} · {t(`bench.weather.precipitation.${weather.precipitationType}`)}</p>}
    </PanelHeading>
    {weather ? <>
      <WeatherSketch weather={weather} />
      <div className="weather-measures">
        <WeatherMeasure icon={<CloudRain size={18} />} label={t("bench.weather.rain")} value={weather.precipitationRateMmH === null ? null : `${format.number(weather.precipitationRateMmH, {minimumFractionDigits: 1, maximumFractionDigits: 1})} mm/h`} />
        <WeatherMeasure icon={<Wind size={18} />} label={t("bench.weather.wind")} value={weather.windKmh === null ? null : `${Math.round(weather.windKmh)} km/h`} />
        <WeatherMeasure icon={<Droplets size={18} />} label={t("bench.weather.humidity")} value={weather.humidityPercent === null ? null : `${Math.round(weather.humidityPercent)}%`} />
        <WeatherMeasure icon={<Snowflake size={18} />} label={t("bench.weather.precipitation.snow")} value={weather.snowDepthCm === null ? null : `${Math.round(weather.snowDepthCm)} cm`} />
      </div>
      <p className="weather-time">{t("bench.weather.updated", {date: readableDate(weather.observedAt, t)})}</p>
    </> : <p className="calm-empty">{t("bench.weather.empty")}</p>}
    <CommunityQuiet bench={bench} />
  </section>;
}

function WeatherMeasure({ icon, label, value }: { icon: ReactNode; label: string; value: string | null }) {
  if (value === null) return null;
  return <div><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{value}</strong></div>;
}

function WeatherSketch({ weather }: { weather: NonNullable<BenchDetail["weather"]> }) {
  const t = useTranslations();
  const detailedLayers: Array<[string, number | null]> = [[t("bench.weather.layers.high"), weather.cloudHigh], [t("bench.weather.layers.mid"), weather.cloudMid], [t("bench.weather.layers.low"), weather.cloudLow]];
  const layers: Array<[string, number | null]> = [[t("bench.weather.layers.total"), weather.cloudCover], ...detailedLayers.filter(([, value]) => value !== null)];
  return <div className="weather-sketch" aria-label={t("bench.weather.cloudCover", {percent: Math.round(weather.cloudCover * 100)})}>
    <div className="weather-sky-mark">{weather.precipitationType === "snow" ? <Snowflake /> : weather.precipitationType === "rain" || weather.precipitationType === "mixed" ? <CloudRain /> : <CloudSun />}</div>
    <div className="cloud-layers">{layers.map(([label, raw]) => {
      const value = raw ?? 0;
      return <div key={label}><span>{label}</span><i><b style={{ width: `${Math.round(value * 100)}%` }} /></i><strong>{raw === null ? "–" : `${Math.round(value * 100)}%`}</strong></div>;
    })}</div>
  </div>;
}

function CommunityQuiet({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const format = useFormatter();
  if (!bench.ratingBreakdown) return <div className="community-quiet is-empty"><MessageCircleHeart size={21} /><div><small>{t("bench.weather.quiet.title")}</small><strong>{t("bench.weather.quiet.empty")}</strong><p>{t("bench.weather.quiet.unknown")}</p></div></div>;
  const quiet = bench.ratingBreakdown.quiet;
  return <div className="community-quiet">
    <MessageCircleHeart size={21} />
    <div><small>{t("bench.weather.quiet.community")}</small><strong>{t("bench.weather.quiet.score", {score: format.number(quiet, {minimumFractionDigits: 1, maximumFractionDigits: 1})})}</strong><i><b style={{ width: `${quiet / 5 * 100}%` }} /></i><p>{t("bench.weather.quiet.explanation")}</p></div>
  </div>;
}

function cloudDescription(value: number, t: Translator) {
  const cloud = value >= .88 ? "overcast" : value >= .62 ? "mostly" : value >= .28 ? "cloudy" : value >= .1 ? "few" : "clear";
  return t(`bench.weather.clouds.${cloud}`);
}

function readableDate(value: string, t: Translator) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("common.values.unknown") : formatDate(date, t, "dateTime");
}
