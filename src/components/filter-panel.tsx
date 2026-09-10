"use client";
import { useTranslations } from "next-intl";

import { useEffect, useId, useRef } from "react";
import { Accessibility, Armchair, CloudSun, Flame, Hand, RotateCcw, Star, Sun, Trash2, Umbrella, X } from "lucide-react";
import { activeMapFilterCount } from "@/lib/map-filters";
import type { MapFilters } from "@/lib/types";

type Props = { filters: MapFilters; onChange: (filters: MapFilters) => void; onClose: () => void };

export function FilterPanel({ filters, onChange, onClose }: Props) {
  const t = useTranslations();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const activeCount = activeMapFilterCount(filters);
  useEffect(() => {
    // A closing native menu dialog restores focus to its trigger after the
    // filter has mounted. Focus once that browser restoration has settled.
    const focusTimer = window.setTimeout(() => {
      // Keep the user's focus if they already started navigating the filter.
      if (!panelRef.current?.contains(document.activeElement)) closeRef.current?.focus();
    }, 60);
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
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKey);
      window.setTimeout(() => document.querySelector<HTMLButtonElement>('#map-filter-toggle')?.focus(), 0);
    };
  }, []);
  const toggle = (key: keyof MapFilters) => onChange({ ...filters, [key]: filters[key] === true ? undefined : true });
  const setLight = (sunny: boolean) => onChange({ ...filters, sunnyNow: filters.sunnyNow === sunny ? undefined : sunny });
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="calm-filter-panel safe-bottom absolute inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-6rem)] overflow-y-auto p-4 md:bottom-auto md:left-4 md:right-auto md:top-20 md:w-[23rem]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><p className="filter-eyebrow">{t("map.filters.eyebrow")}</p><h2 id={titleId}>{t("map.filters.title")}</h2>{activeCount > 0 && <p className="filter-count" role="status">{t("map.filters.count", { count: activeCount })}</p>}</div>
        <button ref={closeRef} autoFocus className="btn btn-circle btn-ghost btn-sm" aria-label={t("map.filters.close")} onClick={onClose}><X size={19} /></button>
      </div>
      <p className="filter-intro">{t("map.filters.intro")}</p>
      <FilterGroup label={t("map.filters.pause")}>
        <FilterToggle active={filters.backrest === true} icon={<Armchair />} label={t("bench.attributes.backrest")} onClick={() => toggle("backrest")} />
        <FilterToggle active={filters.covered === true} icon={<Umbrella />} label={t("bench.attributes.covered")} onClick={() => toggle("covered")} />
        <FilterToggle active={filters.fireplaceNearby === true} icon={<Flame />} label={t("map.filters.fireplace")} onClick={() => toggle("fireplaceNearby")} />
        <FilterToggle active={filters.wasteBasketNearby === true} icon={<Trash2 />} label={t("map.filters.bin")} onClick={() => toggle("wasteBasketNearby")} />
      </FilterGroup>
      <FilterGroup label={t("map.filters.light")}>
        <FilterToggle active={filters.sunnyNow === true} icon={<Sun />} label={t("map.filters.sun")} onClick={() => setLight(true)} />
        <FilterToggle active={filters.sunnyNow === false} icon={<CloudSun />} label={t("map.filters.shade")} onClick={() => setLight(false)} />
      </FilterGroup>
      <details className="filter-more">
        <summary>{t("map.filters.more")}</summary>
        <FilterGroup label={t("map.filters.access")}>
          <FilterToggle active={filters.armrest === true} icon={<Hand />} label={t("bench.attributes.armrest")} onClick={() => toggle("armrest")} />
          <FilterToggle active={filters.wheelchair === true} icon={<Accessibility />} label={t("bench.attributes.wheelchair")} onClick={() => toggle("wheelchair")} />
        </FilterGroup>
        <p className="filter-intro">{t("map.filters.accessNote")}</p>
        <div className="filter-select-grid">
          <label className="filter-material">
            <span>{t("bench.attributes.material")}</span>
            <select className="select min-h-11 w-full" value={filters.material ?? ""} onChange={(event) => onChange({ ...filters, material: event.target.value || undefined })}>
              <option value="">{t("map.filters.anyMaterial")}</option><option value="wood">{t("bench.materials.wood")}</option><option value="metal">{t("bench.materials.metal")}</option><option value="stone">{t("bench.materials.stone")}</option><option value="concrete">{t("bench.materials.concrete")}</option><option value="plastic">{t("bench.materials.plastic")}</option><option value="mixed">{t("bench.materials.mixed")}</option>
            </select>
          </label>
          <label className="filter-material">
            <span>{t("map.filters.roomFor")}</span>
            <select className="select min-h-11 w-full" value={filters.minSeats ?? ""} onChange={(event) => onChange({ ...filters, minSeats: event.target.value ? Number(event.target.value) : undefined })}>
              <option value="">{t("map.filters.anySeats")}</option><option value="2">{t("map.filters.minimumSeats", { count: 2 })}</option><option value="3">{t("map.filters.minimumSeats", { count: 3 })}</option><option value="4">{t("map.filters.minimumSeats", { count: 4 })}</option><option value="6">{t("map.filters.minimumSeats", { count: 6 })}</option>
            </select>
          </label>
        </div>
        <FilterGroup label={t("map.filters.rated")}>
          <FilterToggle active={(filters.minCommunityRating ?? 0) >= 4} icon={<Star />} label={t("map.filters.fourStars")} onClick={() => onChange({ ...filters, minCommunityRating: (filters.minCommunityRating ?? 0) >= 4 ? undefined : 4 })} />
        </FilterGroup>
      </details>
      <div className="filter-actions">
        <button className="clear-filters" disabled={activeCount === 0} onClick={() => onChange({})}><RotateCcw size={15} /> {t("map.filters.clear")}</button>
        <button className="filter-done" onClick={onClose}>{t("map.filters.done")}</button>
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
