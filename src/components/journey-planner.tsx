"use client";
/* Tiny precompressed map sprites are shared directly with MapLibre. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, ChevronDown, Footprints, House, LocateFixed, MapPin, RefreshCw, Search, X } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { BenchDetail } from "@/lib/types";
import { getJourney, searchJourneyOrigins } from "@/app/actions/journey";
import { journeyClock, journeyMinutes, PACE_OPTIONS, swissWallTime, swissWallTimeToIso, TRANSFER_LABELS, type JourneyLeg, type JourneyOption, type JourneyOrigin, type JourneyQuery, type JourneyResult } from "@/lib/journey";
import { clearJourneyMap, paintJourney } from "@/lib/journey-map";

export function JourneyPlanner({ bench, getMap, onClose }: { bench: BenchDetail; getMap: () => MapLibreMap | null; onClose: () => void }) {
  const [origin, setOrigin] = useState<JourneyOrigin | null>(null);
  const [query, setQuery] = useState(""); const [results, setResults] = useState<JourneyOrigin[]>([]); const [highlighted, setHighlighted] = useState(-1);
  const [mode, setMode] = useState<JourneyQuery["mode"]>("transit");
  const [timeMode, setTimeMode] = useState("now"); const [time, setTime] = useState(() => swissWallTime(new Date().toISOString()));
  const [speed, setSpeed] = useState<JourneyQuery["speedKmh"]>(() => readPreferences().speed); const [buffer, setBuffer] = useState<JourneyQuery["bufferMinutes"]>(() => readPreferences().buffer);
  const [result, setResult] = useState<JourneyResult | null>(null); const [selected, setSelected] = useState(""); const [activeLeg, setActiveLeg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false); const [error, setError] = useState(""); const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition(); const [searching, startSearch] = useTransition();
  const sequence = useRef(0); const searches = useRef(0); const locationSequence = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);
  const resultSection = useRef<HTMLElement>(null);
  const chooseOrigin = (p: JourneyOrigin) => { sequence.current++; searches.current++; locationSequence.current++; setOrigin(p); setQuery(p.label); setResults([]); setDirty(true); };
  useEffect(() => {
    title.current?.focus();
    const requestRef = sequence, searchRef = searches, locationRef = locationSequence;
    return () => { requestRef.current++; searchRef.current++; locationRef.current++; };
  }, []);
  useEffect(() => {
    const map = getMap(); if (!map) return;
    const camera = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    const click = (e: { point: { x: number; y: number } }) => {
      const ids = ["benchly-local-transit", "benchly-major-transit"].filter((id) => map.getLayer(id));
      if (!ids.length) return;
      const feature = map.queryRenderedFeatures([[e.point.x - 22, e.point.y - 22], [e.point.x + 22, e.point.y + 22]], { layers: ids })[0];
      if (feature?.geometry.type !== "Point" || !feature.properties?.station_id) return;
      chooseOrigin({ kind: "station", stationId: String(feature.properties.station_id), label: String(feature.properties["name:latin"] ?? feature.properties.name ?? "Haltestelle"), longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1] });
    };
    map.on("click", click);
    return () => { map.off("click", click); clearJourneyMap(map); map.jumpTo(camera); };
  }, [getMap]);
  useEffect(() => {
    const token = ++searches.current;
    if (query.trim().length < 2 || origin?.label === query) return;
    const timer = setTimeout(() => startSearch(async () => {
      try { const items = await searchJourneyOrigins(query); if (searches.current === token) { setResults(items); setHighlighted(-1); } }
      catch { if (searches.current === token) setError("Suche gerade nicht verfügbar. Bitte erneut versuchen."); }
    }), 350);
    return () => clearTimeout(timer);
  }, [query, origin]);
  useEffect(() => {
    const map = getMap(); if (!map || !result) return;
    let painted = false;
    const paint = () => { if (!painted) painted = paintJourney(map, result.options, selected, activeLeg); };
    const reload = () => { painted = false; paint(); };
    paint(); map.on("style.load", reload); map.on("idle", paint);
    return () => { map.off("style.load", reload); map.off("idle", paint); };
  }, [getMap, result, selected, activeLeg]);
  useEffect(() => { if (result) resultSection.current?.scrollIntoView({ block: "start", behavior: "instant" }); }, [result]);
  const changed = () => { sequence.current++; setDirty(true); };
  const locate = () => {
    if (!navigator.geolocation) { setError("Standortsuche wird hier nicht unterstützt."); return; }
    setError("Standort wird gesucht …"); const token = ++locationSequence.current;
    navigator.geolocation.getCurrentPosition((p) => {
      if (token !== locationSequence.current) return;
      chooseOrigin({ kind: "location", label: "Mein Standort", latitude: p.coords.latitude, longitude: p.coords.longitude });
      setError(p.coords.accuracy > 100 ? `Standort nur auf etwa ${Math.round(p.coords.accuracy)} m genau. Bitte prüfen.` : "");
    }, () => { if (token === locationSequence.current) setError("Standort nicht verfügbar. Wähle eine Adresse oder Haltestelle."); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };
  const focus = (legs: JourneyLeg[]) => {
    const points = legs.flatMap((l) => l.geometry.length ? l.geometry : [[l.from.longitude, l.from.latitude], [l.to.longitude, l.to.latitude]]);
    if (!points.length) return;
    const desktop = window.innerWidth >= 768;
    const bounds = points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    getMap()?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: { top: 90, left: 35, right: desktop ? 485 : 35, bottom: desktop ? 45 : window.innerHeight * .48 }, maxZoom: 17, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450 });
  };
  const submit = (offset = 0) => {
    if (!origin) { setError("Bitte einen Start auswählen."); return; }
    const chosenTime = timeMode === "now" ? new Date().toISOString() : swissWallTimeToIso(time);
    if (!chosenTime) { setError("Diese Schweizer Uhrzeit existiert nicht. Bitte das Datum prüfen."); return; }
    const at = new Date(Date.parse(chosenTime) + offset * 60000).toISOString();
    if (offset) { setTimeMode(timeMode === "arrival" ? "arrival" : "departure"); setTime(swissWallTime(at)); }
    const token = ++sequence.current; setError("");
    try { localStorage.setItem("benchly-journey-preferences", JSON.stringify({ speed, buffer })); } catch {}
    startTransition(async () => {
      try {
        const next = await getJourney({ benchId: bench.id, origin, mode, time: at, arriveBy: timeMode === "arrival", speedKmh: speed, bufferMinutes: buffer });
        if (sequence.current !== token) return;
        setResult(next); setDirty(false); setSelected(next.options[0]?.id ?? ""); setActiveLeg(null);
        if (next.options[0]) focus(next.options[0].legs);
      } catch { if (sequence.current === token) setError("Reiseplanung gerade nicht verfügbar oder zu viele Anfragen. Bitte kurz warten und erneut versuchen."); }
    });
  };
  const option = result?.options.find((o) => o.id === selected);
  return <aside className={`journey-panel storybook-panel ${expanded ? "is-expanded" : ""}`} aria-label="Dein Weg zum Bänkli">
    <div className="journey-chrome"><button aria-label="Reiseplan schliessen" onClick={onClose}><ArrowLeft size={18} /></button><button aria-label="Reiseplan vergrössern oder verkleinern" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className="journey-handle" /></button><button aria-label="Zurück zur Bank" onClick={onClose}><X size={18} /></button></div>
    <div className="journey-scroll">
      <header><span className="story-eyebrow">Ein kleiner Ausflug</span><h2 tabIndex={-1} ref={title}>Dein Weg zum Bänkli</h2><p className="journey-destination"><MapPin size={15} /> {bench.title}</p></header>
      <section className="journey-controls" aria-label="Reise planen">
        <label className="journey-search-label"><Search size={17} /><span className="sr-only">Start: Adresse oder Haltestelle</span><input role="combobox" aria-expanded={results.length > 0} aria-controls="journey-origins" aria-activedescendant={highlighted >= 0 ? `journey-origin-${highlighted}` : undefined} aria-autocomplete="list" placeholder="Wo beginnt dein Ausflug?" value={query} onKeyDown={(e) => {
          if (e.key === "Escape") { searches.current++; setResults([]); setHighlighted(-1); }
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) { e.preventDefault(); setHighlighted((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length); }
          if (e.key === "Enter" && results[highlighted]) { e.preventDefault(); chooseOrigin(results[highlighted]); setHighlighted(-1); }
        }} onChange={(e) => { changed(); searches.current++; setOrigin(null); setResults([]); setHighlighted(-1); setQuery(e.target.value); }} /></label>
        {searching && <small role="status">Startpunkte werden gesucht …</small>}
        <ul id="journey-origins" role="listbox" className="journey-origins" aria-label="Startpunkte">{results.map((p, i) => <li role="option" id={`journey-origin-${i}`} aria-selected={highlighted === i} key={`${p.kind}-${p.stationId ?? `${p.latitude}-${p.longitude}`}`}><button tabIndex={-1} onClick={() => chooseOrigin(p)}>{p.kind === "station" ? <TransportArt mode="rail" /> : <House size={22} />}<span>{p.label}<small>{p.kind === "station" ? "Haltestelle" : "Adresse"}</small></span></button></li>)}</ul>
        <button className="journey-location" onClick={locate}><LocateFixed size={17} /> Mein Standort</button><small>Oder eine Haltestelle auf der Karte antippen.</small>
        <div className="journey-modes">{(["transit", "walk"] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); changed(); }}>{m === "walk" ? <Footprints size={19} /> : <TransportArt mode="rail" />}{m === "walk" ? "Nur zu Fuss" : "ÖV + Fusswege"}</button>)}</div>
        <div className="journey-time"><label>Wann?<select value={timeMode} onChange={(e) => { setTimeMode(e.target.value); changed(); }}><option value="now">Jetzt losgehen</option><option value="departure">Abfahrt um …</option><option value="arrival">Ankommen bis …</option></select></label>{timeMode !== "now" && <label>Schweizer Zeit<input type="datetime-local" value={time} onChange={(e) => { setTime(e.target.value); changed(); }} /></label>}</div>
        <fieldset className="journey-pace"><legend>Dein Schritttempo</legend><div>{PACE_OPTIONS.map((p, i) => <button key={p.speed} aria-pressed={speed === p.speed} onClick={() => { setSpeed(p.speed); changed(); }}><span className={`pace-drawing pace-${i}`}><Footprints size={24 + i * 3} /></span><strong>{p.label}</strong><small>{p.speed} km/h</small></button>)}</div><small>500 m in etwa {Math.ceil(500 / (speed / 3.6) / 60)} min · Steigung und Untergrund können bremsen.</small></fieldset>
        {mode === "transit" && <fieldset className="journey-buffer"><legend>Luft beim Umsteigen</legend><div>{([0, 3, 6, 10] as const).map((value) => <button key={value} aria-pressed={buffer === value} onClick={() => { setBuffer(value); changed(); }}><span>+{value}</span><small>min</small></button>)}</div></fieldset>}
        <p className="journey-privacy">Beim Suchen und Planen gehen Eingaben und Koordinaten an GeoAdmin, transport.opendata.ch und FOSSGIS. Persönliche Routen bleiben hier höchstens fünf Minuten im Arbeitsspeicher, ohne Verlauf. Für die Anbieter gelten deren eigene Datenschutzregeln.</p>
        <button className="journey-submit" disabled={pending || !origin} onClick={() => submit()}><RefreshCw size={17} />{pending ? "Dein Weg wird gesucht …" : result ? "Verbindungen aktualisieren" : "Meinen Weg finden"}</button>
        {pending && <p role="status">Die Karte bleibt frei beweglich. Wege können bis zu 15 Sekunden benötigen.</p>}
        {dirty && result && <p role="status">Einstellungen geändert – bitte Verbindungen aktualisieren. Der gezeigte Plan gilt noch für die vorherige Auswahl.</p>}
        {error && <p role="status">{error}</p>}
      </section>
      {result && <section ref={resultSection} className="journey-results" aria-label="Deine Verbindungen">
        {result.message && <p role="status">{result.message}</p>}
        <div className="journey-alternatives">{result.options.map((o) => <button key={o.id} aria-pressed={o.id === selected} onClick={() => { setSelected(o.id); setActiveLeg(null); focus(o.legs); }}><strong>{journeyClock(o.arrival)} am Bänkli</strong><span>{journeyMinutes(o.durationSeconds)} · {journeyMinutes(o.walkingSeconds)} zu Fuss · {o.changes} Umstiege</span><small>{tightestTransfer(o)}</small>{(!o.complete || !o.feasible) && <small>Noch nicht vollständig geprüft</small>}</button>)}</div>
        {option && <ol className="journey-thread">{option.legs.map((leg) => <li key={leg.id} className={activeLeg === leg.id ? "is-active" : ""}>
          {leg.transfer && <details className={`journey-transfer tone-${leg.transfer.tone}`} onToggle={(e) => { if (e.currentTarget.open) { setActiveLeg(leg.id); focus([{ ...leg, geometry: [[leg.from.longitude, leg.from.latitude]] }]); } }}><summary>{TRANSFER_LABELS[leg.transfer.tone]} beim Umsteigen <ChevronDown size={16} /></summary><p>{journeyMinutes(leg.transfer.availableSeconds)} verfügbar · {leg.transfer.requiredSeconds === null ? "Wegzeit unbekannt" : `${journeyMinutes(leg.transfer.requiredSeconds)} benötigt`}</p>{leg.transfer.slackSeconds !== null && <p>{journeyMinutes(leg.transfer.slackSeconds)} Luft · gewünscht +{leg.transfer.bufferMinutes} min</p>}<p>Gehzeit: {leg.transfer.walkingSeconds === null ? "unbekannt" : journeyMinutes(leg.transfer.walkingSeconds)} · offizielle Mindestzeit: {leg.transfer.officialMinimumSeconds === null ? "nicht verfügbar" : journeyMinutes(leg.transfer.officialMinimumSeconds)}. Es zählt die grössere Zeit, nicht die Summe.</p><small>{leg.transfer.evidence}{leg.transfer.guaranteed ? " · Anschluss vorgesehen, aber nicht garantiert." : ""}</small></details>}
          <button className="journey-leg" onClick={() => { setActiveLeg(leg.id); focus([leg]); }}><span className="journey-stamp"><TransportArt mode={leg.mode} /></span><span><small>{journeyClock(leg.departure)} → {journeyClock(leg.arrival)} · {leg.predicted ? "Prognose" : leg.mode === "walk" ? "geschätzt" : "Fahrplan"}</small><strong>{leg.mode === "walk" ? "Ein Stück zu Fuss" : `${leg.line}${leg.direction ? ` Richtung ${leg.direction}` : ""}`}</strong><span>{leg.from.label}{leg.from.platform ? ` · Gleis ${leg.from.platform}` : ""} → {leg.to.label}{leg.to.platform ? ` · Gleis ${leg.to.platform}` : ""}</span><small>{leg.geometryQuality === "missing" ? "Wegzeit unbekannt" : journeyMinutes(leg.durationSeconds)}{leg.distanceMeters !== undefined ? ` · ${Math.round(leg.distanceMeters)} m` : ""}{leg.geometryQuality === "schematic" ? " · Verlauf schematisch" : ""}</small></span></button>
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

function tightestTransfer(option: JourneyOption) {
  const transfers = option.legs.flatMap((leg) => leg.transfer ? [leg.transfer] : []);
  if (!transfers.length) return "Ohne Umsteigen";
  if (transfers.some((t) => t.slackSeconds === null)) return "Umstiegszeit noch unsicher";
  const tightest = Math.min(...transfers.map((t) => t.slackSeconds!));
  return `Engster Umstieg: ${journeyMinutes(tightest)} Luft · gewünscht +${transfers[0].bufferMinutes} min`;
}

function readPreferences(): { speed: JourneyQuery["speedKmh"]; buffer: JourneyQuery["bufferMinutes"] } {
  let speed: JourneyQuery["speedKmh"] = 4.2, buffer: JourneyQuery["bufferMinutes"] = 3;
  try {
    const saved = JSON.parse(localStorage.getItem("benchly-journey-preferences") ?? "null");
    if ([3, 4.2, 5.4].includes(saved?.speed)) speed = saved.speed;
    if ([0, 3, 6, 10].includes(saved?.buffer)) buffer = saved.buffer;
  } catch { /* Includes server rendering and blocked storage. */ }
  return { speed, buffer };
}
