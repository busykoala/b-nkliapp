import type { CSSProperties, ReactNode } from "react";
import { Eye } from "lucide-react";

export function PanelHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="detail-panel-heading"><small>{eyebrow}</small><h3>{title}</h3>{children}</header>;
}

export function DetailRows({ title, rows }: { title: string; rows: Array<[string, string | null]> }) {
  const visible = rows.filter(([, value]) => value !== null && value !== "");
  if (!visible.length) return null;
  return <dl>{visible.map(([label, value]) => <div key={`${title}-${label}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function ObstructionSketch({ building, vegetation }: { building: number | null; vegetation: number | null }) {
  if (building === null && vegetation === null) return null;
  const buildings = Math.max(0, Math.min(100, building ?? 0));
  const plants = Math.max(0, Math.min(100 - buildings, vegetation ?? 0));
  const open = Math.max(0, 100 - buildings - plants);
  const chartStyle = {
    "--open-angle": `${open * 3.6}deg`,
    "--building-angle": `${(open + buildings) * 3.6}deg`,
  } as CSSProperties;
  return <div className="horizon-sketch" aria-label={`Horizont: ${Math.round(open)} Prozent frei, ${Math.round(buildings)} Prozent Gebäude, ${Math.round(plants)} Prozent Vegetation`}>
    <header><Eye size={17} /><span>Was den Horizont prägt</span></header>
    <div className="horizon-chart">
      <div className="horizon-ring" style={chartStyle} aria-hidden="true"><span><strong>{Math.round(open)}%</strong><small>frei</small></span></div>
      <div className="horizon-legend" aria-hidden="true">
        <div><i className="is-open" /><span>Freier Blick</span><strong>{Math.round(open)}%</strong></div>
        <div><i className="is-building" /><span>Gebäude</span><strong>{Math.round(buildings)}%</strong></div>
        <div><i className="is-vegetation" /><span>Bäume</span><strong>{Math.round(plants)}%</strong></div>
      </div>
    </div>
  </div>;
}
