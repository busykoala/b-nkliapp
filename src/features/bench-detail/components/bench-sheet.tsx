"use client";
import { useTranslations } from "next-intl";

import { Footprints, RefreshCw } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { BenchDetailContent } from "@/features/bench-detail/components/bench-detail-content";
import { BenchActions } from "./bench-header";
import type { CurrentUser } from "@/lib/security";
import { LocalBenchLanguageProvider, useLocalBenchLanguage } from "@/features/bench-detail/components/local-bench-language-provider";
import { BenchAtlasSheet, type BenchAtlasPresentation } from "@/components/bench-atlas-sheet";

type NearbyAmenity = NonNullable<BenchDetail["knowledge"]>["amenities"][number];
type BenchSheetProps = { created?: boolean; initiallyExpanded?: boolean; returnTarget?: "map" | "list" | "walk"; presentation?: BenchAtlasPresentation | null; onPresentationChange?: (presentation: BenchAtlasPresentation) => void; bench: BenchDetail | null; loading: boolean; error: boolean; onRetry: () => void; onClose: () => void; onBenchChange?: () => void | Promise<void>; onJourney?: () => void; onResumeWalk?: () => void; onLocateAmenity?: (amenity: NearbyAmenity) => void; user: CurrentUser | null };

export function BenchSheet(props: BenchSheetProps) {
  return props.bench && !props.loading
    ? <LocalBenchLanguageProvider key={props.bench.id} bench={props.bench}><BenchSheetSurface {...props} /></LocalBenchLanguageProvider>
    : <BenchSheetSurface key="empty" {...props} />;
}

function BenchSheetSurface({ created = false, initiallyExpanded = false, returnTarget = "map", presentation, onPresentationChange, bench, loading, error, onRetry, onClose, onBenchChange, onJourney, onResumeWalk, onLocateAmenity, user }: BenchSheetProps) {
  const t = useTranslations();
  const localLanguage = useLocalBenchLanguage();
  return (
    <BenchAtlasSheet label={t("bench.sheet.label")} openLabel={t("reading.atlas.openPlace")} previewLabel={t("reading.atlas.showMap")} closeLabel={returnTarget === "walk" ? t("walks.planner.resume") : returnTarget === "list" ? t("map.list.title") : t("bench.sheet.close")} mapLabel={returnTarget === "walk" ? t("walks.planner.resume") : returnTarget === "list" ? t("map.list.button") : t("reading.atlas.closeSearch")} initialMode={created || initiallyExpanded ? "place" : "preview"} initialPresentation={presentation} onPresentationChange={onPresentationChange} languageTag={localLanguage.profile?.languageTag} voiceId={localLanguage.profile?.voiceId} onClose={onClose} footer={!loading && bench && <BenchActions key={bench.id} bench={bench} user={user} onJourney={onJourney} onChanged={onBenchChange} />} headerAction={returnTarget !== "walk" && onResumeWalk && <button type="button" className="map-sheet-walk-resume" aria-label={t("walks.planner.resume")} title={t("walks.planner.resume")} onClick={onResumeWalk}><Footprints size={18} /><span>{t("walks.planner.resume")}</span></button>}>
      {(mode, changeMode) => {
        return <>
        {loading && <div className="flex h-48 flex-col items-center justify-center gap-3"><span className="loading loading-ring loading-lg text-primary" /><span className="story-eyebrow">{t("bench.sheet.loading")}</span><span className="sr-only">{t("bench.sheet.loadingAccessible")}</span></div>}
        {!loading && bench && <BenchDetailContent created={created} key={bench.id} bench={bench} user={user} compact={mode === "preview"} hideActions onDetails={() => changeMode("place")} onBenchChange={onBenchChange} onJourney={onJourney} onLocateAmenity={onLocateAmenity} />}
        {!loading && error && <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
          <RefreshCw size={30} aria-hidden="true" />
          <p className="max-w-64 text-lg font-semibold text-primary">{t("bench.sheet.unavailable")}</p>
          <button className="btn btn-ghost min-h-11 gap-2 rounded-full" onClick={onRetry}><RefreshCw size={18} />{t("bench.sheet.retry")}</button>
        </div>}
      </>;}}
    </BenchAtlasSheet>
  );
}
