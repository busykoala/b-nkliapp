"use client";

import { useId } from "react";
import { Armchair, ChevronDown, CloudSun, MountainSnow, Sun } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { BenchPanel } from "./bench-panel";
import { LightPanel } from "./light-panel";
import { ViewPanel } from "./view-panel";
import { WeatherPanel } from "./weather-panel";

export function BenchDetails({ bench, signedIn = false, onChanged }: { bench: BenchDetail; signedIn?: boolean; onChanged?: () => void | Promise<void> }) {
  const id = useId();
  const known = bench.properties.filter((item) => !/^(unbekannt|noch offen)$/i.test(item.value));
  const chapters = [
    { key: "bench", title: "Bank", icon: Armchair, summary: known.slice(0, 2).map((item) => `${item.label}: ${item.value}`).join(" · ") || "Ausstattung noch offen", content: <BenchPanel bench={bench} signedIn={signedIn} onChanged={onChanged} /> },
    { key: "light", title: "Licht", icon: Sun, summary: bench.dayPhase === "night" ? "Jetzt ist Nacht" : bench.sunnyNow === null ? "Lichtlage noch offen" : `${bench.sunnyNow ? "Sonne" : "Schatten"} · geschätzt`, content: <LightPanel bench={bench} /> },
    { key: "view", title: "Aussicht", icon: MountainSnow, summary: bench.viewLabels.join(" · ") || "Der Blick wird noch erkundet", content: <ViewPanel bench={bench} /> },
    { key: "weather", title: "Wetter", icon: CloudSun, summary: bench.weather ? `${Math.round(bench.weather.temperatureC)} °C · Prognose` : "Wetterdaten noch offen", content: <WeatherPanel bench={bench} /> },
  ];
  return <section className="quiet-details detail-disclosures" aria-label="Details">
    {chapters.map(({ key, title, icon: Icon, summary, content }) => <details key={key} name={`bench-details-${id}`}>
      <summary><Icon size={20} /><span><strong>{title}</strong><small>{summary}</small></span><ChevronDown className="disclosure-chevron" size={18} /></summary>
      <div className="detail-panel-frame">{content}</div>
    </details>)}
  </section>;
}
