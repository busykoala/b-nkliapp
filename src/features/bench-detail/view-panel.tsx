import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Building2, ChevronDown, Footprints, Leaf, TreePine, UsersRound, Waves } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, ObstructionSketch, PanelHeading } from "./panel-ui";

export function ViewPanel({ bench }: { bench: BenchDetail }) {
  const hasDistances = [bench.distanceBuildingMeters, bench.distanceWaterMeters, bench.distancePathMeters].some((value) => value !== null);
  const surroundings = surroundingsLine(bench);
  return <section className="detail-panel detail-panel-view">
    <PanelHeading eyebrow="Aussicht & Umgebung" title={viewTitle(bench)} />
    <div className="view-summary">
      <ViewScoreIllustration bench={bench} />
      <div><small>Eindruck</small><p>{bench.viewLabels.join(" · ") || "Die Aussicht wird noch erkundet."}</p><span>{confidence(bench.viewConfidence)}e Sicherheit</span></div>
    </div>
    {bench.observations.view.publicEstimate && <p className="community-evidence">
      <UsersRound size={15} aria-hidden="true" />
      {bench.observations.view.publicEstimate.contributors} Eindrücke von Menschen vor Ort · {communityConfidence(bench.observations.view.publicEstimate.confidence)}
    </p>}
    <details className="technical-fold view-evidence-fold">
      <summary><span><strong>Aussicht im Detail</strong><small>Messwerte, Horizont und Umgebung</small></span><ChevronDown size={16} /></summary>
      <MetricSketch values={[
        ["Freie Blickrichtungen", bench.nearOpenness],
        ["Himmelsoffenheit", bench.viewComponents.openness],
        ["Geländerelief", bench.viewComponents.relief],
        ["Wasser im Blick", bench.viewComponents.water],
        ["Natürliche Umgebung", bench.viewComponents.naturalness],
        ["Abstand zu Störungen", bench.viewComponents.remoteness],
      ]} />
      <ObstructionSketch building={bench.buildingObstructionPercent} vegetation={bench.vegetationObstructionPercent} />
      {hasDistances && <div className="distance-ribbon">
        <DistanceFact icon={<Building2 size={19} />} label="Gebäude" value={bench.distanceBuildingMeters} />
        <DistanceFact icon={<Waves size={19} />} label="Wasser" value={bench.waterfront ? 0 : bench.distanceWaterMeters} />
        <DistanceFact icon={<Footprints size={19} />} label="Weg" value={bench.distancePathMeters} />
      </div>}
      <CanopySketch values={[bench.canopyShare3m, bench.canopyShare10m, bench.canopyShare25m]} />
      {(surroundings || bench.inForest !== null || bench.canopyContext && bench.canopyContext !== "unknown") && <div className="landscape-facts">
        {surroundings && <span><Leaf size={17} />{surroundings}</span>}
        {bench.inForest !== null && <span><TreePine size={17} />{bench.inForest ? "Im Wald" : "Ausserhalb des Waldes"}</span>}
        {bench.canopyContext && bench.canopyContext !== "unknown" && <span><TreePine size={17} />{canopy(bench.canopyContext)}</span>}
      </div>}
      {bench.viewExplanation.length > 0 && <ul className="view-notes">{bench.viewExplanation.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>}
      {bench.photoEvidence && <p className="view-notes">Mit Fotos ergänzt</p>}
      <DetailRows title="Aussicht" rows={[
        ["Analysebereich", bench.analysisCoverage === "terrain" ? "Nahbereich und Gelände bis 20 km" : "Nahbereich"],
        ["Gebäude am Horizont", percent(bench.buildingObstructionPercent)],
        ["Vegetation am Horizont", percent(bench.vegetationObstructionPercent)],
        ["Gebäude in 100 m", bench.buildingCount100m === null ? null : String(bench.buildingCount100m)],
        ["Baumdeckung", percent(bench.canopyPercent)],
        ["Mittlere Vegetationshöhe", meters(bench.vegetationMedianHeight)],
        ["Höchste Vegetation", meters(bench.vegetationMaxHeight)],
      ]} />
      {bench.likelyEnvironment?.traits.length ? <div className="image-hints"><small>Hinweise aus Bildern der Umgebung</small>{bench.likelyEnvironment.traits.map((trait) => <span key={trait.kind}>{trait.label} · {Math.round(trait.probability * 100)}%</span>)}</div> : null}
    </details>
  </section>;
}

function ViewScoreIllustration({ bench }: { bench: BenchDetail }) {
  const clipId = useId();
  const mountain = bench.viewLabels.includes("Bergblick");
  const hill = bench.viewLabels.includes("Hügelblick");
  const water = bench.viewComponents.water !== null && bench.viewComponents.water >= .5;
  const wooded = bench.inForest === true || (bench.viewComponents.naturalness ?? 0) >= .7;
  return <svg className="view-score-art" viewBox="0 0 124 104" role="img" aria-label={bench.viewScore === null ? "Aussicht noch offen" : `Aussicht ${bench.viewScore} von 5`}>
    <defs><clipPath id={clipId}><path d="M7 17Q11 7 25 8h75q16 0 18 14v58q-3 15-18 16H23Q7 94 6 80Z" /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      <rect className="view-art-sky" x="4" y="5" width="116" height="93" />
      <circle className="view-art-sun" cx="91" cy="27" r="9" />
      {mountain
        ? <><path className="view-art-mountain-back" d="M-4 72 25 33l18 25 20-38 35 52Z" /><path className="view-art-snow" d="m51 43 12-23 13 25-12-8-7 8Z" /></>
        : hill && <path className="view-art-hill-back" d="M-8 74Q20 39 50 69q27-38 65 3Z" />}
      {wooded && <g className="view-art-trees"><path d="m17 62 8-18 8 18h-5l7 13H14l7-13Zm68 2 7-16 7 16h-4l6 12H83l6-12Z" /></g>}
      {water && <path className="view-art-water" d="M-3 76q18-6 36 0t36 0 39 0 25 0v20H-3Z" />}
      <path className="view-art-ground" d="M-7 83q28-19 57-4 32-16 82 1v23H-7Z" />
      <path className="view-art-path" d="M46 103q10-22 25-28 9-4 18-1-13 7-20 29Z" />
    </g>
    <path className="view-art-frame" d="M7 17Q11 7 25 8h75q16 0 18 14v58q-3 15-18 16H23Q7 94 6 80Z" />
    <g className="view-art-score"><path d="M69 67q3-7 12-7h30q8 1 9 9v20q-2 9-10 10H80q-10-1-11-10Z" /><text className="view-art-number" x="94" y="84">{bench.viewScore ?? "?"}</text><text className="view-art-of" x="94" y="94">{bench.viewScore === null ? "offen" : "von 5"}</text></g>
  </svg>;
}

function DistanceFact({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  if (value === null) return null;
  return <div><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{distance(value)}</strong></div>;
}

function MetricSketch({ values }: { values: Array<[string, number | null]> }) {
  const available = values.filter((value): value is [string, number] => value[1] !== null);
  if (!available.length) return <p className="calm-empty">Für die Aussicht fehlen noch genügend Messpunkte.</p>;
  return <div className="metric-sketch" aria-label="Bestandteile der Aussichtswertung">
    {available.map(([label, raw]) => {
      const value = Math.max(0, Math.min(1, raw));
      return <div key={label}><span>{label}</span><i><b style={{ width: `${Math.round(value * 100)}%` }} /></i><small>{Math.round(value * 100)}</small></div>;
    })}
  </div>;
}

function CanopySketch({ values }: { values: Array<number | null> }) {
  if (values.every((value) => value === null)) return null;
  return <div className="canopy-sketch" aria-label="Baumdeckung im Nahbereich">
    <small>Baumdach rund um die Bank</small>
    <div>{values.map((value, index) => value === null ? null : <span key={index} style={{ "--canopy": `${Math.max(3, value) / 100}` } as CSSProperties}><i /><b>{Math.round(value)}%</b><em>{["3 m", "10 m", "25 m"][index]}</em></span>)}</div>
  </div>;
}

function distance(value: number) { return value < 2 ? "direkt" : value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`; }
function percent(value: number | null) { return value === null ? null : `${Math.round(value)}%`; }
function meters(value: number | null) { return value === null ? null : `${Number(value.toFixed(1))} m`; }
function confidence(value: BenchDetail["viewConfidence"]) { return ({ hoch: "Hoh", mittel: "Mittler", niedrig: "Niedrig" } as const)[value]; }
function canopy(value: BenchDetail["canopyContext"]) { return value === null || value === "unknown" ? null : ({ none: "Freier Himmel", partial: "Unter einzelnen Bäumen", dense: "Dichtes Blätterdach" } as const)[value]; }
function communityConfidence(value: number) { return value >= .7 ? "gut gestützt" : value >= .5 ? "vorsichtig gestützt" : "erste Tendenz"; }

function viewTitle(bench: BenchDetail) {
  if (bench.viewLabels.includes("Bergblick")) return "Berge öffnen den Horizont";
  if (bench.viewLabels.includes("Hügelblick")) return "Hügel zeichnen die Ferne";
  if (bench.viewLabels.includes("Seeblick") || bench.viewLabels.includes("Wasserblick")) return "Wasser liegt im Blick";
  if (bench.viewLabels.includes("Eingeschränkte Aussicht")) return "Der Blick bleibt im Nahraum";
  return bench.viewScore === null ? "Der Blick wird noch erkundet" : "So weit öffnet sich der Blick";
}

function surroundingsLine(bench: BenchDetail) {
  if (bench.waterfront) return "Direkt am Wasser";
  return ({ forest: "Wald", forest_edge: "Waldrand", park: "Park", open: "Offenes Gelände", urban: "Im Ort", mixed: "Gemischte Landschaft", unknown: null } as const)[bench.landContext ?? "unknown"];
}
