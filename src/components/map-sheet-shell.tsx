"use client";

import { ArrowLeft, ChevronDown, Maximize2 } from "lucide-react";
import routeStyles from "@/features/routing/components/route-presentation.module.css";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { registerOverlayDismissal } from "@/lib/overlay-dismissal";

export type MapSheetSnap = "peek" | "half" | "full";
export type MapSheetPresentation = { snap: MapSheetSnap; scrollTop: number; openSections?: string[]; focusKey?: string };

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
  footer?: ReactNode;
  initialPresentation?: MapSheetPresentation | null;
  onPresentationChange?: (presentation: MapSheetPresentation) => void;
  children: ReactNode | ((snap: MapSheetSnap, setSnap: (snap: MapSheetSnap) => void) => ReactNode);
};

type SheetContentProps = {
  children: Props["children"];
  snap: MapSheetSnap;
  onSnapChange: (snap: MapSheetSnap) => void;
};

// Pass the ref-backed event handler through JSX, not to a render-time call in
// MapSheetShell. A stable component boundary also preserves child state.
function SheetContent({ children, snap, onSnapChange }: SheetContentProps) {
  return <>{typeof children === "function" ? children(snap, onSnapChange) : children}</>;
}

const nextUp: Record<MapSheetSnap, MapSheetSnap> = { peek: "half", half: "full", full: "full" };
const nextDown: Record<MapSheetSnap, MapSheetSnap> = { peek: "peek", half: "peek", full: "half" };

export function MapSheetShell({ label, resizeLabel, expandLabel, compactLabel, minimizeLabel, minimizeActionLabel, closeLabel, mapLabel, onClose, initialSnap = "half", variant = "planner", languageTag, voiceId, headerAction, initialPresentation, onPresentationChange, footer, children }: Props) {
  const startingSnap = initialPresentation?.snap ?? initialSnap;
  const [snap, setSnap] = useState<MapSheetSnap>(startingSnap);
  const [resumeSnap, setResumeSnap] = useState<Exclude<MapSheetSnap, "peek">>(startingSnap === "full" ? "full" : "half");
  const [desktop, setDesktop] = useState(false);
  const startY = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const contentRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const restoringScroll = useRef(false);
  const restoredFocus = useRef(false);
  const presentationRef = useRef<MapSheetPresentation>({ ...initialPresentation, snap: startingSnap, scrollTop: initialPresentation?.scrollTop ?? 0 });
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(media.matches);
    update(); media.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, []);
  useEffect(() => {
    return registerOverlayDismissal(() => onCloseRef.current());
  }, []);
  useLayoutEffect(() => {
    if (snap === "peek") return;
    const content = contentRef.current;
    if (!content) return;
    const scrollTop = presentationRef.current.scrollTop;
    // display:none may discard the native scroll position. Restore from the
    // saved visible state before paint, then after the first expanded layout.
    restoringScroll.current = true;
    content.querySelectorAll<HTMLDetailsElement>("details[data-sheet-section]").forEach(section => {
      section.open = presentationRef.current.openSections?.includes(section.dataset.sheetSection!) ?? false;
    });
    content.scrollTop = scrollTop;
    const frame = window.requestAnimationFrame(() => {
      content.scrollTop = scrollTop;
      const focusKey = presentationRef.current.focusKey;
      if (!restoredFocus.current && focusKey) [...shellRef.current!.querySelectorAll<HTMLElement>("[data-sheet-focus]")]
        .find(node => node.dataset.sheetFocus === focusKey)?.focus({ preventScroll: true });
      restoredFocus.current = true;
      restoringScroll.current = false;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      restoringScroll.current = false;
    };
  }, [snap, desktop]);
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // Native details toggles do not bubble; capture them without React-only attributes.
    const rememberSections = (event: Event) => {
      if (!(event.target instanceof HTMLDetailsElement) || !event.target.dataset.sheetSection || restoringScroll.current) return;
      const openSections = [...content.querySelectorAll<HTMLDetailsElement>("details[data-sheet-section][open]")].map(section => section.dataset.sheetSection!);
      presentationRef.current = { ...presentationRef.current, openSections };
      onPresentationChange?.(presentationRef.current);
    };
    content.addEventListener("toggle", rememberSections, true);
    return () => content.removeEventListener("toggle", rememberSections, true);
  }, [onPresentationChange]);
  const visibleSnap = desktop ? (snap === "peek" ? "peek" : "full") : snap;
  const changeSnap = (next: MapSheetSnap) => {
    if (next !== "peek") setResumeSnap(next);
    const content = contentRef.current;
    // Never replace the saved position with the zero reported by a hidden box.
    const canReadScroll = presentationRef.current.snap !== "peek" && !restoringScroll.current && content && content.clientHeight > 0;
    const scrollTop = canReadScroll ? content.scrollTop : presentationRef.current.scrollTop;
    presentationRef.current = { ...presentationRef.current, snap: next, scrollTop };
    onPresentationChange?.(presentationRef.current);
    setSnap(next);
  };
  const resize = () => {
    if (Date.now() < suppressClickUntil.current) return;
    changeSnap(snap === "peek" ? resumeSnap : snap === "full" ? "half" : "full");
  };
  const minimize = () => {
    if (snap !== "peek") setResumeSnap(snap);
    changeSnap("peek");
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
  return <aside ref={shellRef} onFocusCapture={(event) => {
      const focusKey = (event.target as HTMLElement).dataset.sheetFocus;
      if (!focusKey || restoringScroll.current) return;
      presentationRef.current = { ...presentationRef.current, focusKey };
      onPresentationChange?.(presentationRef.current);
    }}
    className={`map-sheet-shell ${variant === "bench" ? "desktop-sheet storybook-sheet sheet-shadow map-sheet-bench" : `journey-panel storybook-panel map-sheet-planner ${routeStyles.sheet}`}`}
    aria-label={label} lang={languageTag} data-local-voice={voiceId} data-snap={visibleSnap}
  >
    <div className="map-sheet-chrome">
      <div className="map-sheet-leading">
        <button type="button" className="map-sheet-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}><ArrowLeft size={17} aria-hidden="true" /><span>{mapLabel}</span></button>
        {headerAction}
      </div>
      {(!desktop || visibleSnap === "peek") ? <button type="button" className="map-sheet-resize" aria-label={`${resizeActionLabel}. ${resizeLabel}`} title={resizeActionLabel} aria-expanded={visibleSnap !== "peek"} onClick={resize} onTouchStart={(event) => { startY.current = event.touches[0].clientY; }} onTouchEnd={(event) => release(event.changedTouches[0].clientY)}>
        <span className="map-sheet-handle" aria-hidden="true" />
        {visibleSnap !== "peek" && <span className="map-sheet-resize-label">{resizeActionLabel}</span>}
        {visibleSnap === "peek" && <><span className="map-sheet-collapsed-title">{label}</span><Maximize2 className="map-sheet-expand-icon" size={17} aria-hidden="true" /></>}
      </button> : <span aria-hidden="true" />}
      {visibleSnap !== "peek" && <button type="button" className="map-sheet-minimize" aria-label={minimizeLabel} title={minimizeLabel} onClick={minimize}><ChevronDown size={18} aria-hidden="true" /><span className="sr-only">{minimizeActionLabel}</span></button>}
    </div>
    <div ref={contentRef} onScroll={(event) => {
      if (presentationRef.current.snap === "peek" || restoringScroll.current || event.currentTarget.clientHeight === 0) return;
      presentationRef.current = { ...presentationRef.current, snap, scrollTop: event.currentTarget.scrollTop };
      onPresentationChange?.(presentationRef.current);
    }} className={variant === "bench" ? "map-sheet-content map-sheet-bench-content safe-bottom" : "map-sheet-content journey-scroll"}>
      <SheetContent snap={visibleSnap} onSnapChange={changeSnap}>{children}</SheetContent>
    </div>
    {footer && <div className="map-sheet-footer" hidden={visibleSnap === "peek"}>{footer}</div>}
  </aside>;
}
