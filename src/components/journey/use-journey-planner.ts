"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { getJourney, searchJourneyOrigins } from "@/app/actions/journey";
import { swissWallTime, swissWallTimeToIso, type JourneyLeg, type JourneyOption, type JourneyOrigin, type JourneyResult } from "@/lib/journey";
import { clearJourneyMap, paintJourney } from "@/lib/journey-map";
import { journeyBounds, parsePreferences, PREFERENCES_KEY, type JourneySettings } from "./planner-model";

// Owns requests and map effects; the journal component owns rendering and focus.
export function useJourneyPlanner(benchId: string, getMap: () => MapLibreMap | null) {
  const [origin, setOrigin] = useState<JourneyOrigin | null>(null);
  const [query, setQuery] = useState(""); const [results, setResults] = useState<JourneyOrigin[]>([]); const [highlighted, setHighlighted] = useState(-1);
  const [settings, setSettings] = useState<JourneySettings>(() => ({
    ...readPreferences(), mode: "transit", timeMode: "now", time: swissWallTime(new Date().toISOString()),
  }));
  const { mode, timeMode, time, speed, buffer } = settings;
  const [result, setResult] = useState<JourneyResult | null>(null); const [selected, setSelected] = useState(""); const [activeLeg, setActiveLeg] = useState<string | null>(null);
  const [error, setError] = useState(""); const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition(); const [searching, startSearch] = useTransition();
  const sequence = useRef(0); const searches = useRef(0); const locationSequence = useRef(0);
  const chooseOrigin = (p: JourneyOrigin) => { sequence.current++; searches.current++; locationSequence.current++; setOrigin(p); setQuery(p.label); setResults([]); setDirty(true); };
  useEffect(() => {
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
  const changed = () => { sequence.current++; setDirty(true); };
  const updateSettings = (patch: Partial<JourneySettings>) => {
    changed();
    setSettings((current) => ({ ...current, ...patch }));
  };
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
    const bounds = journeyBounds(legs);
    if (!bounds) return;
    const desktop = window.innerWidth >= 768;
    getMap()?.fitBounds(bounds, { padding: { top: 90, left: 35, right: desktop ? 485 : 35, bottom: desktop ? 45 : window.innerHeight * .48 }, maxZoom: 17, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450 });
  };
  const submit = (offset = 0) => {
    if (!origin) { setError("Bitte einen Start auswählen."); return; }
    const chosenTime = timeMode === "now" ? new Date().toISOString() : swissWallTimeToIso(time);
    if (!chosenTime) { setError("Diese Schweizer Uhrzeit existiert nicht. Bitte das Datum prüfen."); return; }
    const at = new Date(Date.parse(chosenTime) + offset * 60000).toISOString();
    if (offset) setSettings({ ...settings, timeMode: timeMode === "arrival" ? "arrival" : "departure", time: swissWallTime(at) });
    const token = ++sequence.current; setError("");
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ speed, buffer })); } catch {}
    startTransition(async () => {
      try {
        const next = await getJourney({ benchId, origin, mode, time: at, arriveBy: timeMode === "arrival", speedKmh: speed, bufferMinutes: buffer });
        if (sequence.current !== token) return;
        setResult(next); setDirty(false); setSelected(next.options[0]?.id ?? ""); setActiveLeg(null);
        if (next.options[0]) focus(next.options[0].legs);
      } catch { if (sequence.current === token) setError("Reiseplanung gerade nicht verfügbar oder zu viele Anfragen. Bitte kurz warten und erneut versuchen."); }
    });
  };
  const editQuery = (value: string) => {
    changed(); searches.current++; setOrigin(null); setResults([]); setHighlighted(-1); setQuery(value);
  };
  const dismissResults = () => { searches.current++; setResults([]); setHighlighted(-1); };
  const selectOption = (option: JourneyOption) => { setSelected(option.id); setActiveLeg(null); focus(option.legs); };
  const selectLeg = (leg: JourneyLeg, atStation = false) => {
    setActiveLeg(leg.id);
    focus(atStation ? [{ ...leg, geometry: [[leg.from.longitude, leg.from.latitude]] }] : [leg]);
  };
  return {
    origin, query, results, highlighted, setHighlighted, chooseOrigin, editQuery, dismissResults,
    settings, updateSettings,
    result, selected, activeLeg, option: result?.options.find((option) => option.id === selected),
    error, dirty, pending, searching, locate, submit, selectOption, selectLeg,
  };
}

function readPreferences() {
  try { return parsePreferences(localStorage.getItem(PREFERENCES_KEY)); }
  catch { return parsePreferences(null); } // Server rendering or blocked storage.
}
