import { ChartNoAxesColumnIncreasing as StepsIcon, Check, CircleHelp, Footprints, Mountain, MoveHorizontal, PersonStanding, Route, Ruler, TrendingUp, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { BenchDetail } from "@/lib/types";
import { benchFact } from "@/lib/presentation";
import { smoothnessLabel, surfaceLabel } from "@/i18n/approach-labels";

export function AccessPanel({ bench }: { bench: Pick<BenchDetail, "properties" | "knowledge"> }) {
  const t = useTranslations();
  const format = useFormatter();
  const space = benchFact<boolean>(bench, "wheelchair");
  const approach = bench.knowledge?.approach ?? null;
  const spaceLabel = space.state === "conflicting"
    ? t("bench.summary.conflictingLevelSpace") : space.value === true ? t("bench.attributes.wheelchair")
      : space.value === false ? t("bench.summary.noWheelchair") : t("bench.summary.unknownWheelchair");
  const approachLabel = approach?.steps === true
    ? t("knowledge.approach.recorded") : approach?.steps === false ? t("knowledge.approach.noneRecorded")
      : t("knowledge.approach.open");
  return <section className="detail-panel access-panel">
    <div className="access-summary-grid">
      <AccessStatus icon={<PersonStanding />} label={t("bench.access.atBench")} value={spaceLabel} state={space.state === "conflicting" ? "warning" : space.value === true ? "clear" : space.value === false ? "blocked" : "unknown"} />
      <AccessStatus icon={approach?.steps === true ? <StepsIcon /> : <Footprints />} label={t("bench.access.localApproach")} value={approachLabel} state={approach?.steps === true ? "blocked" : approach?.steps === false ? "clear" : "unknown"} />
    </div>
    {approach && <div className="access-visuals">
      {approach.maximumSlopePercent !== null && <SlopeValue value={approach.maximumSlopePercent} />}
      {approach.surface && <SurfaceSwatch surface={approach.surface} label={surfaceLabel(approach.surface, t)} />}
    </div>}
    {approach && <div className="access-metrics">
      {approach.lengthMeters !== null && <AccessMetric icon={<Route />} label={t("knowledge.approach.length")} value={`${Math.round(approach.lengthMeters)} m`} />}
      {approach.elevationGainMeters !== null && <AccessMetric icon={<Mountain />} label={t("knowledge.approach.ascent")} value={`${Math.round(approach.elevationGainMeters)} m`} />}
      {approach.widthMeters !== null && <AccessMetric icon={<MoveHorizontal />} label={t("knowledge.approach.width")} value={`${format.number(approach.widthMeters)} m`} />}
      {approach.smoothness && <AccessMetric icon={<Footprints />} label={t("knowledge.approach.smoothness")} value={smoothnessLabel(approach.smoothness, t)} />}
    </div>}
    {approach?.sampleCoverage && approach.sampleCoverage.expected > 0 && <div className="access-coverage">
      <Ruler size={15} aria-hidden="true" /><small>{t("knowledge.approach.sampleCoverage", approach.sampleCoverage)}</small>
    </div>}
    {approach && <div className="access-scope-strip" aria-label={t("bench.access.scopeNote")} title={t("bench.access.scopeNote")}>
      <span><PersonStanding aria-hidden="true" /><small>{t("bench.access.atBench")}</small></span><i aria-hidden="true" /><span><Footprints aria-hidden="true" /><small>{t("bench.access.localApproach")}</small></span><i aria-hidden="true" /><span><Route aria-hidden="true" /><small>{t("walks.planner.route")}</small></span>
    </div>}
    {approach && <p className="access-scope-note">{t("bench.access.scopeNote")}</p>}
  </section>;
}

function AccessStatus({icon, label, value, state}: {icon: ReactNode; label: string; value: string; state: "clear" | "blocked" | "warning" | "unknown"}) {
  const StateIcon = state === "clear" ? Check : state === "unknown" ? CircleHelp : state === "warning" ? TriangleAlert : StepsIcon;
  return <div className={`access-status is-${state}`}>
    <span className="access-status-main" aria-hidden="true">{icon}</span><small>{label}</small><strong>{value}</strong><StateIcon className="access-status-state" size={16} aria-hidden="true" />
  </div>;
}

function SlopeValue({value}: {value: number}) {
  const t = useTranslations();
  const formatted = useFormatter().number(value, {maximumFractionDigits: 1});
  return <div className="slope-gauge" aria-label={`${t("knowledge.approach.maxSlope")}: ${formatted}%`}>
    <span aria-hidden="true"><TrendingUp size={17} /></span><small>{t("knowledge.approach.maxSlope")}</small><strong>{formatted}%</strong>
  </div>;
}

function SurfaceSwatch({surface, label}: {surface: string; label: string}) {
  const t = useTranslations();
  const pattern = /asphalt|paved|concrete/.test(surface) ? "smooth" : /gravel|fine_gravel|compacted/.test(surface) ? "gravel" : /ground|earth|dirt|grass/.test(surface) ? "natural" : "mixed";
  return <div className="surface-swatch"><span className={`is-${pattern}`} aria-hidden="true" /><small>{t("knowledge.approach.surface")}</small><strong>{label}</strong></div>;
}

function AccessMetric({icon, label, value}: {icon: ReactNode; label: string; value: string}) {
  return <div><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{value}</strong></div>;
}
