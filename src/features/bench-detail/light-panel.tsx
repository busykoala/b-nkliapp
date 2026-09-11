import { useFormatter, useTranslations } from "next-intl";
import type { Translator } from "@/i18n/types";
import { compassDirection } from "@/i18n/bench-labels";
import type { ReactNode } from "react";
import { ChevronDown, CloudSun, Moon, Sun } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, minuteClock, ObstructionSketch, PanelHeading } from "./panel-ui";

export function LightPanel({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const format = useFormatter();
  const sunPercent = bench.daylightMinutesToday > 0 ? Math.round(bench.sunMinutesToday / bench.daylightMinutesToday * 100) : 0;
  const sunLabel = bench.sunConfidence === "niedrig" ? t("bench.light.estimatedSun") : t("bench.light.directSun");
  return <section className="detail-panel detail-panel-light">
    <PanelHeading eyebrow={t("bench.light.today")} title={currentLight(bench, t)}><p>{lightSentence(bench, t)}</p></PanelHeading>
    <p className="calculation-freshness">{t("bench.light.calculatedFor", {time: minuteClock(bench.localMinutesNow)})}</p>
    <SunPath bench={bench} />
    <div className="light-windows is-primary">
      <IntervalStory icon={<Sun size={17} />} label={bench.sunConfidence === "niedrig" ? t("bench.light.estimatedWindows") : t("bench.light.sunWindows")} windows={bench.sunWindows} empty={t("bench.light.noSun")} />
      <IntervalStory icon={<CloudSun size={17} />} label={t("bench.light.shadeWindows")} windows={bench.shadeWindows} empty={t("bench.light.noShade")} />
    </div>
    <p className="confidence-line">{t(`bench.light.confidence.${bench.sunConfidence}`)}</p>
    <details className="technical-fold">
      <summary><span><strong>{t("bench.light.durationSeasons")}</strong><small>{t("bench.light.detailsSummary")}</small></span><ChevronDown size={16} /></summary>
      <div className="light-balance" aria-label={t("bench.light.balance", {sun: sunDuration(bench.sunMinutesToday), shade: sunDuration(bench.shadeMinutesToday)})}>
        <div><span className="is-sun"><Sun size={18} /></span><small>{sunLabel}</small><strong>{sunDuration(bench.sunMinutesToday)}</strong></div>
        <div><span className="is-shade"><CloudSun size={18} /></span><small>{t("bench.light.shade")}</small><strong>{sunDuration(bench.shadeMinutesToday)}</strong></div>
        <i><b style={{ width: `${sunPercent}%` }} /></i>
      </div>
      <ObstructionSketch building={bench.buildingObstructionPercent} vegetation={bench.vegetationObstructionPercent} />
      <SeasonalLight bench={bench} />
      <DetailRows title={t("bench.light.skyValues")} rows={[
        [t("bench.light.sunrise"), bench.sunrise],
        [t("bench.light.sunset"), bench.sunset],
        [t("bench.light.directFrom"), bench.sunWindows.length ? bench.directSunrise : t("bench.light.noDirect")],
        [t("bench.light.directUntil"), bench.sunWindows.length ? bench.directSunset : t("bench.light.noDirect")],
        [t("bench.light.altitude"), `${format.number(bench.sunAltitudeDegrees, {maximumFractionDigits: 1})}°`],
        [t("bench.light.azimuth"), compassDirection(bench.sunAzimuthDegrees, t)],
        [t("bench.light.moonlight"), `${Math.round(bench.moonIllumination * 100)}%`],
        [t("bench.light.moonrise"), bench.moonrise],
        [t("bench.light.moonset"), bench.moonset],
      ]} />
    </details>
  </section>;
}

function SunPath({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const nowX = timelineX(bench.localMinutesNow);
  return <section className="daylight-story" aria-label={t("bench.light.timeline", {sunrise: bench.sunrise, sunset: bench.sunset, moonrise: bench.moonrise, moonset: bench.moonset})}>
    <div className="sky-legend"><span className="sun-time"><Sun size={15} />{bench.sunrise}–{bench.sunset}</span><span className="moon-time"><Moon size={15} />{bench.moonrise}–{bench.moonset}</span></div>
    <svg className="sky-arc" viewBox="0 0 360 96" aria-hidden="true">
      <path className="sky-horizon" d="M8 75H352" />
      {trackPaths(bench.skyTrack.sun).map((path, index) => <path key={`sun-${index}`} className="sky-arc-line sky-arc-sun" d={path} />)}
      {trackPaths(bench.skyTrack.moon).map((path, index) => <path key={`moon-${index}`} className="sky-arc-line sky-arc-moon" d={path} />)}
      {bench.sunWindows.map((window) => {
        const start = clockMinutes(window.start);
        const end = clockMinutes(window.end);
        return start !== null && end !== null ? <path key={`${window.start}-${window.end}`} className="sky-light-window" d={`M${timelineX(start)} 78H${timelineX(end)}`} /> : null;
      })}
      <path className="sky-now-line" d={`M${nowX} 8V79`} />
      {bench.sunAltitudeDegrees > 0 && <g className="sky-arc-now is-sun" transform={`translate(${nowX} ${trackY(bench.sunAltitudeDegrees)})`}><circle r="5" /><path className="sun-rays" d="M0-10v2M0 8v2M-10 0h2M8 0h2M-7-7l1.5 1.5M5.5 5.5 7 7M7-7 5.5-5.5M-5.5 5.5-7 7" /></g>}
      {bench.moonVisible && <g className="sky-arc-now is-moon" transform={`translate(${nowX} ${trackY(bench.moonAltitudeDegrees)})`}><path d="M2-6a7 7 0 1 0 0 12 6 6 0 1 1 0-12Z" /></g>}
      {[0, 6, 12, 18, 24].map((hour) => <text key={hour} className="sky-clock" x={timelineX(hour * 60)} y="92" textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}>{hour}</text>)}
    </svg>
  </section>;
}

function IntervalStory({ icon, label, windows, empty }: { icon: ReactNode; label: string; windows: BenchDetail["sunWindows"]; empty: string }) {
  const visible = windows.filter((window) => window.start !== window.end);
  return <div><span aria-hidden="true">{icon}</span><p><small>{label}</small><strong>{visible.length ? visible.map((window) => `${window.start}–${window.end}`).join(" · ") : empty}</strong></p></div>;
}

function SeasonalLight({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const values: Array<[string, number | null]> = [
    [t("bench.light.seasons.spring"), bench.sunMinutesSpring], [t("bench.light.seasons.summer"), bench.sunMinutesSummer],
    [t("bench.light.seasons.autumn"), bench.sunMinutesAutumn], [t("bench.light.seasons.winter"), bench.sunMinutesWinter],
  ];
  const available = values.filter((item): item is [string, number] => item[1] !== null);
  if (!available.length) return null;
  const maximum = Math.max(...available.map((item) => item[1]), 1);
  return <div className="season-light" aria-label={t("bench.light.seasons.label")}>
    {available.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${value / maximum * 100}%` }} /></i><strong>{sunDuration(value)}</strong></div>)}
  </div>;
}

function clockMinutes(clock: string) {
  const match = clock.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function timelineX(minutes: number) { return 8 + Math.max(0, Math.min(1440, minutes)) / 1440 * 344; }
function trackY(altitude: number) { return 75 - Math.max(0, Math.min(62, altitude * .9)); }
function sunDuration(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; return hours ? `${hours} h${minutes ? ` ${minutes} min` : ""}` : `${minutes} min`; }

function trackPaths(points: BenchDetail["skyTrack"]["sun"]) {
  const paths: string[] = [];
  let path = "";
  for (const point of points) {
    if (point.altitudeDegrees <= 0) {
      if (path) paths.push(path);
      path = "";
      continue;
    }
    path += `${path ? "L" : "M"}${timelineX(point.minute).toFixed(1)} ${trackY(point.altitudeDegrees).toFixed(1)} `;
  }
  if (path) paths.push(path);
  return paths;
}

function currentLight(bench: BenchDetail, t: Translator) {
  if (bench.shadeCause === "nacht") return t(bench.moonVisible ? "bench.light.state.moon" : "bench.light.state.night");
  if (bench.sunnyNow === null) return t("bench.light.state.unknown");
  return t(bench.sunnyNow ? "bench.light.state.sun" : "bench.light.state.shade");
}

function lightSentence(bench: BenchDetail, t: Translator) {
  if (bench.shadeCause === "nacht") return t(bench.sunConfidence === "niedrig" ? "bench.light.explanation.nightEstimate" : "bench.light.explanation.night", {duration: sunDuration(bench.sunMinutesToday)});
  if (bench.sunnyNow === null) return t("bench.light.explanation.unknown");
  if (bench.sunnyNow) return t(bench.weather && bench.weather.cloudCover > .65 ? "bench.light.explanation.clouds" : "bench.light.explanation.sun");
  return t(`bench.light.causes.${bench.shadeCause}`);
}
