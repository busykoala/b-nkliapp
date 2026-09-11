import { useTranslations } from "next-intl";
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

export type ObstructionChart = {
  buildings: number | null;
  plants: number | null;
  open: number | null;
  unknown: number | null;
  inconsistent: boolean;
};

export function obstructionChart(building: number | null, vegetation: number | null): ObstructionChart | null {
  const metric = (value: number | null) => value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const buildings = metric(building);
  const plants = metric(vegetation);
  if (buildings === null && plants === null) return null;
  const known = (buildings ?? 0) + (plants ?? 0);
  if (known > 100) return { buildings, plants, open: null, unknown: null, inconsistent: true };
  if (buildings !== null && plants !== null) return { buildings, plants, open: 100 - known, unknown: 0, inconsistent: false };
  return { buildings, plants, open: null, unknown: 100 - known, inconsistent: false };
}

export function minuteClock(minutes: number) {
  const value = Math.max(0, Math.min(1439, Math.floor(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function ObstructionSketch({ building, vegetation }: { building: number | null; vegetation: number | null }) {
  const t = useTranslations();
  const chart = obstructionChart(building, vegetation);
  if (!chart) return null;
  const { buildings, plants, open, unknown, inconsistent } = chart;
  const measured = (buildings ?? 0) + (plants ?? 0);
  const chartStyle = {
    "--open-angle": `${(open ?? 0) * 3.6}deg`,
    "--building-angle": `${((open ?? 0) + (buildings ?? 0)) * 3.6}deg`,
    "--vegetation-angle": `${((open ?? 0) + (buildings ?? 0) + (plants ?? 0)) * 3.6}deg`,
  } as CSSProperties;
  const ariaLabel = inconsistent
    ? t("bench.horizon.labelInconsistent")
    : open !== null
      ? t("bench.horizon.label", {open: Math.round(open), buildings: Math.round(buildings!), plants: Math.round(plants!)})
      : t("bench.horizon.labelPartial", {measured: Math.round(measured), unknown: Math.round(unknown!)});
  return <div className="horizon-sketch" aria-label={ariaLabel}>
    <header><Eye size={17} /><span>{t("bench.horizon.title")}</span></header>
    <div className={`horizon-chart${inconsistent ? " is-inconsistent" : ""}`}>
      {!inconsistent && <div className="horizon-ring" style={chartStyle} aria-hidden="true"><span><strong>{Math.round(open ?? unknown!)}%</strong><small>{t(open !== null ? "bench.horizon.open" : "bench.horizon.unknown")}</small></span></div>}
      <div className="horizon-legend" aria-hidden="true">
        {open !== null && <div><i className="is-open" /><span>{t("bench.horizon.openView")}</span><strong>{Math.round(open)}%</strong></div>}
        {buildings !== null && <div><i className="is-building" /><span>{t("bench.horizon.buildings")}</span><strong>{Math.round(buildings)}%</strong></div>}
        {plants !== null && <div><i className="is-vegetation" /><span>{t("bench.horizon.trees")}</span><strong>{Math.round(plants)}%</strong></div>}
        {unknown !== null && unknown > 0 && <div><i className="is-unknown" /><span>{t("bench.horizon.unknownRemainder")}</span><strong>{Math.round(unknown)}%</strong></div>}
      </div>
    </div>
    {inconsistent && <p className="horizon-warning">{t("bench.horizon.inconsistent")}</p>}
  </div>;
}
