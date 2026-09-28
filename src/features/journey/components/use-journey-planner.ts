"use client";
import { useTranslations } from "next-intl";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { getJourney } from "@/app/actions/journey";
import { swissWallTime, swissWallTimeToIso, type JourneyLeg, type JourneyOption, type JourneyOrigin, type JourneyPoint, type JourneyResult } from "@/features/journey/model";
import { claimJourneyMap, journeyMapPadding, paintJourney, releaseJourneyMap, type JourneyMapOwner } from "@/features/journey/map";
import { journeyBounds, parsePreferences, PREFERENCES_KEY, type JourneySettings } from "@/features/journey/planner";

export type JourneyDraftSnapshot = {
  benchId: string;
  origin: JourneyOrigin | null;
  settings: JourneySettings;
  result: JourneyResult | null;
  selected: string;
  activeLeg: string | null;
  dirty: boolean;
};

// Owns requests and map effects; the journal component owns rendering and focus.
export function useJourneyPlanner(benchId: string, getMap: () => MapLibreMap | null, initial?: { origin: JourneyOrigin; destination: JourneyPoint; time: string }, draft?: JourneyDraftSnapshot | null, onSnapshot?: (draft: JourneyDraftSnapshot) => void) {
  const t = useTranslations();
  const restored = draft?.benchId === benchId ? draft : null;
  const [origin, setOrigin] = useState<JourneyOrigin | null>(restored?.origin ?? initial?.origin ?? null);
  const [settings, setSettings] = useState<JourneySettings>(() => restored?.settings ?? ({
    ...readPreferences(), mode: "transit", timeMode: initial ? "departure" : "now", time: initial?.time ?? swissWallTime(new Date().toISOString()),
  }));
  const { mode, timeMode, time, speed, buffer } = settings;
  const [result, setResult] = useState<JourneyResult | null>(restored?.result ?? null); const [selected, setSelected] = useState(restored?.selected ?? ""); const [activeLeg, setActiveLeg] = useState<string | null>(restored?.activeLeg ?? null);
  const [error, setError] = useState(""); const [dirty, setDirty] = useState(restored?.dirty ?? false);
  const [pending, startTransition] = useTransition();
  const sequence = useRef(0);
  const mapOwner = useRef<JourneyMapOwner | null>(null);
  useEffect(() => {
    onSnapshot?.({ benchId, origin, settings, result, selected, activeLeg, dirty });
  }, [benchId, origin, settings, result, selected, activeLeg, dirty, onSnapshot]);
  const chooseOrigin = (p: JourneyOrigin | null) => { sequence.current++; setOrigin(p); setDirty(true); };
  useEffect(() => {
    const requestRef = sequence;
    return () => { requestRef.current++; };
  }, []);
  useEffect(() => {
    const map = getMap(); if (!map) return;
    const owner = claimJourneyMap(map);
    mapOwner.current = owner;
    const camera = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    return () => { if (releaseJourneyMap(map, owner)) map.jumpTo(camera); };
  }, [getMap]);
  useEffect(() => {
    const map = getMap(); if (!map || !result) return;
    let painted = false;
    const paint = () => { if (!painted && mapOwner.current) painted = paintJourney(map, result.options, selected, activeLeg, mapOwner.current); };
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
    const map = getMap();
    if (!map) return;
    map.fitBounds(bounds, { padding: journeyMapPadding(map), maxZoom: 17, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450 });
  };
  const submit = (offset = 0) => {
    if (!origin) { setError(t("journey.planner.chooseStart")); return; }
    const chosenTime = timeMode === "now" ? new Date().toISOString() : swissWallTimeToIso(time);
    if (!chosenTime) { setError(t("journey.planner.invalidTime")); return; }
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
      } catch { if (sequence.current === token) setError(t("journey.planner.failed")); }
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
