"use client";

import { Accessibility, Armchair, Check, Eye, Leaf, MountainSnow, Sun, Telescope, Trees, Umbrella, Waves } from "lucide-react";
import type { MapFilters } from "@/lib/types";

type Props = { filters: MapFilters; onChange: (filters: MapFilters) => void; onClose: () => void };

export function FilterPanel({ filters, onChange, onClose }: Props) {
  const toggle = (key: keyof MapFilters) => onChange({ ...filters, [key]: filters[key] === true ? undefined : true });
  return (
    <div role="dialog" aria-label="Bänke filtern" className="safe-top absolute inset-x-3 top-16 z-30 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-box border border-base-300 bg-base-100 p-4 shadow-2xl md:left-4 md:right-auto md:w-96">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">Bänke filtern</h2>
        <button className="btn btn-sm btn-ghost min-h-11" onClick={onClose}>Fertig <Check size={18} /></button>
      </div>
      <p className="mb-3 text-sm opacity-65">Wähle nur, was für deinen nächsten Sitzplatz wirklich zählt.</p>
      <div className="grid grid-cols-2 gap-2">
        <FilterToggle active={filters.sunnyNow === true} icon={<Sun />} label="Wahrsch. Sonne" onClick={() => toggle("sunnyNow")} />
        <FilterToggle active={(filters.minViewScore ?? 0) >= 4} icon={<Telescope />} label="Gute Aussicht" onClick={() => onChange({ ...filters, minViewScore: (filters.minViewScore ?? 0) >= 4 ? undefined : 4 })} />
        <FilterToggle active={filters.backrest === true} icon={<Armchair />} label="Rückenlehne" onClick={() => toggle("backrest")} />
        <FilterToggle active={filters.wheelchair === true} icon={<Accessibility />} label="Rollstuhlgerecht" onClick={() => toggle("wheelchair")} />
      </div>
      <details className="collapse-arrow collapse mt-3 rounded-xl border border-base-300 bg-base-100">
        <summary className="collapse-title min-h-12 py-3 font-semibold">Weitere Filter</summary>
        <div className="collapse-content">
          <div className="grid grid-cols-2 gap-2">
            <FilterToggle active={filters.covered === true} icon={<Umbrella />} label="Überdacht" onClick={() => toggle("covered")} />
            <FilterToggle active={filters.environment === "forest"} icon={<Trees />} label="Im Wald" onClick={() => onChange({ ...filters, environment: filters.environment === "forest" ? undefined : "forest" })} />
            <FilterToggle active={filters.environment === "open"} icon={<Leaf />} label="Offenes Gelände" onClick={() => onChange({ ...filters, environment: filters.environment === "open" ? undefined : "open" })} />
          </div>
          <div className="mb-2 mt-4 flex items-center gap-2 font-semibold"><Telescope size={17} /> Aussichtstyp</div>
          <div className="grid grid-cols-2 gap-2">
            <ViewToggle active={filters.viewType === "mountain"} icon={<MountainSnow />} label="Berge" onClick={() => onChange({ ...filters, viewType: filters.viewType === "mountain" ? undefined : "mountain" })} />
            <ViewToggle active={filters.viewType === "lake"} icon={<Waves />} label="See/Wasser" onClick={() => onChange({ ...filters, viewType: filters.viewType === "lake" ? undefined : "lake" })} />
            <ViewToggle active={filters.viewType === "open"} icon={<Eye />} label="Weitsicht" onClick={() => onChange({ ...filters, viewType: filters.viewType === "open" ? undefined : "open" })} />
          </div>
          <label className="form-control mt-4 block">
            <span className="label mb-1 font-semibold">Material</span>
            <select className="select select-bordered min-h-11 w-full" value={filters.material ?? ""} onChange={(event) => onChange({ ...filters, material: event.target.value || undefined })}>
              <option value="">Alle</option><option value="wood">Holz</option><option value="metal">Metall</option><option value="stone">Stein</option><option value="concrete">Beton</option>
            </select>
          </label>
        </div>
      </details>
      <button className="btn btn-ghost mt-3 min-h-11 w-full" onClick={() => onChange({})}>Alle Filter zurücksetzen</button>
    </div>
  );
}

function FilterToggle({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className={`btn min-h-12 justify-start ${active ? "btn-primary" : "btn-outline border-base-300"}`} onClick={onClick}>{icon}<span className="truncate">{label}</span></button>;
}
const ViewToggle = FilterToggle;
