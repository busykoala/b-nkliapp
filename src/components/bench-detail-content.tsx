"use client";

import { useState, useTransition } from "react";
import { Accessibility, Armchair, Building2, Clock3, Compass, ExternalLink, EyeOff, Flag, Hammer, Image as ImageIcon, Info, Leaf, MapPin, Moon, Mountain, MountainSnow, MoveHorizontal, Route, Star, Sun, Sunrise, Sunset, Telescope, TreePine, Trees, Umbrella, UsersRound, Waves } from "lucide-react";
import { reportContribution } from "@/app/actions/contributions";
import type { BenchDetail } from "@/lib/types";
import { CorrectionForm, RatingForm } from "./contribution-forms";

const correctionLabels: Record<string, string> = { properties: "Ausstattung", condition: "Zustand", location: "Position", removed: "Nicht mehr vorhanden" };

export function BenchDetailContent({ bench }: { bench: BenchDetail }) {
  const [tab, setTab] = useState<"details" | "community">("details");
  const [, startTransition] = useTransition();
  const report = (type: "rating" | "correction", id: number) => startTransition(async () => { const result = await reportContribution(type, id); window.alert(result.message); });
  return (
    <div className="pb-8">
      <div className="mb-4">
        <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
          <span className={`badge gap-1 ${bench.sunnyNow ? "badge-warning" : "badge-ghost"}`}>
            {bench.shadeCause === "nacht" ? <Moon size={14} /> : <Sun size={14} />}
            {sunStatusLabel(bench)}
          </span>
          <span className="badge badge-primary gap-1"><Mountain size={14} /> Aussicht {bench.viewConfidence === "niedrig" ? "ca. " : ""}{bench.viewScore ?? "–"}/5</span>
          {bench.ratingAverage && <span className="badge badge-secondary gap-1"><Star size={14} /> {bench.ratingAverage} ({bench.ratingCount})</span>}
        </div>
        <h2 className="mt-3 text-2xl font-bold leading-tight">{bench.title}</h2>
        <p className="mt-1 flex items-center gap-1 text-sm opacity-65"><MapPin size={15} /> {bench.latitude.toFixed(5)}, {bench.longitude.toFixed(5)} · {bench.elevationMeters ? `${Math.round(bench.elevationMeters)} m ü. M.` : "Höhe unbekannt"}</p>
      </div>
      <div role="tablist" className="tabs tabs-box mb-4 grid grid-cols-2">
        <button role="tab" className={`tab min-h-11 ${tab === "details" ? "tab-active" : ""}`} onClick={() => setTab("details")}>Details</button>
        <button role="tab" className={`tab min-h-11 ${tab === "community" ? "tab-active" : ""}`} onClick={() => setTab("community")}>Community {bench.ratingCount + bench.corrections.length > 0 && `(${bench.ratingCount + bench.corrections.length})`}</button>
      </div>
      {tab === "details" ? <Details bench={bench} /> : (
        <div className="space-y-4">
          {bench.ratingBreakdown && <section className="rounded-box bg-primary/8 p-4"><h3 className="font-bold">Community-Bewertungen</h3><div className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">{Object.entries({ Gesamt: bench.ratingBreakdown.overall, Aussicht: bench.ratingBreakdown.view, Komfort: bench.ratingBreakdown.comfort, Ruhe: bench.ratingBreakdown.quiet }).map(([label, value]) => <div key={label}><div className="text-xl font-bold">{value}</div><div className="text-xs opacity-60">{label}</div></div>)}</div></section>}
          {bench.recentRatings.map((rating) => <article key={rating.id} className="rounded-box border border-base-300 p-3"><div className="flex items-start justify-between"><div><span className="font-bold">{rating.overall}/5</span><span className="ml-2 text-xs opacity-55">{new Date(rating.createdAt).toLocaleDateString("de-CH")}</span></div><button aria-label="Bewertung melden" className="btn btn-circle btn-ghost btn-sm" onClick={() => report("rating", rating.id)}><Flag size={15} /></button></div>{rating.note && <p className="mt-2 text-sm">{rating.note}</p>}</article>)}
          <RatingForm benchId={bench.id} />
          <section><h3 className="mb-2 font-bold">Veröffentlichte Korrekturhinweise</h3>{bench.corrections.length === 0 && <p className="text-sm opacity-60">Noch keine Hinweise.</p>}{bench.corrections.map((item) => <article key={item.id} className="mb-2 rounded-box border border-warning/40 bg-warning/8 p-3"><div className="flex items-start justify-between"><div><div className="text-xs font-semibold uppercase opacity-60">{correctionLabels[item.field] ?? item.field}</div><div className="font-semibold">{item.proposedValue}</div></div><button aria-label="Korrektur melden" className="btn btn-circle btn-ghost btn-sm" onClick={() => report("correction", item.id)}><Flag size={15} /></button></div>{item.note && <p className="mt-2 text-sm">{item.note}</p>}</article>)}</section>
          <CorrectionForm benchId={bench.id} />
        </div>
      )}
    </div>
  );
}

function Details({ bench }: { bench: BenchDetail }) {
  const exact = bench.media.filter((media) => media.relation === "exact");
  const nearby = bench.media.filter((media) => media.relation === "nearby");
  return <div className="space-y-5">
    <section>
      <h3 className="mb-2 flex items-center gap-2 font-bold"><Armchair size={19} /> Eigenschaften vor Ort</h3>
      <div className="grid grid-cols-2 gap-2">{bench.properties.map((property) => <PropertyCard key={property.label} property={property} />)}</div>
    </section>
    <section className="rounded-box border border-warning/40 bg-warning/8 p-4">
      <h3 className="flex items-center gap-2 font-bold"><Sun size={19} /> Sonnenlage</h3>
      <div className="my-3 rounded-xl bg-base-100/80 p-3">
        <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={17} className="text-primary" /> Direkte Sonne heute</span><strong>{bench.directSunrise === "Noch nicht berechnet" ? "–" : sunDuration(bench.sunMinutesToday)}</strong></div>
        <div className="mt-2 flex flex-wrap gap-2">{bench.sunWindows.length ? bench.sunWindows.map((window) => <span className="badge badge-warning badge-outline" key={`${window.start}-${window.end}`}>{window.start}–{window.end}</span>) : <span className="text-sm opacity-65">{bench.sunConfidence === "niedrig" ? "Lokales 3D-Modell noch nicht berechnet" : "Heute kein berechnetes Sonnenfenster"}</span>}</div>
      </div>
      <div className="my-3 grid grid-cols-2 gap-3"><InfoCell icon={<Sunrise />} label="Erste direkte Sonne" value={bench.directSunrise} /><InfoCell icon={<Sunset />} label="Letzte direkte Sonne" value={bench.directSunset} /><InfoCell icon={<Sunrise />} label="Astronomisch auf" value={bench.sunrise} /><InfoCell icon={<Sunset />} label="Astronomisch unter" value={bench.sunset} /></div>
      <div className="mb-3 grid grid-cols-2 gap-3"><InfoCell icon={<Building2 />} label="Gebäude verdecken" value={percent(bench.buildingObstructionPercent)} /><InfoCell icon={<TreePine />} label="Vegetation verdeckt" value={percent(bench.vegetationObstructionPercent)} /></div>
      <details className="collapse rounded-xl bg-base-100/60"><summary className="collapse-title min-h-11 py-3 text-sm font-semibold">Saisonale direkte Sonne</summary><div className="collapse-content grid grid-cols-2 gap-2"><InfoCell icon={<Sun />} label="Frühling" value={sunDuration(bench.sunMinutesSpring)} /><InfoCell icon={<Sun />} label="Sommer" value={sunDuration(bench.sunMinutesSummer)} /><InfoCell icon={<Sun />} label="Herbst" value={sunDuration(bench.sunMinutesAutumn)} /><InfoCell icon={<Sun />} label="Winter" value={sunDuration(bench.sunMinutesWinter)} /></div></details>
      <Confidence value={bench.sunConfidence} />
      <p className="mt-2 text-xs leading-relaxed opacity-65">{bench.sunConfidence === "niedrig" ? "Vorläufige 5-Minuten-Berechnung aus Sonnenstand, erfassten Gebäuden, Bäumen, Wald und Überdachung. Das Berg- und Geländemodell wird noch ergänzt." : "Direkte Sonne wird im 5-Minuten-Raster gegen Gelände, Gebäudeoberflächen, Baumkronen und Überdachung geprüft."} Wolken, Laubwechsel und temporäre Objekte sind nicht berücksichtigt.</p>
    </section>
    <section className="rounded-box bg-primary/8 p-4"><h3 className="flex items-center gap-2 font-bold"><Telescope size={19} /> Aussicht {bench.viewScore ?? "–"}/5</h3><div className="mt-3 flex flex-wrap gap-2">{bench.viewLabels.map((label) => <span className="badge badge-primary badge-outline gap-1" key={label}>{viewIcon(label)}{label}</span>)}</div><ul className="mt-3 space-y-1 text-sm">{bench.viewExplanation.filter((item) => !bench.viewLabels.includes(item)).map((item) => <li className="flex gap-2" key={item}><span className="text-primary">●</span>{item}</li>)}</ul><div className="mt-3"><Confidence value={bench.viewConfidence} /></div>{bench.directionDegrees !== null && <p className="mt-2 flex items-center gap-2 text-sm"><Compass size={16} /> Blickrichtung etwa {Math.round(bench.directionDegrees)}°</p>}</section>
    <section><h3 className="mb-2 flex items-center gap-2 font-bold"><Leaf size={19} /> Umgebung</h3><div className="grid grid-cols-2 gap-2"><InfoCell icon={<Trees />} label="Vegetation" value={bench.inForest ? `Wald · ${Math.round(bench.canopyPercent ?? 0)}% Krone` : `Offen · ${Math.round(bench.canopyPercent ?? 0)}% Krone`} /><InfoCell icon={<Waves />} label="Wasser" value={distance(bench.distanceWaterMeters)} /><InfoCell icon={<Route />} label="Nächster Weg" value={distance(bench.distancePathMeters)} /><InfoCell icon={<Building2 />} label="Nächstes Gebäude" value={distance(bench.distanceBuildingMeters)} /><InfoCell icon={<Building2 />} label="Gebäude in 100 m" value={bench.buildingCount100m === null ? "Unbekannt" : String(bench.buildingCount100m)} /><InfoCell icon={<Mountain />} label="Höhe" value={bench.elevationMeters ? `${Math.round(bench.elevationMeters)} m` : "–"} /></div></section>
    {(exact.length > 0 || nearby.length > 0) && <section><h3 className="mb-2 flex items-center gap-2 font-bold"><ImageIcon size={19} /> Bilder</h3>{exact.length > 0 && <MediaGrid media={exact} />}{nearby.length > 0 && <><h4 className="mb-2 mt-4 text-sm font-semibold">Fotos in der Nähe – zeigen nicht zwingend die Bank</h4><MediaGrid media={nearby} /></>}</section>}
    <section className="rounded-box border border-base-300 p-3 text-xs leading-relaxed opacity-70"><div className="mb-1 flex items-center gap-2 font-bold"><Info size={15} /> Daten & Herkunft</div><p>Bank: OpenStreetMap · Analyse: Benchly {bench.pipelineVersion ? `(${bench.pipelineVersion})` : ""}</p><p>Quelle aktualisiert: {new Date(bench.sourceUpdatedAt).toLocaleDateString("de-CH")}</p><a className="link mt-2 inline-flex items-center gap-1" href={`https://www.openstreetmap.org/${bench.osmType}/${bench.osmId}`} target="_blank" rel="noreferrer">In OpenStreetMap öffnen <ExternalLink size={13} /></a></section>
  </div>;
}

const propertyIcons: Record<string, React.ReactNode> = {
  Rückenlehne: <Armchair />, Armlehnen: <MoveHorizontal />, Überdacht: <Umbrella />,
  Rollstuhlgerecht: <Accessibility />, Material: <Hammer />, Sitzplätze: <UsersRound />,
};
function PropertyCard({ property }: { property: BenchDetail["properties"][number] }) { return <div className="flex gap-2 rounded-xl bg-base-200 p-3"><span className="mt-0.5 text-primary [&>svg]:h-5 [&>svg]:w-5">{propertyIcons[property.label] ?? <Info />}</span><div><div className="text-xs opacity-60">{property.label}</div><div className="font-semibold">{property.value}</div><div className="mt-1 text-[10px] uppercase opacity-45">{property.source}</div></div></div>; }
function viewIcon(label: string) { if (label.includes("Berg")) return <MountainSnow size={14} />; if (label.includes("See") || label.includes("Wasser")) return <Waves size={14} />; if (label.includes("Eingeschränkt") || label.includes("Keine")) return <EyeOff size={14} />; return <Telescope size={14} />; }

function InfoCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-2 rounded-xl bg-base-100/70 p-2.5"><span className="text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><div className="text-xs opacity-60">{label}</div><div className="font-semibold">{value}</div></div></div>; }
function Confidence({ value }: { value: BenchDetail["viewConfidence"] }) { return <span className="badge badge-outline text-xs">{value === "niedrig" ? "Vorläufiges Modell" : `Sicherheit: ${value}`}</span>; }
function distance(value: number | null) { if (value === null) return "Unbekannt"; return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`; }
function sunDuration(value: number | null) { if (value === null) return "–"; const hours = Math.floor(value / 60); const minutes = value % 60; return `${hours} h ${minutes ? `${minutes} min` : ""} direkt`.trim(); }
function sunStatusLabel(bench: BenchDetail) {
  if (bench.shadeCause === "nacht") return "Nacht";
  if (bench.sunnyNow === null) return "Sonne noch nicht analysiert";
  if (bench.sunnyNow) return bench.sunConfidence === "niedrig" ? "Wahrscheinlich Sonne" : "Sonne jetzt";
  return `${bench.sunConfidence === "niedrig" ? "Wahrsch. " : ""}Schatten: ${shadeLabel(bench.shadeCause)}`;
}
function shadeLabel(value: BenchDetail["shadeCause"]) { return ({ frei: "frei", nacht: "Nacht", überdacht: "Überdachung", gebäude: "Gebäude", vegetation: "Vegetation", gelände: "Gelände", unbekannt: "unbekannt" })[value]; }
function percent(value: number | null) { return value === null ? "Unbekannt" : `${Math.round(value)}% der Richtungen`; }
/* External Commons hosts are intentionally rendered directly so thumbnails are not rehosted or proxied. */
// eslint-disable-next-line @next/next/no-img-element
function MediaImage({ src, alt }: { src: string; alt: string }) { return <img src={src} alt={alt} loading="lazy" className="aspect-[4/3] w-full object-cover" />; }
function MediaGrid({ media }: { media: BenchDetail["media"] }) { return <div className="grid grid-cols-2 gap-2">{media.map((item) => <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-base-300 bg-base-100"><MediaImage src={item.thumbnailUrl} alt={item.title ?? "Bild zur Umgebung der Sitzbank"} /><div className="p-2 text-[11px]"><div className="truncate font-semibold">{item.title ?? item.provider}</div><div className="truncate opacity-60">{item.author ?? item.provider} · {item.license ?? "Lizenz siehe Quelle"}{item.distanceMeters !== null ? ` · ${Math.round(item.distanceMeters)} m` : ""}</div></div></a>)}</div>; }
