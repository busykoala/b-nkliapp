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
import { BenchDetails } from "@/features/bench-detail/bench-details";
import { BenchLandscape } from "./bench-landscape";
import { BenchPlaceCommunity } from "./bench-place-community";

const correctionLabels: Record<string, string> = {
  properties: "Ausstattung",
  condition: "Zustand",
  location: "Position",
  removed: "Nicht mehr vorhanden",
  environment: "Umgebung, Aussicht oder Licht",
};

export function BenchDetailContent({ bench, user, onBenchChange, onJourney }: { bench: BenchDetail; user: CurrentUser | null; onBenchChange?: () => void | Promise<void>; onJourney?: () => void }) {
  const router = useRouter();
  const [community, setCommunity] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const [, startTransition] = useTransition();
  const refreshBench = onBenchChange ?? (() => router.refresh());
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => {
    const result = await reportContribution(type, id);
    window.alert(result.message);
  });

  useEffect(() => {
    if (community) detailRef.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
  }, [community]);

  if (community) {
    return <>
      <div ref={detailRef} className="calm-detail community-detail pb-8">
        <button className="quiet-back" onClick={() => setCommunity(false)}><ArrowLeft size={17} /> Zum Platz</button>
        <Community bench={bench} report={report} user={user} onContribute={() => user ? setContributeOpen(true) : accountDialog.current?.showModal()} />
        {user && <BenchContributionHub bench={bench} open={contributeOpen} onClose={() => setContributeOpen(false)} onChanged={refreshBench} />}
      </div>
      {!user && <AccountDialog dialogRef={accountDialog} />}
    </>;
  }

  const poem = scenePoem(bench);

  return <div ref={detailRef} className="calm-detail pb-8">
    <section className="bench-story-card">
      <BenchLandscape bench={bench}>
        <RatingEntry bench={bench} onOpen={() => setCommunity(true)} />
      </BenchLandscape>
      <header className="calm-title">
        {bench.verificationStatus === "unverified" && <p className="unverified-note">Neu entdeckt · noch unbestätigt</p>}
        <div className="calm-title-row"><h2>{bench.title}</h2></div>
        <div className="calm-title-meta"><p>{placeLine(bench)}</p></div>
        <div className="bench-primary-actions">
          {onJourney && <button className="journey-entry" onClick={onJourney}><span aria-hidden="true">↝</span> Weg hierher</button>}
          <button className="contribution-entry" onClick={() => user ? setContributeOpen(true) : accountDialog.current?.showModal()}><MessageCircleHeart size={17} /> {user ? "Beitragen" : "Mitmachen"}</button>
        </div>
      </header>
    </section>

    <div className="calm-story-body">
      <p className="scene-caption"><span>{poem.first}</span>{" "}<span>{poem.second}</span></p>
      <BenchDetails bench={bench} />
      <BenchPlaceCommunity bench={bench} signedIn={Boolean(user)} onChanged={refreshBench} />
      <PhotoStory bench={bench} />
    </div>
    {user && <BenchContributionHub bench={bench} open={contributeOpen} onClose={() => setContributeOpen(false)} onChanged={refreshBench} />}
    {!user && <AccountDialog dialogRef={accountDialog} />}
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
  return <section className="photo-story">
    <h3>Ein Blick in die Nähe</h3>
    <div className="photo-ribbon">{media.map((item) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer">
      <MediaImage src={item.thumbnailUrl} alt={item.title ?? "Bild aus der Umgebung der Sitzbank"} />
      <span>{item.relation === "nearby" ? "Aus der Umgebung" : item.title ?? "Dieser Platz"}</span>
      <small>{item.author ?? item.provider} · {item.license ?? "Lizenz bei Quelle"}</small>
    </a>)}</div>
  </section>;
}

function Community({ bench, report, user, onContribute }: { bench: BenchDetail; report: (type: "rating" | "correction", id: number) => void; user: CurrentUser | null; onContribute: () => void }) {
  return <div className="community-page">
    <header><small>Von Menschen vor Ort</small><h3>Wie war die Pause?</h3></header>
    {bench.ratingBreakdown && <div className="rating-line">{Object.entries({ Gesamt: bench.ratingBreakdown.overall, Aussicht: bench.ratingBreakdown.view, Komfort: bench.ratingBreakdown.comfort, Ruhe: bench.ratingBreakdown.quiet }).map(([label, value]) => <span key={label}><strong>{value}</strong><small>{label}</small></span>)}</div>}
    {user
      ? <button type="button" className="community-contribute-entry" onClick={onContribute}><MessageCircleHeart size={17} /> {bench.myRating ? "Meinen Beitrag bearbeiten" : "Einen Eindruck beitragen"}</button>
      : <button type="button" className="community-contribute-entry" onClick={onContribute}><MessageCircleHeart size={17} /> Zum Mitmachen kurz anmelden</button>}
    {bench.recentRatings.map((rating) => <article key={rating.id} className="quiet-contribution"><div><strong>{rating.overall}/5</strong><time>{new Date(rating.createdAt).toLocaleDateString("de-CH")}</time><button aria-label="Bewertung melden" onClick={() => report("rating", rating.id)}><Flag size={14} /></button></div>{rating.note && <p>{rating.note}</p>}</article>)}
    {bench.corrections.length > 0 && <section className="community-notes"><h3>Hinweise</h3>{bench.corrections.map((item) => <article key={item.id} className="quiet-contribution"><div><small>{correctionLabels[item.field] ?? item.field}</small><button aria-label="Korrektur melden" onClick={() => report("correction", item.id)}><Flag size={14} /></button></div><strong>{item.proposedValue}</strong>{item.note && <p>{item.note}</p>}</article>)}</section>}
  </div>;
}

function placeLine(bench: BenchDetail) {
  return [bench.elevationMeters !== null ? `${Math.round(bench.elevationMeters)} m ü. M.` : null, bench.locationName].filter(Boolean).join(" · ") || "Ein stiller Platz";
}

// External Commons hosts are intentionally rendered directly so thumbnails are not rehosted or proxied.
// eslint-disable-next-line @next/next/no-img-element
function MediaImage({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} loading="lazy" />; }
