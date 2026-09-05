"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { getJourney } from "@/app/actions/journey";
import { swissWallTime, swissWallTimeToIso, type JourneyLeg, type JourneyOption, type JourneyOrigin, type JourneyPoint, type JourneyResult } from "@/lib/journey";
import { clearJourneyMap, paintJourney } from "@/lib/journey-map";
import { journeyBounds, parsePreferences, PREFERENCES_KEY, type JourneySettings } from "@/lib/journey-planner";

// Owns requests and map effects; the journal component owns rendering and focus.
export function useJourneyPlanner(benchId: string, getMap: () => MapLibreMap | null, initial?: { origin: JourneyOrigin; destination: JourneyPoint; time: string }) {
  const [origin, setOrigin] = useState<JourneyOrigin | null>(initial?.origin ?? null);
  const [settings, setSettings] = useState<JourneySettings>(() => ({
    ...readPreferences(), mode: "transit", timeMode: initial ? "departure" : "now", time: initial?.time ?? swissWallTime(new Date().toISOString()),
  }));
  const { mode, timeMode, time, speed, buffer } = settings;
  const [result, setResult] = useState<JourneyResult | null>(null); const [selected, setSelected] = useState(""); const [activeLeg, setActiveLeg] = useState<string | null>(null);
  const [error, setError] = useState(""); const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const sequence = useRef(0);
  const chooseOrigin = (p: JourneyOrigin | null) => { sequence.current++; setOrigin(p); setDirty(true); };
  useEffect(() => {
    const requestRef = sequence;
    return () => { requestRef.current++; };
  }, []);
  useEffect(() => {
    const map = getMap(); if (!map) return;
    const camera = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    return () => { clearJourneyMap(map); map.jumpTo(camera); };
  }, [getMap]);
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
        const next = await getJourney({ ...(initial ? { destination: initial.destination } : { benchId }), origin, mode, time: at, arriveBy: timeMode === "arrival", speedKmh: speed, bufferMinutes: buffer });
        if (sequence.current !== token) return;
        setResult(next); setDirty(false); setSelected(next.options[0]?.id ?? ""); setActiveLeg(null);
        if (next.options[0]) focus(next.options[0].legs);
      } catch { if (sequence.current === token) setError("Reiseplanung gerade nicht verfügbar oder zu viele Anfragen. Bitte kurz warten und erneut versuchen."); }
    });
  };
  const selectOption = (option: JourneyOption) => { setSelected(option.id); setActiveLeg(null); focus(option.legs); };
  const selectLeg = (leg: JourneyLeg, atStation = false) => {
    setActiveLeg(leg.id);
    focus(atStation ? [{ ...leg, geometry: [[leg.from.longitude, leg.from.latitude]] }] : [leg]);
  };
  return {
    origin, chooseOrigin,
    settings, updateSettings,
    result, selected, activeLeg, option: result?.options.find((option) => option.id === selected),
    error, dirty, pending, submit, selectOption, selectLeg,
  };
}

function readPreferences() {
  try { return parsePreferences(localStorage.getItem(PREFERENCES_KEY)); }
  catch { return parsePreferences(null); } // Server rendering or blocked storage.
}
