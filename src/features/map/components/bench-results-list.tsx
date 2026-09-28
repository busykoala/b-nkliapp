"use client";

import type { RefObject } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Armchair, ChevronRight, CloudSun, MapPin, MountainSnow, PersonStanding, Star, Sun, Telescope, Waves, X } from "lucide-react";
import type { MapBenchListItem, MapBenchListResult } from "@/lib/types";

type Props = {
  result: MapBenchListResult; loading: boolean; error: boolean; activeFilterCount: number;
  scrollRef: RefObject<HTMLOListElement | null>;
  onClose: () => void; onRetry: () => void; onZoom: () => void;
  onSelect: (item: MapBenchListItem) => void;
};

export function BenchResultsList({ result, loading, error, activeFilterCount, scrollRef, onClose, onRetry, onZoom, onSelect }: Props) {
  const t = useTranslations();
  const format = useFormatter();
  return <aside className="bench-list-panel storybook-panel" aria-label={t("map.list.title")}>
        <header><div><span className="story-eyebrow">{t("map.list.eyebrow")}</span><h2>{t("map.list.title")}</h2></div><button type="button" aria-label={t("map.list.close")} onClick={onClose}><X size={18} /></button></header>
        <p>{activeFilterCount ? t("map.list.matches", {count: activeFilterCount}) : t("map.list.intro")}</p>
        {loading && <p role="status">{t("map.list.loading")}</p>}
        {!loading && error && <p role="alert">{t("map.list.failed")} <button type="button" onClick={onRetry}>{t("map.list.retry")}</button></p>}
        {!loading && !error && result.zoomRequired && <div className="bench-list-empty"><p>{t("map.list.zoom")}</p><button type="button" onClick={onZoom}>{t("map.list.zoomAction")}</button></div>}
        {!loading && !error && !result.zoomRequired && result.items.length === 0 && <p className="bench-list-empty">{t(activeFilterCount ? "map.list.emptyFiltered" : "map.list.empty")}</p>}
        {!error && !result.zoomRequired && result.items.length > 0 && <ol ref={scrollRef}>{result.items.map((item) => <li key={item.id}><button type="button" data-bench-list-id={item.id} onClick={() => onSelect(item)}>
          <span className={`bench-list-appeal is-${item.sunnyNow === true ? "sun" : item.sunnyNow === false ? "shade" : item.viewType ?? "plain"}`} aria-hidden="true">{item.sunnyNow === true ? <Sun size={18} /> : item.sunnyNow === false ? <CloudSun size={18} /> : item.viewType === "mountain" || item.viewType === "hill" ? <MountainSnow size={18} /> : item.viewType === "lake" ? <Waves size={18} /> : item.viewType === "open" ? <Telescope size={18} /> : <MapPin size={18} />}</span>
          <span className="bench-list-distance">{item.distanceMeters >= 1000 ? t("map.list.kilometres", {distance: format.number(item.distanceMeters / 1000, {maximumFractionDigits: 1})}) : t("map.list.metres", {distance: Math.round(item.distanceMeters)})}</span>
          <strong>{item.title || t("common.values.bench")}</strong><ChevronRight className="bench-list-open" size={17} aria-hidden="true" />
          <span className="bench-list-evidence">
            {item.backrest === true && <small><Armchair size={14} />{t("bench.attributes.backrest")}</small>}
            {item.wheelchair === true && <small><PersonStanding size={14} />{t("bench.attributes.wheelchair")}</small>}
            {item.sunnyNow !== null && <small>{item.sunnyNow ? <Sun size={14} /> : <CloudSun size={14} />}{t(item.sunnyNow ? "bench.summary.sun" : "bench.summary.shade")}</small>}
            {item.rating !== null && <small><Star size={14} />{t("map.list.rating", {rating: format.number(item.rating, {maximumFractionDigits: 1}), count: item.ratingCount})}</small>}

          </span>
        </button></li>)}</ol>}
        <small className="bench-list-note">{t("map.list.distanceNote")}</small>
      </aside>;
}
