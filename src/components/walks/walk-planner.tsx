"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Footprints, X, Sun, Trees, MapPin } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { journeyMinutes, PACE_OPTIONS } from "@/lib/journey";
import { walkCopy } from "@/lib/walks/model";
import { StartPicker } from "../routing/start-picker";
import { useWalkPlanner, walkLegs } from "./use-walk-planner";
import type { ReturnJourney } from "@/lib/journey";

export function WalkPlanner({ getMap, onClose, onReturn }: { getMap: () => MapLibreMap | null; onClose: () => void; onReturn: (journey: ReturnJourney) => void }) {
  const [expanded, setExpanded] = useState(false); const title = useRef<HTMLHeadingElement>(null);
  const p = useWalkPlanner(getMap), s = p.settings;
  useEffect(() => { title.current?.focus(); }, []);
  const copy = p.chosen && p.result ? walkCopy([p.chosen.bench], p.result.query.shape, p.chosen.extraBenches.length) : null;
  return <aside className={`journey-panel storybook-panel ${expanded ? "is-expanded" : ""}`} aria-label="Spaziergang entdecken">
    <div className="journey-chrome"><button className="overlay-resize" aria-label="Spaziergang vergrössern oder verkleinern" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</button><button aria-label="Spaziergang schliessen" onClick={onClose}><X size={18} /></button></div>
    <div className="journey-scroll"><header><span className="story-eyebrow">Zeit für ein Bänkli</span><h2 ref={title} tabIndex={-1}>Spaziergang entdecken</h2><p>Ein schöner Weg. Ein Bänkli zum Innehalten.</p></header>
      <section className="journey-controls" aria-label="Spaziergang planen">
        <StartPicker origin={p.origin} onChange={p.chooseOrigin} getMap={getMap} />
        <fieldset className="walk-options"><legend>Wie lange möchtest du gehen?</legend><div>{([30, 50, 120] as const).map((minutes) => <button key={minutes} aria-pressed={s.minutes === minutes} onClick={() => p.change({ minutes })}>ca. {minutes} min</button>)}</div></fieldset>
        <details className="journey-adjust"><summary>Optionen <small>{s.shape === "loop" ? "Rundweg" : "Einfache Strecke"} · {s.speed} km/h{s.maxRestMinutes ? ` · Bänkli spätestens alle ${s.maxRestMinutes} min` : ""}</small></summary>
        <fieldset className="walk-options"><legend>Dein Weg</legend><div><button aria-pressed={s.shape === "loop"} onClick={() => p.change({ shape: "loop" })}>Rundweg</button><button aria-pressed={s.shape === "one-way"} onClick={() => p.change({ shape: "one-way" })}>Einfache Strecke</button></div></fieldset>
        <fieldset className="walk-options"><legend>Sonne oder Schatten?</legend><div><button aria-pressed={s.light === "any"} onClick={() => p.change({ light: "any" })}>Egal</button><button aria-pressed={s.light === "sun"} onClick={() => p.change({ light: "sun" })}><Sun size={18} /> Lieber Sonne</button><button aria-pressed={s.light === "shade"} onClick={() => p.change({ light: "shade" })}><Trees size={18} /> Lieber Schatten</button></div></fieldset>
          <fieldset className="walk-options"><legend>Dein Schritttempo</legend><div>{PACE_OPTIONS.map((v) => <button key={v.speed} aria-pressed={s.speed === v.speed} onClick={() => p.change({ speed: v.speed })}>{v.label}<small>{v.speed} km/h</small></button>)}</div></fieldset>
          <div className="journey-time"><label>Schwierigkeit<select value={s.difficulty} onChange={(e) => p.change({ difficulty: e.target.value as "easy" | "t2" })}><option value="easy">Leichte Wege</option><option value="t2">Bergwege bis T2</option></select></label><label>Startzeit (Schweiz; leer = jetzt)<input type="datetime-local" value={s.time} onChange={(e) => p.change({ time: e.target.value })} /></label></div>
          <fieldset className="walk-options rest-options"><legend>Spätestens alle … ein Bänkli</legend><div>{([undefined, 5, 10, 15] as const).map((minutes) => <button type="button" key={minutes ?? "any"} aria-pressed={s.maxRestMinutes === minutes} onClick={() => p.change({ maxRestMinutes: minutes })}>{minutes ? `${minutes} Min.` : "Egal"}</button>)}</div><p>Der gesamte Weg wird mit deinem Gehtempo geprüft, auch der erste und letzte Abschnitt. Gehzeiten bleiben Schätzungen.</p></fieldset>
        </details>
        <button className="journey-submit" disabled={!p.origin || p.pending} onClick={p.submit}><Footprints size={20} />{p.pending ? "Dein Ausflug entsteht …" : p.result ? "Spaziergänge aktualisieren" : "Bänkli-Spaziergang finden"}</button>
        {p.pending && <p role="status">Die Karte bleibt beweglich. Die Suche dauert höchstens 15 Sekunden.</p>}
        {p.dirty && p.result && <p role="status">Auswahl geändert — der gezeigte Weg gilt noch für die vorherigen Einstellungen.</p>}
        {p.error && <p role="status">{p.error}</p>}
      </section>
      {p.result?.message && <p role="status">{p.result.message}</p>}
      {p.chosen && p.result && copy && <section className="journey-results" aria-label="Dein Spaziergang">
        {p.result.suggestions.length > 1 && <fieldset className="walk-suggestion-picker"><legend>{p.result.suggestions.length} Spaziergänge zur Auswahl</legend><div>{p.result.suggestions.map((suggestion, index) => {
          const option = walkCopy([suggestion.bench], p.result!.query.shape, suggestion.extraBenches.length);
          return <button type="button" key={suggestion.id} aria-pressed={suggestion.id === p.chosen?.id} onClick={() => p.select(suggestion)}><span>{index === 0 ? "Empfohlen" : `Variante ${index + 1}`}</span><strong>{option.title}</strong><small>ca. {journeyMinutes(suggestion.durationSeconds)} · ↑ {Math.round(suggestion.path.ascent)} m</small></button>;
        })}</div></fieldset>}
        <div className="journey-recommendation"><span className="story-eyebrow">Dein Bänkli-Ausflug</span><h2>{copy.title}</h2><p>ca. {journeyMinutes(p.chosen.durationSeconds)} · {p.result.query.shape === "loop" ? p.chosen.repeated ? "Hin- und Rückweg" : "Rundweg" : "Einfache Strecke"} · ↑ {Math.round(p.chosen.path.ascent)} m</p><p>{p.chosen.evidence.reasons.join(" · ")}</p><p className="walk-pause">{copy.pause}</p>{copy.discover && <button className="walk-discover" aria-pressed={p.extras} onClick={p.toggleExtras}>{copy.discover}</button>}</div>
        {p.chosen.rest && <section className="walk-rest-summary" aria-label="Sitzpausen unterwegs"><h3>Sitzpausen unterwegs</h3><p>Höchstens ca. {Math.ceil(p.chosen.rest.maxGapSeconds / 60)} Min. am Stück zu Fuss · inklusive Start und Ziel</p><ol>{p.chosen.rest.stops.map((stop, index) => <li key={`${stop.bench.id}-${index}`}><a href={`/bank/${stop.bench.id}`} target="_blank" rel="noreferrer">{stop.bench.label}</a><span>nach ca. {Math.round(stop.routeSeconds / 60)} Min.</span></li>)}</ol></section>}
        {p.result.query.difficulty === "t2" && <p className="journey-warning">Bergwege bis T2: Trittsicherheit erforderlich.</p>}
        {p.chosen.path.warnings.map((warning) => <p className="journey-warning" key={warning}>{warning}</p>)}
        <ol className="journey-thread"><li><MapPin size={20} /><strong>{p.result.query.origin.label}</strong><small>Hier beginnt dein Ausflug</small></li>{walkLegs(p.chosen, p.result.query).map((leg, i) => <li key={leg.id}><button className="journey-leg" onClick={() => p.focusLeg(leg)}><span className="journey-stamp">{i === 0 ? <img src="/map-art/markers/bench.webp" width="44" height="44" alt="" /> : <Footprints size={24} />}</span><span><strong>{i === 0 ? copy.pause : "Zurück zum Ausgangspunkt"}</strong><span>{leg.to.label}</span></span></button></li>)}</ol>
        <details><summary>Wegbeschreibung</summary><ol className="walk-instructions">{p.chosen.path.instructions.map((step, i) => <li key={i}>{step.text}{step.distance > 0 && <small>{Math.round(step.distance)} m</small>}</li>)}</ol></details>
        <details><summary>Warum dieser Vorschlag?</summary><p>Wir vergleichen Ruhe, Natur, Aussicht, Wassernähe und das Bänkli entlang des tatsächlichen Wegs. Das ist eine datengestützte Einschätzung, keine Schönheitsgarantie.</p>{p.chosen.evidence.warnings.map((warning) => <p key={warning}>{warning}</p>)}<p>{p.chosen.evidence.updatedAt ? `Landschaftsdaten vom ${new Date(p.chosen.evidence.updatedAt).toLocaleDateString("de-CH")}.` : "Landschaftsdaten fehlen noch."} Bestätigte zusätzliche Bänkli haben einen kurzen geprüften Fusszugang; nicht geprüfte werden nicht gezählt.</p></details>
        {p.result.query.shape === "one-way" && <button className="journey-submit" onClick={() => { const journey = p.returnJourney(); if (journey) onReturn(journey); }}>Rückweg planen</button>}
      </section>}
      <footer className="journey-sources"><details><summary>Gut zu wissen</summary><p>Gehzeiten und Licht sind Schätzungen. Keine Zusage zu Barrierefreiheit, aktuellen Sperren, Schnee oder Bergsicherheit.</p><p>Standort nur auf Wunsch. Für die Suche werden Eingaben und Koordinaten an den benötigten Kartendienst übermittelt; Fussrouting läuft auf unserem Server. Persönliche Routen bleiben höchstens fünf Minuten im Arbeitsspeicher, ohne Verlauf.</p></details></footer>
    </div>
  </aside>;
}
