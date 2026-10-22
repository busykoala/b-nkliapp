"use client";

import { ArrowDown, ArrowLeft, ArrowUpRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { registerOverlayDismissal } from "@/lib/overlay-dismissal";
import { useTaskIsolation } from "./use-task-isolation";
import styles from "./bench-atlas-sheet.module.css";

export type BenchPresentationMode = "preview" | "place";
export type BenchAtlasPresentation = {
  mode: BenchPresentationMode;
  scrollTop: number;
  openSections?: string[];
  focusKey?: string;
};

function BenchAtlasContent({ children, mode, change }: { children: (mode: BenchPresentationMode, change: (mode: BenchPresentationMode) => void) => ReactNode; mode: BenchPresentationMode; change: (mode: BenchPresentationMode) => void }) {
  return <>{children(mode, change)}</>;
}

export function BenchAtlasSheet({ label, closeLabel, mapLabel, openLabel, previewLabel, initialMode, initialPresentation, onPresentationChange, onClose, footer, headerAction, languageTag, voiceId, children }: {
  label: string; closeLabel: string; mapLabel: string; openLabel: string; previewLabel: string;
  initialMode: BenchPresentationMode; initialPresentation?: BenchAtlasPresentation | null;
  onPresentationChange?: (value: BenchAtlasPresentation) => void;
  onClose: () => void; footer?: ReactNode; headerAction?: ReactNode;
  languageTag?: string; voiceId?: string;
  children: (mode: BenchPresentationMode, change: (mode: BenchPresentationMode) => void) => ReactNode;
}) {
  const [mode, setMode] = useState(initialPresentation?.mode ?? initialMode);
  const [flow, setFlow] = useState(false);
  const [canPreview, setCanPreview] = useState(false);
  const [covering, setCovering] = useState(false);
  const shell = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const flowRef = useRef(flow);
  useLayoutEffect(() => { flowRef.current = flow; }, [flow]);
  const returnFocus = useRef<HTMLElement | null>(null);
  const gestureY = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const snapshot = useRef<BenchAtlasPresentation>(initialPresentation ?? { mode: initialMode, scrollTop: 0 });
  const onCloseRef = useRef(onClose);
  const notify = useRef(onPresentationChange);
  const restoring = useRef(false);
  const restoredFocus = useRef(false);
  useEffect(() => { onCloseRef.current = onClose; notify.current = onPresentationChange; }, [onClose, onPresentationChange]);
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unregister = registerOverlayDismissal(() => onCloseRef.current());
    return () => {
      unregister();
      // Let task isolation release the background before returning focus.
      requestAnimationFrame(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); });
    };
  }, []);
  useTaskIsolation(shell, covering && mode === "place");
  useEffect(() => {
    if (covering && mode === "place" && !shell.current?.contains(document.activeElement)) {
      shell.current?.querySelector<HTMLButtonElement>(".map-sheet-close")?.focus({ preventScroll: true });
    }
  }, [covering, mode]);
  const scroller = () => flowRef.current ? shell.current : content.current;
  const remember = () => {
    if (!content.current || restoring.current) return;
    const openSections = [...content.current.querySelectorAll<HTMLDetailsElement>("details[data-sheet-section][open]")].map(node => node.dataset.sheetSection!);
    snapshot.current = { ...snapshot.current, openSections, ...(snapshot.current.mode === "place" ? { scrollTop: scroller()?.scrollTop ?? 0 } : {}) };
    notify.current?.(snapshot.current);
  };
  const change = (next: BenchPresentationMode) => {
    if (next === mode || (next === "preview" && !canPreview)) return;
    remember();
    snapshot.current = { ...snapshot.current, mode: next };
    notify.current?.(snapshot.current);
    setMode(next);
  };
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    restoring.current = true;
    if (mode === "place") {
      node.querySelectorAll<HTMLDetailsElement>("details[data-sheet-section]").forEach(section => { section.open = snapshot.current.openSections?.includes(section.dataset.sheetSection!) ?? false; });
    }
    const top = mode === "place" ? snapshot.current.scrollTop : 0;
    scroller()?.scrollTo({ top });
    const frame = requestAnimationFrame(() => {
      scroller()?.scrollTo({ top });
      if (!restoredFocus.current && snapshot.current.focusKey) {
        [...shell.current!.querySelectorAll<HTMLElement>("[data-sheet-focus]")].find(element => element.dataset.sheetFocus === snapshot.current.focusKey)?.focus({ preventScroll: true });
      }
      restoredFocus.current = true;
      restoring.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, flow]);
  useEffect(() => {
    const node = content.current;
    if (!node) return;
    node.addEventListener("toggle", remember, true);
    return () => node.removeEventListener("toggle", remember, true);
  });
  useEffect(() => {
    const root = shell.current;
    const node = content.current;
    if (!root || !node) return;
    let frame = 0;
    const measure = () => {
      const height = window.visualViewport?.height ?? innerHeight;
      root.style.setProperty("--bench-viewport-height", `${height}px`);
      setCovering(matchMedia("(max-width: 1023px)").matches);
      const chrome = root.querySelector<HTMLElement>(".map-sheet-chrome")?.offsetHeight ?? 0;
      const actions = root.querySelector<HTMLElement>(".map-sheet-footer")?.offsetHeight ?? 0;
      const nextFlow = mode === "place" && chrome + actions > height * .35;
      if (nextFlow !== flowRef.current) { remember(); setFlow(nextFlow); }
      const heading = node.querySelector<HTMLElement>(".bench-header");
      if (!heading) { setCanPreview(false); return; }
      const detail = node.querySelector<HTMLElement>(".bench-detail")!;
      const detailStyle = getComputedStyle(detail);
      const titleStyle = getComputedStyle(heading);
      const warnings = node.querySelector<HTMLElement>(".bench-visit-warnings");
      const estimate = chrome + actions + heading.offsetHeight + parseFloat(titleStyle.marginBottom)
        + parseFloat(detailStyle.paddingTop) + parseFloat(detailStyle.paddingBottom) + 176 + (warnings?.offsetHeight ?? 0);
      const fits = estimate <= height * .55;
      setCanPreview(fits);
      if (!fits && mode === "preview") {
        snapshot.current = { ...snapshot.current, mode: "place" };
        notify.current?.(snapshot.current);
        setMode("place");
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    for (const child of root.querySelectorAll<HTMLElement>(".map-sheet-chrome,.map-sheet-footer")) observer.observe(child);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  // Measure the same mounted content; callbacks read current refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  return <aside ref={shell} className={`map-sheet-shell map-sheet-bench bench-atlas-sheet ${styles.sheet}`} aria-label={label}
    data-presentation={mode} data-reading-layout={flow ? "flow" : "reserved"} data-snap={mode === "place" ? "full" : "half"} lang={languageTag} data-local-voice={voiceId}
    onScroll={() => { if (flow) remember(); }}
    onFocusCapture={event => { const key = (event.target as HTMLElement).dataset.sheetFocus; if (key) { snapshot.current = { ...snapshot.current, focusKey: key }; notify.current?.(snapshot.current); } }}>
    <div className="map-sheet-chrome">
      <div className="map-sheet-leading"><button type="button" className="map-sheet-close" aria-label={closeLabel} onClick={onClose}><ArrowLeft size={18} aria-hidden="true" /><span>{mapLabel}</span></button>{headerAction}</div>
      {canPreview && <button type="button" className="atlas-place-toggle" aria-label={mode === "place" ? previewLabel : openLabel} title={mode === "place" ? previewLabel : openLabel} aria-expanded={mode === "place"} onClick={() => { if (Date.now() >= suppressClickUntil.current) change(mode === "place" ? "preview" : "place"); }}
        onTouchStart={event => { gestureY.current = event.touches[0].clientY; }} onTouchEnd={event => {
          if (gestureY.current === null) return;
          const delta = event.changedTouches[0].clientY - gestureY.current;
          gestureY.current = null;
          if (Math.abs(delta) > 12) suppressClickUntil.current = Date.now() + 350;
          if (delta < -45) change("place");
          if (delta > 45) change("preview");
        }}>
        <span>{mode === "place" ? previewLabel : openLabel}</span>{mode === "place" ? <ArrowDown size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
      </button>}
    </div>
    <div className="map-sheet-content map-sheet-bench-content" ref={content} onScroll={() => { if (!flow) remember(); }}><BenchAtlasContent mode={mode} change={change}>{children}</BenchAtlasContent></div>
    {footer && <div className="map-sheet-footer">{footer}</div>}
  </aside>;
}
