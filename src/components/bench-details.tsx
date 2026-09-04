"use client";

import { useId, useState, useTransition } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Accessibility,
  Armchair,
  Building2,
  ChevronDown,
  CloudRain,
  CloudSun,
  Compass,
  Droplets,
  Eye,
  Footprints,
  Hammer,
  Leaf,
  MessageCircleHeart,
  Moon,
  MountainSnow,
  MoveHorizontal,
  Pencil,
  Plus,
  Snowflake,
  Sun,
  TreePine,
  Umbrella,
  UsersRound,
  Waves,
  Wind,
} from "lucide-react";
import { editBenchField } from "@/app/actions/benches";
import type { BenchDetail, BenchProperty } from "@/lib/types";

type DetailPanel = "bench" | "light" | "view" | "weather";

const panelLabels: Array<{ id: DetailPanel; label: string; icon: ReactNode }> = [
  { id: "bench", label: "Bank", icon: <Armchair size={18} /> },
  { id: "light", label: "Licht", icon: <Sun size={18} /> },
  { id: "view", label: "Aussicht", icon: <MountainSnow size={18} /> },
  { id: "weather", label: "Wetter", icon: <CloudSun size={18} /> },
];

export function BenchDetails({ bench, signedIn, onBenchChange }: { bench: BenchDetail; signedIn: boolean; onBenchChange?: () => void | Promise<void> }) {
  const [panel, setPanel] = useState<DetailPanel>("bench");
  const id = useId();
  return <section className="quiet-details" aria-label="Details">
    <div className="detail-chapters">
      <div className="detail-tabs" role="tablist" aria-label="Detailkapitel">
        {panelLabels.map((item) => <button
          key={item.id}
          id={`${id}-${item.id}-tab`}
          type="button"
          role="tab"
          aria-selected={panel === item.id}
          aria-controls={`${id}-${item.id}-panel`}
          onClick={() => setPanel(item.id)}
        >{item.icon}<span>{item.label}</span></button>)}
      </div>
      <div id={`${id}-${panel}-panel`} role="tabpanel" aria-labelledby={`${id}-${panel}-tab`}>
        {panel === "bench" && <BenchPanel bench={bench} signedIn={signedIn} onBenchChange={onBenchChange} />}
        {panel === "light" && <LightPanel bench={bench} />}
        {panel === "view" && <ViewPanel bench={bench} />}
        {panel === "weather" && <WeatherPanel bench={bench} />}
      </div>
    </div>
  </section>;
}

function PanelHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="detail-panel-heading"><small>{eyebrow}</small><h3>{title}</h3>{children}</header>;
}

function BenchPanel({ bench, signedIn, onBenchChange }: { bench: BenchDetail; signedIn: boolean; onBenchChange?: () => void | Promise<void> }) {
  const [propertyOverrides, setPropertyOverrides] = useState<Partial<Record<BenchProperty["key"], Pick<BenchProperty, "value" | "source">>>>({});
  const [directionOverride, setDirectionOverride] = useState<number | null | undefined>(undefined);
  const [activeField, setActiveField] = useState<EditableField | null>(null);
  const properties = bench.properties.map((property) => ({ ...property, ...propertyOverrides[property.key] }));
  const directionDegrees = directionOverride === undefined ? bench.directionDegrees : directionOverride;
  const known = properties.filter((property) => !isMissing(property.value));
  const visible = signedIn ? properties : known;
  const missingCount = properties.length - known.length;
  const activeProperty = properties.find((property) => property.key === activeField);
  return <section className="detail-panel detail-panel-bench">
    <PanelHeading eyebrow="So sitzt es sich hier" title={known.length ? "Was die Bank mitbringt" : "Die Bank wird noch erkundet"}>
      {signedIn && <p className="contribution-invite">Tippe auf eine Angabe, um sie zu ergänzen.</p>}
    </PanelHeading>
    {visible.length > 0 && <div className="bench-fact-grid">
      {visible.map((property) => <button
        type="button"
        disabled={!signedIn}
        aria-expanded={signedIn ? activeField === property.key : undefined}
        className={`${isMissing(property.value) ? "is-missing" : ""} ${property.source === "Bänkli App" ? "is-community" : ""} ${activeField === property.key ? "is-editing" : ""}`}
        key={property.label}
        onClick={() => setActiveField(activeField === property.key ? null : property.key)}
      >
        <span className="fact-mark"><PropertyIcon label={property.label} /></span>
        <small>{property.label}</small>
        <strong>{isMissing(property.value) && signedIn ? "Ergänzen" : property.value}</strong>
        {signedIn && <span className="fact-edit" aria-hidden="true">{isMissing(property.value) ? <Plus size={15} /> : <Pencil size={13} />}</span>}
      </button>)}
    </div>}
    {!signedIn && missingCount > 0 && <p className="missing-whisper">{missingCount === 1 ? "Ein Merkmal" : `${missingCount} Merkmale`} wurde{missingCount === 1 ? "" : "n"} noch nicht erfasst.</p>}
    {signedIn && activeProperty && <ChoiceEditor
      benchId={bench.id}
      field={activeProperty.key}
      label={activeProperty.label}
      currentDisplay={activeProperty.value}
      onClose={() => setActiveField(null)}
      onSaved={(display) => setPropertyOverrides((current) => ({ ...current, [activeProperty.key]: { value: display, source: "Bänkli App" } }))}
      onBenchChange={onBenchChange}
    />}
    {(bench.dedication || bench.description) && <blockquote className="bench-note">{bench.dedication || bench.description}</blockquote>}
    <div className={`bearing-card ${activeField === "direction" ? "is-editing" : ""}`}>
      <div className="bearing-dial" aria-hidden="true"><Compass size={36} /><i style={{ transform: `rotate(${directionDegrees ?? 0}deg)` }} /></div>
      <div><small>Blickrichtung</small><strong>{directionDegrees === null ? signedIn ? "Ergänzen" : "Noch nicht erfasst" : direction(directionDegrees)}</strong><p>{directionDegrees === null ? "Die Landschaft wird deshalb rundum betrachtet." : "Die Aussicht wird in dieser Richtung gewichtet."}</p></div>
      {signedIn && <button type="button" className="bearing-edit" aria-label="Blickrichtung bearbeiten" aria-expanded={activeField === "direction"} onClick={() => setActiveField(activeField === "direction" ? null : "direction")}>{directionDegrees === null ? <Plus size={16} /> : <Pencil size={14} />}</button>}
    </div>
    {signedIn && activeField === "direction" && <ChoiceEditor
      benchId={bench.id}
      field="direction"
      label="Blickrichtung"
      currentDisplay={directionDegrees === null ? null : direction(directionDegrees)}
      onClose={() => setActiveField(null)}
      onSaved={(_, value) => setDirectionOverride(Number(value))}
      onBenchChange={onBenchChange}
    />}
    <details className="technical-fold">
      <summary>Ort & Herkunft <ChevronDown size={16} /></summary>
      <DetailRows title="Ort & Herkunft" rows={[
        ["Höhe", bench.elevationMeters === null ? null : `${Math.round(bench.elevationMeters)} m ü. M.`],
        ["Ort", [bench.locationPostcode, bench.locationName, bench.locationCanton].filter(Boolean).join(" ") || null],
        ["Koordinaten", `${bench.latitude.toFixed(6)}, ${bench.longitude.toFixed(6)}`],
        ["Datenquelle", bench.osmType === "community" ? "Bänkli App" : "OpenStreetMap"],
        ["Stand", readableDate(bench.sourceUpdatedAt)],
      ]} />
    </details>
  </section>;
}

type EditableField = BenchProperty["key"] | "direction";
type FieldChoice = { value: string; label: string; display?: string };

function choicesFor(field: EditableField): FieldChoice[] {
  if (["backrest", "armrest", "covered", "wheelchair"].includes(field)) return [
    { value: "yes", label: "Ja" }, { value: "no", label: "Nein" },
  ];
  if (field === "material") return [
    { value: "wood", label: "Holz" }, { value: "metal", label: "Metall" }, { value: "stone", label: "Stein" },
    { value: "concrete", label: "Beton" }, { value: "plastic", label: "Kunststoff" }, { value: "mixed", label: "Gemischt" },
  ];
  if (field === "seats") return Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }));
  return [
    ["0", "N", "N · 0°"], ["45", "NO", "NO · 45°"], ["90", "O", "O · 90°"], ["135", "SO", "SO · 135°"],
    ["180", "S", "S · 180°"], ["225", "SW", "SW · 225°"], ["270", "W", "W · 270°"], ["315", "NW", "NW · 315°"],
  ].map(([value, label, display]) => ({ value, label, display }));
}

function ChoiceEditor({ benchId, field, label, currentDisplay, onSaved, onClose, onBenchChange }: {
  benchId: string;
  field: EditableField;
  label: string;
  currentDisplay: string | null;
  onSaved: (display: string, value: string) => void;
  onClose: () => void;
  onBenchChange?: () => void | Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const choose = (choice: FieldChoice) => startTransition(async () => {
    setMessage(null);
    const result = await editBenchField(benchId, field, choice.value);
    setMessage(result.message);
    if (!result.ok) return;
    onSaved(choice.display ?? choice.label, choice.value);
    window.setTimeout(onClose, 420);
    if (onBenchChange) void onBenchChange();
  });
  return <div className="inline-field-editor" aria-label={`${label} bearbeiten`}>
    <header><span>{label}</span><small>{pending ? "Wird eingetragen …" : message ?? "Was siehst du vor Ort?"}</small></header>
    <div className={`field-choice-grid is-${field}`}>
      {choicesFor(field).map((choice) => {
        const selected = (choice.display ?? choice.label) === currentDisplay;
        return <button type="button" key={choice.value} disabled={pending} aria-pressed={selected} onClick={() => choose(choice)}>{selected && <span aria-hidden="true">✓</span>}{choice.label}</button>;
      })}
    </div>
  </div>;
}

function PropertyIcon({ label }: { label: string }) {
  if (label === "Rückenlehne") return <Armchair size={19} />;
  if (label === "Armlehnen") return <MoveHorizontal size={19} />;
  if (label === "Überdacht") return <Umbrella size={19} />;
  if (label === "Barrierefrei") return <Accessibility size={19} />;
  if (label === "Material") return <Hammer size={19} />;
  return <UsersRound size={19} />;
}

function LightPanel({ bench }: { bench: BenchDetail }) {
  const sunPercent = bench.daylightMinutesToday > 0 ? Math.round(bench.sunMinutesToday / bench.daylightMinutesToday * 100) : 0;
  const sunLabel = bench.sunConfidence === "niedrig" ? "Geschätzte Sonne" : "Direkte Sonne";
  return <section className="detail-panel detail-panel-light">
    <PanelHeading eyebrow="Licht heute" title={currentLight(bench)}>
      <p>{lightSentence(bench)}</p>
    </PanelHeading>
    <SunPath bench={bench} />
    <div className="light-balance" aria-label={`${sunDuration(bench.sunMinutesToday)} direkte Sonne und ${sunDuration(bench.shadeMinutesToday)} Schatten bei Tageslicht`}>
      <div><span className="is-sun"><Sun size={18} /></span><small>{sunLabel}</small><strong>{sunDuration(bench.sunMinutesToday)}</strong></div>
      <div><span className="is-shade"><CloudSun size={18} /></span><small>Schatten</small><strong>{sunDuration(bench.shadeMinutesToday)}</strong></div>
      <i><b style={{ width: `${sunPercent}%` }} /></i>
    </div>
    <div className="light-windows">
      <IntervalStory icon={<Sun size={17} />} label={bench.sunConfidence === "niedrig" ? "Geschätzte Sonnenfenster" : "Sonnenfenster"} windows={bench.sunWindows} empty="Heute keine direkte Sonne berechnet" />
      <IntervalStory icon={<CloudSun size={17} />} label="Schattenfenster" windows={bench.shadeWindows} empty="Heute kein Schattenfenster berechnet" />
    </div>
    <ObstructionSketch building={bench.buildingObstructionPercent} vegetation={bench.vegetationObstructionPercent} />
    <p className="confidence-line">{lightConfidenceLine(bench.sunConfidence)}</p>
    <details className="technical-fold">
      <summary>Himmelswerte <ChevronDown size={16} /></summary>
      <SeasonalLight bench={bench} />
      <DetailRows title="Himmelswerte" rows={[
        ["Sonnenaufgang", bench.sunrise],
        ["Sonnenuntergang", bench.sunset],
        ["Direkte Sonne ab", bench.directSunrise],
        ["Direkte Sonne bis", bench.directSunset],
        ["Sonnenhöhe", angle(bench.sunAltitudeDegrees)],
        ["Sonnenrichtung", direction(bench.sunAzimuthDegrees)],
        ["Mondlicht", `${Math.round(bench.moonIllumination * 100)}%`],
        ["Mondaufgang", bench.moonrise],
        ["Monduntergang", bench.moonset],
      ]} />
    </details>
  </section>;
}

function SunPath({ bench }: { bench: BenchDetail }) {
  const nowX = timelineX(bench.localMinutesNow);
  const sunY = trackY(bench.sunAltitudeDegrees);
  const moonY = trackY(bench.moonAltitudeDegrees);
  return <section className="daylight-story" aria-label={`Sonnenaufgang ${bench.sunrise}, Sonnenuntergang ${bench.sunset}. Mondaufgang ${bench.moonrise}, Monduntergang ${bench.moonset}.`}>
    <div className="sky-legend"><span className="sun-time"><Sun size={15} />{bench.sunrise}–{bench.sunset}</span><span className="moon-time"><Moon size={15} />{bench.moonrise}–{bench.moonset}</span></div>
    <svg className="sky-arc" viewBox="0 0 360 96" aria-hidden="true">
      <path className="sky-horizon" d="M8 75H352" />
      {trackPaths(bench.skyTrack.sun).map((path, index) => <path key={`sun-${index}`} className="sky-arc-line sky-arc-sun" d={path} />)}
      {trackPaths(bench.skyTrack.moon).map((path, index) => <path key={`moon-${index}`} className="sky-arc-line sky-arc-moon" d={path} />)}
      {bench.sunWindows.map((window) => {
        const start = clockMinutes(window.start), end = clockMinutes(window.end);
        return start !== null && end !== null ? <path key={`${window.start}-${window.end}`} className="sky-light-window" d={`M${timelineX(start)} 78H${timelineX(end)}`} /> : null;
      })}
      <path className="sky-now-line" d={`M${nowX} 8V79`} />
      {bench.sunAltitudeDegrees > 0 && <g className="sky-arc-now is-sun" transform={`translate(${nowX} ${sunY})`}><circle r="5" /><path className="sun-rays" d="M0-10v2M0 8v2M-10 0h2M8 0h2M-7-7l1.5 1.5M5.5 5.5 7 7M7-7 5.5-5.5M-5.5 5.5-7 7" /></g>}
      {bench.moonVisible && <g className="sky-arc-now is-moon" transform={`translate(${nowX} ${moonY})`}><path d="M2-6a7 7 0 1 0 0 12 6 6 0 1 1 0-12Z" /></g>}
      {[0, 6, 12, 18, 24].map((hour) => <text key={hour} className="sky-clock" x={timelineX(hour * 60)} y="92" textAnchor={hour === 0 ? "start" : hour === 24 ? "end" : "middle"}>{hour}</text>)}
    </svg>
  </section>;
}

function IntervalStory({ icon, label, windows, empty }: { icon: ReactNode; label: string; windows: BenchDetail["sunWindows"]; empty: string }) {
  return <div><span aria-hidden="true">{icon}</span><p><small>{label}</small><strong>{windows.length ? windows.map((window) => `${window.start}–${window.end}`).join(" · ") : empty}</strong></p></div>;
}

function SeasonalLight({ bench }: { bench: BenchDetail }) {
  const values: Array<[string, number | null]> = [
    ["Frühling", bench.sunMinutesSpring],
    ["Sommer", bench.sunMinutesSummer],
    ["Herbst", bench.sunMinutesAutumn],
    ["Winter", bench.sunMinutesWinter],
  ];
  const available = values.filter((item): item is [string, number] => item[1] !== null);
  if (!available.length) return null;
  const maximum = Math.max(...available.map((item) => item[1]), 1);
  return <div className="season-light" aria-label="Typische direkte Sonnendauer nach Jahreszeit">
    {available.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${value / maximum * 100}%` }} /></i><strong>{sunDuration(value)}</strong></div>)}
  </div>;
}

function ViewPanel({ bench }: { bench: BenchDetail }) {
  const hasDistances = [bench.distanceBuildingMeters, bench.distanceWaterMeters, bench.distancePathMeters].some((value) => value !== null);
  const surroundings = surroundingsLine(bench);
  return <section className="detail-panel detail-panel-view">
    <PanelHeading eyebrow="Aussicht & Umgebung" title={viewTitle(bench)} />
    <div className="view-summary">
      <ViewScoreIllustration bench={bench} />
      <div><small>Eindruck</small><p>{bench.viewLabels.join(" · ") || "Die Aussicht wird noch erkundet."}</p><span>{confidence(bench.viewConfidence)}e Sicherheit</span></div>
    </div>
    <MetricSketch values={[
      ["Freie Blickrichtungen", bench.nearOpenness],
      ["Himmelsoffenheit", bench.viewComponents.openness],
      ["Geländerelief", bench.viewComponents.relief],
      ["Wasser im Blick", bench.viewComponents.water],
      ["Natürliche Umgebung", bench.viewComponents.naturalness],
      ["Abstand zu Störungen", bench.viewComponents.remoteness],
    ]} />
    <ObstructionSketch building={bench.buildingObstructionPercent} vegetation={bench.vegetationObstructionPercent} />
    {hasDistances && <div className="distance-ribbon">
      <DistanceFact icon={<Building2 size={19} />} label="Gebäude" value={bench.distanceBuildingMeters} />
      <DistanceFact icon={<Waves size={19} />} label="Wasser" value={bench.waterfront ? 0 : bench.distanceWaterMeters} />
      <DistanceFact icon={<Footprints size={19} />} label="Weg" value={bench.distancePathMeters} />
    </div>}
    <CanopySketch values={[bench.canopyShare3m, bench.canopyShare10m, bench.canopyShare25m]} />
    {(surroundings || bench.inForest !== null || bench.canopyContext && bench.canopyContext !== "unknown") && <div className="landscape-facts">
      {surroundings && <span><Leaf size={17} />{surroundings}</span>}
      {bench.inForest !== null && <span><TreePine size={17} />{bench.inForest ? "Im Wald" : "Ausserhalb des Waldes"}</span>}
      {bench.canopyContext && bench.canopyContext !== "unknown" && <span><TreePine size={17} />{canopy(bench.canopyContext)}</span>}
    </div>}
    {bench.viewExplanation.length > 0 && <ul className="view-notes">{bench.viewExplanation.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>}
    <details className="technical-fold">
      <summary>Messwerte <ChevronDown size={16} /></summary>
      <DetailRows title="Aussicht" rows={[
        ["Analysebereich", bench.analysisCoverage === "terrain" ? "Nahbereich und Gelände bis 20 km" : "Nahbereich"],
        ["Gebäude am Horizont", percent(bench.buildingObstructionPercent)],
        ["Vegetation am Horizont", percent(bench.vegetationObstructionPercent)],
        ["Gebäude in 100 m", bench.buildingCount100m === null ? null : String(bench.buildingCount100m)],
        ["Baumdeckung", percent(bench.canopyPercent)],
        ["Mittlere Vegetationshöhe", meters(bench.vegetationMedianHeight)],
        ["Höchste Vegetation", meters(bench.vegetationMaxHeight)],
      ]} />
      {bench.likelyEnvironment?.traits.length ? <div className="image-hints"><small>Hinweise aus Bildern der Umgebung</small>{bench.likelyEnvironment.traits.map((trait) => <span key={trait.kind}>{trait.label} · {Math.round(trait.probability * 100)}%</span>)}</div> : null}
    </details>
  </section>;
}

function ViewScoreIllustration({ bench }: { bench: BenchDetail }) {
  const clipId = useId();
  const mountain = bench.viewLabels.includes("Bergblick");
  const hill = bench.viewLabels.includes("Hügelblick");
  const water = bench.viewComponents.water !== null && bench.viewComponents.water >= .5;
  const wooded = bench.inForest === true || (bench.viewComponents.naturalness ?? 0) >= .7;
  return <svg className="view-score-art" viewBox="0 0 124 104" role="img" aria-label={bench.viewScore === null ? "Aussicht noch offen" : `Aussicht ${bench.viewScore} von 5`}>
    <defs><clipPath id={clipId}><path d="M7 17Q11 7 25 8h75q16 0 18 14v58q-3 15-18 16H23Q7 94 6 80Z" /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      <rect className="view-art-sky" x="4" y="5" width="116" height="93" />
      <circle className="view-art-sun" cx="91" cy="27" r="9" />
      {mountain
        ? <><path className="view-art-mountain-back" d="M-4 72 25 33l18 25 20-38 35 52Z" /><path className="view-art-snow" d="m51 43 12-23 13 25-12-8-7 8Z" /></>
        : hill && <path className="view-art-hill-back" d="M-8 74Q20 39 50 69q27-38 65 3Z" />}
      {wooded && <g className="view-art-trees">
        <path d="m17 62 8-18 8 18h-5l7 13H14l7-13Zm68 2 7-16 7 16h-4l6 12H83l6-12Z" />
      </g>}
      {water && <path className="view-art-water" d="M-3 76q18-6 36 0t36 0 39 0 25 0v20H-3Z" />}
      <path className="view-art-ground" d="M-7 83q28-19 57-4 32-16 82 1v23H-7Z" />
      <path className="view-art-path" d="M46 103q10-22 25-28 9-4 18-1-13 7-20 29Z" />
    </g>
    <path className="view-art-frame" d="M7 17Q11 7 25 8h75q16 0 18 14v58q-3 15-18 16H23Q7 94 6 80Z" />
    <g className="view-art-score">
      <path d="M69 67q3-7 12-7h30q8 1 9 9v20q-2 9-10 10H80q-10-1-11-10Z" />
      <text className="view-art-number" x="94" y="84">{bench.viewScore ?? "?"}</text>
      <text className="view-art-of" x="94" y="94">{bench.viewScore === null ? "offen" : "von 5"}</text>
    </g>
  </svg>;
}

function DistanceFact({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  if (value === null) return null;
  return <div><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{distance(value)}</strong></div>;
}

function MetricSketch({ values }: { values: Array<[string, number | null]> }) {
  const available = values.filter((value): value is [string, number] => value[1] !== null);
  if (!available.length) return <p className="calm-empty">Für die Aussicht fehlen noch genügend Messpunkte.</p>;
  return <div className="metric-sketch" aria-label="Bestandteile der Aussichtswertung">
    {available.map(([label, raw]) => {
      const value = Math.max(0, Math.min(1, raw));
      return <div key={label}><span>{label}</span><i><b style={{ width: `${Math.round(value * 100)}%` }} /></i><small>{Math.round(value * 100)}</small></div>;
    })}
  </div>;
}

function ObstructionSketch({ building, vegetation }: { building: number | null; vegetation: number | null }) {
  if (building === null && vegetation === null) return null;
  const buildings = Math.max(0, Math.min(100, building ?? 0));
  const plants = Math.max(0, Math.min(100 - buildings, vegetation ?? 0));
  const open = Math.max(0, 100 - buildings - plants);
  const chartStyle = {
    "--open-angle": `${open * 3.6}deg`,
    "--building-angle": `${(open + buildings) * 3.6}deg`,
  } as CSSProperties;
  return <div className="horizon-sketch" aria-label={`Horizont: ${Math.round(open)} Prozent frei, ${Math.round(buildings)} Prozent Gebäude, ${Math.round(plants)} Prozent Vegetation`}>
    <header><Eye size={17} /><span>Was den Horizont prägt</span></header>
    <div className="horizon-chart">
      <div className="horizon-ring" style={chartStyle} aria-hidden="true"><span><strong>{Math.round(open)}%</strong><small>frei</small></span></div>
      <div className="horizon-legend" aria-hidden="true">
        <div><i className="is-open" /><span>Freier Blick</span><strong>{Math.round(open)}%</strong></div>
        <div><i className="is-building" /><span>Gebäude</span><strong>{Math.round(buildings)}%</strong></div>
        <div><i className="is-vegetation" /><span>Bäume</span><strong>{Math.round(plants)}%</strong></div>
      </div>
    </div>
  </div>;
}

function CanopySketch({ values }: { values: Array<number | null> }) {
  if (values.every((value) => value === null)) return null;
  return <div className="canopy-sketch" aria-label="Baumdeckung im Nahbereich">
    <small>Baumdach rund um die Bank</small>
    <div>{values.map((value, index) => value === null ? null : <span key={index} style={{ "--canopy": `${Math.max(3, value) / 100}` } as CSSProperties}><i /><b>{Math.round(value)}%</b><em>{["3 m", "10 m", "25 m"][index]}</em></span>)}</div>
  </div>;
}

function WeatherPanel({ bench }: { bench: BenchDetail }) {
  const weather = bench.weather;
  return <section className="detail-panel detail-panel-weather">
    <PanelHeading eyebrow="Wetter & Ruhe" title={weather ? `${Math.round(weather.temperatureC)}° bei ${weather.location}` : "Der Himmel bleibt noch verborgen"}>
      {weather && <p>{cloudDescription(weather.cloudCover)} · {precipitation(weather.precipitationType)}</p>}
    </PanelHeading>
    {weather ? <>
      <WeatherSketch weather={weather} />
      <div className="weather-measures">
        <WeatherMeasure icon={<CloudRain size={18} />} label="Niederschlag" value={weather.precipitationRateMmH === null ? null : `${weather.precipitationRateMmH.toFixed(1)} mm/h`} />
        <WeatherMeasure icon={<Wind size={18} />} label="Wind" value={weather.windKmh === null ? null : `${Math.round(weather.windKmh)} km/h`} />
        <WeatherMeasure icon={<Droplets size={18} />} label="Feuchte" value={weather.humidityPercent === null ? null : `${Math.round(weather.humidityPercent)}%`} />
        <WeatherMeasure icon={<Snowflake size={18} />} label="Schnee" value={weather.snowDepthCm === null ? null : `${Math.round(weather.snowDepthCm)} cm`} />
      </div>
      <p className="weather-time">MeteoSchweiz · {readableDate(weather.observedAt)}</p>
    </> : <p className="calm-empty">Sobald Wetterdaten verfügbar sind, erscheinen Temperatur, Wolken und Niederschlag hier.</p>}
    <CommunityQuiet bench={bench} />
    <ModelThanks bench={bench} />
  </section>;
}

function WeatherMeasure({ icon, label, value }: { icon: ReactNode; label: string; value: string | null }) {
  if (value === null) return null;
  return <div><span aria-hidden="true">{icon}</span><small>{label}</small><strong>{value}</strong></div>;
}

function WeatherSketch({ weather }: { weather: NonNullable<BenchDetail["weather"]> }) {
  const detailedLayers: Array<[string, number | null]> = [["hoch", weather.cloudHigh], ["mittel", weather.cloudMid], ["tief", weather.cloudLow]];
  const layers: Array<[string, number | null]> = [["gesamt", weather.cloudCover], ...detailedLayers.filter(([, value]) => value !== null)];
  return <div className="weather-sketch" aria-label={`Wolkendecke ${Math.round(weather.cloudCover * 100)} Prozent`}>
    <div className="weather-sky-mark">{weather.precipitationType === "snow" ? <Snowflake /> : weather.precipitationType === "rain" || weather.precipitationType === "mixed" ? <CloudRain /> : <CloudSun />}</div>
    <div className="cloud-layers">{layers.map(([label, raw]) => {
      const value = raw ?? 0;
      return <div key={label}><span>{label}</span><i><b style={{ width: `${Math.round(value * 100)}%` }} /></i><strong>{raw === null ? "–" : `${Math.round(value * 100)}%`}</strong></div>;
    })}</div>
  </div>;
}

function CommunityQuiet({ bench }: { bench: BenchDetail }) {
  if (!bench.ratingBreakdown) return <div className="community-quiet is-empty"><MessageCircleHeart size={21} /><div><small>Ruhe vor Ort</small><strong>Noch keine Stimmen</strong><p>Die Ruhe an diesem Platz wurde noch nicht erkundet.</p></div></div>;
  const quiet = bench.ratingBreakdown.quiet;
  return <div className="community-quiet">
    <MessageCircleHeart size={21} />
    <div><small>Ruhe laut Menschen vor Ort</small><strong>{quiet.toFixed(1)} von 5</strong><i><b style={{ width: `${quiet / 5 * 100}%` }} /></i><p>Subjektive Bewertung, getrennt von Verkehrsdaten.</p></div>
  </div>;
}

function ModelThanks({ bench }: { bench: BenchDetail }) {
  return <details className="source-book">
    <summary>Quellen & Modell <ChevronDown size={16} /></summary>
    <p>Diese Landschaft entsteht aus folgenden Daten:</p>
    <div>
      {bench.osmType !== "community" && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>}
      <a href="https://www.swisstopo.admin.ch/de/geodaten-kostenlos-online" target="_blank" rel="noreferrer">swisstopo Gelände & Gebäude</a>
      {bench.weather && <a href="https://www.meteoschweiz.admin.ch/service-und-publikationen/service/open-data.html" target="_blank" rel="noreferrer">MeteoSchweiz</a>}
      {bench.media.length > 0 && <a href="https://commons.wikimedia.org/" target="_blank" rel="noreferrer">Wikimedia Commons</a>}
      {bench.ratingCount > 0 && <span>Menschen vor Ort</span>}
    </div>
    <small>{bench.pipelineVersion ?? "Umgebungsmodell"} · Quelldaten {readableDate(bench.sourceUpdatedAt)}</small>
    {bench.likelyEnvironment?.evidence.length ? <details className="source-whisper"><summary>Verwendete Umgebungsbilder</summary><div>{bench.likelyEnvironment.evidence.map((item) => <a key={`${item.provider}-${item.captureGroup}`} href={item.sourceUrl} target="_blank" rel="noreferrer">{item.provider} · {item.distanceMeters} m</a>)}</div></details> : null}
  </details>;
}

function DetailRows({ title, rows }: { title: string; rows: Array<[string, string | null]> }) {
  const visible = rows.filter(([, value]) => value !== null && value !== "");
  if (!visible.length) return null;
  return <dl>{visible.map(([label, value]) => <div key={`${title}-${label}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function clockMinutes(clock: string) {
  const match = clock.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function timelineX(minutes: number) { return 8 + Math.max(0, Math.min(1440, minutes)) / 1440 * 344; }
function trackY(altitude: number) { return 75 - Math.max(0, Math.min(62, altitude * .9)); }

function trackPaths(points: BenchDetail["skyTrack"]["sun"]) {
  const paths: string[] = [];
  let path = "";
  for (const point of points) {
    if (point.altitudeDegrees <= 0) {
      if (path) paths.push(path);
      path = "";
      continue;
    }
    path += `${path ? "L" : "M"}${timelineX(point.minute).toFixed(1)} ${trackY(point.altitudeDegrees).toFixed(1)} `;
  }
  if (path) paths.push(path);
  return paths;
}

function isMissing(value: string) { return /^(unbekannt|noch offen)$/i.test(value.trim()); }
function distance(value: number) { if (value < 2) return "direkt"; return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`; }
function sunDuration(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; if (!hours) return `${minutes} min`; return `${hours} h${minutes ? ` ${minutes} min` : ""}`; }
function percent(value: number | null) { return value === null ? null : `${Math.round(value)}%`; }
function meters(value: number | null) { return value === null ? null : `${Number(value.toFixed(1))} m`; }
function angle(value: number) { return `${Number(value.toFixed(1))}°`; }
function confidence(value: BenchDetail["viewConfidence"]) { return ({ hoch: "Hoh", mittel: "Mittler", niedrig: "Niedrig" } as const)[value]; }
function canopy(value: BenchDetail["canopyContext"]) { return value === null || value === "unknown" ? null : ({ none: "Freier Himmel", partial: "Unter einzelnen Bäumen", dense: "Dichtes Blätterdach" } as const)[value]; }
function direction(value: number | null) {
  if (value === null) return "Nicht erfasst";
  const names = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return `${names[Math.round(value / 45) % 8]} · ${Math.round(value)}°`;
}
function shadeCause(value: BenchDetail["shadeCause"]) { return ({ frei: "freier Himmel", nacht: "die Nacht", überdacht: "die Überdachung", gebäude: "ein Gebäude", vegetation: "Bäume und Vegetation", gelände: "das Gelände", unbekannt: "eine noch unbekannte Ursache" } as const)[value]; }
function currentLight(bench: BenchDetail) { return bench.shadeCause === "nacht" ? bench.moonVisible ? "Mondlicht über dem Platz" : "Nacht über dem Platz" : bench.sunnyNow === null ? "Die Lichtlage wird noch erkundet" : bench.sunnyNow ? "Die Bank liegt in direkter Sonne" : "Die Bank liegt im Schatten"; }
function lightSentence(bench: BenchDetail) {
  if (bench.shadeCause === "nacht") return `${bench.sunConfidence === "niedrig" ? "Im Modell waren" : "Heute waren"} ${sunDuration(bench.sunMinutesToday)} direkte Sonne möglich.`;
  if (bench.sunnyNow === null) return "Für eine sichere Aussage fehlen noch einzelne Umgebungsdaten.";
  if (bench.sunnyNow) return bench.weather && bench.weather.cloudCover > .65 ? "Geometrisch frei, doch Wolken dämpfen das Licht." : "Der Sonnenstrahl erreicht den Platz.";
  return `Der Schatten kommt wahrscheinlich durch ${shadeCause(bench.shadeCause)}.`;
}
function lightConfidenceLine(value: BenchDetail["sunConfidence"]) {
  if (value === "hoch") return "Aus Gelände, Gebäuden und Bewuchs berechnet · Wolken separat betrachtet.";
  if (value === "mittel") return "Gut angenäherte geometrische Lichtlage · Wolken separat betrachtet.";
  return "Vorläufige Schätzung · einzelne Umgebungsdaten fehlen noch.";
}
function viewTitle(bench: BenchDetail) {
  if (bench.viewLabels.includes("Bergblick")) return "Berge öffnen den Horizont";
  if (bench.viewLabels.includes("Hügelblick")) return "Hügel zeichnen die Ferne";
  if (bench.viewLabels.includes("Seeblick") || bench.viewLabels.includes("Wasserblick")) return "Wasser liegt im Blick";
  if (bench.viewLabels.includes("Eingeschränkte Aussicht")) return "Der Blick bleibt im Nahraum";
  return bench.viewScore === null ? "Der Blick wird noch erkundet" : "So weit öffnet sich der Blick";
}
function surroundingsLine(bench: BenchDetail) {
  if (bench.waterfront) return "Direkt am Wasser";
  return ({ forest: "Wald", forest_edge: "Waldrand", park: "Park", open: "Offenes Gelände", urban: "Im Ort", mixed: "Gemischte Landschaft", unknown: null } as const)[bench.landContext ?? "unknown"];
}
function precipitation(value: NonNullable<BenchDetail["weather"]>["precipitationType"]) { return ({ none: "trocken", rain: "Regen", snow: "Schnee", mixed: "Schneeregen", unknown: "Niederschlag noch unklar" } as const)[value]; }
function cloudDescription(value: number) { if (value >= .88) return "Bedeckt"; if (value >= .62) return "Stark bewölkt"; if (value >= .28) return "Wolkig"; if (value >= .1) return "Leicht bewölkt"; return "Klar"; }
function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Nicht bekannt" : new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(date);
}
