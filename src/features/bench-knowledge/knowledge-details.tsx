import { useTranslations } from "next-intl";
import { propertyValue } from "@/i18n/bench-labels";
import { formatDate } from "@/i18n/date";
import type { MessageKey } from "@/i18n/types";
import type { BenchDetail } from "@/lib/types";
import { sourceEvidenceRows, sourceVersionRows } from "@/features/bench-detail/source-evidence";
import { DetailRows, SourceGroup, SourceSection } from "@/features/bench-detail/components/panel-ui";

const categories: Record<string, MessageKey> = {
  physical: "knowledge.categories.physical", location: "knowledge.categories.location",
  accessibility: "knowledge.categories.accessibility", imagery: "knowledge.categories.imagery",
  surroundings: "knowledge.categories.surroundings", amenities: "knowledge.categories.amenities",
  environment: "knowledge.categories.environment", recent_verification: "knowledge.categories.recent_verification",
};

export function KnowledgeDetails({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const rows = sourceEvidenceRows(bench, t);
  if (!rows.length) return null;
  return <SourceGroup title={t("knowledge.evidence.title")}>
    <p className="source-note">{t("knowledge.details.evidenceIntro")}</p>
    <dl className="source-rows source-evidence">
      {rows.map((row) => <div key={row.key} data-attribute={row.key}>
        <dt>{row.label}</dt><dd>
          <strong>{row.value}</strong>
          {row.status && <span className={`knowledge-confidence${row.conflicting ? " is-conflicting" : ""}`}>{row.status}</span>}
          {row.source && <small>{row.source}</small>}
        </dd>
      </div>)}
    </dl>
  </SourceGroup>;
}

export function KnowledgeCoverage({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const knowledge = bench.knowledge;
  const estimates = knowledge?.photoEstimates ?? [];
  const completeness = knowledge?.completeness ?? [];
  const versions = sourceVersionRows(bench, t).filter(([, version]) => version);
  const photoProvenance = [...new Set(estimates.map((item) => `${t("knowledge.estimates.provenance", { model: item.modelVersion, count: item.validationSamples })} · ${item.capturedAt ? formatDate(item.capturedAt, t) : t("knowledge.freshness.unknown")}`))];
  if (!estimates.length && !completeness.length && !versions.length) return null;
  return <SourceSection title={t("knowledge.details.coverage")}>
    {completeness.length > 0 && <SourceGroup title={t("knowledge.completeness.title")}>
      <DetailRows title={t("knowledge.completeness.title")} rows={completeness.map((item) => [
        categories[item.category] ? t(categories[item.category]) : item.category,
        t("knowledge.completeness.count", { known: item.known, total: item.total }) + (item.uncertain > 0 ? t("knowledge.completeness.uncertain", { count: item.uncertain }) : ""),
      ])} />
      <p className="source-note">{t("knowledge.completeness.explanation")}</p>
    </SourceGroup>}
    {estimates.length > 0 && <SourceGroup title={t("knowledge.estimates.title")}>
      <DetailRows title={t("knowledge.estimates.title")} rows={estimates.map((item) => [
        t(`bench.attributes.${item.attribute}`),
        propertyValue({ key: item.attribute, value: typeof item.value === "boolean" ? item.value ? "Ja" : "Nein" : item.value }, t),
      ])} />
      <p className="source-note">{t("knowledge.estimates.explanation")}</p>
      {photoProvenance.map((text) => <p className="source-note source-code" key={text}>{text}</p>)}
    </SourceGroup>}
    {versions.length > 0 && <SourceGroup title={t("knowledge.details.versions")}>
      <DetailRows title={t("knowledge.details.versions")} className="source-versions" rows={versions} />
    </SourceGroup>}
  </SourceSection>;
}
