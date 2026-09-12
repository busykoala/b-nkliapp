import { formatDate } from "@/i18n/date";
import { useTranslations } from "next-intl";
import { compassDirection, propertyLabel, propertyValue } from "@/i18n/bench-labels";
import { KnowledgeDetails } from "@/features/bench-knowledge/knowledge-details";
import { BenchFeatureEditor } from "@/components/bench-feature-editor";
import { Accessibility, Armchair, ChevronDown, Compass, Flame, Hammer, MoveHorizontal, Trash2, Umbrella, UsersRound } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { DetailRows, PanelHeading } from "./panel-ui";

export function BenchPanel({ bench, signedIn = false, onChanged }: { bench: BenchDetail; signedIn?: boolean; onChanged?: () => void | Promise<void> }) {
  const t = useTranslations();
  const known = bench.properties.filter((property) => !/^(unbekannt|noch offen)$/i.test(property.value.trim()));
  const missingCount = bench.properties.length - known.length;
  return <section className="detail-panel detail-panel-bench">
    <PanelHeading eyebrow={t("bench.panel.eyebrow")} title={known.length ? t("bench.panel.title") : t("bench.panel.unknown")} />
    {signedIn && <BenchFeatureEditor bench={bench} onChanged={onChanged} />}
    {!signedIn && known.length > 0 && <div className="bench-fact-grid">
      {known.map((property) => <div className={property.source === "Bänkli App" ? "is-community" : ""} key={property.label}>
        <span className="fact-mark"><PropertyIcon attribute={property.key} /></span>
        <small>{propertyLabel(property, t)}</small>
        <strong>{propertyValue(property, t)}</strong>
      </div>)}
    </div>}
    {missingCount > 0 && <p className="missing-whisper">{t("bench.panel.missing", {count: missingCount})}</p>}
    {(bench.dedication || bench.description) && <blockquote className="bench-note">{bench.dedication || bench.description}</blockquote>}
    <div className="bearing-card">
      <div className="bearing-dial" aria-hidden="true"><Compass size={36} />{bench.directionDegrees !== null && <i style={{ transform: `rotate(${bench.directionDegrees}deg)` }} />}</div>
      <div><small>{t("bench.attributes.direction")}</small><strong>{bench.directionDegrees === null ? t("common.values.notRecorded") : compassDirection(bench.directionDegrees, t)}</strong><p>{bench.directionDegrees === null ? t("bench.panel.directionUnknown") : t("bench.panel.directionKnown")}</p></div>
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
  </section>;
}

function PropertyIcon({ attribute }: { attribute: string }) {
  if (attribute === "backrest") return <Armchair size={19} />;
  if (attribute === "armrest") return <MoveHorizontal size={19} />;
  if (attribute === "covered") return <Umbrella size={19} />;
  if (attribute === "wheelchair") return <Accessibility size={19} />;
  if (attribute === "fireplaceNearby") return <Flame size={19} />;
  if (attribute === "wasteBasketNearby") return <Trash2 size={19} />;
  if (attribute === "material") return <Hammer size={19} />;
  return <UsersRound size={19} />;
}
