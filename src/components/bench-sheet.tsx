"use client";
import { useTranslations } from "next-intl";

import { Footprints, RefreshCw } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { BenchDetailContent } from "./bench-detail-content";
import { BenchQuickPreview } from "./bench-quick-preview";
import type { CurrentUser } from "@/lib/security";
import { LocalBenchLanguageProvider, useLocalBenchLanguage } from "./local-bench-language-provider";
import { MapSheetShell } from "./map-sheet-shell";

type NearbyAmenity = NonNullable<BenchDetail["knowledge"]>["amenities"][number];
type BenchSheetProps = { created?: boolean; bench: BenchDetail | null; loading: boolean; error: boolean; onRetry: () => void; onClose: () => void; onBenchChange?: () => void | Promise<void>; onJourney?: () => void; onResumeWalk?: () => void; onLocateAmenity?: (amenity: NearbyAmenity) => void; user: CurrentUser | null };

export function BenchSheet(props: BenchSheetProps) {
  return props.bench && !props.loading
    ? <LocalBenchLanguageProvider key={props.bench.id} bench={props.bench}><BenchSheetSurface {...props} /></LocalBenchLanguageProvider>
    : <BenchSheetSurface key="empty" {...props} />;
}

function BenchSheetSurface({ created = false, bench, loading, error, onRetry, onClose, onBenchChange, onJourney, onResumeWalk, onLocateAmenity, user }: BenchSheetProps) {
  const t = useTranslations();
  const localLanguage = useLocalBenchLanguage();
  return (
    <MapSheetShell variant="bench" label={t("bench.sheet.label")} resizeLabel={t("bench.sheet.resize")} closeLabel={t("bench.sheet.close")} initialSnap={created ? "full" : "half"} languageTag={localLanguage.profile?.languageTag} voiceId={localLanguage.profile?.voiceId} onClose={onClose} headerAction={onResumeWalk && <button type="button" className="map-sheet-walk-resume" aria-label={t("walks.planner.resume")} title={t("walks.planner.resume")} onClick={onResumeWalk}><Footprints size={18} /><span>{t("walks.planner.resume")}</span></button>}>
      {(visibleSnap) => <>
        {loading && <div className="flex h-48 flex-col items-center justify-center gap-3"><span className="loading loading-ring loading-lg text-primary" /><span className="story-eyebrow">{t("bench.sheet.loading")}</span><span className="sr-only">{t("bench.sheet.loadingAccessible")}</span></div>}
        {!loading && bench && (visibleSnap === "full"
          ? <BenchDetailContent created={created} key={bench.id} bench={bench} user={user} onBenchChange={onBenchChange} onJourney={onJourney} onLocateAmenity={onLocateAmenity} />
          : <BenchQuickPreview key={bench.id} bench={bench} user={user} onJourney={onJourney} onChanged={onBenchChange} />)}
        {!loading && error && <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
          <span className="text-5xl" aria-hidden="true">🍃</span>
          <p className="max-w-64 text-lg font-semibold text-primary">{t("bench.sheet.unavailable")}</p>
          <button className="btn btn-ghost min-h-11 gap-2 rounded-full" onClick={onRetry}><RefreshCw size={18} />{t("bench.sheet.retry")}</button>
        </div>}
      </>}
    </MapSheetShell>
  );
}
