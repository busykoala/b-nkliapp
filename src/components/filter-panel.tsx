"use client";

import { Accessibility, Armchair, Check, Eye, Leaf, MountainSnow, RotateCcw, SlidersHorizontal, Sun, Telescope, Trees, Umbrella, Waves } from "lucide-react";
import type { MapFilters } from "@/lib/types";

type Props = { filters: MapFilters; onChange: (filters: MapFilters) => void; onClose: () => void };

export function FilterPanel({ filters, onChange, onClose }: Props) {
  const toggle = (key: keyof MapFilters) => onChange({ ...filters, [key]: filters[key] === true ? undefined : true });
  return (
    <div role="dialog" aria-label="Bänke filtern" className="storybook-panel safe-bottom absolute inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-[1.75rem] p-4 md:bottom-auto md:left-4 md:right-auto md:top-20 md:w-[25rem]">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <div className="story-eyebrow flex items-center gap-1.5"><SlidersHorizontal size={13} /> Dein Lieblingsplatz</div>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.03em]">Was wünschst du dir?</h2>
        </div>
        <button className="btn btn-circle btn-ghost btn-sm" aria-label="Filter schliessen" onClick={onClose}><Check size={19} /></button>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-base-content/60">Ein sonniger Zwischenhalt, Aussicht auf die Berge oder einfach bequem sitzen.</p>
      <div className="grid grid-cols-2 gap-2.5">
        <FilterToggle active={filters.sunnyNow === true} icon={<Sun />} label="Jetzt sonnig" hint="Licht geniessen" onClick={() => toggle("sunnyNow")} />
        <FilterToggle active={(filters.minViewScore ?? 0) >= 4} icon={<Telescope />} label="Schöne Aussicht" hint="Weit schauen" onClick={() => onChange({ ...filters, minViewScore: (filters.minViewScore ?? 0) >= 4 ? undefined : 4 })} />
        <FilterToggle active={filters.backrest === true} icon={<Armchair />} label="Rückenlehne" onClick={() => toggle("backrest")} />
        <FilterToggle active={filters.wheelchair === true} icon={<Accessibility />} label="Rollstuhlgerecht" onClick={() => toggle("wheelchair")} />
      </div>
      <details className="collapse-arrow collapse story-card mt-3">
        <summary className="collapse-title min-h-12 py-3 font-bold">Noch genauer wählen</summary>
        <div className="collapse-content">
          <div className="grid grid-cols-2 gap-2.5">
            <FilterToggle active={filters.covered === true} icon={<Umbrella />} label="Überdacht" onClick={() => toggle("covered")} />
            <FilterToggle active={filters.environment === "forest"} icon={<Trees />} label="Im Wald" onClick={() => onChange({ ...filters, environment: filters.environment === "forest" ? undefined : "forest" })} />
            <FilterToggle active={filters.environment === "open"} icon={<Leaf />} label="Im Freien" onClick={() => onChange({ ...filters, environment: filters.environment === "open" ? undefined : "open" })} />
          </div>
          <div className="mb-2 mt-4 flex items-center gap-2 font-bold"><Telescope size={17} /> Was möchtest du sehen?</div>
          <div className="grid grid-cols-2 gap-2.5">
            <ViewToggle active={filters.viewType === "mountain"} icon={<MountainSnow />} label="Berge" onClick={() => onChange({ ...filters, viewType: filters.viewType === "mountain" ? undefined : "mountain" })} />
            <ViewToggle active={filters.viewType === "lake"} icon={<Waves />} label="Wasser" onClick={() => onChange({ ...filters, viewType: filters.viewType === "lake" ? undefined : "lake" })} />
            <ViewToggle active={filters.viewType === "open"} icon={<Eye />} label="Weitsicht" onClick={() => onChange({ ...filters, viewType: filters.viewType === "open" ? undefined : "open" })} />
          </div>
          <label className="form-control mt-4 block">
            <span className="label mb-1 font-bold">Material der Bank</span>
            <select className="select story-card min-h-11 w-full" value={filters.material ?? ""} onChange={(event) => onChange({ ...filters, material: event.target.value || undefined })}>
              <option value="">Ganz egal</option><option value="wood">Holz</option><option value="metal">Metall</option><option value="stone">Stein</option><option value="concrete">Beton</option>
            </select>
          </label>
        </div>
      </details>
      <button className="btn btn-ghost mt-3 min-h-11 w-full text-base-content/60" onClick={() => onChange({})}><RotateCcw size={16} /> Auswahl löschen</button>
    </div>
  );
}

function FilterToggle({ active, icon, label, hint, onClick }: { active: boolean; icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return <button aria-pressed={active} className="choice-card story-card flex min-h-[4rem] items-center gap-2 px-2.5 py-2 text-left" onClick={onClick}><span className="story-icon h-9 w-9 [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span><span className="min-w-0"><span className="block text-[13px] font-bold leading-tight">{label}</span>{hint && <span className="mt-0.5 block text-[10px] leading-tight opacity-55">{hint}</span>}</span></button>;
}
const ViewToggle = FilterToggle;
