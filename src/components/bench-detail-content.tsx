"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Flag, MessageCircleHeart, Star } from "lucide-react";
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

const correctionLabels: Record<string, string> = {
  properties: "Ausstattung",
  condition: "Zustand",
  location: "Position",
  removed: "Nicht mehr vorhanden",
  environment: "Umgebung, Aussicht oder Licht",
};

export function BenchDetailContent({ bench, user, onBenchChange, onJourney, created = false }: { bench: BenchDetail; user: CurrentUser | null; onBenchChange?: () => void | Promise<void>; onJourney?: () => void; created?: boolean }) {
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
  const refreshBench = onBenchChange ?? (() => router.refresh());
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
    } catch { setStatus("Meldung fehlgeschlagen. Bitte erneut versuchen."); }
  });
  useEffect(() => {
    if (community) detailRef.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
  }, [community]);
  useEffect(() => {
    if (created) detailRef.current?.querySelector(".bench-created-status")?.scrollIntoView({ block: "start" });
  }, [created]);
  const poem = scenePoem(bench);
  const missingFields = bench.properties.filter((item) => /^(Unbekannt|Noch offen)$/i.test(item.value)).slice(0, 3).map((item) => item.key);
  return <div ref={detailRef} className="calm-detail pb-8">
    {community ? <>
      <button className="quiet-back" onClick={() => setCommunity(false)}><ArrowLeft size={17} /> Zum Platz</button>
      <Community bench={bench} report={report} reported={reported} user={user} onContribute={() => contribute("rating")} />
    </> : <>
      <section className="bench-story-card">
        <BenchLandscape bench={bench}><RatingEntry bench={bench} onOpen={() => contribute("rating")} /></BenchLandscape>
        <header className="calm-title">
          {created ? <p role="status" className="bench-created-status">Bänkli eingetragen{bench.verificationStatus === "unverified" ? ` · noch ${Math.max(0, bench.verificationThreshold - bench.confirmationCount)} Bestätigungen` : " · bestätigt"}</p>
            : bench.verificationStatus === "unverified" && <p className="unverified-note">Neu entdeckt · noch unbestätigt</p>}
          <div className="calm-title-row"><h2>{bench.title}</h2></div>
          <div className="calm-title-meta"><p>{placeLine(bench)}</p></div>
          <BenchSummary bench={bench} signedIn={signedIn} onSignIn={() => contribute("presence")} onChanged={refreshBench} />
          <div className="bench-primary-actions">
            {onJourney && <button className="journey-entry" onClick={onJourney}><span aria-hidden="true">↝</span> Weg hierher</button>}
            <button className="contribution-entry" onClick={() => contribute()}><MessageCircleHeart size={17} /> {signedIn ? "Beitragen" : "Mitmachen"}</button>
            <button className="contribution-entry" onClick={() => setCommunity(true)}>Bewertungen ansehen</button>
          </div>
        </header>
      </section>
      <div className="calm-story-body">
        {created && signedIn && missingFields.length > 0 && <section className="new-bench-next"><h3>Was kannst du noch ergänzen?</h3><p>Diese Angaben helfen bei der nächsten Pause.</p><BenchFeatureEditor bench={bench} onlyFields={missingFields} onChanged={refreshBench} /></section>}
        <p className="scene-caption"><span>{poem.first}</span>{" "}<span>{poem.second}</span></p>
        {signedIn && bench.knowledge?.question && <VerificationQuestion benchId={bench.id} question={bench.knowledge.question} onChanged={refreshBench} />}
        <BenchDetails bench={bench} signedIn={signedIn} onChanged={refreshBench} />
        <BenchPlaceCommunity bench={bench} signedIn={signedIn} onChanged={refreshBench} />
        <PhotoStory bench={bench} />
      </div>
    </>}
    {status && <p role="status" className="contribution-inline-status">{status}</p>}
    {signedIn && contributeOpen && <BenchContributionHub key={`${bench.id}-${contributionMode}`} bench={bench} open initialChapter={contributionMode} onClose={() => setContributeOpen(false)} onChanged={refreshBench} />}
    <AccountDialog dialogRef={accountDialog} intent={contributionMode === "rating" ? "Bewertung abgeben" : contributionMode === "presence" ? "Bänkli bestätigen" : "Zum Bänkli beitragen"} onAuthenticated={() => { setAuthenticated(true); setContributeOpen(true); void refreshBench(); }} />
  </div>;
}

function RatingEntry({ bench, onOpen }: { bench: BenchDetail; onOpen: () => void }) {
  const rounded = bench.ratingAverage === null ? 0 : Math.max(1, Math.min(5, Math.round(bench.ratingAverage)));
  const label = bench.myRating
    ? `Deine Bewertung ist ${bench.myRating.overall} von 5. Bewertung bearbeiten`
    : bench.ratingAverage === null
      ? "Noch unbewertet. Erste Bewertung abgeben"
      : `Bewertung ${bench.ratingAverage.toFixed(1)} von 5 bei ${bench.ratingCount} ${bench.ratingCount === 1 ? "Stimme" : "Stimmen"}. Selbst bewerten`;

  return <button type="button" className={`landscape-rating-action${rounded === 0 ? " is-empty" : ""}`} aria-label={label} title={label} onClick={onOpen}>
    <span className="landscape-rating-stars" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => <Star key={index} className={index < rounded ? "is-filled" : undefined} />)}
    </span>
    {bench.ratingAverage !== null && <strong>{bench.ratingAverage.toFixed(1)}</strong>}
  </button>;
}

function PhotoStory({ bench }: { bench: BenchDetail }) {
  const media = [...bench.media.filter((item) => item.relation === "exact"), ...bench.media.filter((item) => item.relation === "nearby")];
  if (!media.length) return null;
  const photos = media.flatMap((item) => {
    const src = galleryImageUrl(item.thumbnailUrl);
    return src ? [{ id: String(item.id), src, caption: item.relation === "nearby" ? "Aus der Umgebung · nicht zwingend diese Bank" : item.title ?? "Dieser Platz", credit: `${item.author ?? item.provider} · ${item.license ?? "Lizenz bei Quelle"}`, sourceUrl: item.sourceUrl }] : [];
  });
  const links = media.filter((item) => !galleryImageUrl(item.thumbnailUrl) && /^https?:\/\//.test(item.sourceUrl));
  return <section className="photo-story">
    <h3>Ein Blick in die Nähe</h3>
    {photos.length > 0 && <PhotoGallery photos={photos} />}
    {links.map((item) => <p key={item.id}><a href={item.sourceUrl} target="_blank" rel="noreferrer">Externer Hinweis zum Platz ↗</a></p>)}
  </section>;
}

function Community({ bench, report, reported, user, onContribute }: { bench: BenchDetail; reported: Set<string>; report: (type: "rating" | "correction", id: number) => void; user: CurrentUser | null; onContribute: () => void }) {
  return <div className="community-page">
    <header><small>Von Menschen vor Ort</small><h3>Wie war die Pause?</h3></header>
    {bench.ratingBreakdown && <div className="rating-line">{Object.entries({ Gesamt: bench.ratingBreakdown.overall, Aussicht: bench.ratingBreakdown.view, Komfort: bench.ratingBreakdown.comfort, Ruhe: bench.ratingBreakdown.quiet }).map(([label, value]) => <span key={label}><strong>{value}</strong><small>{label}</small></span>)}</div>}
    {user
      ? <button type="button" className="community-contribute-entry" onClick={onContribute}><MessageCircleHeart size={17} /> {bench.myRating ? "Meinen Beitrag bearbeiten" : "Einen Eindruck beitragen"}</button>
      : <button type="button" className="community-contribute-entry" onClick={onContribute}><MessageCircleHeart size={17} /> Zum Mitmachen kurz anmelden</button>}
    {bench.recentRatings.map((rating) => <article key={rating.id} className="quiet-contribution"><div><strong>{rating.overall}/5</strong><time>{new Date(rating.createdAt).toLocaleDateString("de-CH")}</time><button disabled={reported.has(`rating-${rating.id}`)} aria-label={reported.has(`rating-${rating.id}`) ? "Bewertung gemeldet" : "Bewertung melden"} onClick={() => report("rating", rating.id)}><Flag size={14} /></button></div>{rating.note && <p>{rating.note}</p>}</article>)}
    {bench.corrections.length > 0 && <section className="community-notes"><h3>Hinweise</h3>{bench.corrections.map((item) => <article key={item.id} className="quiet-contribution"><div><small>{correctionLabels[item.field] ?? item.field}</small><button disabled={reported.has(`correction-${item.id}`)} aria-label={reported.has(`correction-${item.id}`) ? "Korrektur gemeldet" : "Korrektur melden"} onClick={() => report("correction", item.id)}><Flag size={14} /></button></div><strong>{item.proposedValue}</strong>{item.note && <p>{item.note}</p>}</article>)}</section>}
  </div>;
}

function placeLine(bench: BenchDetail) {
  return [bench.elevationMeters !== null ? `${Math.round(bench.elevationMeters)} m ü. M.` : null, bench.locationName].filter(Boolean).join(" · ") || "Ein stiller Platz";
}
