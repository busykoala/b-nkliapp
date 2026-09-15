"use client";
import { useTranslations } from "next-intl";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, X } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { BenchDetailContent } from "./bench-detail-content";
import { BenchQuickPreview } from "./bench-quick-preview";
import type { CurrentUser } from "@/lib/security";
import { LocalBenchLanguageProvider, useLocalBenchLanguage } from "./local-bench-language-provider";

type Snap = "peek" | "half" | "full";
type NearbyAmenity = NonNullable<BenchDetail["knowledge"]>["amenities"][number];
type BenchSheetProps = { created?: boolean; bench: BenchDetail | null; loading: boolean; error: boolean; onRetry: () => void; onClose: () => void; onBenchChange?: () => void | Promise<void>; onJourney?: () => void; onLocateAmenity?: (amenity: NearbyAmenity) => void; user: CurrentUser | null };

export function BenchSheet(props: BenchSheetProps) {
  return props.bench && !props.loading
    ? <LocalBenchLanguageProvider key={props.bench.id} bench={props.bench}><BenchSheetSurface {...props} /></LocalBenchLanguageProvider>
    : <BenchSheetSurface key="empty" {...props} />;
}

function BenchSheetSurface({ created = false, bench, loading, error, onRetry, onClose, onBenchChange, onJourney, onLocateAmenity, user }: BenchSheetProps) {
  const t = useTranslations();
  const localLanguage = useLocalBenchLanguage();
  const [snap, setSnap] = useState<Snap>(created ? "full" : "half");
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const visibleSnap = desktop ? "full" : snap;
  const touchStart = useRef<number | null>(null);
  const finishDrag = (end: number) => {
    if (touchStart.current === null) return;
    const delta = end - touchStart.current;
    if (delta < -45) setSnap(snap === "peek" ? "half" : "full");
    if (delta > 45) setSnap(snap === "full" ? "half" : "peek");
    touchStart.current = null;
  };
  return (
    <aside aria-label={t("bench.sheet.label")} lang={localLanguage.profile?.languageTag} data-local-voice={localLanguage.profile?.voiceId} data-snap={visibleSnap} className="desktop-sheet storybook-sheet sheet-shadow fixed inset-x-0 bottom-0 z-40 h-[calc(100dvh-4.5rem)] overflow-hidden rounded-t-[2rem] transition-transform duration-300">
      <div className="sheet-chrome absolute inset-x-0 top-0 z-30 rounded-t-[2rem] px-4 py-2" onTouchStart={(e) => { touchStart.current = e.touches[0].clientY; }} onTouchEnd={(e) => finishDrag(e.changedTouches[0].clientY)}>
        <button aria-label={t("bench.sheet.resize")} aria-expanded={visibleSnap === "full"} className="overlay-resize" onClick={() => setSnap(snap === "full" ? "half" : "full")}>{visibleSnap === "full" ? <ChevronDown size={20} /> : <ChevronUp size={20} />}<span>{t(visibleSnap === "full" ? "bench.sheet.showMap" : "bench.sheet.showDetails")}</span></button>
        <div className="sheet-close-slot">
          <button aria-label={t("bench.sheet.close")} className="sheet-close btn btn-circle btn-ghost btn-sm" onClick={onClose}><X size={19} /></button>
        </div>
      </div>
      <div className="relative z-10 h-full overflow-y-auto safe-bottom">
        {loading && <div className="flex h-48 flex-col items-center justify-center gap-3"><span className="loading loading-ring loading-lg text-primary" /><span className="story-eyebrow">{t("bench.sheet.loading")}</span><span className="sr-only">{t("bench.sheet.loadingAccessible")}</span></div>}
        {!loading && bench && (visibleSnap === "full"
          ? <BenchDetailContent created={created} key={bench.id} bench={bench} user={user} onBenchChange={onBenchChange} onJourney={onJourney} onLocateAmenity={onLocateAmenity} />
          : <BenchQuickPreview key={bench.id} bench={bench} user={user} onJourney={onJourney} onChanged={onBenchChange} />)}
        {!loading && error && <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
          <span className="text-5xl" aria-hidden="true">🍃</span>
          <p className="max-w-64 text-lg font-semibold text-primary">{t("bench.sheet.unavailable")}</p>
          <button className="btn btn-ghost min-h-11 gap-2 rounded-full" onClick={onRetry}><RefreshCw size={18} />{t("bench.sheet.retry")}</button>
        </div>}
      </div>
    </aside>
  );
}
