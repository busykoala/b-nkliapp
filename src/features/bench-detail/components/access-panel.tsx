import { useFormatter, useTranslations } from "next-intl";
import { smoothnessLabel, surfaceLabel } from "@/i18n/approach-labels";
import type { MessageKey } from "@/i18n/types";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, SourceGroup, SourceSection } from "./panel-ui";

const amenities: Record<string, MessageKey> = {
  toilets: "knowledge.amenities.toilets", drinking_water: "knowledge.amenities.drinking_water",
  fountain: "knowledge.amenities.fountain", shelter: "knowledge.amenities.shelter",
  picnic_table: "knowledge.amenities.picnic_table", playground: "knowledge.amenities.playground",
  fireplace: "knowledge.amenities.fireplace",
};

export function AccessPanel({ bench }: { bench: Pick<BenchDetail, "properties" | "knowledge"> }) {
  const t = useTranslations();
  const format = useFormatter();
  const approach = bench.knowledge?.approach;
  const nearby = (bench.knowledge?.amenities ?? [])
    .filter((item) => amenities[item.category] && item.distanceMeters !== null && Number.isFinite(item.distanceMeters) && item.distanceMeters >= 0)
    .sort((a, b) => a.distanceMeters! - b.distanceMeters!);
  const confidence: Record<string, MessageKey> = { unknown: "knowledge.confidence.unknown", low: "knowledge.confidence.low", medium: "knowledge.confidence.medium", high: "knowledge.confidence.high" };
  const meters = (value: number | null) => value === null || !Number.isFinite(value) ? null : `${format.number(value, { maximumFractionDigits: 1 })} m`;
  const slope = (value: number | null) => value === null || !Number.isFinite(value) ? null : `${format.number(value, { maximumFractionDigits: 1 })}%`;
  return <SourceSection title={t("knowledge.details.access")} className="access-panel">
    <SourceGroup title={t("knowledge.approach.title")}>
      {approach ? <>
        <DetailRows title={t("knowledge.approach.title")} rows={[
          [t("knowledge.approach.length"), meters(approach.lengthMeters)],
          [t("knowledge.approach.unmapped"), meters(approach.unmappedLastMeters ?? null)],
          [t("knowledge.approach.steps"), t(approach.steps === null ? "knowledge.approach.open" : approach.steps ? "knowledge.approach.recorded" : "knowledge.approach.noneRecorded")],
          [t("knowledge.approach.stepFree"), t(approach.stepFreePossible === null ? "knowledge.approach.open" : approach.stepFreePossible ? "knowledge.approach.evidence" : "knowledge.approach.obstacle")],
          [t("knowledge.approach.surface"), approach.surface ? surfaceLabel(approach.surface, t) : null],
          [t("knowledge.approach.smoothness"), approach.smoothness ? smoothnessLabel(approach.smoothness, t) : null],
          [t("knowledge.approach.width"), meters(approach.widthMeters)],
          [t("knowledge.approach.maxSlope"), slope(approach.maximumSlopePercent)],
          [t("knowledge.approach.meanSlope"), slope(approach.averageSlopePercent)],
          [t("knowledge.approach.ascent"), meters(approach.elevationGainMeters)],
        ]} />
        {approach.terrainAmbiguity && <p className="source-note">{t("knowledge.approach.structure")}</p>}
        {approach.sampleCoverage && approach.sampleCoverage.expected > 0 && <p className="source-note">{t("knowledge.approach.sampleCoverage", approach.sampleCoverage)}</p>}
      </> : <p className="source-note">{t("knowledge.approach.empty")}</p>}
      <p className="source-note">{approach ? t("knowledge.approach.explanation", { confidence: t(confidence[approach.confidence] ?? "knowledge.confidence.unknown") }) : t("bench.access.scopeNote")}</p>
    </SourceGroup>
    {nearby.length > 0 && <SourceGroup title={t("knowledge.nearby.title")}>
      <DetailRows title={t("knowledge.nearby.title")} rows={nearby.map((item) => [t(amenities[item.category]), t("knowledge.nearby.distance", { distance: Math.round(item.distanceMeters!) })])} />
      <p className="source-note">{t("knowledge.nearby.explanation")}</p>
    </SourceGroup>}
  </SourceSection>;
}
