"use client";

import { useEffect, useId, useRef } from "react";
import { Accessibility, Armchair, CloudSun, Hand, RotateCcw, Star, Sun, Umbrella, X } from "lucide-react";
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
        <div><p className="filter-eyebrow">Bänkli auswählen</p><h2 id={titleId}>Was brauchst du?</h2>{activeCount > 0 && <p className="filter-count" role="status">{activeCount} Filter aktiv</p>}</div>
        <button ref={closeRef} autoFocus className="btn btn-circle btn-ghost btn-sm" aria-label="Filter schliessen" onClick={onClose}><X size={19} /></button>
      </div>
      <p className="filter-intro">Nur Angaben, die Menschen vor Ort ergänzen oder korrigieren können.</p>
      <FilterGroup label="Ausstattung am Bänkli">
        <FilterToggle active={filters.backrest === true} icon={<Armchair />} label="Rückenlehne" onClick={() => toggle("backrest")} />
        <FilterToggle active={filters.armrest === true} icon={<Hand />} label="Armlehnen" onClick={() => toggle("armrest")} />
        <FilterToggle active={filters.covered === true} icon={<Umbrella />} label="Überdacht" onClick={() => toggle("covered")} />
        <FilterToggle active={filters.wheelchair === true} icon={<Accessibility />} label="Barrierefrei" onClick={() => toggle("wheelchair")} />
      </FilterGroup>
      <FilterGroup label="Licht jetzt">
        <FilterToggle active={filters.sunnyNow === true} icon={<Sun />} label="Sonne" onClick={() => setLight(true)} />
        <FilterToggle active={filters.sunnyNow === false} icon={<CloudSun />} label="Schatten" onClick={() => setLight(false)} />
      </FilterGroup>
      <div className="filter-select-grid">
        <label className="filter-material">
          <span>Material</span>
          <select className="select min-h-11 w-full" value={filters.material ?? ""} onChange={(event) => onChange({ ...filters, material: event.target.value || undefined })}>
            <option value="">Ganz egal</option><option value="wood">Holz</option><option value="metal">Metall</option><option value="stone">Stein</option><option value="concrete">Beton</option><option value="plastic">Kunststoff</option><option value="mixed">Gemischt</option>
          </select>
        </label>
        <label className="filter-material">
          <span>Sitzplätze</span>
          <select className="select min-h-11 w-full" value={filters.minSeats ?? ""} onChange={(event) => onChange({ ...filters, minSeats: event.target.value ? Number(event.target.value) : undefined })}>
            <option value="">Ganz egal</option><option value="2">Mindestens 2</option><option value="3">Mindestens 3</option><option value="4">Mindestens 4</option><option value="6">Mindestens 6</option>
          </select>
        </label>
      </div>
      <FilterGroup label="Von Menschen bewertet">
        <FilterToggle active={(filters.minCommunityRating ?? 0) >= 4} icon={<Star />} label="Ab 4 Sternen" onClick={() => onChange({ ...filters, minCommunityRating: (filters.minCommunityRating ?? 0) >= 4 ? undefined : 4 })} />
      </FilterGroup>
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

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <fieldset className="filter-group"><legend>{label}</legend><div className="filter-choices">{children}</div></fieldset>;
}
