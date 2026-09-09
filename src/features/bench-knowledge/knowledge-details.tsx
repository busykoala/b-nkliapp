import { ChevronDown } from "lucide-react";
import type { BenchKnowledge } from "./model";

const categories: Record<string, string> = { physical: "Ausstattung", location: "Ort", accessibility: "Zugangsweg", imagery: "Bilder", surroundings: "Umgebung", amenities: "Einrichtungen", environment: "Umweltdaten", recent_verification: "Aktuelle Sichtung" };
const amenities: Record<string, string> = { toilets: "Toilette", drinking_water: "Trinkwasser", fountain: "Brunnen", shelter: "Unterstand", picnic_table: "Picknicktisch", playground: "Spielplatz", waste_basket: "Abfalleimer", fireplace: "Feuerstelle" };
const attributes: Record<string, string> = { backrest: "Rückenlehne", armrest: "Armlehnen", covered: "Überdachung", wheelchair: "Rollstuhlnutzung", seats: "Sitzplätze", material: "Material", direction: "Blickrichtung", land_context: "Umgebung", canopy_context: "Baumdach", waterfront: "Am Wasser", presence: "Vorhandensein" };
const sources: Record<string, string> = { osm: "OpenStreetMap", gis: "Geometrie", imagery: "Bildmodell", official: "Amtliche Daten", community: "Community" };
const confidence: Record<string, string> = { unknown: "offen", low: "unsicher", medium: "gestützt", high: "gut gestützt" };

export function KnowledgeDetails({ knowledge }: { knowledge: BenchKnowledge }) {
  const nearby = knowledge.amenities.filter((item) => item.distanceMeters !== null);
  const approach = knowledge.approach;
  const hasDetails = nearby.length || approach || knowledge.noise.length || knowledge.attributes.length || knowledge.completeness.length;
  if (!hasDetails) return null;
  return <details className="technical-fold knowledge-details"><summary>Was wir wissen – und was noch offen ist <ChevronDown className="disclosure-chevron" size={16} /></summary>
    {nearby.length > 0 && <section><h4>In der Nähe</h4><dl>{nearby.map((item) => <div key={item.category}><dt>{amenities[item.category] ?? item.category}</dt><dd>ca. {Math.round(item.distanceMeters!)} m</dd></div>)}</dl><p>Abstand in Luftlinie zu erfassten Einrichtungen innerhalb von 500 m. Ein Brunnen ist nicht automatisch Trinkwasser.</p></section>}
    {approach && <section><h4>Das letzte Wegstück</h4>{approach.lengthMeters !== null ? <><dl>
      <div><dt>Betrachteter Weg</dt><dd>ca. {Math.round(approach.lengthMeters)} m</dd></div>
      <div><dt>Treppen auf diesem Weg</dt><dd>{approach.steps === null ? "Offen" : approach.steps ? "Erfasst" : "Keine erfasst"}</dd></div>
      <div><dt>Stufenfreie Möglichkeit</dt><dd>{approach.stepFreePossible === null ? "Offen" : approach.stepFreePossible ? "Hinweise vorhanden" : "Hindernis erfasst"}</dd></div>
      {approach.maximumSlopePercent !== null && <div><dt>Stärkste geschätzte Steigung</dt><dd>{approach.maximumSlopePercent}%</dd></div>}
      {approach.averageSlopePercent !== null && <div><dt>Mittlere absolute Steigung</dt><dd>{approach.averageSlopePercent}%</dd></div>}
      {approach.elevationGainMeters !== null && <div><dt>Aufstieg zur Bank</dt><dd>{Math.round(approach.elevationGainMeters)} m</dd></div>}
      {approach.surface && <div><dt>Belag laut Karte</dt><dd>{approach.surface}</dd></div>}
      {approach.smoothness && <div><dt>Beschaffenheit laut Karte</dt><dd>{approach.smoothness}</dd></div>}
      {approach.widthMeters !== null && <div><dt>Schmalste erfasste Breite</dt><dd>{approach.widthMeters} m</dd></div>}
    </dl><p>{confidence[approach.confidence] ?? "Offen"} · Nur ein lokaler Zugang, keine Prüfung der gesamten Anreise. Fehlende Hindernisse in der Karte sind keine Zusage zur Barrierefreiheit.</p></> : <p>Noch kein ausreichend naher Fussweg zugeordnet.</p>}</section>}
    {knowledge.noise.length > 0 && <section><h4>Verkehrslärm im Modell</h4><dl>{knowledge.noise.map((item) => <div key={`${item.mode}-${item.period}`}><dt>{item.mode === "rail" ? "Bahn" : "Strasse"} · {item.period === "day" ? "Tag" : "Nacht"}</dt><dd>{item.value === null ? "Keine Rasterabdeckung" : `${item.value.toFixed(1)} ${item.unit}`}</dd></div>)}</dl><p>Amtliche Beurteilungspegel, keine Live-Messung. Quellenstand: {[...new Set(knowledge.noise.map((item) => item.datasetVersion))].join(" · ")}.</p></section>}
    {knowledge.attributes.some((item) => attributes[item.attribute]) && <section><h4>Hinweise je Merkmal</h4><ul>{knowledge.attributes.filter((item) => attributes[item.attribute]).map((item) => <li key={item.attribute}><strong>{attributes[item.attribute]}</strong><span>{item.conflicting ? "Widersprüchliche Hinweise" : confidence[item.confidence]} · {item.sourceTypes.map((source) => sources[source] ?? source).join(", ")}{item.latestAt && ` · ${new Date(item.latestAt).toLocaleDateString("de-CH", { timeZone: "Europe/Zurich" })}`}</span></li>)}</ul></section>}
    {knowledge.completeness.length > 0 && <section><h4>Wie vollständig ist dieser Platz?</h4><ul>{knowledge.completeness.map((item) => <li key={item.category}><strong>{categories[item.category] ?? item.category}</strong><span>{item.known} von {item.total} Angaben{item.uncertain > 0 && ` · ${item.uncertain} unsicher`}</span></li>)}</ul><p>Jeder Bereich steht für sich. Ein fehlender Wert zählt als offen und sagt nichts Schlechtes über die Bank aus.</p></section>}
  </details>;
}
