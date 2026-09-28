"use client";
import { useId } from "react";
import { Locate, LocateFixed, Navigation } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LocationState } from "../location-controller";
import "./location-control.css";

export function LocationControl({ state, onToggle, onNorth }: {
  state: LocationState; onToggle: () => void; onNorth: () => void;
}) {
  const t = useTranslations();
  const description = useId();
  const label = t(state.pending === "location" ? "map.location.searching" : state.pending === "compass" ? "map.orientation.requesting"
    : state.mode === "browse" ? "map.location.show" : state.mode === "north" ? "map.orientation.follow" : "map.orientation.north");
  return <div className="map-location-controls">
    {Math.abs(state.bearing) > 1 && <button className="map-north-control" type="button" onClick={onNorth}
      aria-label={t("map.orientation.reset")} title={t("map.orientation.reset")}>
      <svg width="24" height="24" viewBox="0 0 24 24" style={{ transform: `rotate(${-state.bearing}deg)` }} aria-hidden="true">
        <path d="M12 2 7 20 12 16 17 20Z" fill="currentColor" />
        <path d="M12 2v14l5 4Z" fill="var(--color-sage-wash, #e5eddf)" />
      </svg><span aria-hidden="true">N</span>
    </button>}
    <button className="map-location-control" type="button" onClick={onToggle} data-mode={state.mode}
      aria-label={label} aria-describedby={description} title={label} aria-busy={Boolean(state.pending)} disabled={Boolean(state.pending)}>
      {state.pending ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : state.mode === "browse"
        ? <Locate size={23} aria-hidden="true" /> : state.mode === "north" ? <LocateFixed size={23} aria-hidden="true" />
          : <Navigation size={23} fill="currentColor" aria-hidden="true" />}
    </button>
    <span className="sr-only" id={description}>{t(`map.location.modes.${state.mode}`)}</span>
  </div>;
}
