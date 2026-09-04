"use client";

import { useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { BenchDetailContent } from "./bench-detail-content";
import type { CurrentUser } from "@/lib/security";

type Snap = "peek" | "half" | "full";

export function BenchSheet({ bench, loading, error, onRetry, onClose, onBenchChange, user }: { bench: BenchDetail | null; loading: boolean; error: boolean; onRetry: () => void; onClose: () => void; onBenchChange?: () => void | Promise<void>; user: CurrentUser | null }) {
  const [snap, setSnap] = useState<Snap>("half");
  const touchStart = useRef<number | null>(null);
  const translate = snap === "peek" ? "translateY(76%)" : snap === "half" ? "translateY(42%)" : "translateY(0)";
  const finishDrag = (end: number) => {
    if (touchStart.current === null) return;
    const delta = end - touchStart.current;
    if (delta < -45) setSnap(snap === "peek" ? "half" : "full");
    if (delta > 45) setSnap(snap === "full" ? "half" : "peek");
    touchStart.current = null;
  };
  return (
    <aside aria-label="Bankdetails" className="desktop-sheet storybook-sheet sheet-shadow fixed inset-x-0 bottom-0 z-40 h-[calc(100dvh-4.5rem)] overflow-hidden rounded-t-[2rem] transition-transform duration-300" style={{ transform: translate }}>
      <div className="sheet-chrome absolute inset-x-0 top-0 z-30 rounded-t-[2rem] px-4 pb-1 pt-2" onTouchStart={(e) => { touchStart.current = e.touches[0].clientY; }} onTouchEnd={(e) => finishDrag(e.changedTouches[0].clientY)}>
        <button aria-label="Detailhöhe ändern" className="mx-auto block h-6 w-full" onClick={() => setSnap(snap === "full" ? "half" : "full")}><span className="mx-auto block h-1 w-12 rounded-full bg-primary/25" /></button>
        <div className="flex items-center justify-end">
          <button aria-label="Bank schliessen" className="sheet-close btn btn-circle btn-ghost btn-sm" onClick={onClose}><X size={19} /></button>
        </div>
      </div>
      <div className="relative z-10 h-full overflow-y-auto safe-bottom">
        {loading && <div className="flex h-48 flex-col items-center justify-center gap-3"><span className="loading loading-ring loading-lg text-primary" /><span className="story-eyebrow">Der Platz wird erkundet</span><span className="sr-only">Bank wird geladen</span></div>}
        {!loading && bench && <BenchDetailContent key={bench.id} bench={bench} user={user} onBenchChange={onBenchChange} />}
        {!loading && error && <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
          <span className="text-5xl" aria-hidden="true">🍃</span>
          <p className="max-w-64 text-lg font-semibold text-primary">Dieser Platz versteckt sich gerade.</p>
          <button className="btn btn-ghost min-h-11 gap-2 rounded-full" onClick={onRetry}><RefreshCw size={18} />Noch einmal schauen</button>
        </div>}
      </div>
    </aside>
  );
}
