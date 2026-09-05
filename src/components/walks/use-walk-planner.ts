"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import { getWalkSuggestions } from "@/app/actions/walks";
import { summarizeJourney, swissWallTime, swissWallTimeToIso, type JourneyLeg, type JourneyOrigin, type JourneyPoint } from "@/lib/journey";
import { clearJourneyMap, paintJourney } from "@/lib/journey-map";
import { journeyBounds, parsePreferences, PREFERENCES_KEY } from "@/lib/journey-planner";
import type { ReturnJourney } from "@/lib/journey";
import type { WalkQuery, WalkResult, WalkSuggestion } from "@/lib/walks/model";
import { pathTimes } from "@/lib/walking";

export function walkLegs(s: WalkSuggestion, query: WalkQuery): JourneyLeg[] {
  const times = pathTimes(s.path, query.speed);
  const make = (id: string, start: number, end: number, from: JourneyPoint, to: JourneyPoint): JourneyLeg => ({
    id: `${s.id}-${id}`, from, to, mode: "walk", departure: new Date(Date.parse(query.time) + times[start] * 1000).toISOString(), arrival: new Date(Date.parse(query.time) + times[end] * 1000).toISOString(), predicted: false,
    durationSeconds: times[end] - times[start], geometry: s.path.geometry.slice(start, end + 1), geometryQuality: "routed", warnings: s.path.warnings,
  });
  const last = s.path.geometry.length - 1;
  return query.shape === "loop" ? [make("bench", 0, s.benchIndex, query.origin, s.bench), make("return", s.benchIndex, last, s.bench, query.origin)] : [make("bench", 0, last, query.origin, s.bench)];
}
export function useWalkPlanner(getMap: () => MapLibreMap | null) {
  const [origin, setOrigin] = useState<JourneyOrigin | null>(null);
  const [settings, setSettings] = useState(() => {
    let speed: WalkQuery["speed"] = 4.2;
    try { speed = parsePreferences(localStorage.getItem(PREFERENCES_KEY)).speed; } catch {}
    return { minutes: 50 as WalkQuery["minutes"], shape: "loop" as WalkQuery["shape"], light: "any" as WalkQuery["light"], difficulty: "easy" as WalkQuery["difficulty"], speed, time: "" };
  });
  const [result, setResult] = useState<WalkResult | null>(null); const [selected, setSelected] = useState("");
  const [error, setError] = useState(""); const [dirty, setDirty] = useState(false); const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<string | null>(null), [extras, setExtras] = useState(false);
  const sequence = useRef(0);
  const chosen = result?.suggestions.find((s) => s.id === selected);
  const change = (patch: Partial<typeof settings>) => { sequence.current++; setSettings((s) => ({ ...s, ...patch })); setDirty(true); };
  const chooseOrigin = (p: JourneyOrigin | null) => { sequence.current++; setOrigin(p); setDirty(true); };
  const focus = (legs: JourneyLeg[]) => { const bounds = journeyBounds(legs); if (bounds) getMap()?.fitBounds(bounds, { padding: { top: 100, left: 30, right: innerWidth >= 768 ? 485 : 30, bottom: innerWidth >= 768 ? 45 : innerHeight * .5 }, maxZoom: 17, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400 }); };
  useEffect(() => {
    const map = getMap(), seq = sequence;
    const camera = map ? { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() } : null;
    return () => { seq.current++; if (map) { clearJourneyMap(map); for (const id of ["walk-extra-benches", "walk-labels"]) if (map.getLayer(id)) map.removeLayer(id); for (const id of ["walk-extra-benches", "walk-labels"]) if (map.getSource(id)) map.removeSource(id); if (camera) map.jumpTo(camera); } };
  }, [getMap]);
  useEffect(() => {
    const map = getMap(); if (!map || !result || !chosen) return;
    let painted = false;
    const paint = () => {
      if (painted || !map.isStyleLoaded()) return;
      painted = paintJourney(map, result.suggestions.map((s) => summarizeJourney(s.id, walkLegs(s, result.query))), selected, active);
      const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: extras ? chosen.extraBenches.map((b) => ({ type: "Feature", properties: { title: b.label }, geometry: { type: "Point", coordinates: [b.longitude, b.latitude] } })) : [] };
      if (map.getSource("walk-extra-benches")) (map.getSource("walk-extra-benches") as GeoJSONSource).setData(data);
      else { map.addSource("walk-extra-benches", { type: "geojson", data }); map.addLayer({ id: "walk-extra-benches", type: "circle", source: "walk-extra-benches", paint: { "circle-radius": 15, "circle-color": "#71855b", "circle-opacity": .45, "circle-blur": .5 } }); }
      const labels: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", properties: { label: result.query.shape === "loop" ? "Start & Rückkehr" : "Start" }, geometry: { type: "Point", coordinates: [result.query.origin.longitude, result.query.origin.latitude] } }, { type: "Feature", properties: { label: chosen.bench.label }, geometry: { type: "Point", coordinates: [chosen.bench.longitude, chosen.bench.latitude] } }] };
      if (map.getSource("walk-labels")) (map.getSource("walk-labels") as GeoJSONSource).setData(labels);
      else { map.addSource("walk-labels", { type: "geojson", data: labels }); map.addLayer({ id: "walk-labels", type: "symbol", source: "walk-labels", layout: { "text-field": ["get", "label"], "text-size": 13, "text-offset": [0, 1.6] }, paint: { "text-color": "#345947", "text-halo-color": "#fff5de", "text-halo-width": 2 } }); }
    };
    const reload = () => { painted = false; paint(); };
    paint(); map.on("idle", paint); map.on("style.load", reload);
    return () => { map.off("idle", paint); map.off("style.load", reload); };
  }, [getMap, result, chosen, selected, active, extras]);
  const submit = () => {
    if (!origin) return;
    const time = settings.time ? swissWallTimeToIso(settings.time) : new Date().toISOString();
    if (!time) { setError("Diese Schweizer Uhrzeit existiert nicht. Bitte prüfen."); return; }
    const token = ++sequence.current; setError("");
    try { const prefs = parsePreferences(localStorage.getItem(PREFERENCES_KEY)); localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...prefs, speed: settings.speed })); } catch {}
    startTransition(async () => {
      try { const next = await getWalkSuggestions({ ...settings, origin, time }); if (sequence.current !== token) return; setResult(next); setSelected(next.suggestions[0]?.id ?? ""); setDirty(false); setExtras(false); setActive(null); if (next.suggestions[0]) focus(walkLegs(next.suggestions[0], next.query)); }
      catch { if (sequence.current === token) setError("Spaziergang gerade nicht verfügbar. Bitte kurz warten oder den Start ändern."); }
    });
  };
  return { origin, chooseOrigin, settings, change, result, chosen, error, dirty, pending, submit, extras, toggleExtras: () => setExtras(!extras),
    select: (s: WalkSuggestion) => { setSelected(s.id); setExtras(false); setActive(null); if (result) focus(walkLegs(s, result.query)); },
    focusLeg: (leg: JourneyLeg) => { setActive(leg.id); focus([leg]); },
    returnJourney: (): ReturnJourney | null => chosen && result ? { origin: { ...chosen.bench, kind: "address" }, destination: result.query.origin, time: swissWallTime(new Date(Date.parse(result.query.time) + chosen.durationSeconds * 1000).toISOString()) } : null,
  };
}
