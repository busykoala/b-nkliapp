import { formatDate } from "@/i18n/date";
import { useTranslations } from "next-intl";
import { compassDirection, propertyLabel, propertyValue } from "@/i18n/bench-labels";
import { KnowledgeDetails } from "@/features/bench-knowledge/knowledge-details";
import { Armchair, Check, ChevronDown, Compass, Flame, Hammer, Info, Minus, MoveHorizontal, PersonStanding, Umbrella, UsersRound } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { DetailRows } from "./panel-ui";

export function BenchPanel({ bench }: { bench: BenchDetail }) {
  const t = useTranslations();
  const visitorProperties = bench.properties.filter((property) => property.key !== "wasteBasketNearby");
  const known = visitorProperties.filter((property) => property.evidenceState === "known");
  const missingCount = visitorProperties.length - known.length;
  return <section className="detail-panel detail-panel-bench">
    {(bench.dedication || bench.description) && <blockquote className="bench-note">{bench.dedication || bench.description}</blockquote>}
    <details className="fact-info-fold">
      <summary>
        <span className="fact-info-icon" aria-hidden="true"><Info size={19} /></span>
        <span><strong>{t("bench.panel.moreInfo")}</strong><small>{known.length > 0 ? t("bench.panel.moreInfoKnown", {count: known.length}) : t("bench.panel.moreInfoUnknown")}</small></span>
        <ChevronDown className="fact-info-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="fact-info-body">
        {known.length > 0 && <dl className="bench-fact-list">
          {known.map((property) => <div className={property.source === "Bänkli App" ? "is-community" : ""} key={property.label}>
            <dt><PropertyIcon attribute={property.key} /><span>{propertyLabel(property, t)}</span></dt>
            <dd><FactValue property={property} /></dd>
          </div>)}
        </dl>}
        {missingCount > 0 && <p className="missing-whisper">{t("bench.panel.missing", {count: missingCount})}</p>}
        <div className="bearing-card">
          <div className="bearing-dial" aria-hidden="true"><Compass size={36} />{bench.directionDegrees !== null && <i style={{ transform: `rotate(${bench.directionDegrees}deg)` }} />}</div>
          <div><small>{t("bench.attributes.direction")}</small><strong>{bench.directionDegrees === null ? t("common.values.notRecorded") : `${compassDirection(bench.directionDegrees, t)} · ${Math.round(bench.directionDegrees)}°`}</strong></div>
        </div>
        <details className="technical-fold">
          <summary>{t("bench.location.title")} <ChevronDown size={16} /></summary>
          <DetailRows title={t("bench.location.title")} rows={[
            [t("bench.location.elevation"), bench.elevationMeters === null ? null : t("bench.location.metresAboveSea", {value: Math.round(bench.elevationMeters)})],
            [t("bench.location.place"), [bench.locationPostcode, bench.locationName, bench.locationCanton].filter(Boolean).join(" ") || null],
            [t("bench.location.municipality"), bench.knowledge?.geography?.municipalityName ? t("bench.location.municipalityValue", {name: bench.knowledge.geography.municipalityName, id: bench.knowledge.geography.municipalityId ?? t("common.values.open")}) : null],
            [t("bench.location.canton"), bench.knowledge?.geography?.cantonName ?? null],
            [t("bench.location.district"), bench.knowledge?.geography?.districtName ?? null],
            [t("bench.location.nearbyName"), bench.knowledge?.geography?.localityName ?? null],
            [t("bench.location.sourceUpdated"), bench.sourceUpdatedAt ? formatDate(bench.sourceUpdatedAt, t) : t("common.values.unknown")],
            [t("bench.location.imported"), bench.importedAt ? formatDate(bench.importedAt, t) : null],
            [t("bench.location.osmVersion"), bench.osmVersion == null ? null : String(bench.osmVersion)],
            [t("bench.location.coordinates"), `${bench.latitude.toFixed(6)}, ${bench.longitude.toFixed(6)}`],
          ]} />
        </details>
        {bench.knowledge && <KnowledgeDetails knowledge={bench.knowledge} />}
      </div>
    </details>
  </section>;
}

function FactValue({property}: {property: BenchDetail["properties"][number]}) {
  const t = useTranslations();
  const display = propertyValue(property, t);
  if (typeof property.canonicalValue === "boolean") return <span className={`fact-binary ${property.canonicalValue ? "is-yes" : "is-no"}`}>
    {property.canonicalValue ? <Check size={15} aria-hidden="true" /> : <Minus size={15} aria-hidden="true" />}<span>{display}</span>
  </span>;
  if (property.key === "seats" && typeof property.canonicalValue === "number") {
    const count = Math.max(0, Math.round(property.canonicalValue));
    return <span className="fact-seats" aria-label={display}><i aria-hidden="true">{Array.from({length: Math.min(count, 6)}, (_, index) => <b key={index} />)}</i><span>{display}</span></span>;
  }
  if (property.key === "material") {
    const material = String(property.canonicalValue ?? property.value).toLowerCase().replace(/[^a-z]/g, "");
    return <span className="fact-material"><i className={`is-${material}`} aria-hidden="true" /><span>{display}</span></span>;
  }
  return <span>{display}</span>;
}

function PropertyIcon({ attribute }: { attribute: string }) {
  if (attribute === "backrest") return <Armchair size={19} />;
  if (attribute === "armrest") return <MoveHorizontal size={19} />;
  if (attribute === "covered") return <Umbrella size={19} />;
  if (attribute === "wheelchair") return <PersonStanding size={19} />;
  if (attribute === "fireplaceNearby") return <Flame size={19} />;
  if (attribute === "material") return <Hammer size={19} />;
  return <UsersRound size={19} />;
}
