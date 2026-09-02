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
  return <section className="daylight-story" aria-label={`Direkte Sonne heute: ${sunDuration(bench.sunMinutesToday)}`}>
    <div className="daylight-copy"><span>Heute</span><strong>{sunStory(bench)}</strong></div>
    <div className="daylight-track" aria-hidden="true">
      <span className="daylight-line" />
      {bench.sunWindows.map((window) => <span key={`${window.start}-${window.end}`} className="daylight-window" style={{ left: `${clockPercent(window.start, bench.sunrise, bench.sunset)}%`, width: `${Math.max(2, clockPercent(window.end, bench.sunrise, bench.sunset) - clockPercent(window.start, bench.sunrise, bench.sunset))}%` }} />)}
      {bench.dayPhase !== "night" && <span className="daylight-now" style={{ left: `${bench.daylightProgress * 100}%` }} />}
    </div>
    <div className="daylight-times"><span>{bench.sunrise}</span><span>{bench.sunset}</span></div>
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
    {user && <RatingForm benchId={bench.id} />}
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
  const light = bench.shadeCause === "nacht" ? "Der Platz ruht im Mondlicht" : bench.sunnyNow ? "Hier fällt gerade Sonne auf die Bank" : "Hier ist es gerade schattig";
  const view = bench.viewLabels.some((item) => item.includes("Berg")) ? "mit Bergen im Blick" : bench.waterfront || bench.viewLabels.some((item) => item.includes("See") || item.includes("Wasser")) ? "nah am Wasser" : bench.inForest ? "zwischen Bäumen" : null;
  return `${light}${view ? `, ${view}` : ""}.`;
}

function placeLine(bench: BenchDetail) {
  return [bench.elevationMeters !== null ? `${Math.round(bench.elevationMeters)} m ü. M.` : null, bench.locationName, bench.locationCanton].filter(Boolean).join(" · ") || "Ein stiller Platz";
}

function sunStory(bench: BenchDetail) {
  if (bench.shadeCause === "nacht") return "Mond über dem Platz";
  if (bench.sunnyNow) return `${sunDuration(bench.sunMinutesToday)} Sonne`;
  return bench.sunMinutesToday > 0 ? "Sonne kommt und geht" : "Ein schattiger Platz";
}

function surroundingsLine(bench: BenchDetail) {
  if (bench.waterfront) return "Direkt am Wasser";
  return ({ forest: "Wald", forest_edge: "Waldrand", park: "Park", open: "Offenes Gelände", urban: "Im Ort", mixed: "Gemischte Landschaft", unknown: null } as const)[bench.landContext ?? "unknown"];
}

function clockPercent(value: string, sunrise: string, sunset: string) {
  const minutes = (clock: string) => {
    const match = clock.match(/(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const current = minutes(value), start = minutes(sunrise), end = minutes(sunset);
  if (current === null || start === null || end === null || end <= start) return 0;
  return Math.max(0, Math.min(100, ((current - start) / (end - start)) * 100));
}

function compassDirection(degrees: number) { const labels = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"]; return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % labels.length]; }
function distance(value: number) { if (value < 2) return "direkt daneben"; return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`; }
function sunDuration(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; if (!hours) return `${minutes} min`; return `${hours} h${minutes ? ` ${minutes} min` : ""}`; }
function friendlyViewLabel(label: string) { return ({ "Nahbereich weitgehend offen": "Freier Blick", "Nahbereich teilweise offen": "Etwas geschützt", "Nahbereich stark begrenzt": "Geschützt", "Keine besondere Aussicht": "Alltagsblick", "Eingeschränkte Aussicht": "Geschützt" } as Record<string, string>)[label] ?? label; }

// External Commons hosts are intentionally rendered directly so thumbnails are not rehosted or proxied.
// eslint-disable-next-line @next/next/no-img-element
function MediaImage({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} loading="lazy" />; }
