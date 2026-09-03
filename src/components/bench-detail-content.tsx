"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, Flag, MessageCircleHeart } from "lucide-react";
import { reportContribution } from "@/app/actions/contributions";
import type { BenchDetail } from "@/lib/types";
import type { CurrentUser } from "@/lib/security";
import { scenePoem } from "@/lib/scene-poetry";
import { CorrectionForm, RatingForm } from "./contribution-forms";
import { BenchCommunityActions } from "./bench-community-actions";
import { BenchLandscape } from "./bench-landscape";

const correctionLabels: Record<string, string> = {
  properties: "Ausstattung", condition: "Zustand", location: "Position", removed: "Nicht mehr vorhanden", environment: "Umgebung, Aussicht oder Licht",
};

export function BenchDetailContent({ bench, user }: { bench: BenchDetail; user: CurrentUser | null }) {
  const [community, setCommunity] = useState(false);
  const [, startTransition] = useTransition();
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => {
    const result = await reportContribution(type, id);
    window.alert(result.message);
  });

  if (community) {
    return <div className="calm-detail community-detail pb-8">
      <button className="quiet-back" onClick={() => setCommunity(false)}><ArrowLeft size={17} /> Zum Platz</button>
      <Community bench={bench} report={report} user={user} />
    </div>;
  }

  const poem = scenePoem(bench);

  return (
    <div className="calm-detail pb-8">
      <section className="bench-story-card">
        <BenchLandscape bench={bench} />
        <header className="calm-title">
          {bench.verificationStatus === "unverified" && <p className="unverified-note">Neu entdeckt · noch unbestätigt</p>}
          <h2>{bench.title}</h2>
          <div className="calm-title-meta"><p>{placeLine(bench)}</p><button className="title-community-action" onClick={() => setCommunity(true)}><MessageCircleHeart size={16} aria-hidden="true" /><span>{bench.myRating ? "Deine Stimme" : "Stimmen"}</span>{bench.ratingCount > 0 && <small>{bench.ratingCount}</small>}</button></div>
        </header>
      </section>

      <div className="calm-story-body">
        <p className="scene-caption"><span>{poem.first}</span>{" "}<span>{poem.second}</span></p>

        <QuietDetails bench={bench} signedIn={Boolean(user)} />
        <PhotoStory bench={bench} />

      </div>
    </div>
  );
}

function SunPath({ bench }: { bench: BenchDetail }) {
  const nowX = timelineX(bench.localMinutesNow);
  const sunY = trackY(bench.sunAltitudeDegrees);
  const moonY = trackY(bench.moonAltitudeDegrees);
  return <section className="daylight-story" aria-label={`Sonnenaufgang ${bench.sunrise}, Sonnenuntergang ${bench.sunset}. Mondaufgang ${bench.moonrise}, Monduntergang ${bench.moonset}.`}>
    <div className="daylight-copy"><span>Himmelslauf</span><strong>{sunStory(bench)}</strong></div>
    <svg className="sky-arc" viewBox="0 0 320 72" aria-hidden="true">
      <path className="sky-horizon" d="M4 58H316" />
      {trackPaths(bench.skyTrack.sun).map((path, index) => <path key={`sun-${index}`} className="sky-arc-line sky-arc-sun" d={path} />)}
      {trackPaths(bench.skyTrack.moon).map((path, index) => <path key={`moon-${index}`} className="sky-arc-line sky-arc-moon" d={path} />)}
      {bench.sunWindows.map((window) => {
        const start = clockMinutes(window.start), end = clockMinutes(window.end);
        return start !== null && end !== null ? <path key={`${window.start}-${window.end}`} className="sky-light-window" d={`M${timelineX(start)} 61H${timelineX(end)}`} /> : null;
      })}
      <path className="sky-now-line" d={`M${nowX} 5V61`} />
      {bench.sunAltitudeDegrees > 0 && <g className="sky-arc-now is-sun" transform={`translate(${nowX} ${sunY})`}><circle r="4.5" /><path className="sun-rays" d="M0-9v2M0 7v2M-9 0h2M7 0h2M-6-6l1.5 1.5M4.5 4.5 6 6M6-6 4.5-4.5M-4.5 4.5-6 6" /></g>}
      {bench.moonVisible && <g className="sky-arc-now is-moon" transform={`translate(${nowX} ${moonY})`}><path d="M2-5a6 6 0 1 0 0 10 5 5 0 1 1 0-10Z" /></g>}
      <text className="sky-clock" x="4" y="70">0</text><text className="sky-clock" x="155" y="70">12</text><text className="sky-clock" x="307" y="70">24</text>
    </svg>
  </section>;
}

function QuietDetails({ bench, signedIn }: { bench: BenchDetail; signedIn: boolean }) {
  return <details className="quiet-details">
    <summary>Details <span aria-hidden>＋</span></summary>
    <div className="detail-chapters">
      <DetailChapter title="Die Bank" rows={[
        ...bench.properties.map((property) => [property.label, property.value] as [string, string]),
        ["Blickrichtung", direction(bench.directionDegrees)],
        ["Widmung", bench.dedication],
        ["Beschreibung", bench.description],
      ]} />
      <section className="detail-chapter">
        <h3>Aussicht</h3>
        <MetricSketch values={[
          ["Freiraum", bench.viewComponents.openness],
          ["Relief", bench.viewComponents.relief],
          ["Wasser", bench.viewComponents.water],
          ["Natur", bench.viewComponents.naturalness],
          ["Ruhe", bench.viewComponents.remoteness],
        ]} />
        <DetailRows title="Aussicht" rows={[
        ["Eindruck", bench.viewLabels.join(" · ") || "Noch offen"],
        ["Aussichtswert", bench.viewScore === null ? "Noch offen" : `${bench.viewScore} von 5`],
        ["Sicherheit", confidence(bench.viewConfidence)],
        ["Analysebereich", bench.analysisCoverage === "terrain" ? "Nahbereich und Gelände bis 20 km" : "Nahbereich; Gelände noch offen"],
        ["Höhe", bench.elevationMeters === null ? "Noch offen" : `${Math.round(bench.elevationMeters)} m ü. M.`],
        ["Freie Gebäudesicht", inversePercent(bench.buildingObstructionPercent)],
        ["Freie Vegetationssicht", inversePercent(bench.vegetationObstructionPercent)],
        ["Nächstes Gebäude", nullableDistance(bench.distanceBuildingMeters)],
        ["Gebäude in 100 m", bench.buildingCount100m === null ? "Noch offen" : String(bench.buildingCount100m)],
        ...bench.viewExplanation.map((explanation, index) => [modelName(explanation, index), explanation] as [string, string]),
        ]} />
      </section>
      <section className="detail-chapter">
        <h3>Licht & Himmel</h3>
        <SunPath bench={bench} />
        <ObstructionSketch building={bench.buildingObstructionPercent} vegetation={bench.vegetationObstructionPercent} />
        <DetailRows title="Licht & Himmel" rows={[
        ["Gerade", currentLight(bench)],
        ["Ursache", shadeCause(bench.shadeCause)],
        ["Gebäudeschatten jetzt", shadowNow(bench, "gebäude")],
        ["Vegetationsschatten jetzt", shadowNow(bench, "vegetation")],
        ["Geländeschatten jetzt", shadowNow(bench, "gelände")],
        ["Gebäude am Horizont", percent(bench.buildingObstructionPercent)],
        ["Vegetation am Horizont", percent(bench.vegetationObstructionPercent)],
        ["Direkte Sonne heute", sunDuration(bench.sunMinutesToday)],
        ["Sonnenfenster", bench.sunWindows.map((window) => `${window.start}–${window.end}`).join(" · ") || "Keine direkte Sonne"],
        ["Sonnenaufgang", bench.sunrise],
        ["Sonnenuntergang", bench.sunset],
        ["Direkter Sonnenbeginn", bench.directSunrise],
        ["Direktes Sonnenende", bench.directSunset],
        ["Sonnenhöhe", angle(bench.sunAltitudeDegrees)],
        ["Sonnenrichtung", direction(bench.sunAzimuthDegrees)],
        ["Sicherheit", confidence(bench.sunConfidence)],
        ["Sonne im Frühling", seasonalSun(bench.sunMinutesSpring)],
        ["Sonne im Sommer", seasonalSun(bench.sunMinutesSummer)],
        ["Sonne im Herbst", seasonalSun(bench.sunMinutesAutumn)],
        ["Sonne im Winter", seasonalSun(bench.sunMinutesWinter)],
        ["Mond", `${Math.round(bench.moonIllumination * 100)}% beleuchtet`],
        ["Mondaufgang", bench.moonrise],
        ["Monduntergang", bench.moonset],
        ["Mondhöhe", angle(bench.moonAltitudeDegrees)],
        ["Mondrichtung", direction(bench.moonAzimuthDegrees)],
        ]} />
      </section>
      <section className="detail-chapter">
        <h3>Umgebung</h3>
        <CanopySketch values={[bench.canopyShare3m, bench.canopyShare10m, bench.canopyShare25m]} />
        <DetailRows title="Umgebung" rows={[
        ["Position", `${bench.latitude.toFixed(6)}, ${bench.longitude.toFixed(6)}`],
        ["Jahreszeit im Bild", season(bench.season)],
        ["Landschaft", surroundingsLine(bench) ?? "Noch offen"],
        ["Wald", yesNoOpen(bench.inForest)],
        ["Baumdach", canopy(bench.canopyContext)],
        ["Baumdeckung", percent(bench.canopyPercent)],
        ["Baumdeckung in 3 m", percent(bench.canopyShare3m)],
        ["Baumdeckung in 10 m", percent(bench.canopyShare10m)],
        ["Baumdeckung in 25 m", percent(bench.canopyShare25m)],
        ["Mittlere Vegetationshöhe", meters(bench.vegetationMedianHeight)],
        ["Höchste Vegetation", meters(bench.vegetationMaxHeight)],
        ["Wasser", bench.waterfront ? "Direkt am Wasser" : nullableDistance(bench.distanceWaterMeters)],
        ["Nächster Weg", nullableDistance(bench.distancePathMeters)],
        ]} />
      </section>
      {bench.weather && <section className="detail-chapter">
        <h3>Wetter</h3>
        <WeatherSketch low={bench.weather.cloudLow} mid={bench.weather.cloudMid} high={bench.weather.cloudHigh} />
        <DetailRows title="Wetter" rows={[
        ["Temperatur", `${Math.round(bench.weather.temperatureC)} °C bei ${bench.weather.location}`],
        ["Himmel", cloudDescription(bench.weather.cloudCover)],
        ["Tiefe Wolken", percentFraction(bench.weather.cloudLow)],
        ["Mittlere Wolken", percentFraction(bench.weather.cloudMid)],
        ["Hohe Wolken", percentFraction(bench.weather.cloudHigh)],
        ["Niederschlag", precipitation(bench.weather.precipitationType)],
        ["Intensität", bench.weather.precipitationRateMmH === null ? "Kein Messwert" : `${bench.weather.precipitationRateMmH.toFixed(1)} mm/h`],
        ["Wind", bench.weather.windKmh === null ? "Kein Messwert" : `${Math.round(bench.weather.windKmh)} km/h`],
        ["Luftfeuchtigkeit", percent(bench.weather.humidityPercent)],
        ["Schneedecke", percent(bench.weather.snowCoverPercent)],
        ["Schneehöhe", bench.weather.snowDepthCm === null ? "Kein Messwert" : `${Math.round(bench.weather.snowDepthCm)} cm`],
        ["Schneefallgrenze", bench.weather.snowfallLimitMeters === null ? "Kein Messwert" : `${Math.round(bench.weather.snowfallLimitMeters)} m ü. M.`],
        ["Messzeit", readableDate(bench.weather.observedAt)],
        ]} />
      </section>}
      {bench.likelyEnvironment?.traits.length ? <DetailChapter title="Hinweise aus Bildern der Umgebung" rows={bench.likelyEnvironment.traits.map((trait) => [trait.label, `${Math.round(trait.probability * 100)}% wahrscheinlich`] as [string, string])} /> : null}
      <details className="data-report">
        <summary><Flag size={16} /> Datenfehler melden</summary>
        {signedIn ? <CorrectionForm benchId={bench.id} /> : <p>Zum Melden bitte kurz über das Menü anmelden.</p>}
      </details>
      <ModelThanks bench={bench} />
    </div>
  </details>;
}

function DetailChapter({ title, rows }: { title: string; rows: Array<[string, string | null]> }) {
  return <section className="detail-chapter"><h3>{title}</h3><DetailRows title={title} rows={rows} /></section>;
}

function DetailRows({ title, rows }: { title: string; rows: Array<[string, string | null]> }) {
  return <dl>{rows.filter(([, value]) => value !== null).map(([label, value]) => <div key={`${title}-${label}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function MetricSketch({ values }: { values: Array<[string, number | null]> }) {
  return <div className="metric-sketch" aria-label="Bestandteile der Aussichtswertung">
    {values.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${Math.round((value ?? 0) * 100)}%` }} /></i><small>{value === null ? "–" : Math.round(value * 100)}</small></div>)}
  </div>;
}

function ObstructionSketch({ building, vegetation }: { building: number | null; vegetation: number | null }) {
  const buildings = Math.max(0, Math.min(100, building ?? 0));
  const plants = Math.max(0, Math.min(100 - buildings, vegetation ?? 0));
  const open = Math.max(0, 100 - buildings - plants);
  return <div className="horizon-sketch" aria-label={`Horizont: ${Math.round(open)} Prozent frei, ${Math.round(buildings)} Prozent Gebäude, ${Math.round(plants)} Prozent Vegetation`}>
    <div><i className="is-open" style={{ width: `${open}%` }} /><i className="is-building" style={{ width: `${buildings}%` }} /><i className="is-vegetation" style={{ width: `${plants}%` }} /></div>
    <p><span>frei {Math.round(open)}%</span><span>Gebäude {Math.round(buildings)}%</span><span>Bäume {Math.round(plants)}%</span></p>
  </div>;
}

function CanopySketch({ values }: { values: Array<number | null> }) {
  return <div className="canopy-sketch" aria-label="Baumdeckung im Nahbereich">
    {values.map((value, index) => <span key={index} style={{ "--canopy": `${Math.max(10, value ?? 10) / 100}` } as CSSProperties}><i />{["3 m", "10 m", "25 m"][index]}</span>)}
  </div>;
}

function WeatherSketch({ low, mid, high }: { low: number | null; mid: number | null; high: number | null }) {
  return <div className="weather-sketch" aria-label="Wolkenschichten">
    {[["hoch", high], ["mittel", mid], ["tief", low]].map(([label, raw]) => { const value = typeof raw === "number" ? raw : 0; return <div key={String(label)}><span>{label}</span><i style={{ opacity: .16 + value * .8, transform: `scaleX(${.22 + value * .78})` }} /></div>; })}
  </div>;
}

function modelName(explanation: string, index: number) {
  if (/Horizont|Himmelsoffenheit|verdeckt/i.test(explanation)) return "Horizontblick";
  if (/Gelände|Relief|Fernsicht/i.test(explanation)) return "Gelände & Fernsicht";
  if (/Nahbereich|Gebäude|Einzelb/i.test(explanation)) return "Nahraum & Gebäude";
  if (/Wasser/i.test(explanation)) return "Wasserlinien";
  if (/natürliche Umgebung/i.test(explanation)) return "Landschaftsbild";
  return `Umgebungsbild ${index + 1}`;
}

function ModelThanks({ bench }: { bench: BenchDetail }) {
  return <footer className="model-thanks">
    <p>Diese kleine Landschaft entsteht dank Daten von</p>
    <div>
      {bench.osmType !== "community" && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>}
      <a href="https://www.swisstopo.admin.ch/de/geodaten-kostenlos-online" target="_blank" rel="noreferrer">swisstopo Gelände & Gebäude</a>
      {bench.weather && <a href="https://www.meteoschweiz.admin.ch/service-und-publikationen/service/open-data.html" target="_blank" rel="noreferrer">MeteoSchweiz</a>}
      {bench.media.length > 0 && <a href="https://commons.wikimedia.org/" target="_blank" rel="noreferrer">Wikimedia Commons</a>}
      {bench.ratingCount > 0 && <span>Menschen vor Ort</span>}
    </div>
    <small>{bench.pipelineVersion ?? "Umgebungsmodell"} · Quelldaten {readableDate(bench.sourceUpdatedAt)}</small>
    {bench.likelyEnvironment?.evidence.length ? <details className="source-whisper"><summary>Verwendete Umgebungsbilder</summary><div>{bench.likelyEnvironment.evidence.map((item) => <a key={`${item.provider}-${item.captureGroup}`} href={item.sourceUrl} target="_blank" rel="noreferrer">{item.provider} · {item.distanceMeters} m</a>)}</div></details> : null}
  </footer>;
}

function PhotoStory({ bench }: { bench: BenchDetail }) {
  const media = [...bench.media.filter((item) => item.relation === "exact"), ...bench.media.filter((item) => item.relation === "nearby")];
  if (!media.length) return null;
  return <section className="photo-story">
    <h3>Ein Blick in die Nähe</h3>
    <div className="photo-ribbon">{media.map((item) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer">
      <MediaImage src={item.thumbnailUrl} alt={item.title ?? "Bild aus der Umgebung der Sitzbank"} />
      <span>{item.relation === "nearby" ? "Aus der Umgebung" : item.title ?? "Dieser Platz"}</span>
      <small>{item.author ?? item.provider} · {item.license ?? "Lizenz bei Quelle"}</small>
    </a>)}</div>
  </section>;
}

function Community({ bench, report, user }: { bench: BenchDetail; report: (type: "rating" | "correction", id: number) => void; user: CurrentUser | null }) {
  return <div className="community-page">
    <header><small>Von Menschen vor Ort</small><h3>Wie war die Pause?</h3></header>
    {bench.ratingBreakdown && <div className="rating-line">{Object.entries({ Gesamt: bench.ratingBreakdown.overall, Aussicht: bench.ratingBreakdown.view, Komfort: bench.ratingBreakdown.comfort, Ruhe: bench.ratingBreakdown.quiet }).map(([label, value]) => <span key={label}><strong>{value}</strong><small>{label}</small></span>)}</div>}
    {bench.recentRatings.map((rating) => <article key={rating.id} className="quiet-contribution"><div><strong>{rating.overall}/5</strong><time>{new Date(rating.createdAt).toLocaleDateString("de-CH")}</time><button aria-label="Bewertung melden" onClick={() => report("rating", rating.id)}><Flag size={14} /></button></div>{rating.note && <p>{rating.note}</p>}</article>)}
    {user && <RatingForm benchId={bench.id} rating={bench.myRating} />}
    {bench.corrections.length > 0 && <section className="community-notes"><h3>Hinweise</h3>{bench.corrections.map((item) => <article key={item.id} className="quiet-contribution"><div><small>{correctionLabels[item.field] ?? item.field}</small><button aria-label="Korrektur melden" onClick={() => report("correction", item.id)}><Flag size={14} /></button></div><strong>{item.proposedValue}</strong>{item.note && <p>{item.note}</p>}</article>)}</section>}
    <BenchCommunityActions bench={bench} signedIn={Boolean(user)} />
  </div>;
}

function placeLine(bench: BenchDetail) {
  return [bench.elevationMeters !== null ? `${Math.round(bench.elevationMeters)} m ü. M.` : null, bench.locationName].filter(Boolean).join(" · ") || "Ein stiller Platz";
}

function sunStory(bench: BenchDetail) {
  if (bench.shadeCause === "nacht") return bench.moonVisible ? "Mondlicht über dem Platz" : "Der Mond kommt später";
  if (bench.sunnyNow) return `${sunDuration(bench.sunMinutesToday)} Sonne`;
  return bench.sunMinutesToday > 0 ? "Sonne kommt und geht" : "Ein schattiger Platz";
}

function surroundingsLine(bench: BenchDetail) {
  if (bench.waterfront) return "Direkt am Wasser";
  return ({ forest: "Wald", forest_edge: "Waldrand", park: "Park", open: "Offenes Gelände", urban: "Im Ort", mixed: "Gemischte Landschaft", unknown: null } as const)[bench.landContext ?? "unknown"];
}

function clockMinutes(clock: string) {
  const match = clock.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function timelineX(minutes: number) { return 4 + Math.max(0, Math.min(1440, minutes)) / 1440 * 312; }

function trackY(altitude: number) { return 58 - Math.max(0, Math.min(52, altitude * .78)); }

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

function distance(value: number) { if (value < 2) return "direkt daneben"; return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`; }
function sunDuration(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; if (!hours) return `${minutes} min`; return `${hours} h${minutes ? ` ${minutes} min` : ""}`; }
function seasonalSun(value: number | null) { return value === null ? "Noch offen" : `${sunDuration(value)} an einem typischen Tag`; }
function nullableDistance(value: number | null) { return value === null ? "Noch offen" : distance(value); }
function percent(value: number | null) { return value === null ? "Noch offen" : `${Math.round(value)}%`; }
function percentFraction(value: number | null) { return value === null ? "Kein Messwert" : `${Math.round(value * 100)}%`; }
function inversePercent(value: number | null) { return value === null ? "Noch offen" : `${Math.round(100 - value)}%`; }
function meters(value: number | null) { return value === null ? "Noch offen" : `${Number(value.toFixed(1))} m`; }
function angle(value: number) { return `${Number(value.toFixed(1))}°`; }
function yesNoOpen(value: boolean | null) { return value === null ? "Noch offen" : value ? "Ja" : "Nein"; }
function season(value: BenchDetail["season"]) { return ({ spring: "Frühling", summer: "Sommer", autumn: "Herbst", winter: "Winter" } as const)[value]; }
function confidence(value: BenchDetail["viewConfidence"]) { return ({ hoch: "Hoch", mittel: "Mittel", niedrig: "Noch unsicher" } as const)[value]; }
function canopy(value: BenchDetail["canopyContext"]) { return ({ none: "Frei", partial: "Teilweise", dense: "Dicht", unknown: "Noch offen" } as const)[value ?? "unknown"]; }
function direction(value: number | null) {
  if (value === null) return "Noch offen";
  const names = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return `${names[Math.round(value / 45) % 8]} · ${Math.round(value)}°`;
}
function shadeCause(value: BenchDetail["shadeCause"]) { return ({ frei: "Freier Himmel", nacht: "Nacht", überdacht: "Überdachung", gebäude: "Gebäude", vegetation: "Bäume und Vegetation", gelände: "Gelände", unbekannt: "Noch offen" } as const)[value]; }
function currentLight(bench: BenchDetail) { return bench.shadeCause === "nacht" ? bench.moonVisible ? "Mondlicht" : "Nacht" : bench.sunnyNow === null ? "Noch offen" : bench.sunnyNow ? "Direkte Sonne" : "Schatten"; }
function shadowNow(bench: BenchDetail, cause: "gebäude" | "vegetation" | "gelände") { return bench.shadeCause === "nacht" ? "Nicht beurteilbar bei Nacht" : bench.sunnyNow === null || bench.shadeCause === "unbekannt" ? "Noch offen" : bench.shadeCause === cause ? "Ja" : "Nein"; }
function precipitation(value: BenchDetail["weather"] extends infer Weather ? Weather extends { precipitationType: infer Type } ? Type : never : never) { return ({ none: "Trocken", rain: "Regen", snow: "Schnee", mixed: "Schneeregen", unknown: "Noch offen" } as const)[value]; }
function cloudDescription(value: number) { if (value >= .88) return "Bedeckt"; if (value >= .62) return "Stark bewölkt"; if (value >= .28) return "Wolkig"; if (value >= .1) return "Leicht bewölkt"; return "Klar"; }
function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Noch offen" : new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(date);
}

// External Commons hosts are intentionally rendered directly so thumbnails are not rehosted or proxied.
// eslint-disable-next-line @next/next/no-img-element
function MediaImage({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} loading="lazy" />; }
