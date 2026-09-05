"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { House, LocateFixed, MapPin, TrainFront } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { searchJourneyOrigins } from "@/app/actions/journey";
import type { JourneyOrigin } from "@/lib/journey";

/** Shared routing UI: explicit origin selection, without journey or walk business logic. */
export function StartPicker({ origin, onChange, getMap }: { origin: JourneyOrigin | null; onChange: (origin: JourneyOrigin | null) => void; getMap: () => MapLibreMap | null }) {
  const [query, setQuery] = useState(""); const [editing, setEditing] = useState(false);
  const [results, setResults] = useState<JourneyOrigin[]>([]); const [highlighted, setHighlighted] = useState(-1);
  const [message, setMessage] = useState(""); const [pending, startTransition] = useTransition();
  const sequence = useRef(0); const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const choose = (p: JourneyOrigin) => { sequence.current++; setResults([]); setEditing(false); setMessage(""); onChangeRef.current(p); };
  useEffect(() => {
    const ref = sequence;
    const map = getMap();
    const click = (e: { point: { x: number; y: number } }) => {
      if (!map) return;
      const layers = ["benchly-local-transit", "benchly-major-transit"].filter((id) => map.getLayer(id));
      if (!layers.length) return;
      const p = map.queryRenderedFeatures([[e.point.x - 22, e.point.y - 22], [e.point.x + 22, e.point.y + 22]], { layers })[0];
      if (p?.geometry.type === "Point" && p.properties.station_id) choose({ kind: "station", stationId: String(p.properties.station_id), label: String(p.properties["name:latin"] ?? p.properties.name ?? "Haltestelle"), longitude: p.geometry.coordinates[0], latitude: p.geometry.coordinates[1] });
    };
    map?.on("click", click);
    return () => { ref.current++; map?.off("click", click); };
  }, [getMap]);
  useEffect(() => {
    const token = ++sequence.current;
    if (query.trim().length < 2) return;
    const timer = setTimeout(() => startTransition(async () => {
      try { const next = await searchJourneyOrigins(query); if (sequence.current === token) { setResults(next); setHighlighted(-1); } }
      catch { if (sequence.current === token) setMessage("Suche gerade nicht verfügbar."); }
    }), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const locate = () => {
    const token = ++sequence.current; setMessage("Standort wird gesucht …");
    if (!navigator.geolocation) { setMessage("Bitte eine Adresse oder Haltestelle wählen."); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      if (token !== sequence.current) return;
      choose({ kind: "location", label: "Mein Standort", latitude: p.coords.latitude, longitude: p.coords.longitude });
      if (p.coords.accuracy > 100) setMessage(`Standort nur auf etwa ${Math.round(p.coords.accuracy)} m genau. Bitte prüfen.`);
    }, () => { if (token === sequence.current) setMessage("Standort nicht verfügbar. Wähle eine Adresse oder Haltestelle."); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };
  return <div className="journey-start-card"><h3>Wo startest du?</h3>
    {origin && !editing ? <div className="journey-start-summary"><MapPin size={20} /><strong>{origin.label}</strong><button onClick={() => { sequence.current++; onChange(null); setEditing(true); setQuery(""); }}>Ändern</button></div> : <>
      <label className="journey-search-label"><MapPin size={18} /><span className="sr-only">Start: Adresse oder Haltestelle</span><input role="combobox" aria-controls="walk-origins" aria-expanded={results.length > 0} aria-autocomplete="list" aria-activedescendant={highlighted >= 0 ? `walk-origin-${highlighted}` : undefined} placeholder="Adresse oder Haltestelle" value={query} onChange={(e) => { sequence.current++; setResults([]); setHighlighted(-1); setQuery(e.target.value); }} onKeyDown={(e) => {
        if (e.key === "Escape") { sequence.current++; setResults([]); setHighlighted(-1); }
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) { e.preventDefault(); setHighlighted((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length); }
        if (e.key === "Enter" && results[highlighted]) { e.preventDefault(); choose(results[highlighted]); }
      }} /></label>
      <ul id="walk-origins" role="listbox" aria-label="Startpunkte" className="journey-origins">{results.map((p, i) => <li id={`walk-origin-${i}`} key={`${p.kind}-${p.stationId ?? i}`} role="option" aria-selected={i === highlighted}><button tabIndex={-1} onClick={() => choose(p)}>{p.kind === "station" ? <TrainFront size={22} /> : <House size={22} />}<span>{p.label}<small>{p.kind === "station" ? "Haltestelle" : "Adresse"}</small></span></button></li>)}</ul>
      <button className="journey-location" onClick={locate}><LocateFixed size={18} /> Mein Standort</button><small>Oder eine Haltestelle auf der Karte antippen.</small>
    </>}
    {(message || pending) && <p role="status">{message || "Startpunkte werden gesucht …"}</p>}
  </div>;
}
