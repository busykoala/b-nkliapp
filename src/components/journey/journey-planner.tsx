"use client";
/* Tiny precompressed map sprites are shared directly with MapLibre. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Footprints, House, LocateFixed, MapPin, RefreshCw, Search, X } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { BenchDetail } from "@/lib/types";
import { journeyClock, journeyMinutes, PACE_OPTIONS, TRANSFER_LABELS, type JourneyLeg } from "@/lib/journey";
import { useJourneyPlanner } from "./use-journey-planner";
import { tightestTransfer, type JourneySettings } from "./planner-model";

export function JourneyPlanner({ bench, getMap, onClose }: { bench: BenchDetail; getMap: () => MapLibreMap | null; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const resultSection = useRef<HTMLElement>(null);
  const {
    origin, query, results, highlighted, setHighlighted, chooseOrigin, editQuery, dismissResults,
    settings, updateSettings,
    result, selected, activeLeg, option, error, dirty, pending, searching, locate, submit, selectOption, selectLeg,
  } = useJourneyPlanner(bench.id, getMap);
  const { mode, timeMode, time, speed, buffer } = settings;
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { if (result) resultSection.current?.scrollIntoView({ block: "start", behavior: "instant" }); }, [result]);
  return <aside className={`journey-panel storybook-panel ${expanded ? "is-expanded" : ""}`} aria-label="Dein Weg zum Bänkli">
    <div className="journey-chrome"><button aria-label="Reiseplan schliessen" onClick={onClose}><ArrowLeft size={18} /></button><button aria-label="Reiseplan vergrössern oder verkleinern" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className="journey-handle" /></button><button aria-label="Zurück zur Bank" onClick={onClose}><X size={18} /></button></div>
    <div className="journey-scroll">
      <header><span className="story-eyebrow">Ein kleiner Ausflug</span><h2 tabIndex={-1} ref={title}>Dein Weg zum Bänkli</h2><p className="journey-destination"><MapPin size={15} /> {bench.title}</p></header>
      <section className="journey-controls" aria-label="Reise planen">
        <label className="journey-search-label"><Search size={17} /><span className="sr-only">Start: Adresse oder Haltestelle</span><input role="combobox" aria-expanded={results.length > 0} aria-controls="journey-origins" aria-activedescendant={highlighted >= 0 ? `journey-origin-${highlighted}` : undefined} aria-autocomplete="list" placeholder="Wo beginnt dein Ausflug?" value={query} onKeyDown={(e) => {
          if (e.key === "Escape") dismissResults();
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) { e.preventDefault(); setHighlighted((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length); }
          if (e.key === "Enter" && results[highlighted]) { e.preventDefault(); chooseOrigin(results[highlighted]); setHighlighted(-1); }
        }} onChange={(e) => editQuery(e.target.value)} /></label>
        {searching && <small role="status">Startpunkte werden gesucht …</small>}
        <ul id="journey-origins" role="listbox" className="journey-origins" aria-label="Startpunkte">{results.map((p, i) => <li role="option" id={`journey-origin-${i}`} aria-selected={highlighted === i} key={`${p.kind}-${p.stationId ?? `${p.latitude}-${p.longitude}`}`}><button tabIndex={-1} onClick={() => chooseOrigin(p)}>{p.kind === "station" ? <TransportArt mode="rail" /> : <House size={22} />}<span>{p.label}<small>{p.kind === "station" ? "Haltestelle" : "Adresse"}</small></span></button></li>)}</ul>
        <button className="journey-location" onClick={locate}><LocateFixed size={17} /> Mein Standort</button><small>Oder eine Haltestelle auf der Karte antippen.</small>
        <div className="journey-modes">{(["transit", "walk"] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => updateSettings({ mode: m })}>{m === "walk" ? <Footprints size={19} /> : <TransportArt mode="rail" />}{m === "walk" ? "Nur zu Fuss" : "ÖV + Fusswege"}</button>)}</div>
        <div className="journey-time"><label>Wann?<select value={timeMode} onChange={(e) => updateSettings({ timeMode: e.target.value as JourneySettings["timeMode"] })}><option value="now">Jetzt losgehen</option><option value="departure">Abfahrt um …</option><option value="arrival">Ankommen bis …</option></select></label>{timeMode !== "now" && <label>Schweizer Zeit<input type="datetime-local" value={time} onChange={(e) => updateSettings({ time: e.target.value })} /></label>}</div>
        <fieldset className="journey-pace"><legend>Dein Schritttempo</legend><div>{PACE_OPTIONS.map((p, i) => <button key={p.speed} aria-pressed={speed === p.speed} onClick={() => updateSettings({ speed: p.speed })}><span className={`pace-drawing pace-${i}`}><Footprints size={24 + i * 3} /></span><strong>{p.label}</strong><small>{p.speed} km/h</small></button>)}</div><small>500 m in etwa {Math.ceil(500 / (speed / 3.6) / 60)} min · Steigung und Untergrund können bremsen.</small></fieldset>
        {mode === "transit" && <fieldset className="journey-buffer"><legend>Luft beim Umsteigen</legend><div>{([0, 3, 6, 10] as const).map((value) => <button key={value} aria-pressed={buffer === value} onClick={() => updateSettings({ buffer: value })}><span>+{value}</span><small>min</small></button>)}</div></fieldset>}
        <p className="journey-privacy">Beim Suchen und Planen gehen Eingaben und Koordinaten an GeoAdmin, transport.opendata.ch und FOSSGIS. Persönliche Routen bleiben hier höchstens fünf Minuten im Arbeitsspeicher, ohne Verlauf. Für die Anbieter gelten deren eigene Datenschutzregeln.</p>
        <button className="journey-submit" disabled={pending || !origin} onClick={() => submit()}><RefreshCw size={17} />{pending ? "Dein Weg wird gesucht …" : result ? "Verbindungen aktualisieren" : "Meinen Weg finden"}</button>
        {pending && <p role="status">Die Karte bleibt frei beweglich. Wege können bis zu 15 Sekunden benötigen.</p>}
        {dirty && result && <p role="status">Einstellungen geändert – bitte Verbindungen aktualisieren. Der gezeigte Plan gilt noch für die vorherige Auswahl.</p>}
        {error && <p role="status">{error}</p>}
      </section>
      {result && <section ref={resultSection} className="journey-results" aria-label="Deine Verbindungen">
        {result.message && <p role="status">{result.message}</p>}
        <div className="journey-alternatives">{result.options.map((o) => <button key={o.id} aria-pressed={o.id === selected} onClick={() => selectOption(o)}><strong>{journeyClock(o.arrival)} am Bänkli</strong><span>{journeyMinutes(o.durationSeconds)} · {journeyMinutes(o.walkingSeconds)} zu Fuss · {o.changes} Umstiege</span><small>{tightestTransfer(o)}</small>{(!o.complete || !o.feasible) && <small>Noch nicht vollständig geprüft</small>}</button>)}</div>
        {option && <ol className="journey-thread">{option.legs.map((leg) => <li key={leg.id} className={activeLeg === leg.id ? "is-active" : ""}>
          {leg.transfer && <details className={`journey-transfer tone-${leg.transfer.tone}`} onToggle={(e) => { if (e.currentTarget.open) selectLeg(leg, true) }}><summary>{TRANSFER_LABELS[leg.transfer.tone]} beim Umsteigen <ChevronDown size={16} /></summary><p>{journeyMinutes(leg.transfer.availableSeconds)} verfügbar · {leg.transfer.requiredSeconds === null ? "Wegzeit unbekannt" : `${journeyMinutes(leg.transfer.requiredSeconds)} benötigt`}</p>{leg.transfer.slackSeconds !== null && <p>{journeyMinutes(leg.transfer.slackSeconds)} Luft · gewünscht +{leg.transfer.bufferMinutes} min</p>}<p>Gehzeit: {leg.transfer.walkingSeconds === null ? "unbekannt" : journeyMinutes(leg.transfer.walkingSeconds)} · offizielle Mindestzeit: {leg.transfer.officialMinimumSeconds === null ? "nicht verfügbar" : journeyMinutes(leg.transfer.officialMinimumSeconds)}. Es zählt die grössere Zeit, nicht die Summe.</p><small>{leg.transfer.evidence}{leg.transfer.guaranteed ? " · Anschluss vorgesehen, aber nicht garantiert." : ""}</small></details>}
          <button className="journey-leg" onClick={() => selectLeg(leg)}><span className="journey-stamp"><TransportArt mode={leg.mode} /></span><span><small>{journeyClock(leg.departure)} → {journeyClock(leg.arrival)} · {leg.predicted ? "Prognose" : leg.mode === "walk" ? "geschätzt" : "Fahrplan"}</small><strong>{leg.mode === "walk" ? "Ein Stück zu Fuss" : `${leg.line}${leg.direction ? ` Richtung ${leg.direction}` : ""}`}</strong><span>{leg.from.label}{leg.from.platform ? ` · Gleis ${leg.from.platform}` : ""} → {leg.to.label}{leg.to.platform ? ` · Gleis ${leg.to.platform}` : ""}</span><small>{leg.geometryQuality === "missing" ? "Wegzeit unbekannt" : journeyMinutes(leg.durationSeconds)}{leg.distanceMeters !== undefined ? ` · ${Math.round(leg.distanceMeters)} m` : ""}{leg.geometryQuality === "schematic" ? " · Verlauf schematisch" : ""}</small></span></button>
          {leg.predicted && <small>Fahrplan: {journeyClock(leg.scheduledDeparture!)}–{journeyClock(leg.scheduledArrival!)}</small>}
          {leg.platformChanges?.map((change) => <p className="journey-warning" key={change}>{change}</p>)}
          {leg.warnings.map((warning) => <p className="journey-warning" key={warning}>{warning}</p>)}
        </li>)}<li className="journey-arrival"><img src="/map-art/v3/bench.png" alt="" width="44" height="44" /><strong>Ankommen. Platz nehmen.</strong></li></ol>}
        <button className="journey-location" disabled={pending} onClick={() => submit(timeMode === "arrival" ? -30 : 30)}>{timeMode === "arrival" ? "30 Minuten früher suchen" : "30 Minuten später suchen"}</button>
        <small>Abgefragt um {journeyClock(result.fetchedAt)} · {result.feedUpdatedAt ? `Transferdaten: ${new Date(result.feedUpdatedAt).toLocaleDateString("de-CH")}` : "Offizielle Transferdaten noch nicht verfügbar"}</small>
      </section>}
      <footer className="journey-sources"><p>ÖV-Linien sind schematisch. Fusswege und Gehzeiten sind Schätzungen, keine Zusage zu Barrierefreiheit oder Bergsicherheit.</p><a href="https://transport.opendata.ch" target="_blank" rel="noreferrer">Fahrplan: transport.opendata.ch</a><a href="https://opentransportdata.swiss" target="_blank" rel="noreferrer">Transferdaten: opentransportdata.swiss</a><a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">Fusswege: FOSSGIS / OSRM</a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap-Mitwirkende</a><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Kartenfehler melden</a></footer>
    </div>
  </aside>;
}
function TransportArt({ mode }: { mode: JourneyLeg["mode"] }) {
  return mode === "walk" ? <Footprints size={26} /> : <img src={`/map-art/v3/transit-${mode}.png`} alt="" width="42" height="42" />;
}
