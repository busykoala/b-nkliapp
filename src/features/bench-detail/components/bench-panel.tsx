import { useTranslations } from "next-intl";
import { formatDate } from "@/i18n/date";
import { compassDirection } from "@/i18n/bench-labels";
import { KnowledgeDetails } from "@/features/bench-knowledge/knowledge-details";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, SourceGroup, SourceSection } from "./panel-ui";

export function BenchPanel({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const geography = bench.knowledge?.geography;
  return <SourceSection title={t("knowledge.details.entry")}>
    {bench.verificationStatus === "unverified" && <p className="source-note">{t("bench.story.unverified")}</p>}
    <DetailRows title={t("knowledge.details.entry")} rows={[
      [t("bench.summary.lastSeen"), bench.lastConfirmedAt ? formatDate(bench.lastConfirmedAt, t) : t("bench.summary.unconfirmed")],
      [t("bench.location.sourceUpdated"), bench.sourceUpdatedAt ? formatDate(bench.sourceUpdatedAt, t) : null],
      [t("bench.location.imported"), bench.importedAt ? formatDate(bench.importedAt, t) : null],
    ]} />
    <SourceGroup title={t("bench.location.title")}>
      <DetailRows title={t("bench.location.title")} rows={[
        [t("bench.location.place"), [bench.locationPostcode, bench.locationName].filter(Boolean).join(" ") || null],
        [t("bench.location.elevation"), typeof bench.elevationMeters === "number" && Number.isFinite(bench.elevationMeters)
          ? t("bench.location.metresAboveSea", { value: Math.round(bench.elevationMeters) }) : null],
        [t("bench.location.municipality"), geography?.municipalityName && geography.municipalityName !== bench.locationName ? geography.municipalityName : null],
        [t("bench.location.canton"), geography?.cantonName ?? bench.locationCanton],
        [t("bench.location.district"), geography?.districtName && geography.districtName !== geography.municipalityName ? geography.districtName : null],
        [t("bench.location.nearbyName"), geography?.localityName && geography.localityName !== bench.locationName && geography.localityName !== bench.name ? geography.localityName : null],
        [t("bench.location.coordinates"), `${bench.latitude.toFixed(6)}, ${bench.longitude.toFixed(6)}`],
      ]} />
      <dl className="source-rows">
        <div className="bearing-card"><dt>{t("bench.attributes.direction")}</dt><dd><strong>{bench.directionDegrees === null || !Number.isFinite(bench.directionDegrees)
          ? t("common.values.notRecorded") : compassDirection(bench.directionDegrees, t)}</strong></dd></div>
      </dl>
      {[...new Set([bench.dedication, bench.description].filter(Boolean))].map((note) => <p className="source-note" key={note}>{note}</p>)}
    </SourceGroup>
    <KnowledgeDetails bench={bench} />
  </SourceSection>;
}
