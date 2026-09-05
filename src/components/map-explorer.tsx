"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Info } from "lucide-react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getBenchDetail, getMapFeatures } from "@/app/actions/map";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail, MapFeature, MapFilters, PlaceResult } from "@/lib/types";
import { BenchSheet } from "./bench-sheet";
import { FilterPanel } from "./filter-panel";
import { SearchBox } from "./search-box";
import { AddBenchDialog } from "./add-bench-dialog";
import { AppMenu } from "./app-menu";
import { CORE_MAP_ART, DECORATIVE_MAP_ART, TRANSIT_MAP_ART, loadWatercolorMapStyle, MINIMAL_MAP_STYLE } from "@/lib/watercolor-map";
import { featureCollection, selectedBenchFeature, loadMapArt, addDecorativeMapLayers, addPainterlyVectorLayers, addTransitLayers, addCoreArtLayers, addCoreMapLayers, applyMapAtmosphere, showUserPosition, type UserPosition } from "@/lib/map-renderer";

const JourneyPlanner = dynamic(() => import("./journey/journey-planner").then((m) => m.JourneyPlanner), {
  ssr: false, loading: () => <aside className="journey-panel storybook-panel" role="status">Dein Reisejournal wird geöffnet …</aside>,
});

export function MapExplorer({ user }: { user: CurrentUser | null }) {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const querySequence = useRef(0);
  const detailSequence = useRef(0);
  const featuresRef = useRef<MapFeature[]>([]);
  const pendingPosition = useRef<UserPosition | null>(null);
  const openedFromUrl = useRef<string | null>(null);
  const filtersRef = useRef<MapFilters>({});
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [filters, setFilters] = useState<MapFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bench, setBench] = useState<BenchDetail | null>(null);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const getJourneyMap = useCallback(() => mapRef.current, []);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCoordinates, setAddCoordinates] = useState({ latitude: 46.82, longitude: 8.25 });

  const loadVisible = useCallback(async (map: MapLibreMap, nextFilters: MapFilters) => {
    const sequence = ++querySequence.current;
    const bounds = map.getBounds();
    try {
      const result = await getMapFeatures({ bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, zoom: map.getZoom(), filters: nextFilters });
      if (sequence === querySequence.current) {
        featuresRef.current = result;
        setFeatures(result);
        (map.getSource("benchly") as GeoJSONSource | undefined)?.setData(featureCollection(result));
        setMessage(null);
      }
    } catch {
      if (sequence === querySequence.current) setMessage("Bänke konnten nicht geladen werden.");
    } finally { if (sequence === querySequence.current) setMapLoading(false); }
  }, []);

  const selectBench = useCallback(async (id: string, focusOnMap = false) => {
    setJourneyOpen(false);
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
      if (detail && sequence === detailSequence.current) {
        setBench(detail);
        (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature(detail));
      }
    } catch {
      setMessage("Die neue Angabe ist gespeichert. Die Ansicht aktualisiert sich beim nächsten Öffnen.");
    }
  }, [selectedId]);

  const openAddAt = (latitude: number, longitude: number) => {
    if (!user) {
      setMessage("Zum Eintragen bitte zuerst im Menü anmelden.");
      return;
    }
    setAddCoordinates({ latitude, longitude });
    const source = mapRef.current?.getSource("add-position") as GeoJSONSource | undefined;
    source?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [longitude, latitude] } });
    setAddOpen(true);
  };

  const locate = (onFound?: (position: UserPosition) => void) => {
    if (!navigator.geolocation) { setMessage("Dein Browser unterstützt die Standortsuche nicht."); return; }
    setMessage("Standort wird gesucht …");
    navigator.geolocation.getCurrentPosition((position) => {
      const { longitude, latitude, accuracy } = position.coords;
      const nextPosition = { longitude, latitude, accuracy };
      const map = mapRef.current;
      if (!map || !showUserPosition(map, nextPosition)) pendingPosition.current = nextPosition;
      if (typeof onFound === "function") onFound(nextPosition);
      window.localStorage.setItem("benchly_location_enabled", "1");
      setMessage(`Standort auf etwa ${Math.round(accuracy)} m genau.`);
      window.setTimeout(() => setMessage(null), 3500);
    }, () => {
      window.localStorage.removeItem("benchly_location_enabled");
      setMessage("Standort nicht verfügbar. Du kannst die Karte weiterhin verwenden.");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    let moveTimeout: number | undefined;
    let ambientTimer: number | undefined;
    let decorationIdle: number | undefined;
    let decorationTimer: number | undefined;
    let initialFeaturesRequest: Promise<void> | undefined;
    const styleRequest = loadWatercolorMapStyle();
    void Promise.allSettled(CORE_MAP_ART.map(async (asset) => {
      const response = await fetch(asset.url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`map artwork ${response.status}`);
      await response.blob();
    }));

    import("maplibre-gl").then(({ Map }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({
        container: containerRef.current,
        center: [8.25, 46.82],
        zoom: 7.2,
        minZoom: 6,
        maxZoom: 19,
        maxBounds: [[5.45, 45.55], [10.9, 48.05]],
        attributionControl: false,
        style: MINIMAL_MAP_STYLE,
      });
      mapRef.current = map;

      map.getContainer().dataset.basemap = "loading";
      map.getContainer().dataset.mapReady = "false";

      const activateInteractiveLayers = () => {
        if (disposed) return;
        addPainterlyVectorLayers(map);
        addCoreMapLayers(map, featuresRef.current);
        applyMapAtmosphere(map);
        ambientTimer = window.setInterval(() => applyMapAtmosphere(map), 5 * 60 * 1000);
        if (pendingPosition.current && showUserPosition(map, pendingPosition.current)) pendingPosition.current = null;
        const click = (event: MapLayerMouseEvent) => {
          const item = event.features?.[0]?.properties as MapFeature | undefined;
          if (!item) return;
          if (item.kind === "cluster") {
            const nextZoom = Math.min(map.getZoom() + 2, map.getMaxZoom());
            map.easeTo({ center: [item.longitude, item.latitude], zoom: nextZoom, duration: 480 });
          }
          else {
            map.easeTo({ center: [item.longitude, item.latitude], offset: [0, -100], duration: 450 });
            selectBench(item.id);
          }
        };
        map.on("click", "clusters", click);
        map.on("click", "bench-hits", click);
        for (const layer of ["clusters", "cluster-count", "bench-hits"]) {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }
        let pressTimer: number | undefined;
        let pressStart: { x: number; y: number } | null = null;
        const canvas = map.getCanvas();
        const cancelPress = () => { window.clearTimeout(pressTimer); pressStart = null; };
        const beginPress = (event: PointerEvent) => {
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
        if (!map.getSource("benchly")) return;
        window.clearTimeout(moveTimeout);
        moveTimeout = window.setTimeout(() => {
          void loadVisible(map, filtersRef.current);
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
      window.clearInterval(ambientTimer);
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
    const requestedBench = searchParams.get("bank");
    if (!mapReady || !requestedBench || openedFromUrl.current === requestedBench) return;
    openedFromUrl.current = requestedBench;
    void selectBench(requestedBench, true);
  }, [mapReady, searchParams, selectBench]);

  useEffect(() => {
    filtersRef.current = filters;
    const map = mapRef.current;
    if (map?.isStyleLoaded()) loadVisible(map, filters);
  }, [filters, loadVisible]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    if (window.localStorage.getItem("benchly_location_enabled") === "1") {
      const timer = window.setTimeout(() => locate(), 0);
      return () => window.clearTimeout(timer);
    }
    navigator.permissions?.query({ name: "geolocation" }).then((permission) => { if (permission.state === "granted") locate(); }).catch(() => undefined);
  }, []);

  const choosePlace = (place: PlaceResult) => {
    mapRef.current?.easeTo({ center: [place.longitude, place.latitude], zoom: place.kind === "bench" ? 17 : 14 });
    if (place.kind === "bench" && place.benchId) void selectBench(place.benchId);
  };
  const openAdd = () => {
    const center = mapRef.current?.getCenter();
    if (center) openAddAt(center.lat, center.lng);
  };
  const closeAdd = () => {
    const source = mapRef.current?.getSource("add-position") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [] });
    setAddOpen(false);
  };
  const activeFilterCount = Object.values(filters).filter((value) => value !== undefined && value !== false && value !== "").length;
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-base-200">
      <div ref={containerRef} className="benchly-map absolute inset-0" aria-label="Karte der Schweizer Sitzbänke" aria-busy={mapLoading} />
      <header className="map-topbar safe-top pointer-events-none absolute inset-x-0 top-0 z-20 px-3 md:max-w-xl md:px-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <SearchBox onSelect={choosePlace} onLocate={locate} />
          <AppMenu user={user} onAdd={openAdd} activeFilters={activeFilterCount} onFilter={() => setFilterOpen(true)} />
        </div>
      </header>
      {filterOpen && <FilterPanel filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />}
      {mapLoading && <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2"><div className="storybook-panel flex min-h-10 items-center gap-2 rounded-full px-3 text-xs text-base-content/65"><span className="loading loading-ring loading-sm text-primary" /><span>Karte wird gemalt …</span></div></div>}
      {message && <div role="status" className="toast toast-center top-36 z-30"><div className="storybook-panel flex min-h-11 items-center gap-2 rounded-2xl px-4 py-2 text-sm"><Info size={18} className="text-primary" /><span>{message}</span></div></div>}
      {journeyOpen && bench && <JourneyPlanner key={bench.id} bench={bench} getMap={getJourneyMap} onClose={() => setJourneyOpen(false)} />}
      {selectedId && !journeyOpen && <BenchSheet bench={bench} loading={detailLoading} error={detailError} onRetry={() => void selectBench(selectedId)} onBenchChange={refreshSelectedBench} onJourney={() => setJourneyOpen(true)} user={user} onClose={() => { detailSequence.current += 1; (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature()); setSelectedId(null); setBench(null); setDetailError(false); }} />}
      <AddBenchDialog open={addOpen} coordinates={addCoordinates} onUseCurrentLocation={() => locate((position) => openAddAt(position.latitude, position.longitude))} onClose={closeAdd} />
    </main>
  );
}
