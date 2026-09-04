"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Flag, Pencil, Star, X } from "lucide-react";
import { editBenchMetadata } from "@/app/actions/benches";
import { reportContribution } from "@/app/actions/contributions";
import type { BenchDetail } from "@/lib/types";
import type { CurrentUser } from "@/lib/security";
import { scenePoem } from "@/lib/scene-poetry";
import { RatingForm } from "./contribution-forms";
import { BenchCommunityActions } from "./bench-community-actions";
import { BenchDetails } from "./bench-details";
import { BenchLandscape } from "./bench-landscape";

const correctionLabels: Record<string, string> = {
  properties: "Ausstattung",
  condition: "Zustand",
  location: "Position",
  removed: "Nicht mehr vorhanden",
  environment: "Umgebung, Aussicht oder Licht",
};

export function BenchDetailContent({ bench, user, onBenchChange }: { bench: BenchDetail; user: CurrentUser | null; onBenchChange?: () => void | Promise<void> }) {
  const [community, setCommunity] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const saveStory = useCallback(async (_previous: Awaited<ReturnType<typeof editBenchMetadata>> | null, formData: FormData) => {
    const result = await editBenchMetadata(bench.id, null, formData);
    if (result.ok) {
      setStoryOpen(false);
      if (onBenchChange) await onBenchChange();
      else router.refresh();
    }
    return result;
  }, [bench.id, onBenchChange, router]);
  const [storyState, storyAction, storyPending] = useActionState(saveStory, null);
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => {
    const result = await reportContribution(type, id);
    window.alert(result.message);
  });

  useEffect(() => {
    if (community) detailRef.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
  }, [community]);

  if (community) {
    return <div ref={detailRef} className="calm-detail community-detail pb-8">
      <button className="quiet-back" onClick={() => setCommunity(false)}><ArrowLeft size={17} /> Zum Platz</button>
      <Community bench={bench} report={report} user={user} />
    </div>;
  }

  const poem = scenePoem(bench);

  return <div ref={detailRef} className="calm-detail pb-8">
    <section className="bench-story-card">
      <BenchLandscape bench={bench}>
        <RatingEntry bench={bench} onOpen={() => setCommunity(true)} />
      </BenchLandscape>
      <header className="calm-title">
        {bench.verificationStatus === "unverified" && <p className="unverified-note">Neu entdeckt · noch unbestätigt</p>}
        <div className="calm-title-row"><h2>{bench.title}</h2>{user && <button type="button" className="story-edit-button" aria-label="Name und Widmung bearbeiten" aria-expanded={storyOpen} onClick={() => setStoryOpen(!storyOpen)}>{storyOpen ? <X size={17} /> : <Pencil size={15} />}</button>}</div>
        <div className="calm-title-meta"><p>{placeLine(bench)}</p></div>
        {user && storyOpen && <form action={storyAction} className="inline-story-editor">
          <label><span>Name</span><input name="name" maxLength={80} defaultValue={bench.name ?? ""} placeholder="Wie heisst dieses Bänkli?" /></label>
          <label><span>Widmung</span><textarea name="dedication" maxLength={180} defaultValue={bench.dedication ?? ""} placeholder="Was steht auf der Bank?" /></label>
          <button disabled={storyPending}>{storyPending ? <span className="loading loading-spinner loading-xs" /> : <Check size={16} />} Speichern</button>
          {storyState && !storyState.ok && <p role="status">{storyState.message}</p>}
        </form>}
      </header>
    </section>

    <div className="calm-story-body">
      <p className="scene-caption"><span>{poem.first}</span>{" "}<span>{poem.second}</span></p>
      <BenchDetails bench={bench} signedIn={Boolean(user)} onBenchChange={onBenchChange} />
      <PhotoStory bench={bench} />
    </div>
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

function Community({ bench, report, user }: { bench: BenchDetail; report: (type: "rating" | "correction", id: number) => void; user: CurrentUser | null }) {
  return <div className="community-page">
    <header><small>Von Menschen vor Ort</small><h3>Wie war die Pause?</h3></header>
    {bench.ratingBreakdown && <div className="rating-line">{Object.entries({ Gesamt: bench.ratingBreakdown.overall, Aussicht: bench.ratingBreakdown.view, Komfort: bench.ratingBreakdown.comfort, Ruhe: bench.ratingBreakdown.quiet }).map(([label, value]) => <span key={label}><strong>{value}</strong><small>{label}</small></span>)}</div>}
    {user && <RatingForm benchId={bench.id} rating={bench.myRating} />}
    {bench.recentRatings.map((rating) => <article key={rating.id} className="quiet-contribution"><div><strong>{rating.overall}/5</strong><time>{new Date(rating.createdAt).toLocaleDateString("de-CH")}</time><button aria-label="Bewertung melden" onClick={() => report("rating", rating.id)}><Flag size={14} /></button></div>{rating.note && <p>{rating.note}</p>}</article>)}
    {bench.corrections.length > 0 && <section className="community-notes"><h3>Hinweise</h3>{bench.corrections.map((item) => <article key={item.id} className="quiet-contribution"><div><small>{correctionLabels[item.field] ?? item.field}</small><button aria-label="Korrektur melden" onClick={() => report("correction", item.id)}><Flag size={14} /></button></div><strong>{item.proposedValue}</strong>{item.note && <p>{item.note}</p>}</article>)}</section>}
    <BenchCommunityActions bench={bench} signedIn={Boolean(user)} />
  </div>;
}

function placeLine(bench: BenchDetail) {
  return [bench.elevationMeters !== null ? `${Math.round(bench.elevationMeters)} m ü. M.` : null, bench.locationName].filter(Boolean).join(" · ") || "Ein stiller Platz";
}

// External Commons hosts are intentionally rendered directly so thumbnails are not rehosted or proxied.
// eslint-disable-next-line @next/next/no-img-element
function MediaImage({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} loading="lazy" />; }
