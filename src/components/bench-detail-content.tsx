"use client";

import { useState, useTransition } from "react";
import {
  Accessibility, Armchair, Building2, Camera, CircleCheck, Clock3, Compass, ExternalLink,
  EyeOff, Flag, Hammer, Image as ImageIcon, Info, Leaf, MapPin, Moon, Mountain,
  MountainSnow, MoveHorizontal, Route, Sparkles, Star, Sun, Sunrise, Sunset,
  Telescope, TreePine, Trees, Umbrella, UsersRound, Waves,
} from "lucide-react";
import { reportContribution } from "@/app/actions/contributions";
import type { BenchDetail } from "@/lib/types";
import { CorrectionForm, RatingForm } from "./contribution-forms";

const correctionLabels: Record<string, string> = {
  properties: "Ausstattung", condition: "Zustand", location: "Position", removed: "Nicht mehr vorhanden",
};

export function BenchDetailContent({ bench }: { bench: BenchDetail }) {
  const [tab, setTab] = useState<"details" | "community">("details");
  const [, startTransition] = useTransition();
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => {
    const result = await reportContribution(type, id);
    window.alert(result.message);
  });

  return (
    <div className="pb-8">
      <header className="bench-hero mb-4 p-5 pb-16 text-[#243c34]">
        <div className="story-eyebrow flex items-center gap-1.5"><Sparkles size={13} /> Ein Platz zum Verweilen</div>
        <h2 className="mt-2 max-w-[85%] text-[1.75rem] font-black leading-[1.05] tracking-[-0.045em]">{bench.title}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
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
      </header>

      <div role="tablist" className="tabs story-tabs mb-5 grid grid-cols-2 rounded-full p-1">
        <button role="tab" className={`tab min-h-11 ${tab === "details" ? "tab-active" : ""}`} onClick={() => setTab("details")}>Entdecken</button>
        <button role="tab" className={`tab min-h-11 ${tab === "community" ? "tab-active" : ""}`} onClick={() => setTab("community")}>
          Stimmen {bench.ratingCount + bench.corrections.length > 0 && `· ${bench.ratingCount + bench.corrections.length}`}
        </button>
      </div>
      {tab === "details" ? <Details bench={bench} /> : <Community bench={bench} report={report} />}
    </div>
  );
}

function Community({ bench, report }: { bench: BenchDetail; report: (type: "rating" | "correction", id: number) => void }) {
  return (
    <div className="space-y-4">
      <div className="px-1"><div className="story-eyebrow">Von Menschen vor Ort</div><h3 className="mt-1 text-xl font-extrabold">Wie fühlt sich dieser Platz an?</h3></div>
      {bench.ratingBreakdown && <section className="story-card p-4"><div className="grid grid-cols-4 gap-2 text-center text-sm">{Object.entries({ Gesamt: bench.ratingBreakdown.overall, Aussicht: bench.ratingBreakdown.view, Komfort: bench.ratingBreakdown.comfort, Ruhe: bench.ratingBreakdown.quiet }).map(([label, value]) => <div key={label}><div className="text-xl font-black text-primary">{value}</div><div className="text-[11px] opacity-55">{label}</div></div>)}</div></section>}
      {bench.recentRatings.map((rating) => <article key={rating.id} className="story-card p-3.5"><div className="flex items-start justify-between"><div><span className="font-extrabold">{rating.overall}/5</span><span className="ml-2 text-xs opacity-50">{new Date(rating.createdAt).toLocaleDateString("de-CH")}</span></div><button aria-label="Bewertung melden" className="btn btn-circle btn-ghost btn-sm" onClick={() => report("rating", rating.id)}><Flag size={15} /></button></div>{rating.note && <p className="mt-2 text-sm leading-relaxed">{rating.note}</p>}</article>)}
      <RatingForm benchId={bench.id} />
      <section><h3 className="mb-2 px-1 font-bold">Hinweise aus der Community</h3>{bench.corrections.length === 0 && <p className="px-1 text-sm opacity-55">Noch keine Hinweise.</p>}{bench.corrections.map((item) => <article key={item.id} className="story-card mb-2 border-secondary/35 bg-secondary/10 p-3.5"><div className="flex items-start justify-between"><div><div className="story-eyebrow">{correctionLabels[item.field] ?? item.field}</div><div className="font-bold">{item.proposedValue}</div></div><button aria-label="Korrektur melden" className="btn btn-circle btn-ghost btn-sm" onClick={() => report("correction", item.id)}><Flag size={15} /></button></div>{item.note && <p className="mt-2 text-sm">{item.note}</p>}</article>)}</section>
      <CorrectionForm benchId={bench.id} />
    </div>
  );
}

function Details({ bench }: { bench: BenchDetail }) {
  const exact = bench.media.filter((media) => media.relation === "exact");
  const nearby = bench.media.filter((media) => media.relation === "nearby");
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 px-1"><div className="story-eyebrow">Auf einen Blick</div><h3 className="mt-1 text-xl font-extrabold tracking-[-0.03em]">Was dich hier erwartet</h3></div>
        <div className="grid grid-cols-3 gap-2">
          <InsightCard icon={bench.shadeCause === "nacht" ? <Moon /> : <Sun />} title={sunStatusShort(bench)} detail={sunDuration(bench.sunMinutesToday)} tone="sun" />
          <InsightCard icon={<MountainSnow />} title={bench.viewLabels[0] ?? "Aussicht"} detail={bench.viewScore ? `${bench.viewScore} von 5` : "wird erkundet"} />
          <InsightCard icon={bench.waterfront ? <Waves /> : bench.inForest ? <Trees /> : <Leaf />} title={environmentTitle(bench)} detail={canopyTitle(bench)} />
        </div>
      </section>

      <section><SectionHeading icon={<Armchair />} eyebrow="Die Bank" title="So sitzt es sich hier" /><div className="grid grid-cols-2 gap-2">{bench.properties.map((property) => <PropertyCard key={property.label} property={property} />)}</div></section>

      <section className="story-card overflow-hidden p-4">
        <SectionHeading icon={bench.shadeCause === "nacht" ? <Moon /> : <Sun />} eyebrow="Licht & Schatten" title={sunStoryTitle(bench)} />
        <p className="mb-4 text-sm leading-relaxed text-base-content/65">{sunStory(bench)}</p>
        <div className="sun-journey mb-3" aria-hidden />
        <div className="flex flex-wrap gap-2">{bench.sunWindows.length ? bench.sunWindows.map((window) => <span className="story-pill story-pill-sun" key={`${window.start}-${window.end}`}><Clock3 size={13} /> {window.start}–{window.end}</span>) : <span className="text-sm opacity-55">Heute kein direktes Sonnenfenster</span>}</div>
        <div className="mt-4 grid grid-cols-2 gap-2"><InfoCell icon={<Sunrise />} label="Erstes Licht" value={bench.directSunrise} /><InfoCell icon={<Sunset />} label="Letztes Licht" value={bench.directSunset} /></div>
        <details className="mt-3 rounded-2xl bg-base-200/45 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">Sonne im Lauf der Jahreszeiten</summary><div className="grid grid-cols-2 gap-2 pb-3"><Season label="Frühling" value={bench.sunMinutesSpring} /><Season label="Sommer" value={bench.sunMinutesSummer} /><Season label="Herbst" value={bench.sunMinutesAutumn} /><Season label="Winter" value={bench.sunMinutesWinter} /></div></details>
        <details className="technical-note mt-4 pt-1"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-base-content/65">Wie wir das Licht einschätzen</summary><div className="space-y-3 pb-2 text-xs leading-relaxed text-base-content/60"><div className="grid grid-cols-2 gap-2"><InfoCell icon={<Building2 />} label="Gebäude" value={percent(bench.buildingObstructionPercent)} /><InfoCell icon={<TreePine />} label="Vegetation" value={percent(bench.vegetationObstructionPercent)} /></div><p>Astronomischer Sonnenaufgang {bench.sunrise}, Sonnenuntergang {bench.sunset}. {bench.analysisCoverage === "near-field" ? "Gebäude und Bäume im Nahbereich sind bereits berücksichtigt; der entfernte Geländehorizont wird noch ergänzt." : "Gelände, erfasste Gebäude, Baumkronen und Überdachung werden im 5-Minuten-Raster berücksichtigt."} Wolken, Laubwechsel und vorübergehende Objekte können abweichen.</p><ModelStatus coverage={bench.analysisCoverage} value={bench.sunConfidence} /></div></details>
      </section>

      <section className="story-card p-4">
        <SectionHeading icon={<Telescope />} eyebrow="Der Blick" title={viewStoryTitle(bench)} />
        {bench.viewScore !== null && <ScoreDots score={bench.viewScore} />}
        <div className="mt-3 flex flex-wrap gap-2">{bench.viewLabels.map((label) => <span className="story-pill" key={label}>{viewIcon(label)}{label}</span>)}</div>
        {bench.directionDegrees !== null && <p className="mt-3 flex items-center gap-2 text-sm text-base-content/65"><Compass size={16} /> Die Bank blickt ungefähr nach {compassDirection(bench.directionDegrees)}.</p>}
        <details className="technical-note mt-4 pt-1"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-base-content/65">Warum wir die Aussicht so beschreiben</summary><ul className="space-y-2 pb-2 text-sm text-base-content/65">{bench.viewExplanation.filter((item) => !bench.viewLabels.includes(item)).map((item) => <li className="flex gap-2" key={item}><CircleCheck className="mt-0.5 shrink-0 text-primary" size={16} aria-hidden />{item}</li>)}</ul><ModelStatus coverage={bench.analysisCoverage} value={bench.viewConfidence} /></details>
      </section>

      <section>
        <SectionHeading icon={<Leaf />} eyebrow="Rundherum" title="Die Umgebung" />
        <div className="grid grid-cols-2 gap-2"><InfoCell icon={<Trees />} label="Landschaft" value={environmentTitle(bench)} /><InfoCell icon={<Waves />} label="Wasser" value={bench.waterfront ? "direkt am Wasser" : distance(bench.distanceWaterMeters)} /><InfoCell icon={<Route />} label="Nächster Weg" value={distance(bench.distancePathMeters)} /><InfoCell icon={<Building2 />} label="Nächstes Haus" value={distance(bench.distanceBuildingMeters)} /></div>
        <details className="story-card mt-2 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-base-content/65">Mehr zur Umgebung</summary><div className="grid grid-cols-2 gap-2 pb-3"><InfoCell icon={<TreePine />} label="Über der Bank" value={canopyTitle(bench)} /><InfoCell icon={<Building2 />} label="Häuser in 100 m" value={bench.buildingCount100m === null ? "Noch unbekannt" : String(bench.buildingCount100m)} />{bench.canopyShare25m !== null && <InfoCell icon={<Trees />} label="Bäume in 25 m" value={`auf etwa ${Math.round(bench.canopyShare25m * 100)}% der Fläche`} />}{bench.vegetationMedianHeight !== null && <InfoCell icon={<TreePine />} label="Typische Baumhöhe" value={`rund ${Math.round(bench.vegetationMedianHeight)} m`} />}</div></details>
      </section>

      {bench.likelyEnvironment && bench.likelyEnvironment.confidence !== "low" && <VisualEvidence environment={bench.likelyEnvironment} />}

      {(exact.length > 0 || nearby.length > 0) && <section><SectionHeading icon={<ImageIcon />} eyebrow="Eindrücke" title="Bilder aus der Umgebung" />{exact.length > 0 && <MediaGrid media={exact} />}{nearby.length > 0 && <><p className="mb-2 mt-4 text-xs leading-relaxed opacity-55">Diese Fotos entstanden in der Nähe und zeigen nicht zwingend die Bank.</p><MediaGrid media={nearby} /></>}</section>}

      <details className="story-card px-3 text-xs leading-relaxed text-base-content/60"><summary className="min-h-12 cursor-pointer py-3 font-bold"><span className="inline-flex items-center gap-2"><Info size={15} /> Daten & Herkunft</span></summary><div className="space-y-1 pb-4"><p>Position: {bench.latitude.toFixed(5)}, {bench.longitude.toFixed(5)}</p><p>Bank: OpenStreetMap · Analyse: Benchly {bench.pipelineVersion ? `(${bench.pipelineVersion})` : ""}</p>{bench.elevationSource && <p>Höhe: {bench.elevationSource}</p>}<p>Quelldaten vom {new Date(bench.sourceUpdatedAt).toLocaleDateString("de-CH")}</p>{bench.likelyEnvironment?.confidence === "low" && <p>Es gibt erste Bildhinweise, sie sind aber noch zu unsicher für die Beschreibung oder Suche.</p>}<a className="link mt-2 inline-flex min-h-11 items-center gap-1 font-bold" href={`https://www.openstreetmap.org/${bench.osmType}/${bench.osmId}`} target="_blank" rel="noreferrer">In OpenStreetMap ansehen <ExternalLink size={13} /></a></div></details>
    </div>
  );
}

function VisualEvidence({ environment }: { environment: NonNullable<BenchDetail["likelyEnvironment"]> }) {
  const traits = environment.traits.filter((trait) => trait.probability >= .65);
  if (!traits.length) return null;
  return <section className="visual-evidence-card p-4">
    <SectionHeading icon={<Camera />} eyebrow="Aus offenen Aufnahmen" title="Was Bilder aus der Nähe erzählen" />
    <p className="mb-3 text-sm leading-relaxed text-base-content/65">{environment.evidenceGroupCount === 1 ? "Eine Aufnahme" : "Mehrere Aufnahmen"} aus der Umgebung {environment.evidenceGroupCount === 1 ? "deutet" : "deuten"} auf Folgendes hin. Sie {environment.evidenceGroupCount === 1 ? "zeigt" : "zeigen"} nicht zwingend die Bank selbst.</p>
    <div className="flex flex-wrap gap-2">{traits.map((trait) => <span className="story-pill" key={trait.kind}>{viewIcon(trait.label)}Wahrscheinlich: {trait.label}</span>)}</div>
    <details className="technical-note mt-4 pt-1"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-base-content/65">Wie sicher ist diese Einschätzung?</summary><div className="space-y-2 pb-2 text-xs leading-relaxed text-base-content/60"><p>Verlässlichkeit: <strong>{environment.confidence === "high" ? "hoch" : "mittel"}</strong> · {environment.evidenceGroupCount} unabhängige {environment.evidenceGroupCount === 1 ? "Aufnahmegruppe" : "Aufnahmegruppen"}.</p>{environment.evidence.map((item) => <p key={`${item.provider}-${item.captureGroup}`}><a href={item.sourceUrl} target="_blank" rel="noreferrer" className="link inline-flex min-h-11 items-center gap-1 font-bold">{item.provider} · {item.distanceMeters} m <ExternalLink size={12} /></a>{item.license && <> · {item.license}</>}</p>)}<p>Aktualisiert am {new Date(environment.updatedAt).toLocaleDateString("de-CH")}. Modell: {environment.modelVersion ?? "Benchly Vision"}.</p></div></details>
  </section>;
}

function SectionHeading({ icon, eyebrow, title }: { icon: React.ReactNode; eyebrow: string; title: string }) { return <div className="mb-3 flex items-center gap-3"><span className="story-icon [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><div className="story-eyebrow">{eyebrow}</div><h3 className="text-lg font-extrabold leading-tight tracking-[-0.025em]">{title}</h3></div></div>; }
function InsightCard({ icon, title, detail, tone }: { icon: React.ReactNode; title: string; detail: string; tone?: "sun" }) { return <div className={`story-card min-w-0 p-2.5 ${tone === "sun" ? "bg-secondary/12" : ""}`}><span className="mb-2 block text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div className="truncate text-xs font-extrabold">{title}</div><div className="mt-0.5 truncate text-[10px] opacity-50">{detail}</div></div>; }

const propertyIcons: Record<string, React.ReactNode> = { Rückenlehne: <Armchair />, Armlehnen: <MoveHorizontal />, Überdacht: <Umbrella />, Rollstuhlgerecht: <Accessibility />, Material: <Hammer />, Sitzplätze: <UsersRound /> };
function PropertyCard({ property }: { property: BenchDetail["properties"][number] }) { return <div className="story-card flex min-h-[4.25rem] gap-2.5 p-3"><span className="text-primary [&>svg]:h-5 [&>svg]:w-5">{propertyIcons[property.label] ?? <Info />}</span><div className="min-w-0"><div className="truncate text-[11px] opacity-50">{property.label}</div><div className="truncate font-bold">{property.value}</div></div></div>; }
function InfoCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="story-card flex min-h-[4rem] gap-2.5 p-2.5"><span className="text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div className="min-w-0"><div className="text-[11px] opacity-50">{label}</div><div className="text-sm font-bold leading-tight">{value}</div></div></div>; }
function Season({ label, value }: { label: string; value: number | null }) { return <div className="rounded-xl bg-base-100/60 p-2.5"><div className="text-[11px] opacity-50">{label}</div><div className="text-sm font-bold">{sunDuration(value)}</div></div>; }
function ScoreDots({ score }: { score: number }) { return <div className="mt-1 flex items-center gap-1.5" aria-label={`${score} von 5 Punkten`}>{Array.from({ length: 5 }, (_, index) => <span key={index} className={`h-2.5 rounded-full ${index < score ? "w-7 bg-primary" : "w-2.5 bg-primary/15"}`} />)}</div>; }
function ModelStatus({ value, coverage }: { value: BenchDetail["viewConfidence"]; coverage: BenchDetail["analysisCoverage"] }) { return <span className="story-pill">{coverage === "near-field" ? "Nahbereich bereits geprüft" : `Verlässlichkeit: ${value}`}</span>; }
function viewIcon(label: string) { if (label.includes("Berg")) return <MountainSnow size={14} />; if (label.includes("See") || label.includes("Wasser")) return <Waves size={14} />; if (label.includes("Eingeschränkt") || label.includes("Keine")) return <EyeOff size={14} />; return <Telescope size={14} />; }

function sunStoryTitle(bench: BenchDetail) { if (bench.shadeCause === "nacht") return "Der Tag ist zur Ruhe gekommen"; return bench.sunnyNow ? "Gerade liegt die Bank in der Sonne" : "Gerade liegt die Bank im Schatten"; }
function sunStory(bench: BenchDetail) { if (bench.shadeCause === "nacht") return "Morgen zeigt sich hier wieder, wann das erste direkte Licht die Bank erreicht."; if (bench.sunnyNow) return `Heute erwarten wir insgesamt etwa ${sunDuration(bench.sunMinutesToday)} direktes Licht.`; return `Der Schatten kommt im Moment wahrscheinlich von ${shadeLabel(bench.shadeCause)}. Heute sind dennoch rund ${sunDuration(bench.sunMinutesToday)} direktes Licht möglich.`; }
function viewStoryTitle(bench: BenchDetail) { if (bench.analysisCoverage === "near-field") return "Wir erkunden den Fernblick noch"; if (bench.viewLabels.includes("Bergblick") && bench.viewLabels.includes("Seeblick")) return "Berge und Wasser im Blick"; if (bench.viewLabels.includes("Bergblick")) return "Ein Platz mit Bergblick"; if (bench.viewLabels.includes("Seeblick") || bench.viewLabels.includes("Wasserblick")) return "Ein Platz am Wasser"; if ((bench.viewScore ?? 0) >= 4) return "Ein Blick zum Bleiben"; if (bench.viewLabels.includes("Eingeschränkte Aussicht")) return "Ein eher geschützter Platz"; return "Der Blick von dieser Bank"; }
function sunStatusLabel(bench: BenchDetail) { if (bench.shadeCause === "nacht") return "Nacht"; if (bench.sunnyNow === null) return "Licht wird erkundet"; return bench.sunnyNow ? "Jetzt sonnig" : "Jetzt Schatten"; }
function sunStatusShort(bench: BenchDetail) { if (bench.shadeCause === "nacht") return "Nacht"; if (bench.sunnyNow === null) return "Licht"; return bench.sunnyNow ? "Sonnig" : "Schatten"; }
function compassDirection(degrees: number) { const labels = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"]; return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % labels.length]; }
function distance(value: number | null) { if (value === null) return "Noch unbekannt"; if (value < 2) return "direkt daneben"; return value >= 1000 ? `${(value / 1000).toFixed(1)} km entfernt` : `${Math.round(value)} m entfernt`; }
function sunDuration(value: number | null) { if (value === null) return "noch offen"; const hours = Math.floor(value / 60); const minutes = value % 60; if (!hours) return `${minutes} min`; return `${hours} h${minutes ? ` ${minutes} min` : ""}`; }
function shadeLabel(value: BenchDetail["shadeCause"]) { return ({ frei: "der freien Lage", nacht: "der Nacht", überdacht: "der Überdachung", gebäude: "einem Gebäude", vegetation: "Bäumen oder Bewuchs", gelände: "dem Gelände", unbekannt: "der Umgebung" })[value]; }
function percent(value: number | null) { return value === null ? "noch unbekannt" : `${Math.round(value)}% des Horizonts`; }
function environmentTitle(bench: BenchDetail) {
  if (bench.waterfront) return "Am Wasser";
  return ({ forest: "Im Wald", forest_edge: "Am Waldrand", park: "Im Park", open: "Offenes Gelände", urban: "Im Ort", mixed: "Abwechslungsreich", unknown: "Umgebung offen" } as Record<string, string>)[bench.landContext ?? "unknown"];
}
function canopyTitle(bench: BenchDetail) {
  return ({ none: "Freier Himmel", partial: "Unter einzelnen Bäumen", dense: "Unter dichtem Blätterdach", unknown: "Baumbestand wird geprüft" } as Record<string, string>)[bench.canopyContext ?? "unknown"];
}

/* External Commons hosts are intentionally rendered directly so thumbnails are not rehosted or proxied. */
// eslint-disable-next-line @next/next/no-img-element
function MediaImage({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} loading="lazy" className="aspect-[4/3] w-full object-cover" />; }
function MediaGrid({ media }: { media: BenchDetail["media"] }) { return <div className="grid grid-cols-2 gap-2">{media.map((item) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" className="story-card overflow-hidden"><MediaImage src={item.thumbnailUrl} alt={item.title ?? "Bild aus der Umgebung der Sitzbank"} /><div className="p-2 text-[11px]"><div className="truncate font-bold">{item.title ?? item.provider}</div><div className="truncate opacity-50">{item.author ?? item.provider} · {item.license ?? "Lizenz bei Quelle"}{item.distanceMeters !== null ? ` · ${Math.round(item.distanceMeters)} m` : ""}</div></div></a>)}</div>; }
