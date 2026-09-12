"use client";

import { formatDate } from "@/i18n/date";
import { useFormatter, useTranslations } from "next-intl";

import type { MessageKey, Translator } from "@/i18n/types";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Flag, Languages, MessageCircleHeart, Navigation, Star } from "lucide-react";
import { reportContribution } from "@/app/actions/contributions";
import type { BenchDetail } from "@/lib/types";
import type { CurrentUser } from "@/lib/security";
import { scenePoem } from "@/lib/scene-poetry";
import { AccountDialog } from "./account-controls";
import { BenchContributionHub } from "./bench-contribution-hub";
import { BenchSummary } from "@/features/bench-detail/bench-summary";
import { BenchFeatureEditor } from "./bench-feature-editor";
import { BenchDetails } from "@/features/bench-detail/bench-details";
import { BenchLandscape } from "./bench-landscape";
import { VerificationQuestion } from "@/features/bench-knowledge/verification-question";
import { PhotoGallery } from "./photo-gallery";
import { galleryImageUrl } from "@/features/bench-photos/media-source";
import { BenchPlaceCommunity } from "./bench-place-community";
import { localBenchVoice } from "@/lib/dialect";
import { useLocalBenchLanguage } from "./local-bench-language-provider";
import { localeTags } from "@/i18n/config";

const correctionLabels: Record<string, MessageKey> = {
  properties: "community.correction.fields.properties",
  condition: "community.correction.fields.condition",
  location: "community.correction.fields.location",
  removed: "community.correction.fields.removed",
  environment: "community.correction.fields.environment",
};

type NearbyAmenity = NonNullable<BenchDetail["knowledge"]>["amenities"][number];

export function BenchDetailContent({ bench, user, onBenchChange, onJourney, onLocateAmenity, created = false }: { bench: BenchDetail; user: CurrentUser | null; onBenchChange?: () => void | Promise<void>; onJourney?: () => void; onLocateAmenity?: (amenity: NearbyAmenity) => void; created?: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [community, setCommunity] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [contributionMode, setContributionMode] = useState<"all" | "rating" | "presence">("all");
  const [authenticated, setAuthenticated] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const detailRef = useRef<HTMLDivElement>(null);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const [, startTransition] = useTransition();
  const signedIn = Boolean(user) || authenticated;
  const localLanguage = useLocalBenchLanguage();
  const refreshBench = onBenchChange ?? (() => router.refresh());
  const refreshTimeSensitiveDetail = useEffectEvent(() => {
    if (document.visibilityState !== "hidden") void refreshBench();
  });
  const contribute = (mode: "all" | "rating" | "presence" = "all") => {
    setContributionMode(mode);
    if (signedIn) setContributeOpen(true);
    else accountDialog.current?.showModal();
  };
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => {
    try {
      const result = await reportContribution(type, id);
      setStatus(result.message);
      if (result.ok) setReported((current) => new Set(current).add(`${type}-${id}`));
    } catch { setStatus(t("bench.story.reportFailed")); }
  });
  useEffect(() => {
    if (community) detailRef.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
  }, [community]);
  useEffect(() => {
    if (created) detailRef.current?.querySelector(".bench-created-status")?.scrollIntoView({ block: "start" });
  }, [created]);
  useEffect(() => {
    const refresh = () => refreshTimeSensitiveDetail();
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [bench.id]);
  const poem = scenePoem(bench, t);
  const localVoice = localLanguage.active ? localBenchVoice(bench) : null;
  const missingFields = bench.properties.filter((item) => /^(Unbekannt|Noch offen)$/i.test(item.value)).slice(0, 3).map((item) => item.key);
  return <div ref={detailRef} className="calm-detail pb-8" lang={localVoice ? localeTags[localVoice.uiLanguage] : undefined} data-local-language={localVoice?.uiLanguage}>
    {community ? <>
      <button className="quiet-back" onClick={() => setCommunity(false)}><ArrowLeft size={17} /> {t("bench.story.back")}</button>
      <Community bench={bench} report={report} reported={reported} user={user} onContribute={() => contribute("rating")} />
    </> : <>
      <section className="bench-story-card">
        <BenchLandscape bench={bench}><RatingEntry bench={bench} onOpen={() => contribute("rating")} /></BenchLandscape>
        <header className="calm-title">
          {created ? <p role="status" className="bench-created-status">{t("bench.story.created")}{bench.verificationStatus === "unverified" ? t("bench.story.remaining", {count: Math.max(0, bench.verificationThreshold - bench.confirmationCount)}) : t("bench.story.confirmed")}</p>
            : bench.verificationStatus === "unverified" && <p className="unverified-note">{t("bench.story.unverified")}</p>}
          <div className="calm-title-row"><h2>{bench.title || t("common.values.bench")}</h2></div>
          <div className="calm-title-meta"><p>{placeLine(bench, t)}</p></div>
          {localVoice && <p className="local-language-badge"><Languages size={14} /> {t("common.language.localActive", { region: localVoice.regionLabel })}</p>}
          <BenchSummary bench={bench} signedIn={signedIn} onSignIn={() => contribute("presence")} onChanged={refreshBench} onLocateAmenity={onLocateAmenity} />
          <div className="bench-primary-actions">
            {onJourney && <button className="journey-entry" onClick={onJourney}><Navigation size={18} />{t("bench.story.directions")}</button>}
            <div className="bench-secondary-actions">
              <button className="contribution-entry" onClick={() => contribute()}><MessageCircleHeart size={17} /> {signedIn ? t("bench.story.contribute") : t("bench.story.join")}</button>
              <button className="contribution-entry" onClick={() => setCommunity(true)}><Star size={17} />{t("bench.story.ratings")}</button>
            </div>
          </div>
        </header>
      </section>
      <div className="calm-story-body">
        {created && signedIn && missingFields.length > 0 && <section className="new-bench-next"><h3>{t("bench.story.nextTitle")}</h3><p>{t("bench.story.nextDescription")}</p><BenchFeatureEditor bench={bench} onlyFields={missingFields} onChanged={refreshBench} /></section>}
        <div className={`scene-caption${localVoice ? " is-local-voice" : ""}`} lang={localVoice?.languageTag} aria-label={localVoice ? `${localVoice.regionLabel}. ${localVoice.first} ${localVoice.second}` : undefined}>
          {localVoice && <small><span aria-hidden="true">◌</span>{localVoice.regionLabel} · {t("common.language.localApproximation")}</small>}
          <p><span>{localVoice?.first ?? poem.first}</span>{" "}<span>{localVoice?.second ?? poem.second}</span></p>
        </div>
        {signedIn && bench.knowledge?.question && <VerificationQuestion benchId={bench.id} question={bench.knowledge.question} onChanged={refreshBench} />}
        <BenchDetails bench={bench} signedIn={signedIn} onChanged={refreshBench} />
        <BenchPlaceCommunity bench={bench} signedIn={signedIn} onChanged={refreshBench} />
        <PhotoStory bench={bench} />
      </div>
    </>}
    {status && <p role="status" className="contribution-inline-status">{status}</p>}
    {signedIn && contributeOpen && <BenchContributionHub key={`${bench.id}-${contributionMode}`} bench={bench} open initialChapter={contributionMode} onClose={() => setContributeOpen(false)} onChanged={refreshBench} />}
    <AccountDialog dialogRef={accountDialog} intent={contributionMode === "rating" ? t("bench.story.rateIntent") : contributionMode === "presence" ? t("community.chapters.presence.title") : t("community.hub.title")} onAuthenticated={() => { setAuthenticated(true); setContributeOpen(true); void refreshBench(); }} />
  </div>;
}

function RatingEntry({ bench, onOpen }: { bench: BenchDetail; onOpen: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  const rounded = bench.ratingAverage === null ? 0 : Math.max(1, Math.min(5, Math.round(bench.ratingAverage)));
  const label = bench.myRating
    ? t("bench.story.ratingMine", {score: bench.myRating.overall})
    : bench.ratingAverage === null
      ? t("bench.story.ratingEmpty")
      : t("bench.story.ratingSummary", {score: format.number(bench.ratingAverage, {minimumFractionDigits: 1, maximumFractionDigits: 1}), count: bench.ratingCount});

  return <button type="button" className={`landscape-rating-action${rounded === 0 ? " is-empty" : ""}`} aria-label={label} title={label} onClick={onOpen}>
    <span className="landscape-rating-stars" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => <Star key={index} className={index < rounded ? "is-filled" : undefined} />)}
    </span>
    {bench.ratingAverage !== null && <strong>{format.number(bench.ratingAverage, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</strong>}
  </button>;
}

function PhotoStory({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const media = [...bench.media.filter((item) => item.relation === "exact"), ...bench.media.filter((item) => item.relation === "nearby")];
  if (!media.length) return null;
  const photos = media.flatMap((item) => {
    const src = galleryImageUrl(item.thumbnailUrl);
    return src ? [{ id: String(item.id), src, caption: item.relation === "nearby" ? t("photos.story.nearby") : item.title ?? t("photos.story.place"), credit: `${item.author ?? item.provider} · ${item.license ?? t("photos.story.license")}`, sourceUrl: item.sourceUrl }] : [];
  });
  const links = media.filter((item) => !galleryImageUrl(item.thumbnailUrl) && /^https?:\/\//.test(item.sourceUrl));
  return <section className="photo-story">
    <h3>{t("photos.story.title")}</h3>
    {photos.length > 0 && <PhotoGallery photos={photos} />}
    {links.map((item) => <p key={item.id}><a href={item.sourceUrl} target="_blank" rel="noreferrer">{t("photos.story.external")}</a></p>)}
  </section>;
}

function Community({ bench, report, reported, user, onContribute }: { bench: BenchDetail; reported: Set<string>; report: (type: "rating" | "correction", id: number) => void; user: CurrentUser | null; onContribute: () => void }) {
  const t = useTranslations();
  const format = useFormatter();
  return <div className="community-page">
    <header><small>{t("community.reviews.eyebrow")}</small><h3>{t("community.reviews.title")}</h3></header>
    {bench.ratingBreakdown && <div className="rating-line">{Object.entries({ [t("community.rating.fields.overall")]: bench.ratingBreakdown.overall, [t("community.rating.fields.view")]: bench.ratingBreakdown.view, [t("community.rating.fields.comfort")]: bench.ratingBreakdown.comfort, [t("community.rating.fields.quiet")]: bench.ratingBreakdown.quiet }).map(([label, value]) => <span key={label}><strong>{format.number(value, {maximumFractionDigits: 1})}</strong><small>{label}</small></span>)}</div>}
    {user
      ? <button type="button" className="community-contribute-entry" onClick={onContribute}><MessageCircleHeart size={17} /> {bench.myRating ? t("community.reviews.edit") : t("community.reviews.add")}</button>
      : <button type="button" className="community-contribute-entry" onClick={onContribute}><MessageCircleHeart size={17} /> {t("community.reviews.signIn")}</button>}
    {bench.recentRatings.map((rating) => <article key={rating.id} className="quiet-contribution"><div><strong>{rating.overall}/5</strong><time>{formatDate(rating.createdAt, t)}</time><button disabled={reported.has(`rating-${rating.id}`)} aria-label={reported.has(`rating-${rating.id}`) ? t("community.reviews.reportedRating") : t("community.reviews.reportRating")} onClick={() => report("rating", rating.id)}><Flag size={14} /></button></div>{rating.note && <p>{rating.note}</p>}</article>)}
    {bench.corrections.length > 0 && <section className="community-notes"><h3>{t("community.reviews.notes")}</h3>{bench.corrections.map((item) => <article key={item.id} className="quiet-contribution"><div><small>{correctionLabels[item.field] ? t(correctionLabels[item.field]) : item.field}</small><button disabled={reported.has(`correction-${item.id}`)} aria-label={reported.has(`correction-${item.id}`) ? t("community.reviews.reportedCorrection") : t("community.reviews.reportCorrection")} onClick={() => report("correction", item.id)}><Flag size={14} /></button></div><strong>{item.proposedValue}</strong>{item.note && <p>{item.note}</p>}</article>)}</section>}
  </div>;
}

function placeLine(bench: BenchDetail, t: Translator) {
  return [bench.elevationMeters !== null ? t("bench.location.metresAboveSea", {value: Math.round(bench.elevationMeters)}) : null, bench.locationName].filter(Boolean).join(" · ") || t("bench.story.quietPlace");
}
