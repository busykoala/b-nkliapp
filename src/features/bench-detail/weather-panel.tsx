import type { ReactNode } from "react";
import { CloudRain, CloudSun, Droplets, MessageCircleHeart, Snowflake, Wind } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { PanelHeading } from "./panel-ui";

export function WeatherPanel({ bench }: { bench: BenchDetail }) {
  const weather = bench.weather;
  return <section className="detail-panel detail-panel-weather">
    <PanelHeading eyebrow="Wetter & Ruhe" title={weather ? `${Math.round(weather.temperatureC)}° bei ${weather.location}` : "Der Himmel bleibt noch verborgen"}>
      {weather && <p>{cloudDescription(weather.cloudCover)} · {precipitation(weather.precipitationType)}</p>}
    </PanelHeading>
    {weather ? <>
      <WeatherSketch weather={weather} />
      <div className="weather-measures">
        <WeatherMeasure icon={<CloudRain size={18} />} label="Niederschlag" value={weather.precipitationRateMmH === null ? null : `${weather.precipitationRateMmH.toFixed(1)} mm/h`} />
        <WeatherMeasure icon={<Wind size={18} />} label="Wind" value={weather.windKmh === null ? null : `${Math.round(weather.windKmh)} km/h`} />
        <WeatherMeasure icon={<Droplets size={18} />} label="Feuchte" value={weather.humidityPercent === null ? null : `${Math.round(weather.humidityPercent)}%`} />
        <WeatherMeasure icon={<Snowflake size={18} />} label="Schnee" value={weather.snowDepthCm === null ? null : `${Math.round(weather.snowDepthCm)} cm`} />
      </div>
      <p className="weather-time">Stand {readableDate(weather.observedAt)}</p>
    </> : <p className="calm-empty">Sobald Wetterdaten verfügbar sind, erscheinen Temperatur, Wolken und Niederschlag hier.</p>}
    <CommunityQuiet bench={bench} />
  </section>;
}

function WeatherMeasure({ icon, label, value }: { icon: ReactNode; label: string; value: string | null }) {
  if (value === null) return null;
  return <div><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{value}</strong></div>;
}

function WeatherSketch({ weather }: { weather: NonNullable<BenchDetail["weather"]> }) {
  const detailedLayers: Array<[string, number | null]> = [["hoch", weather.cloudHigh], ["mittel", weather.cloudMid], ["tief", weather.cloudLow]];
  const layers: Array<[string, number | null]> = [["gesamt", weather.cloudCover], ...detailedLayers.filter(([, value]) => value !== null)];
  return <div className="weather-sketch" aria-label={`Wolkendecke ${Math.round(weather.cloudCover * 100)} Prozent`}>
    <div className="weather-sky-mark">{weather.precipitationType === "snow" ? <Snowflake /> : weather.precipitationType === "rain" || weather.precipitationType === "mixed" ? <CloudRain /> : <CloudSun />}</div>
    <div className="cloud-layers">{layers.map(([label, raw]) => {
      const value = raw ?? 0;
      return <div key={label}><span>{label}</span><i><b style={{ width: `${Math.round(value * 100)}%` }} /></i><strong>{raw === null ? "–" : `${Math.round(value * 100)}%`}</strong></div>;
    })}</div>
  </div>;
}

function CommunityQuiet({ bench }: { bench: BenchDetail }) {
  if (!bench.ratingBreakdown) return <div className="community-quiet is-empty"><MessageCircleHeart size={21} /><div><small>Ruhe vor Ort</small><strong>Noch keine Stimmen</strong><p>Die Ruhe an diesem Platz wurde noch nicht erkundet.</p></div></div>;
  const quiet = bench.ratingBreakdown.quiet;
  return <div className="community-quiet">
    <MessageCircleHeart size={21} />
    <div><small>Ruhe laut Menschen vor Ort</small><strong>{quiet.toFixed(1)} von 5</strong><i><b style={{ width: `${quiet / 5 * 100}%` }} /></i><p>Subjektive Bewertung, getrennt von Verkehrsdaten.</p></div>
  </div>;
}

function precipitation(value: NonNullable<BenchDetail["weather"]>["precipitationType"]) {
  return ({ none: "trocken", rain: "Regen", snow: "Schnee", mixed: "Schneeregen", unknown: "Niederschlag noch unklar" } as const)[value];
}

function cloudDescription(value: number) {
  if (value >= .88) return "Bedeckt";
  if (value >= .62) return "Stark bewölkt";
  if (value >= .28) return "Wolkig";
  if (value >= .1) return "Leicht bewölkt";
  return "Klar";
}

function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Nicht bekannt" : new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(date);
}
