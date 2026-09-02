"use client";

import { useState, useTransition } from "react";
import {
  Accessibility, Armchair, Building2, Camera, CheckCircle2, Clock3, Compass, ExternalLink,
  EyeOff, Flag, Hammer, Image as ImageIcon, Info, Leaf, MapPin, Moon, Mountain,
  MountainSnow, MoveHorizontal, Route, Sparkles, Star, Sun, Sunrise, Sunset,
  Telescope, TreePine, Trees, Umbrella, UsersRound, Waves,
} from "lucide-react";
import { reportContribution } from "@/app/actions/contributions";
import type { BenchDetail } from "@/lib/types";
import type { CurrentUser } from "@/lib/security";
import { RatingForm } from "./contribution-forms";
import { BenchCommunityActions } from "./bench-community-actions";

const correctionLabels: Record<string, string> = {
  properties: "Ausstattung", condition: "Zustand", location: "Position", removed: "Nicht mehr vorhanden",
};

export function BenchDetailContent({ bench, user }: { bench: BenchDetail; user: CurrentUser | null }) {
  const [tab, setTab] = useState<"details" | "community">("details");
  const [, startTransition] = useTransition();
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => {
    const result = await reportContribution(type, id);
    window.alert(result.message);
  });

  return (
    <div className="pb-8">
      <header className="bench-hero mb-4 p-5 pb-16 text-[#243c34]">
        <BenchScene bench={bench} />
        <div className="story-eyebrow flex items-center gap-1.5"><Sparkles size={13} /> Ein Platz zum Verweilen</div>
        <h2 className="mt-2 max-w-[72%] text-[1.75rem] font-black leading-[1.05] tracking-[-0.045em]">{bench.title}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={`story-pill ${bench.verificationStatus === "verified" ? "text-success" : "text-warning"}`}>{bench.verificationStatus === "verified" ? <CheckCircle2 size={14} /> : <UsersRound size={14} />}{bench.verificationStatus === "verified" ? "Bestätigt" : `${bench.confirmationCount}/${bench.verificationThreshold} bestätigt`}</span>
          <span className={`story-pill ${bench.shadeCause === "nacht" ? "story-pill-night" : bench.sunnyNow ? "story-pill-sun" : ""}`}>
            {bench.shadeCause === "nacht" ? <Moon size={14} /> : <Sun size={14} />}{sunStatusLabel(bench)}
          </span>
          <span className="story-pill">
            {bench.analysisCoverage === "near-field" ? <Telescope size={14} /> : <Mountain size={14} />}
            {bench.analysisCoverage === "near-field" ? "Aussicht wird erkundet" : `${bench.viewScore ?? "–"}/5 Aussicht`}
          </span>
          {bench.ratingAverage && <span className="story-pill"><Star size={14} /> {bench.ratingAverage} von Gästen</span>}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-[#344e44]/75">
          <MapPin size={15} /> {bench.elevationMeters !== null ? `${Math.round(bench.elevationMeters)} m ü. M.` : "Höhe noch unbekannt"}
          {bench.directionDegrees !== null && <> · Blick nach {compassDirection(bench.directionDegrees)}</>}
        </p>
        {bench.locationName && <p className="mt-1 text-sm font-semibold text-[#344e44]/75">{[bench.locationPostcode, bench.locationName, bench.locationCanton].filter(Boolean).join(" · ")}</p>}
        {bench.dedication && <p className="mt-3 max-w-[80%] text-sm italic">„{bench.dedication}“</p>}
      </header>

      <div role="tablist" className="tabs story-tabs mb-5 grid grid-cols-2 rounded-full p-1">
        <button role="tab" className={`tab min-h-11 ${tab === "details" ? "tab-active" : ""}`} onClick={() => setTab("details")}>Entdecken</button>
        <button role="tab" className={`tab min-h-11 ${tab === "community" ? "tab-active" : ""}`} onClick={() => setTab("community")}>
          Stimmen {bench.ratingCount + bench.corrections.length > 0 && `· ${bench.ratingCount + bench.corrections.length}`}
        </button>
      </div>
      {tab === "details" ? <Details bench={bench} /> : <Community bench={bench} report={report} user={user} />}
    </div>
  );
}

function BenchScene({ bench }: { bench: BenchDetail }) {
  const ContextIcon = bench.waterfront ? Waves : bench.inForest ? Trees : bench.landContext === "urban" ? Building2 : MountainSnow;
  return <div className="bench-scene" aria-hidden="true">
    <Sun className="bench-scene-sun" />
    <ContextIcon className="bench-scene-landmark" />
    <Armchair className="bench-scene-seat" />
    <Sparkles className="bench-scene-sparkle" />
  </div>;
}

function Community({ bench, report, user }: { bench: BenchDetail; report: (type: "rating" | "correction", id: number) => void; user: CurrentUser | null }) {
  return (
    <div className="space-y-4">
      <div className="px-1"><div className="story-eyebrow">Von Menschen vor Ort</div><h3 className="mt-1 text-xl font-extrabold">Wie fühlt sich dieser Platz an?</h3></div>
      {bench.ratingBreakdown && <section className="story-card p-4"><div className="grid grid-cols-4 gap-2 text-center text-sm">{Object.entries({ Gesamt: bench.ratingBreakdown.overall, Aussicht: bench.ratingBreakdown.view, Komfort: bench.ratingBreakdown.comfort, Ruhe: bench.ratingBreakdown.quiet }).map(([label, value]) => <div key={label}><div className="text-xl font-black text-primary">{value}</div><div className="text-[11px] opacity-55">{label}</div></div>)}</div></section>}
      {bench.recentRatings.map((rating) => <article key={rating.id} className="story-card p-3.5"><div className="flex items-start justify-between"><div><span className="font-extrabold">{rating.overall}/5</span><span className="ml-2 text-xs opacity-50">{new Date(rating.createdAt).toLocaleDateString("de-CH")}</span></div><button aria-label="Bewertung melden" className="btn btn-circle btn-ghost btn-sm" onClick={() => report("rating", rating.id)}><Flag size={15} /></button></div>{rating.note && <p className="mt-2 text-sm leading-relaxed">{rating.note}</p>}</article>)}
      {user && <RatingForm benchId={bench.id} />}
      <section><h3 className="mb-2 px-1 font-bold">Hinweise aus der Community</h3>{bench.corrections.length === 0 && <p className="px-1 text-sm opacity-55">Noch keine Hinweise.</p>}{bench.corrections.map((item) => <article key={item.id} className="story-card mb-2 border-secondary/35 bg-secondary/10 p-3.5"><div className="flex items-start justify-between"><div><div className="story-eyebrow">{correctionLabels[item.field] ?? item.field}</div><div className="font-bold">{item.proposedValue}</div></div><button aria-label="Korrektur melden" className="btn btn-circle btn-ghost btn-sm" onClick={() => report("correction", item.id)}><Flag size={15} /></button></div>{item.note && <p className="mt-2 text-sm">{item.note}</p>}</article>)}</section>
      <BenchCommunityActions bench={bench} signedIn={Boolean(user)} />
    </div>
  );
}

function Details({ bench }: { bench: BenchDetail }) {
  const exact = bench.media.filter((media) => media.relation === "exact");
  const nearby = bench.media.filter((media) => media.relation === "nearby");
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 px-1"><div className="story-eyebrow">Auf einen Blick</div><h3 className="mt-1 text-xl font-extrabold tracking-[-0.03em]">Passt das zu deinem Moment?</h3></div>
        <div className="grid grid-cols-3 gap-2">
          <InsightCard icon={bench.shadeCause === "nacht" ? <Moon /> : <Sun />} title={sunStatusShort(bench)} detail={sunDuration(bench.sunMinutesToday)} tone="sun" />
          <InsightCard icon={<MountainSnow />} title={bench.viewLabels[0] ?? "Aussicht"} detail={bench.viewScore ? `${bench.viewScore} von 5` : "wird erkundet"} />
          <InsightCard icon={bench.waterfront ? <Waves /> : bench.inForest ? <Trees /> : <Leaf />} title={environmentShort(bench)} detail={canopyShort(bench)} tone="nature" />
        </div>
      </section>

      <section><SectionHeading icon={<Armchair />} eyebrow="Die Bank" title="Was sie mitbringt" /><div className="grid grid-cols-2 gap-2">{bench.properties.map((property) => <PropertyCard key={property.label} property={property} />)}</div></section>

      <section className="story-card overflow-hidden p-4">
        <SectionHeading icon={bench.shadeCause === "nacht" ? <Moon /> : <Sun />} eyebrow="Heute" title={sunStoryTitle(bench)} />
        <div className="sun-journey mb-3" aria-hidden />
        <div className="flex flex-wrap gap-2">{bench.sunWindows.length ? bench.sunWindows.map((window) => <span className="story-pill story-pill-sun" key={`${window.start}-${window.end}`}><Clock3 size={13} /> {window.start}–{window.end}</span>) : <span className="text-sm opacity-55">Heute kein direktes Sonnenfenster</span>}</div>
        <div className="mt-4 grid grid-cols-2 gap-2"><InfoCell icon={<Sunrise />} label="Erstes Licht" value={bench.directSunrise} /><InfoCell icon={<Sunset />} label="Letztes Licht" value={bench.directSunset} /></div>
        <details className="mt-3 rounded-2xl bg-base-200/45 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">Durchs Jahr</summary><div className="grid grid-cols-2 gap-2 pb-3"><Season label="Frühling" value={bench.sunMinutesSpring} /><Season label="Sommer" value={bench.sunMinutesSummer} /><Season label="Herbst" value={bench.sunMinutesAutumn} /><Season label="Winter" value={bench.sunMinutesWinter} /></div></details>
      </section>

      <section className="story-card p-4">
        <SectionHeading icon={<Telescope />} eyebrow="Augen auf" title={viewStoryTitle(bench)} />
        {bench.viewScore !== null && <ScoreDots score={bench.viewScore} />}
        <div className="mt-3 flex flex-wrap gap-2">{bench.viewLabels.slice(0, 3).map((label) => <span className="story-pill" key={label}>{viewIcon(label)}{friendlyViewLabel(label)}</span>)}</div>
        {bench.directionDegrees !== null && <p className="mt-3 flex items-center gap-2 text-sm text-base-content/60"><Compass size={16} /> Blick nach {compassDirection(bench.directionDegrees)}</p>}
      </section>

      <section>
        <SectionHeading icon={<Leaf />} eyebrow="Drumherum" title="Was liegt in der Nähe?" />
        <div className="grid grid-cols-2 gap-2"><InfoCell icon={<Trees />} label="Landschaft" value={environmentTitle(bench)} /><InfoCell icon={<TreePine />} label="Über dir" value={canopyTitle(bench)} /><InfoCell icon={<Waves />} label="Wasser" value={bench.waterfront ? "gleich hier" : distance(bench.distanceWaterMeters)} /><InfoCell icon={<Route />} label="Weg" value={distance(bench.distancePathMeters)} /></div>
      </section>

      {bench.likelyEnvironment && bench.likelyEnvironment.confidence !== "low" && <VisualEvidence environment={bench.likelyEnvironment} />}

      {(exact.length > 0 || nearby.length > 0) && <section><SectionHeading icon={<ImageIcon />} eyebrow="Ein Blick vorab" title="Bilder aus der Nähe" />{exact.length > 0 && <MediaGrid media={exact} />}{nearby.length > 0 && <><p className="mb-2 mt-4 text-xs opacity-50">Aus der Nähe – nicht zwingend diese Bank.</p><MediaGrid media={nearby} /></>}</section>}

      <details className="story-card px-3 text-xs text-base-content/55"><summary className="min-h-12 cursor-pointer py-3 font-bold"><span className="inline-flex items-center gap-2"><Info size={15} /> Woher wir das wissen</span></summary><div className="pb-4">{bench.likelyEnvironment?.confidence === "low" && <p className="mb-2">Die Bildhinweise sind noch nicht klar genug.</p>}<p>OpenStreetMap · swisstopo · Bänkli App</p>{bench.osmType !== "community" && <a className="link mt-2 inline-flex min-h-11 items-center gap-1 font-bold" href={`https://www.openstreetmap.org/${bench.osmType}/${bench.osmId}`} target="_blank" rel="noreferrer">Quelle öffnen <ExternalLink size={13} /></a>}</div></details>
    </div>
  );
}

function VisualEvidence({ environment }: { environment: NonNullable<BenchDetail["likelyEnvironment"]> }) {
  const traits = environment.traits.filter((trait) => trait.probability >= .65 && trait.confidence !== "low");
  if (!traits.length) return null;
  return <section className="visual-evidence-card p-4">
    <SectionHeading icon={<Camera />} eyebrow="Bilderflüstern" title="Wahrscheinlich entdeckt" />
    <span className="story-pill mb-3"><Sparkles size={13} /> Wahrscheinlich · {environment.confidence === "high" ? "hoch" : "mittel"}</span>
    <div className="flex flex-wrap gap-2">{traits.map((trait) => <span className="story-pill" key={trait.kind}>{viewIcon(trait.label)}{trait.label}</span>)}</div>
    <details className="technical-note mt-3 pt-1"><summary className="min-h-11 cursor-pointer py-3 text-xs font-bold text-base-content/55">Quellen</summary><div className="flex flex-wrap gap-2 pb-2">{environment.evidence.map((item) => <a key={`${item.provider}-${item.captureGroup}`} href={item.sourceUrl} target="_blank" rel="noreferrer" className="story-pill">{item.provider} · {item.distanceMeters} m</a>)}</div></details>
  </section>;
}

function SectionHeading({ icon, eyebrow, title }: { icon: React.ReactNode; eyebrow: string; title: string }) { return <div className="mb-3 flex items-center gap-3"><span className="story-icon [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><div className="story-eyebrow">{eyebrow}</div><h3 className="text-lg font-extrabold leading-tight tracking-[-0.025em]">{title}</h3></div></div>; }
function InsightCard({ icon, title, detail, tone }: { icon: React.ReactNode; title: string; detail: string; tone?: "sun" | "nature" }) { return <div className={`story-card insight-card min-w-0 p-2.5 ${tone === "sun" ? "insight-card-sun" : tone === "nature" ? "insight-card-nature" : ""}`}><span className="insight-icon mb-2 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div className="line-clamp-2 text-xs font-extrabold leading-tight">{title}</div><div className="mt-1 line-clamp-2 text-[10px] leading-tight opacity-50">{detail}</div></div>; }

const propertyIcons: Record<string, React.ReactNode> = { Rückenlehne: <Armchair />, Armlehnen: <MoveHorizontal />, Überdacht: <Umbrella />, Rollstuhlgerecht: <Accessibility />, Material: <Hammer />, Sitzplätze: <UsersRound /> };
function PropertyCard({ property }: { property: BenchDetail["properties"][number] }) { return <div className="story-card flex min-h-[4.25rem] gap-2.5 p-3"><span className="text-primary [&>svg]:h-5 [&>svg]:w-5">{propertyIcons[property.label] ?? <Info />}</span><div className="min-w-0"><div className="truncate text-[11px] opacity-50">{property.label}</div><div className="truncate font-bold">{property.value}</div></div></div>; }
function InfoCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="story-card flex min-h-[4rem] gap-2.5 p-2.5"><span className="text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div className="min-w-0"><div className="text-[11px] opacity-50">{label}</div><div className="text-sm font-bold leading-tight">{value}</div></div></div>; }
function Season({ label, value }: { label: string; value: number | null }) { return <div className="rounded-xl bg-base-100/60 p-2.5"><div className="text-[11px] opacity-50">{label}</div><div className="text-sm font-bold">{sunDuration(value)}</div></div>; }
function ScoreDots({ score }: { score: number }) { return <div className="mt-1 flex items-center gap-1.5" aria-label={`${score} von 5 Punkten`}>{Array.from({ length: 5 }, (_, index) => <span key={index} className={`h-2.5 rounded-full ${index < score ? "w-7 bg-primary" : "w-2.5 bg-primary/15"}`} />)}</div>; }
function viewIcon(label: string) { if (label.includes("Berg")) return <MountainSnow size={14} />; if (label.includes("See") || label.includes("Wasser")) return <Waves size={14} />; if (label.includes("Eingeschränkt") || label.includes("Keine")) return <EyeOff size={14} />; return <Telescope size={14} />; }

function sunStoryTitle(bench: BenchDetail) { if (bench.shadeCause === "nacht") return "Der Tag ist zur Ruhe gekommen"; return bench.sunnyNow ? "Gerade liegt die Bank in der Sonne" : "Gerade liegt die Bank im Schatten"; }
function viewStoryTitle(bench: BenchDetail) { if (bench.analysisCoverage === "near-field") return "Wir erkunden den Fernblick noch"; if (bench.viewLabels.includes("Bergblick") && bench.viewLabels.includes("Seeblick")) return "Berge und Wasser im Blick"; if (bench.viewLabels.includes("Bergblick")) return "Ein Platz mit Bergblick"; if (bench.viewLabels.includes("Seeblick") || bench.viewLabels.includes("Wasserblick")) return "Ein Platz am Wasser"; if ((bench.viewScore ?? 0) >= 4) return "Ein Blick zum Bleiben"; if (bench.viewLabels.includes("Eingeschränkte Aussicht")) return "Ein eher geschützter Platz"; return "Der Blick von dieser Bank"; }
function sunStatusLabel(bench: BenchDetail) { if (bench.shadeCause === "nacht") return "Nacht"; if (bench.sunnyNow === null) return "Licht wird erkundet"; return bench.sunnyNow ? "Jetzt sonnig" : "Jetzt Schatten"; }
function sunStatusShort(bench: BenchDetail) { if (bench.shadeCause === "nacht") return "Nacht"; if (bench.sunnyNow === null) return "Licht"; return bench.sunnyNow ? "Sonnig" : "Schatten"; }
function compassDirection(degrees: number) { const labels = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"]; return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % labels.length]; }
function distance(value: number | null) { if (value === null) return "Noch unbekannt"; if (value < 2) return "direkt daneben"; return value >= 1000 ? `${(value / 1000).toFixed(1)} km entfernt` : `${Math.round(value)} m entfernt`; }
function sunDuration(value: number | null) { if (value === null) return "noch offen"; const hours = Math.floor(value / 60); const minutes = value % 60; if (!hours) return `${minutes} min`; return `${hours} h${minutes ? ` ${minutes} min` : ""}`; }
function friendlyViewLabel(label: string) { return ({ "Nahbereich weitgehend offen": "Viel freier Blick", "Nahbereich teilweise offen": "Etwas geschützter", "Nahbereich stark begrenzt": "Rundum gemütlich", "Keine besondere Aussicht": "Ruhiger Alltagsblick", "Eingeschränkte Aussicht": "Eher geschützt" } as Record<string, string>)[label] ?? label; }
function environmentTitle(bench: BenchDetail) {
  if (bench.waterfront) return "Am Wasser";
  return ({ forest: "Im Wald", forest_edge: "Am Waldrand", park: "Im Park", open: "Offenes Gelände", urban: "Im Ort", mixed: "Abwechslungsreich", unknown: "Wird erkundet" } as Record<string, string>)[bench.landContext ?? "unknown"];
}
function canopyTitle(bench: BenchDetail) {
  return ({ none: "Freier Himmel", partial: "Unter einzelnen Bäumen", dense: "Unter dichtem Blätterdach", unknown: "Noch offen" } as Record<string, string>)[bench.canopyContext ?? "unknown"];
}
function environmentShort(bench: BenchDetail) {
  if (bench.waterfront) return "Am Wasser";
  return ({ forest: "Wald", forest_edge: "Waldrand", park: "Park", open: "Freier Platz", urban: "Im Ort", mixed: "Bunt gemischt", unknown: "Wird erkundet" } as Record<string, string>)[bench.landContext ?? "unknown"];
}
function canopyShort(bench: BenchDetail) {
  return ({ none: "Freier Himmel", partial: "Ein paar Bäume", dense: "Dichtes Blätterdach", unknown: "Noch offen" } as Record<string, string>)[bench.canopyContext ?? "unknown"];
}

/* External Commons hosts are intentionally rendered directly so thumbnails are not rehosted or proxied. */
// eslint-disable-next-line @next/next/no-img-element
function MediaImage({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} loading="lazy" className="aspect-[4/3] w-full object-cover" />; }
function MediaGrid({ media }: { media: BenchDetail["media"] }) { return <div className="grid grid-cols-2 gap-2">{media.map((item) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" className="story-card overflow-hidden"><MediaImage src={item.thumbnailUrl} alt={item.title ?? "Bild aus der Umgebung der Sitzbank"} /><div className="p-2 text-[11px]"><div className="truncate font-bold">{item.title ?? item.provider}</div><div className="truncate opacity-50">{item.author ?? item.provider} · {item.license ?? "Lizenz bei Quelle"}{item.distanceMeters !== null ? ` · ${Math.round(item.distanceMeters)} m` : ""}</div></div></a>)}</div>; }
