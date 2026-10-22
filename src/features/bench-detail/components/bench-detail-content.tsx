"use client";

import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { reportContribution } from "@/app/actions/contributions";
import type { BenchDetail } from "@/lib/types";
import type { CurrentUser } from "@/lib/security";
import { BenchPoem } from "./bench-poem";
import { BenchPanorama } from "@/features/bench-panorama/components/bench-panorama";
import { BenchPlaceCommunity } from "@/features/bench-community/components/bench-place-community";
import { BenchContribute } from "@/features/bench-community/components/bench-contribute";
import { useBenchContributions } from "@/features/bench-community/components/use-bench-contributions";
import { BenchHeader, BenchActions } from "./bench-header";
import { BenchOverview, BenchRatingLink, BenchVisitWarnings } from "./bench-overview";
import { BenchVisitDetails } from "./bench-visit-details";
import { BenchPhotos } from "./bench-photos";
import { BenchReviews } from "./bench-reviews";
import { useLocalBenchLanguage } from "./local-bench-language-provider";
import type { NearbyAmenity } from "../overview";

export type BenchDetailContentProps = {
  bench: BenchDetail;
  user: CurrentUser | null;
  onBenchChange?: () => void | Promise<void>;
  onJourney?: () => void;
  journeyHref?: string;
  onLocateAmenity?: (amenity: NearbyAmenity) => void;
  amenityMapHrefPrefix?: string;
  created?: boolean;
  compact?: boolean;
  hideActions?: boolean;
  onDetails?: () => void;
};

export function BenchDetailContent({ bench, user, onBenchChange, onJourney, journeyHref, onLocateAmenity, amenityMapHrefPrefix, created = false, compact = false, hideActions = false, onDetails }: BenchDetailContentProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const refresh = onBenchChange ?? (() => router.refresh());
  const { contribute, dialogs, signedIn } = useBenchContributions(bench, user, refresh);
  const [reviews, setReviews] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const readingPosition = useRef(0);
  const localLanguage = useLocalBenchLanguage();
  const voice = localLanguage.active ? bench.dialectPresentation?.voice : undefined;
  const refreshVisible = useEffectEvent(() => {
    if (document.visibilityState !== "hidden") void Promise.resolve(refresh()).catch(() => {});
  });
  useEffect(() => {
    const update = () => refreshVisible();
    const interval = window.setInterval(update, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, [bench.id]);
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => {
    try {
      const result = await reportContribution(type, id);
      setStatus(result.message);
      if (result.ok) setReported(current => new Set(current).add(`${type}-${id}`));
    } catch { setStatus(t("bench.story.reportFailed")); }
  });
  const toggleReviews = (show: boolean) => {
    const scroller = root.current?.closest(".map-sheet-content") ?? document.scrollingElement;
    if (show) readingPosition.current = scroller?.scrollTop ?? 0;
    setReviews(show);
    requestAnimationFrame(() => {
      scroller?.scrollTo({ top: show ? 0 : readingPosition.current });
      root.current?.querySelector<HTMLElement>(show ? ".quiet-back" : ".overview-rating")?.focus({ preventScroll: true });
    });
  };
  return <div ref={root} className={`bench-detail calm-detail${compact ? " is-compact" : ""}`} lang={voice?.languageTag} data-local-language={voice?.language}>
    {reviews && <>
      <button type="button" className="quiet-back" onClick={() => toggleReviews(false)}><ArrowLeft size={17} aria-hidden="true" />{t("bench.story.back")}</button>
      <BenchReviews bench={bench} user={user} reported={reported} report={report} onContribute={() => contribute("rating")} />
    </>}
    <div hidden={reviews}>
      {created && <p role="status" className="bench-created-status">{t("bench.story.created")}</p>}
      <BenchHeader bench={bench} />
      <BenchPanorama key={bench.id} bench={bench} />
      <BenchVisitWarnings bench={bench} />
      {compact && !hideActions && <BenchActions bench={bench} user={user} onJourney={onJourney} journeyHref={journeyHref} onChanged={refresh} />}
      {compact && !hideActions && onDetails && <button type="button" className="bench-details-link" onClick={onDetails}><ArrowUpRight size={18} aria-hidden="true" />{t("bench.sheet.showDetails")}</button>}
      <div className="bench-further" hidden={compact}>
      <BenchPoem key={`${bench.id}:${voice?.id ?? "standard"}:${locale}`} bench={bench} localText={voice?.first} />
      <BenchOverview bench={bench} />
      {!compact && !hideActions && <BenchActions bench={bench} user={user} onJourney={onJourney} journeyHref={journeyHref} onChanged={refresh} />}
      <BenchVisitDetails bench={bench} onLocateAmenity={onLocateAmenity} amenityMapHrefPrefix={amenityMapHrefPrefix} onChanged={refresh} />
      <BenchPhotos bench={bench} onAdd={() => contribute("photo")} />
      <div className="bench-community-reading"><BenchRatingLink bench={bench} onReviews={() => toggleReviews(true)} /><BenchPlaceCommunity bench={bench} signedIn={signedIn} onChanged={refresh} /></div>
      <BenchContribute onChoose={contribute} />
      </div>
    </div>
    {status && <p role="status" className="bench-action-status">{status}</p>}
    {dialogs}
  </div>;
}
