import { BenchFeatureEditor } from "@/components/bench-feature-editor";
import { Accessibility, Armchair, ChevronDown, Compass, Flame, Hammer, MoveHorizontal, Trash2, Umbrella, UsersRound } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, PanelHeading } from "./panel-ui";

export function BenchPanel({ bench, signedIn = false, onChanged }: { bench: BenchDetail; signedIn?: boolean; onChanged?: () => void | Promise<void> }) {
  const known = bench.properties.filter((property) => !/^(unbekannt|noch offen)$/i.test(property.value.trim()));
  const missingCount = bench.properties.length - known.length;
  return <section className="detail-panel detail-panel-bench">
    <PanelHeading eyebrow="So sitzt es sich hier" title={known.length ? "Was die Bank mitbringt" : "Die Bank wird noch erkundet"} />
    {signedIn && <BenchFeatureEditor bench={bench} onChanged={onChanged} />}
    {!signedIn && known.length > 0 && <div className="bench-fact-grid">
      {known.map((property) => <div className={property.source === "Bänkli App" ? "is-community" : ""} key={property.label}>
        <span className="fact-mark"><PropertyIcon label={property.label} /></span>
        <small>{property.label}</small>
        <strong>{property.value}</strong>
      </div>)}
    </div>}
    {missingCount > 0 && <p className="missing-whisper">{missingCount === 1 ? "Ein Merkmal" : `${missingCount} Merkmale`} wurde{missingCount === 1 ? "" : "n"} noch nicht erfasst.</p>}
    {(bench.dedication || bench.description) && <blockquote className="bench-note">{bench.dedication || bench.description}</blockquote>}
    <div className="bearing-card">
      <div className="bearing-dial" aria-hidden="true"><Compass size={36} /><i style={{ transform: `rotate(${bench.directionDegrees ?? 0}deg)` }} /></div>
      <div><small>Blickrichtung</small><strong>{bench.directionDegrees === null ? "Noch nicht erfasst" : direction(bench.directionDegrees)}</strong><p>{bench.directionDegrees === null ? "Die Landschaft wird deshalb rundum betrachtet." : "Die Aussicht wird in dieser Richtung gewichtet."}</p></div>
    </div>
    <details className="technical-fold">
      <summary>Ort & Lage <ChevronDown size={16} /></summary>
      <DetailRows title="Ort & Lage" rows={[
        ["Höhe", bench.elevationMeters === null ? null : `${Math.round(bench.elevationMeters)} m ü. M.`],
        ["Ort", [bench.locationPostcode, bench.locationName, bench.locationCanton].filter(Boolean).join(" ") || null],
        ["Koordinaten", `${bench.latitude.toFixed(6)}, ${bench.longitude.toFixed(6)}`],
      ]} />
    </details>
  </section>;
}

function PropertyIcon({ label }: { label: string }) {
  if (label === "Rückenlehne") return <Armchair size={19} />;
  if (label === "Armlehnen") return <MoveHorizontal size={19} />;
  if (label === "Überdacht") return <Umbrella size={19} />;
  if (label === "Mit Rollstuhl nutzbar") return <Accessibility size={19} />;
  if (label === "Feuerstelle nahebei") return <Flame size={19} />;
  if (label === "Abfalleimer nahebei") return <Trash2 size={19} />;
  if (label === "Material") return <Hammer size={19} />;
  return <UsersRound size={19} />;
}

function direction(value: number) {
  const names = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return `${names[Math.round(value / 45) % 8]} · ${Math.round(value)}°`;
}
