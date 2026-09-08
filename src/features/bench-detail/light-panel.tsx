import type { ReactNode } from "react";
import { ChevronDown, CloudSun, Moon, Sun } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, ObstructionSketch, PanelHeading } from "./panel-ui";

export function LightPanel({ bench }: { bench: BenchDetail }) {
  const sunPercent = bench.daylightMinutesToday > 0 ? Math.round(bench.sunMinutesToday / bench.daylightMinutesToday * 100) : 0;
  const sunLabel = bench.sunConfidence === "niedrig" ? "Geschätzte Sonne" : "Direkte Sonne";
  return <section className="detail-panel detail-panel-light">
    <PanelHeading eyebrow="Licht heute" title={currentLight(bench)}><p>{lightSentence(bench)}</p></PanelHeading>
    <SunPath bench={bench} />
    <div className="light-windows is-primary">
      <IntervalStory icon={<Sun size={17} />} label={bench.sunConfidence === "niedrig" ? "Geschätzte Sonnenfenster" : "Sonnenfenster"} windows={bench.sunWindows} empty="Heute keine direkte Sonne berechnet" />
      <IntervalStory icon={<CloudSun size={17} />} label="Schattenfenster" windows={bench.shadeWindows} empty="Heute kein Schattenfenster berechnet" />
    </div>
    <p className="confidence-line">{lightConfidenceLine(bench.sunConfidence)}</p>
    <details className="technical-fold">
      <summary><span><strong>Dauer & Jahreszeiten</strong><small>Summen, Hindernisse und Himmelswerte</small></span><ChevronDown size={16} /></summary>
      <div className="light-balance" aria-label={`${sunDuration(bench.sunMinutesToday)} direkte Sonne und ${sunDuration(bench.shadeMinutesToday)} Schatten bei Tageslicht`}>
        <div><span className="is-sun"><Sun size={18} /></span><small>{sunLabel}</small><strong>{sunDuration(bench.sunMinutesToday)}</strong></div>
        <div><span className="is-shade"><CloudSun size={18} /></span><small>Schatten</small><strong>{sunDuration(bench.shadeMinutesToday)}</strong></div>
        <i><b style={{ width: `${sunPercent}%` }} /></i>
      </div>
      <ObstructionSketch building={bench.buildingObstructionPercent} vegetation={bench.vegetationObstructionPercent} />
      <SeasonalLight bench={bench} />
      <DetailRows title="Himmelswerte" rows={[
        ["Sonnenaufgang", bench.sunrise],
        ["Sonnenuntergang", bench.sunset],
        ["Direkte Sonne ab", bench.directSunrise],
        ["Direkte Sonne bis", bench.directSunset],
        ["Sonnenhöhe", angle(bench.sunAltitudeDegrees)],
        ["Sonnenrichtung", direction(bench.sunAzimuthDegrees)],
        ["Mondlicht", `${Math.round(bench.moonIllumination * 100)}%`],
        ["Mondaufgang", bench.moonrise],
        ["Monduntergang", bench.moonset],
      ]} />
    </details>
  </section>;
}

function SunPath({ bench }: { bench: BenchDetail }) {
  const nowX = timelineX(bench.localMinutesNow);
  return <section className="daylight-story" aria-label={`Sonnenaufgang ${bench.sunrise}, Sonnenuntergang ${bench.sunset}. Mondaufgang ${bench.moonrise}, Monduntergang ${bench.moonset}.`}>
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
  const values: Array<[string, number | null]> = [
    ["Frühling", bench.sunMinutesSpring], ["Sommer", bench.sunMinutesSummer],
    ["Herbst", bench.sunMinutesAutumn], ["Winter", bench.sunMinutesWinter],
  ];
  const available = values.filter((item): item is [string, number] => item[1] !== null);
  if (!available.length) return null;
  const maximum = Math.max(...available.map((item) => item[1]), 1);
  return <div className="season-light" aria-label="Typische direkte Sonnendauer nach Jahreszeit">
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
function angle(value: number) { return `${Number(value.toFixed(1))}°`; }

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

function direction(value: number) {
  const names = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return `${names[Math.round(value / 45) % 8]} · ${Math.round(value)}°`;
}

function currentLight(bench: BenchDetail) {
  if (bench.shadeCause === "nacht") return bench.moonVisible ? "Mondlicht über dem Platz" : "Nacht über dem Platz";
  if (bench.sunnyNow === null) return "Die Lichtlage wird noch erkundet";
  return bench.sunnyNow ? "Die Bank liegt in direkter Sonne" : "Die Bank liegt im Schatten";
}

function lightSentence(bench: BenchDetail) {
  if (bench.shadeCause === "nacht") return `${bench.sunConfidence === "niedrig" ? "Im Modell waren" : "Heute waren"} ${sunDuration(bench.sunMinutesToday)} direkte Sonne möglich.`;
  if (bench.sunnyNow === null) return "Für eine sichere Aussage fehlen noch einzelne Umgebungsdaten.";
  if (bench.sunnyNow) return bench.weather && bench.weather.cloudCover > .65 ? "Geometrisch frei, doch Wolken dämpfen das Licht." : "Der Sonnenstrahl erreicht den Platz.";
  const causes = { frei: "freier Himmel", nacht: "die Nacht", überdacht: "die Überdachung", gebäude: "ein Gebäude", vegetation: "Bäume und Vegetation", gelände: "das Gelände", unbekannt: "eine noch unbekannte Ursache" } as const;
  return `Der Schatten kommt wahrscheinlich durch ${causes[bench.shadeCause]}.`;
}

function lightConfidenceLine(value: BenchDetail["sunConfidence"]) {
  if (value === "hoch") return "Aus Gelände, Gebäuden und Bewuchs berechnet · Wolken separat betrachtet.";
  if (value === "mittel") return "Gut angenäherte geometrische Lichtlage · Wolken separat betrachtet.";
  return "Vorläufige Schätzung · einzelne Umgebungsdaten fehlen noch.";
}
