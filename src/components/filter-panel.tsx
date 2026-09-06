"use client";

import { useEffect, useId, useRef } from "react";
import { Accessibility, Armchair, CloudSun, Eye, Flame, Hand, Leaf, Mountain, MountainSnow, RotateCcw, Sun, Trash2, Trees, Umbrella, Waves, X } from "lucide-react";
import { activeMapFilterCount } from "@/lib/map-filters";
import type { MapFilters } from "@/lib/types";

type Props = { filters: MapFilters; onChange: (filters: MapFilters) => void; onClose: () => void };

export function FilterPanel({ filters, onChange, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const activeCount = activeMapFilterCount(filters);
  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), summary, input:not([disabled])') ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKey);
      window.setTimeout(() => document.querySelector<HTMLButtonElement>('[aria-label="Menü öffnen"]')?.focus(), 0);
    };
  }, []);
  const toggle = (key: keyof MapFilters) => onChange({ ...filters, [key]: filters[key] === true ? undefined : true });
  const setLight = (sunny: boolean) => onChange({ ...filters, sunnyNow: filters.sunnyNow === sunny ? undefined : sunny });
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="calm-filter-panel safe-bottom absolute inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-6rem)] overflow-y-auto p-4 md:bottom-auto md:left-4 md:right-auto md:top-20 md:w-[23rem]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><p className="filter-eyebrow">Bänkli auswählen</p><h2 id={titleId}>Was passt gerade?</h2>{activeCount > 0 && <p className="filter-count" role="status">{activeCount} Filter aktiv</p>}</div>
        <button ref={closeRef} autoFocus className="btn btn-circle btn-ghost btn-sm" aria-label="Filter schliessen" onClick={onClose}><X size={19} /></button>
      </div>
      <FilterGroup label="Licht jetzt">
        <FilterToggle active={filters.sunnyNow === true} icon={<Sun />} label="Sonne" onClick={() => setLight(true)} />
        <FilterToggle active={filters.sunnyNow === false} icon={<CloudSun />} label="Schatten" onClick={() => setLight(false)} />
      </FilterGroup>
      <FilterGroup label="Das ist mir wichtig">
        <ViewToggle active={filters.viewType === "lake"} icon={<Waves />} label="Am Wasser" onClick={() => onChange({ ...filters, viewType: filters.viewType === "lake" ? undefined : "lake" })} />
        <FilterToggle active={(filters.minViewScore ?? 0) >= 4} icon={<Eye />} label="Weite Sicht" onClick={() => onChange({ ...filters, minViewScore: (filters.minViewScore ?? 0) >= 4 ? undefined : 4 })} />
        <FilterToggle active={filters.backrest === true} icon={<Armchair />} label="Mit Lehne" onClick={() => toggle("backrest")} />
        <FilterToggle active={filters.wheelchair === true} icon={<Accessibility />} label="Rollstuhlgängig" onClick={() => toggle("wheelchair")} />
      </FilterGroup>
      <details className="filter-more">
        <summary>Weitere Wünsche</summary>
        <div>
          <FilterGroup label="Komfort">
            <FilterToggle active={filters.covered === true} icon={<Umbrella />} label="Überdacht" onClick={() => toggle("covered")} />
            <FilterToggle active={filters.armrest === true} icon={<Hand />} label="Armlehnen" onClick={() => toggle("armrest")} />
          </FilterGroup>
          <FilterGroup label="Umgebung">
            <ViewToggle active={filters.viewType === "mountain"} icon={<MountainSnow />} label="Berge" onClick={() => onChange({ ...filters, viewType: filters.viewType === "mountain" ? undefined : "mountain" })} />
            <ViewToggle active={filters.viewType === "hill"} icon={<Mountain />} label="Hügel" onClick={() => onChange({ ...filters, viewType: filters.viewType === "hill" ? undefined : "hill" })} />
            <FilterToggle active={filters.environment === "forest"} icon={<Trees />} label="Wald" onClick={() => onChange({ ...filters, environment: filters.environment === "forest" ? undefined : "forest" })} />
            <FilterToggle active={filters.environment === "open"} icon={<Leaf />} label="Freies Gelände" onClick={() => onChange({ ...filters, environment: filters.environment === "open" ? undefined : "open" })} />
          </FilterGroup>
          <FilterGroup label="Praktisch in der Nähe">
            <FilterToggle active={filters.nearFireplace === true} icon={<Flame />} label="Feuerstelle nah" onClick={() => toggle("nearFireplace")} />
            <FilterToggle active={filters.nearWasteBasket === true} icon={<Trash2 />} label="Abfalleimer nah" onClick={() => toggle("nearWasteBasket")} />
          </FilterGroup>
          <label className="filter-material">
            <span>Material</span>
            <select className="select min-h-11 w-full" value={filters.material ?? ""} onChange={(event) => onChange({ ...filters, material: event.target.value || undefined })}>
              <option value="">Ganz egal</option><option value="wood">Holz</option><option value="metal">Metall</option><option value="stone">Stein</option><option value="concrete">Beton</option>
            </select>
          </label>
        </div>
      </details>
      <div className="filter-actions">
        <button className="clear-filters" disabled={activeCount === 0} onClick={() => onChange({})}><RotateCcw size={15} /> Auswahl löschen</button>
        <button className="filter-done" onClick={onClose}>Karte ansehen</button>
      </div>
    </div>
  );
}

function FilterToggle({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" aria-pressed={active} className="filter-token" onClick={onClick}>{icon}<span>{label}</span></button>;
}
const ViewToggle = FilterToggle;

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <fieldset className="filter-group"><legend>{label}</legend><div className="filter-choices">{children}</div></fieldset>;
}
