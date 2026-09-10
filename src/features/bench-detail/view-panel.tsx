import { useFormatter, useTranslations } from "next-intl";
import type { Translator } from "@/i18n/types";
import { viewLabel } from "@/i18n/bench-labels";
import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Building2, ChevronDown, Footprints, Leaf, TreePine, UsersRound, Waves } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, ObstructionSketch, PanelHeading } from "./panel-ui";

export function ViewPanel({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const format = useFormatter();
  const hasDistances = [bench.distanceBuildingMeters, bench.distanceWaterMeters, bench.distancePathMeters].some((value) => value !== null);
  const surroundings = surroundingsLine(bench, t);
  return <section className="detail-panel detail-panel-view">
    <PanelHeading eyebrow={t("bench.view.title")} title={viewTitle(bench, t)} />
    <div className="view-summary">
      <ViewScoreIllustration bench={bench} />
      <div><small>{t("bench.view.impression")}</small><p>{bench.viewLabels.map((value) => viewLabel(value, t)).join(" · ") || t("bench.view.empty")}</p><span>{t(`bench.view.confidence.${bench.viewConfidence}`)}</span></div>
    </div>
    {bench.observations.view.publicEstimate && <p className="community-evidence">
      <UsersRound size={15} aria-hidden="true" />
      {t("bench.view.community", {count: bench.observations.view.publicEstimate.contributors, confidence: communityConfidence(bench.observations.view.publicEstimate.confidence, t)})}
    </p>}
    <details className="technical-fold view-evidence-fold">
      <summary><span><strong>{t("bench.view.details")}</strong><small>{t("bench.view.detailsSummary")}</small></span><ChevronDown size={16} /></summary>
      <p className="view-notes">{t("knowledge.view.distinctions")}</p>
      <MetricSketch values={[
        [t("bench.view.metrics.directions"), bench.nearOpenness],
        [t("bench.view.metrics.sky"), bench.viewComponents.openness],
        [t("bench.view.metrics.relief"), bench.viewComponents.relief],
        [t("bench.view.metrics.water"), bench.viewComponents.water],
        [t("bench.view.metrics.naturalness"), bench.viewComponents.naturalness],
        [t("bench.view.metrics.remoteness"), bench.viewComponents.remoteness],
      ]} />
      <ObstructionSketch building={bench.buildingObstructionPercent} vegetation={bench.vegetationObstructionPercent} />
      {hasDistances && <div className="distance-ribbon">
        <DistanceFact icon={<Building2 size={19} />} label={t("bench.horizon.buildings")} value={bench.distanceBuildingMeters} />
        <DistanceFact icon={<Waves size={19} />} label={t("bench.view.water")} value={bench.waterfront ? 0 : bench.distanceWaterMeters} />
        <DistanceFact icon={<Footprints size={19} />} label={t("bench.view.path")} value={bench.distancePathMeters} />
      </div>}
      <CanopySketch values={[bench.canopyShare3m, bench.canopyShare10m, bench.canopyShare25m]} />
      {(surroundings || bench.inForest !== null || bench.canopyContext && bench.canopyContext !== "unknown") && <div className="landscape-facts">
        {surroundings && <span><Leaf size={17} />{surroundings}</span>}
        {bench.inForest !== null && <span><TreePine size={17} />{bench.inForest ? t("bench.view.inForest") : t("bench.view.outsideForest")}</span>}
        {bench.canopyContext && bench.canopyContext !== "unknown" && <span><TreePine size={17} />{t(`bench.view.canopy.${bench.canopyContext}`)}</span>}
      </div>}
      {bench.viewExplanation.length > 0 && <ul className="view-notes">{bench.viewExplanation.slice(0, 4).map((item) => <li key={item}>{t(`bench.view.explanation.${item}`, {count: bench.observations.view.publicEstimate?.contributors ?? 0})}</li>)}</ul>}
      {bench.photoEvidence && <p className="view-notes">{t("bench.view.photos")}</p>}
      <DetailRows title={t("bench.details.view")} rows={[
        [t("bench.view.coverage.title"), bench.analysisCoverage === "terrain" ? t("bench.view.coverage.terrain") : t("bench.view.coverage.near")],
        [t("bench.view.buildingHorizon"), percent(bench.buildingObstructionPercent)],
        [t("bench.view.vegetationHorizon"), percent(bench.vegetationObstructionPercent)],
        [t("bench.view.buildingCount"), bench.buildingCount100m === null ? null : String(bench.buildingCount100m)],
        [t("bench.view.canopyCover"), percent(bench.canopyPercent)],
        [t("bench.view.medianVegetation"), meters(bench.vegetationMedianHeight, format.number)],
        [t("bench.view.maxVegetation"), meters(bench.vegetationMaxHeight, format.number)],
      ]} />
      {bench.likelyEnvironment?.traits.length ? <div className="image-hints"><small>{t("bench.view.imageHints")}</small>{bench.likelyEnvironment.traits.map((trait) => <span key={trait.kind}>{traitLabel(trait, t)} · {t(`bench.view.imageConfidence.${trait.confidence}`)}</span>)}<p>{t("bench.view.imageExplanation")}</p></div> : null}
    </details>
  </section>;
}

function ViewScoreIllustration({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const clipId = useId();
  const mountain = bench.viewLabels.includes("Bergblick");
  const hill = bench.viewLabels.includes("Hügelblick");
  const water = bench.viewComponents.water !== null && bench.viewComponents.water >= .5;
  const wooded = bench.inForest === true || (bench.viewComponents.naturalness ?? 0) >= .7;
  return <svg className="view-score-art" viewBox="0 0 124 104" role="img" aria-label={bench.viewScore === null ? t("bench.views.unknown") : t("bench.view.score", {score: bench.viewScore})}>
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
    <g className="view-art-score"><path d="M69 67q3-7 12-7h30q8 1 9 9v20q-2 9-10 10H80q-10-1-11-10Z" /><text className="view-art-number" x="94" y="84">{bench.viewScore ?? "?"}</text><text className="view-art-of" x="94" y="94">{bench.viewScore === null ? "offen" : t("bench.view.outOfFive")}</text></g>
  </svg>;
}

function DistanceFact({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  const t = useTranslations();
  const format = useFormatter();
  if (value === null) return null;
  return <div><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{value < 2 ? t("bench.view.directly") : value >= 1000 ? `${format.number(value / 1000, {maximumFractionDigits: 1})} km` : `${Math.round(value)} m`}</strong></div>;
}

function MetricSketch({ values }: { values: Array<[string, number | null]> }) {
  const t = useTranslations();
  const available = values.filter((value): value is [string, number] => value[1] !== null);
  if (!available.length) return <p className="calm-empty">{t("bench.view.metrics.empty")}</p>;
  return <div className="metric-sketch" aria-label={t("bench.view.metrics.label")}>
    {available.map(([label, raw]) => {
      const value = Math.max(0, Math.min(1, raw));
      return <div key={label}><span>{label}</span><i><b style={{ width: `${Math.round(value * 100)}%` }} /></i><small>{Math.round(value * 100)}</small></div>;
    })}
  </div>;
}

function CanopySketch({ values }: { values: Array<number | null> }) {
  const t = useTranslations();
  if (values.every((value) => value === null)) return null;
  return <div className="canopy-sketch" aria-label={t("bench.view.canopy.label")}>
    <small>{t("bench.view.canopy.title")}</small>
    <div>{values.map((value, index) => value === null ? null : <span key={index} style={{ "--canopy": `${Math.max(3, value) / 100}` } as CSSProperties}><i /><b>{Math.round(value)}%</b><em>{["3 m", "10 m", "25 m"][index]}</em></span>)}</div>
  </div>;
}

function percent(value: number | null) { return value === null ? null : `${Math.round(value)}%`; }
function meters(value: number | null, number: ReturnType<typeof useFormatter>["number"]) { return value === null ? null : `${number(value, { maximumFractionDigits: 1 })} m`; }
export function communityConfidence(value: number, t: Translator) {
  return t(`bench.view.communityConfidence.${value >= .7 ? "high" : value >= .5 ? "medium" : "low"}`);
}

function viewTitle(bench: BenchDetail, t: Translator) {
  if (bench.viewLabels.includes("Bergblick")) return t("bench.view.headline.mountains");
  if (bench.viewLabels.includes("Hügelblick")) return t("bench.view.headline.hills");
  if (bench.viewLabels.includes("Seeblick") || bench.viewLabels.includes("Wasserblick")) return t("bench.view.headline.water");
  if (bench.viewLabels.includes("Eingeschränkte Aussicht")) return t("bench.view.headline.limited");
  return t(bench.viewScore === null ? "bench.details.unknownView" : "bench.view.headline.open");
}

function surroundingsLine(bench: BenchDetail, t: Translator) {
  if (bench.waterfront) return t("bench.view.land.waterfront");
  return bench.landContext && bench.landContext !== "unknown" ? t(`bench.view.land.${bench.landContext}`) : null;
}

function traitLabel(trait: import("@/lib/types").LikelyTrait, t: Translator) {
  if (trait.kind === "land") {
    const value = ["forest", "forest_edge", "park", "open", "urban", "mixed"].includes(trait.value) ? trait.value as NonNullable<BenchDetail["landContext"]> : "unknown";
    return t(`bench.view.land.${value}`);
  }
  if (trait.kind === "canopy") {
    const value = ["none", "partial", "dense"].includes(trait.value) ? trait.value as NonNullable<BenchDetail["canopyContext"]> : "unknown";
    return t(`bench.view.canopy.${value}`);
  }
  const keys = {lake: "bench.views.lake", mountain: "bench.views.mountains", open: "bench.views.panorama", limited: "bench.views.limited", buildings: "bench.view.traits.buildings", roadRail: "bench.view.traits.roadRail"} as const;
  return t(keys[trait.kind]);
}
