"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, ExternalLink, Flag, Share2 } from "lucide-react";
import { reportContribution } from "@/app/actions/contributions";
import type { BenchDetail } from "@/lib/types";
import type { CurrentUser } from "@/lib/security";
import { RatingForm } from "./contribution-forms";
import { BenchCommunityActions } from "./bench-community-actions";
import { BenchLandscape } from "./bench-landscape";

const correctionLabels: Record<string, string> = {
  properties: "Ausstattung", condition: "Zustand", location: "Position", removed: "Nicht mehr vorhanden",
};

export function BenchDetailContent({ bench, user }: { bench: BenchDetail; user: CurrentUser | null }) {
  const [community, setCommunity] = useState(false);
  const [, startTransition] = useTransition();
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => {
    const result = await reportContribution(type, id);
    window.alert(result.message);
  });

  if (community) {
    return <div className="calm-detail pb-8">
      <button className="quiet-back" onClick={() => setCommunity(false)}><ArrowLeft size={17} /> Zum Platz</button>
      <Community bench={bench} report={report} user={user} />
    </div>;
  }

  return (
    <div className="calm-detail pb-8">
      <header className="calm-title">
        {bench.verificationStatus === "unverified" && <p className="unverified-note">Neu entdeckt · noch unbestätigt</p>}
        <h2>{bench.title}</h2>
        <p>{placeLine(bench)}</p>
      </header>

      <BenchLandscape bench={bench} />
      <p className="scene-caption">{sceneSentence(bench)}</p>

      <SunPath bench={bench} />
      <QuietDetails bench={bench} />
      <PhotoStory bench={bench} />

      <button className="community-door" onClick={() => setCommunity(true)}>
        <span><small>Von Menschen vor Ort</small>Stimmen aus der Nähe</span>
        <span aria-hidden>→</span>
      </button>

      <div className="quiet-actions">
        <button onClick={() => shareBench(bench)}><Share2 size={16} /> Teilen</button>
        {bench.osmType !== "community" && <a href={`https://www.openstreetmap.org/${bench.osmType}/${bench.osmId}`} target="_blank" rel="noreferrer">Quelle <ExternalLink size={14} /></a>}
      </div>
    </div>
  );
}

function SunPath({ bench }: { bench: BenchDetail }) {
  const sunrise = clockMinutes(bench.sunrise);
  const sunset = clockMinutes(bench.sunset);
  const moonrise = clockMinutes(bench.moonrise);
  const moonset = clockMinutes(bench.moonset);
  const nowX = timelineX(bench.localMinutesNow);
  const sunY = 58 - Math.max(0, Math.min(48, bench.sunAltitudeDegrees * .78));
  const moonY = 58 - Math.max(0, Math.min(38, bench.moonAltitudeDegrees * .68));
  return <section className="daylight-story" aria-label={`Sonnenaufgang ${bench.sunrise}, Sonnenuntergang ${bench.sunset}. Mondaufgang ${bench.moonrise}, Monduntergang ${bench.moonset}.`}>
    <div className="daylight-copy"><span>Himmelslauf</span><strong>{sunStory(bench)}</strong></div>
    <svg className="sky-arc" viewBox="0 0 320 72" aria-hidden="true">
      <path className="sky-horizon" d="M4 58H316" />
      {orbitPaths(sunrise, sunset, 48).map((path, index) => <path key={`sun-${index}`} className="sky-arc-line sky-arc-sun" d={path} />)}
      {orbitPaths(moonrise, moonset, 35).map((path, index) => <path key={`moon-${index}`} className="sky-arc-line sky-arc-moon" d={path} />)}
      {bench.sunWindows.map((window) => {
        const start = clockMinutes(window.start), end = clockMinutes(window.end);
        const path = start !== null && end !== null && sunrise !== null && sunset !== null ? orbitSectionPath(start, end, sunrise, sunset, 48) : null;
        return path ? <path key={`${window.start}-${window.end}`} className="sky-arc-light" d={path} /> : null;
      })}
      <path className="sky-now-line" d={`M${nowX} 5V61`} />
      {bench.sunAltitudeDegrees > 0 && <g className="sky-arc-now is-sun" transform={`translate(${nowX} ${sunY})`}><circle r="5" /></g>}
      {bench.moonVisible && <g className="sky-arc-now is-moon" transform={`translate(${nowX} ${moonY})`}><circle r="5" /><path d="M1-4a5 5 0 1 0 0 8 4 4 0 1 1 0-8Z" /></g>}
      <text className="sky-clock" x="4" y="70">0</text><text className="sky-clock" x="155" y="70">12</text><text className="sky-clock" x="307" y="70">24</text>
    </svg>
    <div className="sky-orbit-times"><span className="sun-time">☀ {bench.sunrise}–{bench.sunset}</span><span className="moon-time">☾ {bench.moonrise}–{bench.moonset}</span></div>
  </section>;
}

function QuietDetails({ bench }: { bench: BenchDetail }) {
  const rows: Array<[string, string | null]> = [];
  for (const property of bench.properties) if (property.value !== "Unbekannt") rows.push([property.label, property.value]);
  if (bench.directionDegrees !== null) rows.push(["Blickrichtung", compassDirection(bench.directionDegrees)]);
  if (bench.viewLabels.length) rows.push(["Aussicht", bench.viewLabels.slice(0, 2).map(friendlyViewLabel).join(" · ")]);
  const surroundings = surroundingsLine(bench);
  if (surroundings) rows.push(["Umgebung", surroundings]);
  if (bench.distanceWaterMeters !== null && !bench.waterfront) rows.push(["Wasser", distance(bench.distanceWaterMeters)]);
  if (bench.distancePathMeters !== null) rows.push(["Nächster Weg", distance(bench.distancePathMeters)]);
  if (bench.moonrise !== "–" || bench.moonset !== "–") rows.push(["Mond", `auf ${bench.moonrise} · unter ${bench.moonset}`]);
  if (bench.weather) rows.push(["Wetter", `${Math.round(bench.weather.temperatureC)}° bei ${bench.weather.location}`]);
  return <details className="quiet-details">
    <summary>Mehr über diesen Platz <span aria-hidden>＋</span></summary>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {bench.dedication && <blockquote>„{bench.dedication}“</blockquote>}
    {bench.likelyEnvironment?.evidence.length ? <details className="source-whisper"><summary>Bildquellen</summary><div>{bench.likelyEnvironment.evidence.map((item) => <a key={`${item.provider}-${item.captureGroup}`} href={item.sourceUrl} target="_blank" rel="noreferrer">{item.provider} · {item.distanceMeters} m</a>)}</div></details> : null}
  </details>;
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

async function shareBench(bench: BenchDetail) {
  const url = `${window.location.origin}/bank/${bench.id}`;
  if (navigator.share) await navigator.share({ title: bench.title, text: "Dieses Bänkli", url });
  else { await navigator.clipboard.writeText(url); window.alert("Link kopiert."); }
}

function sceneSentence(bench: BenchDetail) {
  const seed = [...bench.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const pick = (phrases: string[], salt: number) => phrases[(seed + salt * 17) % phrases.length];
  const light = bench.shadeCause === "nacht"
    ? bench.moonVisible
      ? pick(["Mondlicht ruht auf der Bank", "Silberlicht fällt auf stilles Holz", "Der Mond hüllt den Platz in Ruhe", "Leiser Mondschein berührt die Bank", "Die Nacht legt Silber auf den Platz"], 1)
      : pick(["Der Platz ruht unter Sternen", "Stille Nacht liegt über der Bank", "Die Bank träumt in tiefer Nacht", "Unter dunklem Himmel wird es still", "Die Nacht hält diesen Platz ganz leise"], 1)
    : bench.sunnyNow
      ? pick(["Sonne wärmt die Bank", "Goldenes Licht lädt zum Bleiben", "Die Sonne küsst stilles Holz", "Helles Licht tanzt über den Platz", "Ein warmer Sonnenfleck wartet hier"], 1)
      : bench.shadeCause === "gebäude"
        ? pick(["Kühler Schatten schenkt eine Pause", "Ein Haus hält still die Sonne fern", "Sanfter Schatten liegt auf der Bank", "Hier wird das Licht ganz weich", "Im Schatten wird der Augenblick ruhig"], 1)
        : bench.shadeCause === "vegetation"
          ? pick(["Blätter malen Schatten auf die Bank", "Grüner Schatten wiegt sich im Wind", "Licht flüstert durch die Blätter", "Unter Blättern wird die Welt leise", "Tanzende Schatten ruhen auf dem Holz"], 1)
          : pick(["Stiller Schatten lädt zum Verweilen", "Das Licht wird hier ganz leise", "Ein kühler Augenblick wartet", "Sanfter Schatten umarmt den Platz", "Hier atmet der Tag ein wenig aus"], 1);
  const view = bench.viewLabels.some((item) => item.includes("Berg"))
    ? pick(["Berge wachen in der Ferne", "Gipfel ziehen den Blick hinaus", "Die Alpen öffnen den Horizont", "Berglinien schweben am Horizont", "Der Blick wandert zu den Gipfeln"], 2)
    : bench.waterfront || bench.viewLabels.some((item) => item.includes("See") || item.includes("Wasser"))
      ? pick(["Das Wasser trägt den Blick davon", "Am Ufer wird die Zeit weit", "Licht wandert über das Wasser", "Der See schenkt dem Blick Ruhe", "Wasser und Himmel werden eins"], 2)
      : bench.inForest
        ? pick(["Der Wald flüstert ringsum", "Zwischen Bäumen wohnt die Ruhe", "Das Grün hält die Welt fern", "Blätter rahmen diesen stillen Ort", "Der Wald atmet ganz in der Nähe"], 2)
        : bench.viewLabels.some((item) => item.includes("Weit"))
          ? pick(["Der Himmel macht den Blick weit", "Weite liegt vor den Augen", "Der Horizont darf offen bleiben", "Der Blick findet freien Raum", "Hier wird der Himmel ein wenig grösser"], 2)
          : pick(["Ein stiller Weg zieht vorbei", "Die Welt wird für einen Moment leise", "Hier darf der Augenblick bleiben", "Ein kleiner Ort zum Durchatmen", "Die Zeit geht hier etwas langsamer"], 2);
  return `${light}. ${view}.`;
}

function placeLine(bench: BenchDetail) {
  return [bench.elevationMeters !== null ? `${Math.round(bench.elevationMeters)} m ü. M.` : null, bench.locationName, bench.locationCanton].filter(Boolean).join(" · ") || "Ein stiller Platz";
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

function orbitSectionPath(start: number, end: number, rise: number, set: number, height: number) {
  if (end <= start || set <= rise) return null;
  const points = Array.from({ length: 21 }, (_, index) => {
    const minute = start + (end - start) * index / 20;
    const phase = Math.max(0, Math.min(1, (minute - rise) / (set - rise)));
    return `${index ? "L" : "M"}${timelineX(minute).toFixed(1)} ${(58 - Math.sin(phase * Math.PI) * height).toFixed(1)}`;
  });
  return points.join(" ");
}

function orbitPaths(rise: number | null, set: number | null, height: number) {
  if (rise === null || set === null) return [];
  const unwrappedSet = set > rise ? set : set + 1440;
  const paths: string[] = [];
  for (const shift of [-1440, 0]) {
    const fullStart = rise + shift;
    const fullEnd = unwrappedSet + shift;
    const visibleStart = Math.max(0, fullStart);
    const visibleEnd = Math.min(1440, fullEnd);
    const path = orbitSectionPath(visibleStart, visibleEnd, fullStart, fullEnd, height);
    if (path) paths.push(path);
  }
  return paths;
}

function compassDirection(degrees: number) { const labels = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"]; return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % labels.length]; }
function distance(value: number) { if (value < 2) return "direkt daneben"; return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`; }
function sunDuration(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; if (!hours) return `${minutes} min`; return `${hours} h${minutes ? ` ${minutes} min` : ""}`; }
function friendlyViewLabel(label: string) { return ({ "Nahbereich weitgehend offen": "Freier Blick", "Nahbereich teilweise offen": "Etwas geschützt", "Nahbereich stark begrenzt": "Geschützt", "Keine besondere Aussicht": "Alltagsblick", "Eingeschränkte Aussicht": "Geschützt" } as Record<string, string>)[label] ?? label; }

// External Commons hosts are intentionally rendered directly so thumbnails are not rehosted or proxied.
// eslint-disable-next-line @next/next/no-img-element
function MediaImage({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} loading="lazy" />; }
