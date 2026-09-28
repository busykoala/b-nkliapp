import { propertyValue } from "@/i18n/bench-labels";
import { formatDate } from "@/i18n/date";
import type { MessageKey, Translator } from "@/i18n/types";
import type { BenchDetail, BenchProperty } from "@/lib/types";
import type { AttributeKnowledge } from "@/features/bench-knowledge/model";

const attributes: Record<string, MessageKey> = {
  backrest: "bench.attributes.backrest", armrest: "bench.attributes.armrest",
  covered: "knowledge.attributes.covered", wheelchair: "knowledge.attributes.wheelchair",
  seats: "bench.attributes.seats", material: "bench.attributes.material",
  fireplaceNearby: "bench.attributes.fireplaceNearby", presence: "knowledge.attributes.presence",
  land_context: "knowledge.attributes.land_context", canopy_context: "knowledge.attributes.canopy_context",
  waterfront: "knowledge.attributes.waterfront", image_water_type: "knowledge.attributes.image_water_type",
  image_long_view: "knowledge.attributes.image_long_view",
};
const sources: Record<string, MessageKey> = {
  osm: "knowledge.sources.osm", gis: "knowledge.sources.gis", imagery: "knowledge.sources.imagery",
  official: "knowledge.sources.official", community: "knowledge.sources.community",
};
const propertySources: Record<BenchProperty["source"], MessageKey> = {
  OpenStreetMap: "knowledge.sources.osm", "Bänkli App": "knowledge.sources.community",
  "Amtliche Daten": "knowledge.sources.official", "Mehrere Quellen": "knowledge.details.multipleSources",
};

export type SourceEvidenceRow = { key: string; label: string; value: string; source: string; status: string; conflicting: boolean };

export function evidenceSource(evidence: AttributeKnowledge | undefined, t: Translator): string {
  if (!evidence) return "";
  return [...new Set(evidence.sourceTypes.map((source) => sources[source] ? t(sources[source]) : source))].join(", ");
}

function evidenceValue(key: string, value: unknown, t: Translator): string {
  if (typeof value === "boolean") return t(value ? "common.values.yes" : "common.values.no");
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : t("common.values.notRecorded");
  if (typeof value !== "string" || !value.trim()) return t("common.values.notRecorded");
  if (key === "material") return propertyValue({ key, value }, t);
  const land: Record<string, MessageKey> = { forest: "bench.view.land.forest", forest_edge: "bench.view.land.forest_edge", park: "bench.view.land.park", open: "bench.view.land.open", urban: "bench.view.land.urban", mixed: "bench.view.land.mixed", unknown: "bench.view.land.unknown" };
  const canopy: Record<string, MessageKey> = { none: "bench.view.canopy.none", partial: "bench.view.canopy.partial", dense: "bench.view.canopy.dense", unknown: "bench.view.canopy.unknown" };
  if (key === "land_context" && land[value]) return t(land[value]);
  if (key === "canopy_context" && canopy[value]) return t(canopy[value]);
  // Keep legacy display translation at the existing boundary, never mutate facts.
  return propertyValue({ key: "backrest", value }, t);
}

/** Join the displayed value and its provenance once, instead of two feature lists. */
export function sourceEvidenceRows(bench: Pick<BenchDetail, "properties" | "knowledge">, t: Translator): SourceEvidenceRow[] {
  const properties = new Map(bench.properties.map((item) => [item.key as string, item]));
  const evidence = new Map((bench.knowledge?.attributes ?? []).map((item) => [item.attribute, item]));
  return Object.entries(attributes).flatMap(([key, label]) => {
    const property = properties.get(key);
    const item = evidence.get(key);
    if (!property && !item) return [];
    const conflicting = property?.evidenceState === "conflicting" || item?.conflicting === true;
    const unknown = property?.evidenceState === "unknown";
    const value = property
      ? property.canonicalValue !== undefined ? property.canonicalValue : property.value
      : item?.value;
    const confidence = property?.confidence ?? item?.confidence;
    const status = conflicting ? t("knowledge.evidence.conflicting")
      : !unknown && confidence ? t(`knowledge.confidence.${confidence}`) : "";
    const source = evidenceSource(item, t) || (property ? t(propertySources[property.source]) : "");
    const date = property?.validAt ?? item?.latestAt;
    const freshness = item?.freshness === "old" ? t("knowledge.freshness.old") : null;
    return [{
      key, label: t(label), conflicting, status,
      value: conflicting || unknown ? t("common.values.open") : evidenceValue(key, value, t),
      source: [source, date ? formatDate(date, t) : null, freshness].filter(Boolean).join(" · "),
    }];
  });
}

export function sourceVersionRows(bench: BenchDetail, t: Translator): Array<[string, string | null]> {
  const versions: Array<[string, string | null]> = [
    [t("bench.location.osmVersion"), bench.osmVersion == null ? null : String(bench.osmVersion)],
    [t("knowledge.details.processingVersion"), bench.pipelineVersion],
    [t("knowledge.categories.location"), bench.knowledge?.geography?.sourceVersion ?? null],
  ];
  if (bench.knowledge?.geography?.municipalityId) {
    versions.push([t("bench.location.municipality"), t("bench.location.municipalityValue", {
      name: bench.knowledge.geography.municipalityName ?? t("common.values.unknown"),
      id: bench.knowledge.geography.municipalityId,
    })]);
  }
  // Group identical versions while retaining which road/rail periods they apply to.
  const noiseVersions = new Map<string, string[]>();
  for (const item of bench.knowledge?.noise ?? []) {
    if (!item.datasetVersion) continue;
    const labels = noiseVersions.get(item.datasetVersion) ?? [];
    labels.push(`${t(`knowledge.noise.${item.mode}`)} · ${t(`knowledge.noise.${item.period}`)}`);
    noiseVersions.set(item.datasetVersion, labels);
  }
  for (const [version, labels] of noiseVersions) {
    versions.push([`${t("knowledge.noise.title")} · ${[...new Set(labels)].join(", ")}`, version]);
  }
  return versions;
}
