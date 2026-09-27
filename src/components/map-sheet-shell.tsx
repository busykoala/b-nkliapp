"use client";

import { ArrowLeft, Maximize2, PanelBottomClose } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type MapSheetSnap = "peek" | "half" | "full";

type Props = {
  label: string;
  resizeLabel: string;
  expandLabel: string;
  compactLabel: string;
  minimizeLabel: string;
  minimizeActionLabel: string;
  closeLabel: string;
  mapLabel: string;
  onClose: () => void;
  initialSnap?: MapSheetSnap;
  variant?: "bench" | "planner";
  languageTag?: string;
  voiceId?: string;
  headerAction?: ReactNode;
  children: ReactNode | ((snap: MapSheetSnap, setSnap: (snap: MapSheetSnap) => void) => ReactNode);
};

const nextUp: Record<MapSheetSnap, MapSheetSnap> = { peek: "half", half: "full", full: "full" };
const nextDown: Record<MapSheetSnap, MapSheetSnap> = { peek: "peek", half: "peek", full: "half" };

export function MapSheetShell({ label, resizeLabel, expandLabel, compactLabel, minimizeLabel, minimizeActionLabel, closeLabel, mapLabel, onClose, initialSnap = "half", variant = "planner", languageTag, voiceId, headerAction, children }: Props) {
  const [snap, setSnap] = useState<MapSheetSnap>(initialSnap);
  const [resumeSnap, setResumeSnap] = useState<Exclude<MapSheetSnap, "peek">>(initialSnap === "full" ? "full" : "half");
  const [desktop, setDesktop] = useState(false);
  const startY = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(media.matches);
    update(); media.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, []);
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const visibleSnap = desktop ? (snap === "peek" ? "peek" : "full") : snap;
  const changeSnap = (next: MapSheetSnap) => {
    if (next !== "peek") setResumeSnap(next);
    setSnap(next);
  };
  const resize = () => {
    if (Date.now() < suppressClickUntil.current) return;
    changeSnap(snap === "peek" ? resumeSnap : snap === "full" ? "half" : "full");
  };
  const minimize = () => {
    if (snap !== "peek") setResumeSnap(snap);
    setSnap("peek");
  };
  const resizeActionLabel = visibleSnap === "full" ? compactLabel : expandLabel;
  const release = (endY: number) => {
    if (startY.current === null) return;
    const delta = endY - startY.current;
    if (Math.abs(delta) > 12) suppressClickUntil.current = Date.now() + 350;
    if (delta < -45) changeSnap(snap === "peek" ? resumeSnap : nextUp[snap]);
    if (delta > 45) {
      const next = nextDown[snap];
      if (next === "peek") minimize();
      else changeSnap(next);
    }
    startY.current = null;
  };
  return <aside
    className={`map-sheet-shell ${variant === "bench" ? "desktop-sheet storybook-sheet sheet-shadow map-sheet-bench" : "journey-panel storybook-panel map-sheet-planner"}`}
    aria-label={label} lang={languageTag} data-local-voice={voiceId} data-snap={visibleSnap}
  >
    <div className="map-sheet-chrome">
      <div className="map-sheet-leading">
        <button type="button" className="map-sheet-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}><ArrowLeft size={17} aria-hidden="true" /><span>{mapLabel}</span></button>
        {headerAction}
      </div>
      {(!desktop || visibleSnap === "peek") ? <button type="button" className="map-sheet-resize" aria-label={`${resizeActionLabel}. ${resizeLabel}`} title={resizeActionLabel} aria-expanded={visibleSnap !== "peek"} onClick={resize} onTouchStart={(event) => { startY.current = event.touches[0].clientY; }} onTouchEnd={(event) => release(event.changedTouches[0].clientY)}>
        <span className="map-sheet-handle" aria-hidden="true" />
        {visibleSnap === "peek" && <><span className="map-sheet-collapsed-title">{label}</span><Maximize2 className="map-sheet-expand-icon" size={17} aria-hidden="true" /></>}
      </button> : <span className="map-sheet-chrome-title">{label}</span>}
      {visibleSnap !== "peek" && <button type="button" className="map-sheet-minimize" aria-label={minimizeLabel} title={minimizeLabel} onClick={minimize}><PanelBottomClose size={18} aria-hidden="true" /><span className="sr-only">{minimizeActionLabel}</span></button>}
    </div>
    <div className={variant === "bench" ? "map-sheet-content map-sheet-bench-content safe-bottom" : "map-sheet-content journey-scroll"}>
      {typeof children === "function" ? children(visibleSnap, setSnap) : children}
    </div>
  </aside>;
}
