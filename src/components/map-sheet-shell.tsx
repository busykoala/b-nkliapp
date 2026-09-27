"use client";

import { ChevronDown, ChevronUp, Minus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type MapSheetSnap = "peek" | "half" | "full";

type Props = {
  label: string;
  resizeLabel: string;
  minimizeLabel: string;
  closeLabel: string;
  onClose: () => void;
  initialSnap?: MapSheetSnap;
  variant?: "bench" | "planner";
  languageTag?: string;
  voiceId?: string;
  headerAction?: ReactNode;
  children: ReactNode | ((snap: MapSheetSnap) => ReactNode);
};

const nextUp: Record<MapSheetSnap, MapSheetSnap> = { peek: "half", half: "full", full: "full" };
const nextDown: Record<MapSheetSnap, MapSheetSnap> = { peek: "peek", half: "peek", full: "half" };

export function MapSheetShell({ label, resizeLabel, minimizeLabel, closeLabel, onClose, initialSnap = "half", variant = "planner", languageTag, voiceId, headerAction, children }: Props) {
  const [snap, setSnap] = useState<MapSheetSnap>(initialSnap);
  const [desktop, setDesktop] = useState(false);
  const startY = useRef<number | null>(null);
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
  const resize = () => setSnap((current) => current === "full" ? "half" : nextUp[current]);
  const release = (endY: number) => {
    if (startY.current === null) return;
    const delta = endY - startY.current;
    if (delta < -45) setSnap((current) => nextUp[current]);
    if (delta > 45) setSnap((current) => nextDown[current]);
    startY.current = null;
  };
  return <aside
    className={`map-sheet-shell ${variant === "bench" ? "desktop-sheet storybook-sheet sheet-shadow map-sheet-bench" : "journey-panel storybook-panel map-sheet-planner"}`}
    aria-label={label} lang={languageTag} data-local-voice={voiceId} data-snap={visibleSnap}
  >
    <div className="map-sheet-chrome" onTouchStart={(event) => { startY.current = event.touches[0].clientY; }} onTouchEnd={(event) => release(event.changedTouches[0].clientY)}>
      {(!desktop || visibleSnap === "peek") && <button type="button" className="map-sheet-resize" aria-label={resizeLabel} title={resizeLabel} aria-expanded={visibleSnap !== "peek"} onClick={resize}>
        {visibleSnap === "peek" ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        <span className="map-sheet-handle" aria-hidden="true" />
        {visibleSnap === "peek" && <span className="map-sheet-collapsed-title">{label}</span>}
      </button>}
      {headerAction}
      {visibleSnap !== "peek" && <button type="button" className="map-sheet-minimize" aria-label={minimizeLabel} title={minimizeLabel} onClick={() => setSnap("peek")}><Minus size={19} /></button>}
      <button type="button" className="map-sheet-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}><X size={19} /></button>
    </div>
    <div className={variant === "bench" ? "map-sheet-content map-sheet-bench-content safe-bottom" : "map-sheet-content journey-scroll"}>
      {typeof children === "function" ? children(visibleSnap) : children}
    </div>
  </aside>;
}
