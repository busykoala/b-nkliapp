import { useFormatter, useTranslations } from "next-intl";
import type { Translator } from "@/i18n/types";
import { viewLabel } from "@/i18n/bench-labels";
import type { BenchDetail } from "@/lib/types";
import { obstructionChart, sourceFractionPercent } from "../source-data";
import { DetailRows, SourceGroup, SourceSection } from "./panel-ui";

export function ViewPanel({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const format = useFormatter();
  const community = bench.observations.view.publicEstimate;
  const obstruction = obstructionChart(bench.buildingObstructionPercent, bench.vegetationObstructionPercent);
  const percent = (value: number | null) => value === null || !Number.isFinite(value) ? null : `${Math.round(value)}%`;
  const meters = (value: number | null) => value === null || !Number.isFinite(value) ? null : `${format.number(value, { maximumFractionDigits: 1 })} m`;
  const distance = (value: number | null) => value !== null && value >= 0 && value < 2 ? t("bench.view.directly") : meters(value);
  const canopy = [bench.canopyShare3m, bench.canopyShare10m, bench.canopyShare25m];
  const noise = (bench.knowledge?.noise ?? []).filter((item) => item.value !== null && Number.isFinite(item.value));
  return <SourceSection title={t("knowledge.details.environment")} className="detail-panel-view">
    <SourceGroup title={t("bench.view.title")}>
      <DetailRows title={t("bench.view.title")} rows={[
        [t("bench.view.impression"), bench.viewLabels.length ? [...new Set(bench.viewLabels.map((value) => viewLabel(value, t)))].join(" · ") : null],
        [t("bench.view.coverage.title"), t(bench.analysisCoverage === "terrain" ? "bench.view.coverage.terrain" : "bench.view.coverage.near")],
      ]} />
      {community && <p role="note" className="community-evidence" aria-label={t("bench.view.community", { count: community.contributors, confidence: communityConfidence(community.confidence, t) })}>
        <strong>{community.contributors}</strong><span>{t("knowledge.details.communityContributors", { count: community.contributors })} · {communityConfidence(community.confidence, t)}</span>
      </p>}
      <p className="source-note">{t("knowledge.view.distinctions")}</p>
    </SourceGroup>
    <SourceGroup title={t("bench.horizon.title")}>
      <p className="source-note">{t("knowledge.details.openness")}</p>
      <dl className="source-rows metric-sketch">
        {([ [t("bench.view.metrics.directions"), bench.nearOpenness], [t("bench.view.metrics.sky"), bench.viewComponents.openness] ] as const).map(([label, value]) => value === null || !Number.isFinite(value) ? null :
          <div key={label} role="group" aria-label={`${label}: ${percent(value * 100)}`}><dt>{label}</dt><dd><small>{percent(value * 100)}</small></dd></div>)}
      </dl>
      {obstruction && <>
        <DetailRows title={t("bench.horizon.title")} rows={[
          [t("bench.view.buildingHorizon"), percent(obstruction.buildings)],
          [t("bench.view.vegetationHorizon"), percent(obstruction.plants)],
          [t("bench.horizon.unknownRemainder"), obstruction.unknown && obstruction.unknown > 0 ? percent(obstruction.unknown) : null],
        ]} />
        {obstruction.inconsistent && <p className="source-note">{t("bench.horizon.inconsistent")}</p>}
      </>}
    </SourceGroup>
    <SourceGroup title={t("knowledge.details.surroundings")}>
      <p className="source-note">{t("knowledge.details.straightLine")}</p>
      <DetailRows title={t("knowledge.details.straightLine")} className="distance-ribbon" rows={[
        [t("bench.horizon.buildings"), distance(bench.distanceBuildingMeters)],
        [t("bench.view.water"), distance(bench.waterfront ? 0 : bench.distanceWaterMeters)],
        [t("bench.view.path"), distance(bench.distancePathMeters)],
      ]} />
      <DetailRows title={t("bench.view.canopy.title")} rows={[
        [t("bench.view.buildingCount"), bench.buildingCount100m === null ? null : String(bench.buildingCount100m)],
        [t("bench.view.canopyCover"), canopy.every((value) => sourceFractionPercent(value) === null) ? percent(bench.canopyPercent) : null],
        ...([3, 10, 25] as const).map((radius, index): [string, string | null] => [t("knowledge.details.canopyRadius", { radius }), sourceFractionPercent(canopy[index])]),
        [t("bench.view.medianVegetation"), meters(bench.vegetationMedianHeight)],
        [t("bench.view.maxVegetation"), meters(bench.vegetationMaxHeight)],
      ]} />
    </SourceGroup>
    {noise.length > 0 && <SourceGroup title={t("knowledge.noise.title")}>
      <DetailRows title={t("knowledge.noise.title")} rows={noise.map((item) => [
        `${t(`knowledge.noise.${item.mode}`)} · ${t(`knowledge.noise.${item.period}`)}`,
        `${format.number(item.value!, { maximumFractionDigits: 1 })} ${item.unit}`,
      ])} />
      <p className="source-note">{t("knowledge.details.noise")}</p>
    </SourceGroup>}
    {bench.likelyEnvironment?.traits.length ? <SourceGroup title={t("bench.view.imageHints")}>
      <DetailRows title={t("bench.view.imageHints")} rows={bench.likelyEnvironment.traits.map((trait) => [traitLabel(trait, t), t(`bench.view.imageConfidence.${trait.confidence}`)])} />
      <p className="source-note">{t("bench.view.imageExplanation")}</p>
    </SourceGroup> : null}
  </SourceSection>;
}

export function communityConfidence(value: number, t: Translator) {
  return t(`bench.view.communityConfidence.${value >= .7 ? "high" : value >= .5 ? "medium" : "low"}`);
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
  const keys = { lake: "bench.views.lake", mountain: "bench.views.mountains", open: "bench.views.panorama", limited: "bench.views.limited", buildings: "bench.view.traits.buildings", roadRail: "bench.view.traits.roadRail" } as const;
  return t(keys[trait.kind]);
}
