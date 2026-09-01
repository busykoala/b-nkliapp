"use client";

import { useRef, useState } from "react";
import { ChevronDown, Share2, X } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { BenchDetailContent } from "./bench-detail-content";

type Snap = "peek" | "half" | "full";

export function BenchSheet({ bench, loading, onClose }: { bench: BenchDetail | null; loading: boolean; onClose: () => void }) {
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
  const share = async () => {
    if (!bench) return;
    const url = `${window.location.origin}/bank/${bench.id}`;
    if (navigator.share) await navigator.share({ title: bench.title, text: "Diese Sitzbank auf Benchly", url });
    else { await navigator.clipboard.writeText(url); window.alert("Link kopiert."); }
  };
  return (
    <aside aria-label="Bankdetails" className="desktop-sheet sheet-shadow fixed inset-x-0 bottom-0 z-40 h-[calc(100dvh-5rem)] rounded-t-[1.75rem] bg-base-100 transition-transform duration-300" style={{ transform: translate }}>
      <div className="sticky top-0 z-10 rounded-t-[1.75rem] bg-base-100 px-4 pb-2 pt-2" onTouchStart={(e) => { touchStart.current = e.touches[0].clientY; }} onTouchEnd={(e) => finishDrag(e.changedTouches[0].clientY)}>
        <button aria-label="Detailhöhe ändern" className="mx-auto block h-6 w-full" onClick={() => setSnap(snap === "full" ? "half" : "full")}><span className="mx-auto block h-1.5 w-11 rounded-full bg-base-300" /></button>
        <div className="flex items-center justify-end gap-1">
          {bench && <button aria-label="Bank teilen" className="btn btn-circle btn-ghost btn-sm" onClick={share}><Share2 size={18} /></button>}
          <button aria-label="Details einklappen" className="btn btn-circle btn-ghost btn-sm" onClick={() => setSnap("peek")}><ChevronDown size={19} /></button>
          <button aria-label="Bank schliessen" className="btn btn-circle btn-ghost btn-sm" onClick={onClose}><X size={19} /></button>
        </div>
      </div>
      <div className="h-[calc(100%-4.25rem)] overflow-y-auto px-4 safe-bottom">
        {loading && <div className="flex h-48 items-center justify-center"><span className="loading loading-spinner loading-lg text-primary" /><span className="sr-only">Bank wird geladen</span></div>}
        {!loading && bench && <BenchDetailContent bench={bench} />}
      </div>
    </aside>
  );
}
