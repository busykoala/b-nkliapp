"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { Footprints, X, Sun, Trees, MapPin } from "lucide-react";
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
    <div className="journey-chrome"><button aria-label="Spaziergang schliessen" onClick={onClose}><X size={18} /></button><button aria-label="Spaziergang vergrössern oder verkleinern" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className="journey-handle" /></button></div>
    <div className="journey-scroll"><header><span className="story-eyebrow">Zeit für ein Bänkli</span><h2 ref={title} tabIndex={-1}>Spaziergang entdecken</h2><p>Ein schöner Weg. Ein Bänkli zum Innehalten.</p></header>
      <section className="journey-controls" aria-label="Spaziergang planen">
        <StartPicker origin={p.origin} onChange={p.chooseOrigin} getMap={getMap} />
        <fieldset className="walk-options"><legend>Wie lange möchtest du gehen?</legend><div>{([30, 50, 120] as const).map((minutes) => <button key={minutes} aria-pressed={s.minutes === minutes} onClick={() => p.change({ minutes })}>ca. {minutes} min</button>)}</div></fieldset>
        <fieldset className="walk-options"><legend>Dein Weg</legend><div><button aria-pressed={s.shape === "loop"} onClick={() => p.change({ shape: "loop" })}>Rundweg</button><button aria-pressed={s.shape === "one-way"} onClick={() => p.change({ shape: "one-way" })}>Einfache Strecke</button></div></fieldset>
        <fieldset className="walk-options"><legend>Sonne oder Schatten?</legend><div><button aria-pressed={s.light === "any"} onClick={() => p.change({ light: "any" })}>Egal</button><button aria-pressed={s.light === "sun"} onClick={() => p.change({ light: "sun" })}><Sun size={18} /> Lieber Sonne</button><button aria-pressed={s.light === "shade"} onClick={() => p.change({ light: "shade" })}><Trees size={18} /> Lieber Schatten</button></div></fieldset>
        <details className="journey-adjust"><summary>Anpassen <small>{s.speed} km/h · {s.difficulty === "easy" ? "Leichte Wege" : "Bergwege bis T2"} · {s.time ? "Startzeit gewählt" : "Jetzt"}</small></summary>
          <fieldset className="walk-options"><legend>Dein Schritttempo</legend><div>{PACE_OPTIONS.map((v) => <button key={v.speed} aria-pressed={s.speed === v.speed} onClick={() => p.change({ speed: v.speed })}>{v.label}<small>{v.speed} km/h</small></button>)}</div></fieldset>
          <div className="journey-time"><label>Schwierigkeit<select value={s.difficulty} onChange={(e) => p.change({ difficulty: e.target.value as "easy" | "t2" })}><option value="easy">Leichte Wege</option><option value="t2">Bergwege bis T2</option></select></label><label>Startzeit (Schweiz; leer = jetzt)<input type="datetime-local" value={s.time} onChange={(e) => p.change({ time: e.target.value })} /></label></div>
        </details>
        <p className="journey-privacy">Standort nur auf Wunsch. Adress-/Stationssuche nutzt GeoAdmin und transport.opendata.ch; Fussrouting läuft auf unserem Server. Persönliche Routen bleiben höchstens fünf Minuten im Arbeitsspeicher, ohne Verlauf.</p>
        <button className="journey-submit" disabled={!p.origin || p.pending} onClick={p.submit}><Footprints size={20} />{p.pending ? "Dein Ausflug entsteht …" : p.result ? "Spaziergänge aktualisieren" : "Mein Bänkli entdecken"}</button>
        {p.pending && <p role="status">Die Karte bleibt beweglich. Die Suche dauert höchstens 15 Sekunden.</p>}
        {p.dirty && p.result && <p role="status">Auswahl geändert — der gezeigte Weg gilt noch für die vorherigen Einstellungen.</p>}
        {p.error && <p role="status">{p.error}</p>}
      </section>
      {p.result?.message && <p role="status">{p.result.message}</p>}
      {p.chosen && p.result && copy && <section className="journey-results" aria-label="Dein Spaziergang">
        <div className="journey-recommendation"><span className="story-eyebrow">Dein Bänkli-Ausflug</span><h2>{copy.title}</h2><p>ca. {journeyMinutes(p.chosen.durationSeconds)} · {p.result.query.shape === "loop" ? p.chosen.repeated ? "Hin- und Rückweg" : "Rundweg" : "Einfache Strecke"} · ↑ {Math.round(p.chosen.path.ascent)} m</p><p>{p.chosen.evidence.reasons.join(" · ")}</p><p className="walk-pause">{copy.pause}</p>{copy.discover && <button className="walk-discover" aria-pressed={p.extras} onClick={p.toggleExtras}>{copy.discover}</button>}</div>
        {p.result.query.difficulty === "t2" && <p className="journey-warning">Bergwege bis T2: Trittsicherheit erforderlich.</p>}
        {p.chosen.path.warnings.map((warning) => <p className="journey-warning" key={warning}>{warning}</p>)}
        {p.result.suggestions.length > 1 && <details><summary>Weitere Spaziergänge</summary><div className="journey-alternatives">{p.result.suggestions.filter((v) => v.id !== p.chosen?.id).map((v) => <button key={v.id} onClick={() => p.select(v)}><strong>{walkCopy([v.bench], p.result!.query.shape, v.extraBenches.length).title}</strong><span>ca. {journeyMinutes(v.durationSeconds)} · ↑ {Math.round(v.path.ascent)} m</span></button>)}</div></details>}
        <ol className="journey-thread"><li><MapPin size={20} /><strong>{p.result.query.origin.label}</strong><small>Hier beginnt dein Ausflug</small></li>{walkLegs(p.chosen, p.result.query).map((leg, i) => <li key={leg.id}><button className="journey-leg" onClick={() => p.focusLeg(leg)}><span className="journey-stamp">{i === 0 ? <img src="/map-art/v3/bench.png" width="44" height="44" alt="" /> : <Footprints size={24} />}</span><span><strong>{i === 0 ? copy.pause : "Zurück zum Ausgangspunkt"}</strong><span>{leg.to.label}</span></span></button></li>)}</ol>
        <details><summary>Wegbeschreibung</summary><ol className="walk-instructions">{p.chosen.path.instructions.map((step, i) => <li key={i}>{step.text}{step.distance > 0 && <small>{Math.round(step.distance)} m</small>}</li>)}</ol></details>
        <details><summary>Warum dieser Vorschlag?</summary><p>Wir vergleichen Ruhe, Natur, Aussicht, Wassernähe und das Bänkli entlang des tatsächlichen Wegs. Das ist eine datengestützte Einschätzung, keine Schönheitsgarantie.</p>{p.chosen.evidence.warnings.map((warning) => <p key={warning}>{warning}</p>)}<p>{p.chosen.evidence.updatedAt ? `Landschaftsdaten vom ${new Date(p.chosen.evidence.updatedAt).toLocaleDateString("de-CH")}.` : "Landschaftsdaten fehlen noch."} Bestätigte zusätzliche Bänkli haben einen kurzen geprüften Fusszugang; nicht geprüfte werden nicht gezählt.</p></details>
        {p.result.query.shape === "one-way" && <button className="journey-submit" onClick={() => { const journey = p.returnJourney(); if (journey) onReturn(journey); }}>Rückweg planen</button>}
      </section>}
      <footer className="journey-sources"><details><summary>Gut zu wissen & Quellen</summary><p>Die Gehzeit berücksichtigt Steigungen. Deine Bänkli-Pause kommt dazu. Bei einer einfachen Strecke ist der Rückweg nicht enthalten.</p><p>Leichte Wege nach verfügbaren Kartendaten. Fehlende Angaben, aktuelle Sperren und Schnee bleiben ungewiss.</p><p>Eigener GraphHopper-Router · © OpenStreetMap-Mitwirkende · swisstopo. Keine Zusage zu Barrierefreiheit oder Bergsicherheit. Lichtangaben sind eingeschränkt, wenn Schatten- oder Wetterdaten fehlen.</p><a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Attribution</a></details></footer>
    </div>
  </aside>;
}
