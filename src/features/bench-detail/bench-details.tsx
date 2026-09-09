"use client";

import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Armchair, CloudSun, MountainSnow, Sun } from "lucide-react";
import type { BenchDetail } from "@/lib/types";
import { BenchPanel } from "./bench-panel";
import { LightPanel } from "./light-panel";
import { ViewPanel } from "./view-panel";
import { WeatherPanel } from "./weather-panel";

type DetailPanel = "bench" | "light" | "view" | "weather";

const panels: Array<{ id: DetailPanel; label: string; icon: ReactNode }> = [
  { id: "bench", label: "Bank", icon: <Armchair size={18} /> },
  { id: "light", label: "Licht", icon: <Sun size={18} /> },
  { id: "view", label: "Aussicht", icon: <MountainSnow size={18} /> },
  { id: "weather", label: "Wetter", icon: <CloudSun size={18} /> },
];

export function BenchDetails({ bench, signedIn = false, onChanged }: { bench: BenchDetail; signedIn?: boolean; onChanged?: () => void | Promise<void> }) {
  const [activePanel, setActivePanel] = useState<DetailPanel>("bench");
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const showPanel = (panel: DetailPanel) => {
    setActivePanel(panel);
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "start" }));
  };
  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? panels.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + panels.length) % panels.length;
    showPanel(panels[nextIndex].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  };

  return <section className="quiet-details" aria-label="Details">
    <div className="detail-chapters">
      <div className="detail-tabs" role="tablist" aria-label="Detailkapitel">
        {panels.map((panel, index) => <button
          key={panel.id}
          id={`${id}-${panel.id}-tab`}
          type="button"
          role="tab"
          aria-selected={activePanel === panel.id}
          aria-controls={`${id}-${panel.id}-panel`}
          tabIndex={activePanel === panel.id ? 0 : -1}
          onClick={() => showPanel(panel.id)}
          onKeyDown={(event) => moveTab(event, index)}
        >{panel.icon}<span>{panel.label}</span></button>)}
      </div>
      <div ref={panelRef} className="detail-panel-frame" id={`${id}-${activePanel}-panel`} role="tabpanel" aria-labelledby={`${id}-${activePanel}-tab`}>
        {activePanel === "bench" && <BenchPanel bench={bench} signedIn={signedIn} onChanged={onChanged} />}
        {activePanel === "light" && <LightPanel bench={bench} />}
        {activePanel === "view" && <ViewPanel bench={bench} />}
        {activePanel === "weather" && <WeatherPanel bench={bench} />}
      </div>
    </div>
  </section>;
}
