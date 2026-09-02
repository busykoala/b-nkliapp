"use client";

import { Accessibility, Armchair, Check, Eye, Leaf, MountainSnow, RotateCcw, Sun, Trees, Umbrella, Waves } from "lucide-react";
import type { MapFilters } from "@/lib/types";

type Props = { filters: MapFilters; onChange: (filters: MapFilters) => void; onClose: () => void };

export function FilterPanel({ filters, onChange, onClose }: Props) {
  const toggle = (key: keyof MapFilters) => onChange({ ...filters, [key]: filters[key] === true ? undefined : true });
  return (
    <div role="dialog" aria-label="Bänke filtern" className="calm-filter-panel safe-bottom absolute inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-6rem)] overflow-y-auto p-4 md:bottom-auto md:left-4 md:right-auto md:top-20 md:w-[23rem]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2>Was passt gerade?</h2>
        <button className="btn btn-circle btn-ghost btn-sm" aria-label="Filter schliessen" onClick={onClose}><Check size={19} /></button>
      </div>
      <div className="filter-choices">
        <FilterToggle active={filters.sunnyNow === true} icon={<Sun />} label="Sonne" onClick={() => toggle("sunnyNow")} />
        <FilterToggle active={(filters.minViewScore ?? 0) >= 4} icon={<Eye />} label="Weite Sicht" onClick={() => onChange({ ...filters, minViewScore: (filters.minViewScore ?? 0) >= 4 ? undefined : 4 })} />
        <FilterToggle active={filters.backrest === true} icon={<Armchair />} label="Rückenlehne" onClick={() => toggle("backrest")} />
        <FilterToggle active={filters.wheelchair === true} icon={<Accessibility />} label="Zugänglich" onClick={() => toggle("wheelchair")} />
      </div>
      <details className="filter-more">
        <summary>Mehr auswählen</summary>
        <div>
          <div className="filter-choices">
            <FilterToggle active={filters.covered === true} icon={<Umbrella />} label="Überdacht" onClick={() => toggle("covered")} />
            <ViewToggle active={filters.viewType === "mountain"} icon={<MountainSnow />} label="Berge" onClick={() => onChange({ ...filters, viewType: filters.viewType === "mountain" ? undefined : "mountain" })} />
            <ViewToggle active={filters.viewType === "lake"} icon={<Waves />} label="Wasser" onClick={() => onChange({ ...filters, viewType: filters.viewType === "lake" ? undefined : "lake" })} />
            <ViewToggle active={filters.viewType === "open"} icon={<Eye />} label="Weitsicht" onClick={() => onChange({ ...filters, viewType: filters.viewType === "open" ? undefined : "open" })} />
            <FilterToggle active={filters.environment === "forest"} icon={<Trees />} label="Wald" onClick={() => onChange({ ...filters, environment: filters.environment === "forest" ? undefined : "forest" })} />
            <FilterToggle active={filters.environment === "open"} icon={<Leaf />} label="Offen" onClick={() => onChange({ ...filters, environment: filters.environment === "open" ? undefined : "open" })} />
          </div>
          <label className="filter-material">
            <span>Material</span>
            <select className="select min-h-11 w-full" value={filters.material ?? ""} onChange={(event) => onChange({ ...filters, material: event.target.value || undefined })}>
              <option value="">Ganz egal</option><option value="wood">Holz</option><option value="metal">Metall</option><option value="stone">Stein</option><option value="concrete">Beton</option>
            </select>
          </label>
        </div>
      </details>
      <button className="clear-filters" onClick={() => onChange({})}><RotateCcw size={15} /> Auswahl löschen</button>
    </div>
  );
}

function FilterToggle({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className="filter-token" onClick={onClick}>{icon}<span>{label}</span></button>;
}
const ViewToggle = FilterToggle;
