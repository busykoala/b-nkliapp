"use client";
import { pointLabel } from "@/i18n/point-label";
import { useFormatter, useTranslations } from "next-intl";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Accessibility, Armchair, CloudSun, Crosshair, Footprints, Info, List, SlidersHorizontal, Star, Sun, X } from "lucide-react";
import type { ReturnJourney } from "@/lib/journey";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getBenchDetail, getMapBenchList, getMapFeatures } from "@/app/actions/map";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail, MapBenchListResult, MapFeature, MapFilters, MapQuery, PlaceResult } from "@/lib/types";
import { activeMapFilterCount, activeMapFilters } from "@/lib/map-filters";
import { BenchSheet } from "./bench-sheet";
import { FilterPanel } from "./filter-panel";
import { SearchBox } from "./search-box";
import { AddBenchDialog } from "./add-bench-dialog";
import { AppMenu } from "./app-menu";
import { AccountDialog } from "./account-controls";
import { CORE_MAP_ART, DECORATIVE_MAP_ART, TRANSIT_MAP_ART, loadWatercolorMapStyle, MINIMAL_MAP_STYLE } from "@/lib/watercolor-map";
import { featureCollection, selectedBenchFeature, loadMapArt, addDecorativeMapLayers, addPainterlyVectorLayers, addTransitLayers, addCoreArtLayers, addCoreMapLayers, applyMapAtmosphere, clusterExpansionZoom, showUserPosition, type UserPosition } from "@/lib/map-renderer";

const WalkPlanner = dynamic(() => import("./walks/walk-planner").then((m) => m.WalkPlanner), { ssr: false, loading: WalkLoading });
const JourneyPlanner = dynamic(() => import("./journey/journey-planner").then((m) => m.JourneyPlanner), {
  ssr: false, loading: JourneyLoading,
});

function WalkLoading() {
  const t = useTranslations("map.loading");
  return <aside className="journey-panel storybook-panel" role="status">{t("walk")}</aside>;
}
function JourneyLoading() {
  const t = useTranslations("map.loading");
  return <aside className="journey-panel storybook-panel" role="status">{t("journey")}</aside>;
}

function visibleMapQuery(map: MapLibreMap, filters: MapFilters): MapQuery {
  const bounds = map.getBounds();
  return { bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, zoom: map.getZoom(), filters };
}

export function MapExplorer({ user }: { user: CurrentUser | null }) {
  const t = useTranslations();
  const format = useFormatter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const querySequence = useRef(0);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const featuresRef = useRef<MapFeature[]>([]);
  const pendingPosition = useRef<UserPosition | null>(null);
  const openedFromUrl = useRef<string | null>(null);
  const filtersRef = useRef<MapFilters>({});
  const listOpenRef = useRef(false);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [filters, setFilters] = useState<MapFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listResult, setListResult] = useState<MapBenchListResult>({ items: [], zoomRequired: true });
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bench, setBench] = useState<BenchDetail | null>(null);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [walkOpen, setWalkOpen] = useState(false);
  const [returnJourney, setReturnJourney] = useState<ReturnJourney | null>(null);
  const getJourneyMap = useCallback(() => mapRef.current, []);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [addStage, setAddStage] = useState<"position" | "details" | null>(null);
  const [createdBenchId, setCreatedBenchId] = useState<string | null>(null);
  const placingRef = useRef(false);
  const canAdd = useRef(Boolean(user));
  const pendingAdd = useRef<{ latitude: number; longitude: number } | null>(null);
  const addAccount = useRef<HTMLDialogElement>(null);
  const handledAction = useRef<string | null>(null);
  useEffect(() => { canAdd.current = Boolean(user); }, [user]);
  const [addCoordinates, setAddCoordinates] = useState({ latitude: 46.82, longitude: 8.25 });

  const loadVisible = useCallback(async (map: MapLibreMap, nextFilters: MapFilters) => {
    const sequence = ++querySequence.current;
    try {
      const result = await getMapFeatures(visibleMapQuery(map, nextFilters));
      if (sequence === querySequence.current) {
        featuresRef.current = result;
        setFeatures(result);
        (map.getSource("benchly") as GeoJSONSource | undefined)?.setData(featureCollection(result));
        setMessage((current) => current === "map.canvas.failed" ? null : current);
      }
    } catch {
      if (sequence === querySequence.current) setMessage("map.canvas.failed");
    } finally { if (sequence === querySequence.current) setMapLoading(false); }
  }, []);

  const loadBenchList = useCallback(async (map: MapLibreMap, nextFilters: MapFilters) => {
    const sequence = ++listSequence.current;
    setListLoading(true);
    setListError(false);
    try {
      const result = await getMapBenchList(visibleMapQuery(map, nextFilters));
      if (sequence === listSequence.current) setListResult(result);
    } catch {
      if (sequence === listSequence.current) setListError(true);
    } finally {
      if (sequence === listSequence.current) setListLoading(false);
    }
  }, []);

  const selectBench = useCallback(async (id: string, focusOnMap = false) => {
    setJourneyOpen(false); setWalkOpen(false); setReturnJourney(null);
    const sequence = ++detailSequence.current;
    setSelectedId(id); setDetailLoading(true); setDetailError(false); setBench(null);
    (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature());
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const detail = await getBenchDetail(id);
        if (!detail) throw new Error("Bench not found");
        if (sequence === detailSequence.current) {
          setBench(detail);
          (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature(detail));
          if (focusOnMap) mapRef.current?.easeTo({ center: [detail.longitude, detail.latitude], zoom: Math.max(mapRef.current.getZoom(), 17), offset: [0, -100], duration: 650 });
        }
        break;
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          continue;
        }
        if (sequence === detailSequence.current) setDetailError(true);
      }
    }
    if (sequence === detailSequence.current) setDetailLoading(false);
  }, []);

  const refreshSelectedBench = useCallback(async () => {
    if (!selectedId) return;
    const sequence = ++detailSequence.current;
    try {
      const detail = await getBenchDetail(selectedId);
      if (sequence === detailSequence.current) {
        setBench(detail);
        (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature(detail ?? undefined));
        if (!detail) setSelectedId(null);
        if (mapRef.current) await loadVisible(mapRef.current, filtersRef.current);
        if (!detail) setMessage(t("map.canvas.removed"));
      }
    } catch {
      setMessage(t("map.canvas.saved"));
    }
  }, [selectedId, loadVisible, t]);

  const beginPlacement = useCallback((latitude: number, longitude: number) => {
    placingRef.current = true;
    detailSequence.current += 1;
    setSelectedId(null); setBench(null); setJourneyOpen(false); setWalkOpen(false); setReturnJourney(null); setFilterOpen(false);
    (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature());
    setAddCoordinates({ latitude, longitude });
    setAddStage("position");
    mapRef.current?.stop();
    mapRef.current?.jumpTo({ center: [longitude, latitude], zoom: Math.max(17, mapRef.current.getZoom()) });
  }, []);

  const openAddAt = useCallback((latitude: number, longitude: number) => {
    if (!canAdd.current) {
      pendingAdd.current = { latitude, longitude };
      addAccount.current?.showModal();
      return;
    }
    beginPlacement(latitude, longitude);
  }, [beginPlacement]);

  const locate = (onFound?: (position: UserPosition) => void) => {
    if (!navigator.geolocation) { setMessage(t("map.location.unsupported")); return; }
    setMessage(t("map.location.searching"));
    navigator.geolocation.getCurrentPosition((position) => {
      const { longitude, latitude, accuracy } = position.coords;
      const nextPosition = { longitude, latitude, accuracy };
      const map = mapRef.current;
      if (!map || !showUserPosition(map, nextPosition)) pendingPosition.current = nextPosition;
      if (typeof onFound === "function") onFound(nextPosition);
      window.localStorage.setItem("benchly_location_enabled", "1");
      setMessage(t("map.location.accuracy", { meters: Math.round(accuracy) }));
      window.setTimeout(() => setMessage(null), 3500);
    }, () => {
      window.localStorage.removeItem("benchly_location_enabled");
      setMessage(t("map.location.unavailable"));
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    let moveTimeout: number | undefined;
    let decorationIdle: number | undefined;
    let decorationTimer: number | undefined;
    let initialFeaturesRequest: Promise<void> | undefined;
    const styleRequest = loadWatercolorMapStyle();
    void Promise.allSettled(CORE_MAP_ART.map(async (asset) => {
      const response = await fetch(asset.url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`map artwork ${response.status}`);
      await response.blob();
    }));

    import("maplibre-gl").then(({ AttributionControl, Map, getVersion, setWorkerUrl }) => {
      if (disposed || !containerRef.current) return;
      // Bundling changes import.meta.url, so MapLibre cannot locate its own worker.
      setWorkerUrl(`/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);
      const map = new Map({
        container: containerRef.current,
        center: [8.25, 46.82],
        zoom: 7.2,
        minZoom: 6,
        maxZoom: 19,
        maxBounds: [[5.45, 45.55], [10.9, 48.05]],
        attributionControl: false,
        locale: { "Map.Title": t("map.canvas.interactive"), "AttributionControl.ToggleAttribution": t("map.canvas.attribution") },
        style: MINIMAL_MAP_STYLE,
      });
      map.addControl(new AttributionControl({
        compact: true,
        customAttribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
      }), "bottom-right");
      mapRef.current = map;

      map.getContainer().dataset.basemap = "loading";
      map.getContainer().dataset.mapReady = "false";

      const activateInteractiveLayers = () => {
        if (disposed) return;
        addPainterlyVectorLayers(map);
        addCoreMapLayers(map, featuresRef.current);
        applyMapAtmosphere(map);
        if (pendingPosition.current && showUserPosition(map, pendingPosition.current)) pendingPosition.current = null;
        const click = (event: MapLayerMouseEvent) => {
          if (placingRef.current) return;
          const item = event.features?.[0]?.properties as MapFeature | undefined;
          if (!item) return;
          if (item.kind === "cluster") {
            const longitudeSpan = Math.max(item.east - item.west, .00008);
            const latitudeSpan = Math.max(item.north - item.south, .00006);
            const longitudePadding = longitudeSpan * .16;
            const latitudePadding = latitudeSpan * .16;
            const camera = map.cameraForBounds([
              [item.west - longitudePadding, item.south - latitudePadding],
              [item.east + longitudePadding, item.north + latitudePadding],
            ], {
              padding: window.innerWidth >= 768
                ? { top: 92, right: 72, bottom: 92, left: 72 }
                : { top: 104, right: 34, bottom: 110, left: 34 },
              maxZoom: 18,
            });
            // A broad cluster must advance at least one grid level; a compact
            // cluster can zoom farther while its real extent still stays centred.
            const nextZoom = clusterExpansionZoom(map.getZoom(), camera?.zoom);
            map.easeTo({ center: camera?.center ?? [item.longitude, item.latitude], zoom: nextZoom, duration: 560 });
          }
          else {
            map.easeTo({ center: [item.longitude, item.latitude], offset: [0, -100], duration: 450 });
            selectBench(item.id);
          }
        };
        map.on("click", "cluster-hits", click);
        map.on("click", "bench-hits", click);
        for (const layer of ["cluster-hits", "bench-hits"]) {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }
        let pressTimer: number | undefined;
        let pressStart: { x: number; y: number } | null = null;
        const canvas = map.getCanvas();
        const cancelPress = () => { window.clearTimeout(pressTimer); pressStart = null; };
        const beginPress = (event: PointerEvent) => {
          if (placingRef.current) return;
          if (event.pointerType === "mouse" && event.button !== 0) return;
          pressStart = { x: event.offsetX, y: event.offsetY };
          pressTimer = window.setTimeout(() => {
            if (!pressStart) return;
            const point = map.unproject([pressStart.x, pressStart.y]);
            openAddAt(point.lat, point.lng);
            cancelPress();
          }, 550);
        };
        const movePress = (event: PointerEvent) => { if (pressStart && Math.hypot(event.offsetX - pressStart.x, event.offsetY - pressStart.y) > 12) cancelPress(); };
        canvas.addEventListener("pointerdown", beginPress);
        canvas.addEventListener("pointerup", cancelPress);
        canvas.addEventListener("pointercancel", cancelPress);
        canvas.addEventListener("pointermove", movePress);
        const preventContextMenu = (event: Event) => event.preventDefault();
        canvas.addEventListener("contextmenu", preventContextMenu);
        map.on("remove", () => {
          cancelPress();
          canvas.removeEventListener("pointerdown", beginPress);
          canvas.removeEventListener("pointerup", cancelPress);
          canvas.removeEventListener("pointercancel", cancelPress);
          canvas.removeEventListener("pointermove", movePress);
          canvas.removeEventListener("contextmenu", preventContextMenu);
        });

        initialFeaturesRequest ??= loadVisible(map, filtersRef.current);
        void initialFeaturesRequest;
        setMapReady(true);
        setMapLoading(false);
        map.getContainer().dataset.mapReady = "true";

        void loadMapArt(map, CORE_MAP_ART).then(() => {
          if (!disposed) addCoreArtLayers(map);
        });

        const loadDecorations = () => {
          if (disposed) return;
          void loadMapArt(map, DECORATIVE_MAP_ART).then(() => {
            if (!disposed) addDecorativeMapLayers(map);
          });
        };
        const browserWindow = window as Window & {
          requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
          cancelIdleCallback?: (handle: number) => void;
        };
        if (browserWindow.requestIdleCallback) {
          decorationIdle = browserWindow.requestIdleCallback(loadDecorations, { timeout: 1_500 });
        } else {
          decorationTimer = browserWindow.setTimeout(loadDecorations, 350);
        }

        let transitStarted = false;
        const ensureTransitArt = () => {
          if (disposed || transitStarted || map.getZoom() < 11) return;
          transitStarted = true;
          void loadMapArt(map, TRANSIT_MAP_ART).then(() => {
            if (!disposed) addTransitLayers(map);
          });
        };
        map.on("zoomend", ensureTransitArt);
        ensureTransitArt();
      };

      map.once("load", () => {
        if (disposed) return;
        setMapLoading(false);
        initialFeaturesRequest = loadVisible(map, filtersRef.current);
        void styleRequest.then(({ style, basemap }) => {
          if (disposed) return;
          map.getContainer().dataset.basemap = basemap;
          map.once("style.load", activateInteractiveLayers);
          map.setStyle(style);
        });
      });

      map.on("moveend", () => {
        if (placingRef.current) { const point = map.getCenter(); setAddCoordinates({ latitude: point.lat, longitude: point.lng }); }
        if (!map.getSource("benchly")) return;
        window.clearTimeout(moveTimeout);
        moveTimeout = window.setTimeout(() => {
          void loadVisible(map, filtersRef.current);
          if (listOpenRef.current) void loadBenchList(map, filtersRef.current);
          applyMapAtmosphere(map);
        }, 220);
      });
    });
    return () => {
      disposed = true;
      window.clearTimeout(moveTimeout);
      window.clearTimeout(decorationTimer);
      const browserWindow = window as Window & { cancelIdleCallback?: (handle: number) => void };
      if (decorationIdle !== undefined) browserWindow.cancelIdleCallback?.(decorationIdle);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // Initialization is intentionally one-shot; filter changes are handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("benchly") as GeoJSONSource | undefined)?.setData(featureCollection(features));
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    // MapLibre has no runtime locale setter. Its existing public DOM remains
    // in place while we update the two built-in controls used by this app.
    map.getCanvas().setAttribute("aria-label", t("map.canvas.interactive"));
    const attribution = map.getContainer().querySelector(".maplibregl-ctrl-attrib-button");
    attribution?.setAttribute("aria-label", t("map.canvas.attribution"));
    attribution?.setAttribute("title", t("map.canvas.attribution"));
  }, [mapReady, t]);

  useEffect(() => {
    const requestedBench = searchParams.get("bank");
    if (!mapReady || !requestedBench || openedFromUrl.current === requestedBench) return;
    openedFromUrl.current = requestedBench;
    void selectBench(requestedBench, true);
  }, [mapReady, searchParams, selectBench]);

  useEffect(() => {
    filtersRef.current = filters;
    const map = mapRef.current;
    // Basemap tiles can still be loading after the interactive layers are ready.
    // Their loading state must never discard a bench-filter change.
    if (mapReady && map) {
      void loadVisible(map, filters);
      if (listOpenRef.current) void loadBenchList(map, filters);
    }
  }, [filters, mapReady, loadVisible, loadBenchList]);

  const refreshTimeSensitiveMap = useEffectEvent(() => {
    if (document.visibilityState === "hidden") return;
    const map = mapRef.current;
    if (!mapReady || !map?.getSource("benchly")) return;
    map.getContainer().dataset.timeRefresh = new Date().toISOString();
    applyMapAtmosphere(map);
    void loadVisible(map, filtersRef.current);
    if (listOpenRef.current) void loadBenchList(map, filtersRef.current);
  });
  useEffect(() => {
    const refresh = () => refreshTimeSensitiveMap();
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const autoLocate = useEffectEvent(() => locate());
  useEffect(() => {
    if (!navigator.geolocation) return;
    if (window.localStorage.getItem("benchly_location_enabled") === "1") {
      const timer = window.setTimeout(() => autoLocate(), 0);
      return () => window.clearTimeout(timer);
    }
    navigator.permissions?.query({ name: "geolocation" }).then((permission) => { if (permission.state === "granted") autoLocate(); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const action = searchParams.get("action");
    if (!mapReady || !action || handledAction.current === action) return;
    handledAction.current = action;
    const timer = window.setTimeout(() => {
      if (action === "filter") setFilterOpen(true);
      if (action === "walk") setWalkOpen(true);
      if (action === "add") { const point = mapRef.current?.getCenter(); if (point) openAddAt(point.lat, point.lng); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mapReady, searchParams, openAddAt]);

  const choosePlace = (place: PlaceResult) => {
    mapRef.current?.easeTo({ center: [place.longitude, place.latitude], zoom: place.kind === "bench" ? 17 : 14 });
    if (!placingRef.current && place.kind === "bench" && place.benchId) void selectBench(place.benchId);
  };
  const openAdd = () => {
    const center = mapRef.current?.getCenter();
    if (center) openAddAt(center.lat, center.lng);
  };
  const openWalk = () => {
    listOpenRef.current = false;
    setListOpen(false);
    setWalkOpen(true);
  };
  const openList = () => {
    listOpenRef.current = true;
    setListOpen(true);
    const map = mapRef.current;
    if (map) void loadBenchList(map, filtersRef.current);
  };
  const closeList = () => {
    listSequence.current += 1;
    listOpenRef.current = false;
    setListOpen(false);
  };
  const closeAdd = () => {
    const source = mapRef.current?.getSource("add-position") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [] });
    placingRef.current = false;
    setAddStage(null);
  };
  const activeFilterCount = activeMapFilterCount(filters);
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-base-200">
      <div ref={containerRef} className="benchly-map absolute inset-0" aria-label={t("map.canvas.label")} aria-busy={mapLoading} />
      <header className="map-topbar safe-top pointer-events-none absolute inset-x-0 top-0 z-20 px-3 md:max-w-xl md:px-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <SearchBox onSelect={choosePlace} onLocate={locate} />
          <button id="map-filter-toggle" aria-label={t("map.filters.open")} aria-expanded={filterOpen} className="map-filter-button" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={19} /><span>{t("map.filters.button")}</span>{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button>
          <AppMenu user={user} onAdd={openAdd} onWalk={openWalk} />
        </div>
        {activeFilterCount > 0 && <div className="active-filter-chips pointer-events-auto" aria-label={t("map.filters.active")}>{activeMapFilters(filters, t).map(({ key, label }) => <button key={key} type="button" aria-label={t("map.filters.remove", { label })} onClick={() => setFilters((current) => ({ ...current, [key]: undefined }))}>{label}<X size={14} /></button>)}</div>}
      </header>
      {addStage === "position" && <>
        <div className="placement-crosshair" aria-hidden="true"><Crosshair size={38} /></div>
        <section className="placement-controls" aria-label={t("map.placement.title")}><h2>{t("map.placement.title")}</h2><p>{t("map.placement.instructions")}</p><button type="button" onClick={() => locate((point) => beginPlacement(point.latitude, point.longitude))}><Crosshair size={18} /> {t("map.location.use")}</button><div><button type="button" onClick={closeAdd}>{t("common.actions.cancel")}</button><button type="button" className="btn btn-primary" onClick={() => { const map = mapRef.current; if (!map) return; map.stop(); const point = map.getCenter(); setAddCoordinates({ latitude: point.lat, longitude: point.lng }); setAddStage("details"); }}>{t("map.placement.confirm")}</button></div></section>
      </>}
      {filterOpen && <FilterPanel filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />}
      {mapLoading && <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2"><div className="storybook-panel flex min-h-10 items-center gap-2 rounded-full px-3 text-xs text-base-content/65"><span className="loading loading-ring loading-sm text-primary" /><span>{t("map.canvas.loading")}</span></div></div>}
      {message && <div role="status" className="toast toast-center top-36 z-30"><div className="storybook-panel flex min-h-11 items-center gap-2 rounded-2xl px-4 py-2 text-sm"><Info size={18} className="text-primary" /><span>{message === "map.canvas.failed" ? t("map.canvas.failed") : message}</span></div></div>}
      {!addStage && !journeyOpen && !walkOpen && !returnJourney && !selectedId && !listOpen && <div className="map-discovery-actions">
        <button className="walk-entry" onClick={openWalk}><Footprints size={20} /> {t("walks.planner.title")}</button>
        <button className="list-entry" onClick={openList}><List size={20} /> {t("map.list.button")}</button>
      </div>}
      {listOpen && !selectedId && <aside className="bench-list-panel storybook-panel" aria-label={t("map.list.title")}>
        <header><div><span className="story-eyebrow">{t("map.list.eyebrow")}</span><h2>{t("map.list.title")}</h2></div><button type="button" aria-label={t("map.list.close")} onClick={closeList}><X size={18} /></button></header>
        <p>{activeFilterCount ? t("map.list.matches", {count: activeFilterCount}) : t("map.list.intro")}</p>
        {listLoading && <p role="status">{t("map.list.loading")}</p>}
        {!listLoading && listError && <p role="alert">{t("map.list.failed")} <button type="button" onClick={() => { const map = mapRef.current; if (map) void loadBenchList(map, filtersRef.current); }}>{t("map.list.retry")}</button></p>}
        {!listLoading && !listError && listResult.zoomRequired && <div className="bench-list-empty"><p>{t("map.list.zoom")}</p><button type="button" onClick={() => mapRef.current?.zoomTo(14, {duration: 450})}>{t("map.list.zoomAction")}</button></div>}
        {!listLoading && !listError && !listResult.zoomRequired && listResult.items.length === 0 && <p className="bench-list-empty">{t(activeFilterCount ? "map.list.emptyFiltered" : "map.list.empty")}</p>}
        {!listError && !listResult.zoomRequired && listResult.items.length > 0 && <ol>{listResult.items.map((item) => <li key={item.id}><button type="button" onClick={() => { closeList(); void selectBench(item.id, true); }}>
          <span className="bench-list-distance">{item.distanceMeters >= 1000 ? t("map.list.kilometres", {distance: format.number(item.distanceMeters / 1000, {maximumFractionDigits: 1})}) : t("map.list.metres", {distance: Math.round(item.distanceMeters)})}</span>
          <strong>{item.title || t("common.values.bench")}</strong>
          <span className="bench-list-evidence">
            {item.backrest === true && <small><Armchair size={14} />{t("bench.attributes.backrest")}</small>}
            {item.wheelchair === true && <small><Accessibility size={14} />{t("bench.attributes.wheelchair")}</small>}
            {item.sunnyNow !== null && <small>{item.sunnyNow ? <Sun size={14} /> : <CloudSun size={14} />}{t(item.sunnyNow ? "bench.summary.sun" : "bench.summary.shade")}</small>}
            {item.rating !== null && <small><Star size={14} />{t("map.list.rating", {rating: format.number(item.rating, {maximumFractionDigits: 1}), count: item.ratingCount})}</small>}
            {item.verificationStatus === "unverified" && <small>{t("map.list.unverified")}</small>}
          </span>
        </button></li>)}</ol>}
        <small className="bench-list-note">{t("map.list.distanceNote")}</small>
      </aside>}
      {walkOpen && <WalkPlanner getMap={getJourneyMap} onClose={() => setWalkOpen(false)} onReturn={(value) => { setWalkOpen(false); setReturnJourney(value); }} />}
      {returnJourney && <JourneyPlanner key="return" bench={{ id: "return", title: pointLabel(returnJourney.destination, t) }} initial={returnJourney} getMap={getJourneyMap} onClose={() => setReturnJourney(null)} />}
      {journeyOpen && bench && <JourneyPlanner key={bench.id} bench={bench} getMap={getJourneyMap} onClose={() => setJourneyOpen(false)} />}
      {selectedId && !journeyOpen && !walkOpen && !returnJourney && <BenchSheet created={createdBenchId === selectedId} bench={bench} loading={detailLoading} error={detailError} onRetry={() => void selectBench(selectedId)} onBenchChange={refreshSelectedBench} onJourney={() => setJourneyOpen(true)} user={user} onClose={() => { detailSequence.current += 1; (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature()); setSelectedId(null); setBench(null); setDetailError(false); }} />}
      {addStage === "details" && <AddBenchDialog coordinates={addCoordinates} onChoosePosition={() => setAddStage("position")} onClose={closeAdd} onExisting={(id) => { closeAdd(); void selectBench(id, true); }} onCreated={(id) => { closeAdd(); setCreatedBenchId(id); void selectBench(id, true); if (mapRef.current) void loadVisible(mapRef.current, filtersRef.current); }} />}
      <AccountDialog dialogRef={addAccount} intent={t("common.navigation.addBench")} onAuthenticated={() => { canAdd.current = true; const point = pendingAdd.current; pendingAdd.current = null; if (point) beginPlacement(point.latitude, point.longitude); }} />
    </main>
  );
}
