import { formatDate } from "@/i18n/date";
import { surfaceLabel, smoothnessLabel } from "@/i18n/approach-labels";

import { useFormatter, useTranslations } from "next-intl";
import type { MessageKey } from "@/i18n/types";
import { ChevronDown } from "lucide-react";
import type { BenchKnowledge } from "./model";

const categories: Record<string, MessageKey> = { physical: "knowledge.categories.physical", location: "knowledge.categories.location", accessibility: "knowledge.categories.accessibility", imagery: "knowledge.categories.imagery", surroundings: "knowledge.attributes.land_context", amenities: "knowledge.categories.amenities", environment: "knowledge.categories.environment", recent_verification: "knowledge.categories.recent_verification" };
const amenities: Record<string, MessageKey> = { toilets: "knowledge.amenities.toilets", drinking_water: "knowledge.amenities.drinking_water", fountain: "knowledge.amenities.fountain", shelter: "knowledge.amenities.shelter", picnic_table: "knowledge.amenities.picnic_table", playground: "knowledge.amenities.playground", waste_basket: "knowledge.amenities.waste_basket", fireplace: "knowledge.amenities.fireplace" };
const attributes: Record<string, MessageKey> = { backrest: "bench.attributes.backrest", armrest: "bench.attributes.armrest", covered: "knowledge.attributes.covered", wheelchair: "knowledge.attributes.wheelchair", seats: "bench.attributes.seats", material: "bench.attributes.material", direction: "bench.attributes.direction", land_context: "knowledge.attributes.land_context", canopy_context: "knowledge.attributes.canopy_context", waterfront: "knowledge.attributes.waterfront", presence: "knowledge.attributes.presence" };
const sources: Record<string, MessageKey> = { osm: "knowledge.sources.osm", gis: "knowledge.sources.gis", imagery: "knowledge.sources.imagery", official: "knowledge.sources.official", community: "knowledge.sources.community" };
const confidence: Record<string, MessageKey> = { unknown: "knowledge.confidence.unknown", low: "knowledge.confidence.low", medium: "knowledge.confidence.medium", high: "knowledge.confidence.high" };

export function KnowledgeDetails({ knowledge }: { knowledge: BenchKnowledge }) {
  const t = useTranslations();
  const format = useFormatter();
  const nearby = knowledge.amenities.filter((item) => item.distanceMeters !== null);
  const approach = knowledge.approach;
  const hasDetails = nearby.length || approach || knowledge.noise.length || knowledge.attributes.length || knowledge.completeness.length;
  if (!hasDetails) return null;
  return <details className="technical-fold knowledge-details"><summary>{t("knowledge.title")} <ChevronDown className="disclosure-chevron" size={16} /></summary>
    {nearby.length > 0 && <section><h4>{t("knowledge.nearby.title")}</h4><dl>{nearby.map((item) => <div key={item.category}><dt>{amenities[item.category] ? t(amenities[item.category]) : item.category}</dt><dd>{t("knowledge.nearby.distance", {distance: Math.round(item.distanceMeters!)})}</dd></div>)}</dl><p>{t("knowledge.nearby.explanation")}</p></section>}
    {approach && <section><h4>{t("knowledge.approach.title")}</h4>{approach.lengthMeters !== null ? <><dl>
      <div><dt>{t("knowledge.approach.length")}</dt><dd>{t("knowledge.nearby.distance", {distance: Math.round(approach.lengthMeters)})}</dd></div>
      <div><dt>{t("knowledge.approach.steps")}</dt><dd>{approach.steps === null ? t("knowledge.approach.open") : approach.steps ? t("knowledge.approach.recorded") : t("knowledge.approach.noneRecorded")}</dd></div>
      <div><dt>{t("knowledge.approach.stepFree")}</dt><dd>{approach.stepFreePossible === null ? t("knowledge.approach.open") : approach.stepFreePossible ? t("knowledge.approach.evidence") : t("knowledge.approach.obstacle")}</dd></div>
      {approach.maximumSlopePercent !== null && <div><dt>{t("knowledge.approach.maxSlope")}</dt><dd>{format.number(approach.maximumSlopePercent)}%</dd></div>}
      {approach.averageSlopePercent !== null && <div><dt>{t("knowledge.approach.meanSlope")}</dt><dd>{format.number(approach.averageSlopePercent)}%</dd></div>}
      {approach.elevationGainMeters !== null && <div><dt>{t("knowledge.approach.ascent")}</dt><dd>{Math.round(approach.elevationGainMeters)} m</dd></div>}
      {approach.surface && <div><dt>{t("knowledge.approach.surface")}</dt><dd>{surfaceLabel(approach.surface, t)}</dd></div>}
      {approach.smoothness && <div><dt>{t("knowledge.approach.smoothness")}</dt><dd>{smoothnessLabel(approach.smoothness, t)}</dd></div>}
      {approach.widthMeters !== null && <div><dt>{t("knowledge.approach.width")}</dt><dd>{format.number(approach.widthMeters)} m</dd></div>}
    </dl><p>{t("knowledge.approach.explanation", {confidence: confidence[approach.confidence] ? t(confidence[approach.confidence]) : t("knowledge.approach.open")})}</p></> : <p>{t("knowledge.approach.empty")}</p>}</section>}
    {knowledge.noise.length > 0 && <section><h4>{t("knowledge.noise.title")}</h4><dl>{knowledge.noise.map((item) => <div key={`${item.mode}-${item.period}`}><dt>{item.mode === "rail" ? t("knowledge.noise.rail") : t("knowledge.noise.road")} · {item.period === "day" ? t("knowledge.noise.day") : t("knowledge.noise.night")}</dt><dd>{item.value === null ? t("knowledge.noise.empty") : `${format.number(item.value, {minimumFractionDigits: 1, maximumFractionDigits: 1})} ${item.unit}`}</dd></div>)}</dl><p>{t("knowledge.noise.explanation", {version: [...new Set(knowledge.noise.map((item) => item.datasetVersion))].join(" · ")})}</p></section>}
    {knowledge.attributes.some((item) => attributes[item.attribute]) && <section><h4>{t("knowledge.evidence.title")}</h4><ul>{knowledge.attributes.filter((item) => attributes[item.attribute]).map((item) => <li key={item.attribute}><strong>{t(attributes[item.attribute])}</strong><span>{item.conflicting ? t("knowledge.evidence.conflicting") : t(confidence[item.confidence])} · {item.sourceTypes.map((source) => sources[source] ? t(sources[source]) : source).join(", ")}{item.latestAt && ` · ${formatDate(item.latestAt, t)}`}</span></li>)}</ul></section>}
    {knowledge.completeness.length > 0 && <section><h4>{t("knowledge.completeness.title")}</h4><ul>{knowledge.completeness.map((item) => <li key={item.category}><strong>{categories[item.category] ? t(categories[item.category]) : item.category}</strong><span>{t("knowledge.completeness.count", {known: item.known, total: item.total})}{item.uncertain > 0 && t("knowledge.completeness.uncertain", {count: item.uncertain})}</span></li>)}</ul><p>{t("knowledge.completeness.explanation")}</p></section>}
  </details>;
}
