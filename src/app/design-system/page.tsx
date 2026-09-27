import { notFound } from "next/navigation";
import { AlertTriangle, Bookmark, Check, HelpCircle } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { WeatherSummary } from "@/components/weather-summary";
import { WeatherPanel } from "@/features/bench-detail/weather-panel";
import { AccessPanel } from "@/features/bench-detail/access-panel";

const baseWeather: NonNullable<BenchDetail["weather"]> = {
  temperatureC: 8,
  precipitationMm10: 0,
  precipitationRateMmH: 0,
  precipitationType: "none",
  sunshineMinutes10: 5,
  windKmh: 9,
  humidityPercent: 62,
  globalRadiationWm2: 280,
  cloudCover: 0,
  cloudLow: 0,
  cloudMid: 0,
  cloudHigh: 0,
  snowCoverPercent: 0,
  snowDepthCm: 0,
  snowfallLimitMeters: 1800,
  location: "Testort",
  observedAt: "2026-01-15T12:00:00+01:00",
  source: "MeteoSchweiz",
};

const presets: Array<[string, BenchDetail["dayPhase"], NonNullable<BenchDetail["weather"]>]> = [
  ["Klar", "day", baseWeather],
  ["Bewölkt", "day", { ...baseWeather, cloudCover: .66, sunshineMinutes10: 1 }],
  ["Regen", "day", { ...baseWeather, cloudCover: .92, precipitationType: "rain", precipitationRateMmH: 2.4 }],
  ["Schnee", "day", { ...baseWeather, temperatureC: -3, cloudCover: .94, precipitationType: "snow", precipitationRateMmH: 1.1, snowDepthCm: 14 }],
  ["Gemischt", "dusk", { ...baseWeather, temperatureC: 1, cloudCover: .88, precipitationType: "mixed", precipitationRateMmH: .8 }],
  ["Nacht", "night", { ...baseWeather, temperatureC: 4, cloudCover: .04, globalRadiationWm2: 0 }],
  ["Wolken unbekannt", "night", { ...baseWeather, cloudCover: null, cloudLow: null, cloudMid: null, cloudHigh: null }],
];

const accessFixture: Pick<BenchDetail, "properties" | "knowledge"> = {
  properties: [{key: "wheelchair", label: "Level space", value: "Ja", canonicalValue: true, evidenceState: "known", source: "OpenStreetMap"}],
  knowledge: {
    attributes: [], geography: null, amenities: [], noise: [], completeness: [], question: null,
    approach: {lengthMeters: 84, maximumSlopePercent: 12.5, averageSlopePercent: 5.2, elevationGainMeters: 7, steps: false, surface: "compacted", smoothness: "intermediate", widthMeters: 1.4, stepFreePossible: true, confidence: "medium", sampleCoverage: {sampled: 7, expected: 9}},
  },
};

export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main className="design-system-gallery">
    <header><small>Development gallery</small><h1>Bänkli watercolor system</h1><p>Deterministische Zustände zum Prüfen von Sprache, Kontrast und Hierarchie.</p></header>
    <section><h2>Farben</h2><div className="design-token-grid">{[
      ["Papier", "paper"], ["Fläche", "surface"], ["Tinte", "ink"], ["Aktion", "action"], ["Salbei", "sage-wash"], ["Himmel", "sky-wash"], ["Hinweis", "caution-text"], ["Gefahr", "danger-text"],
    ].map(([label, token]) => <figure key={token}><i style={{ background: `var(--color-${token})` }} /><figcaption>{label}<code>--color-{token}</code></figcaption></figure>)}</div></section>
    <section><h2>Typografie</h2><div className="design-type-sample"><h3>Lora für einen ruhigen Ortsnamen</h3><p>Source Sans 3 trägt verständliche Hinweise, Fakten und Handlungen in allen unterstützten Sprachen.</p><small>Unbekannte Daten bleiben ausdrücklich unbekannt.</small></div></section>
    <section><h2>Aktionen und Zustände</h2><div className="design-control-row"><button className="design-primary"><Check /> Weg planen</button><button className="design-secondary"><Bookmark /> Merken</button><span><HelpCircle /> Unbekannt</span><span className="is-caution"><AlertTriangle /> Teilweise geprüft</span></div></section>
    <section><h2>Wetterbedingungen</h2><div className="design-condition-grid">{presets.map(([label, phase, weather]) => <article key={label}><h3>{label}</h3><WeatherSummary weather={weather} dayPhase={phase} variant="illustrated" /></article>)}</div></section>
    <section><h2>Wetter-Messinstrumente</h2><div className="design-weather-panel"><WeatherPanel bench={{dayPhase: "day", weather: {...baseWeather, cloudCover: .82, precipitationType: "rain", precipitationRateMmH: 2.4, windKmh: 31, humidityPercent: 87, snowDepthCm: 14}}} /></div></section>
    <section><h2>Zugangsprofil</h2><div className="design-weather-panel"><AccessPanel bench={accessFixture} /></div></section>
  </main>;
}
