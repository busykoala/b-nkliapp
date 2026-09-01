"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Armchair, Info, LocateFixed, MountainSnow, SlidersHorizontal, Sun, Waves } from "lucide-react";
import { getBenchDetail, getMapFeatures } from "@/app/actions/map";
import type { BenchDetail, MapFeature, MapFilters, PlaceResult } from "@/lib/types";
import { BenchSheet } from "./bench-sheet";
import { FilterPanel } from "./filter-panel";
import { SearchBox } from "./search-box";

function circlePolygon(longitude: number, latitude: number, radiusMeters: number) {
  const points = 64;
  const coordinates = Array.from({ length: points + 1 }, (_, index) => {
    const angle = (index / points) * Math.PI * 2;
    const latOffset = (radiusMeters / 111320) * Math.sin(angle);
    const lonOffset = (radiusMeters / (111320 * Math.cos(latitude * Math.PI / 180))) * Math.cos(angle);
    return [longitude + lonOffset, latitude + latOffset];
  });
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [coordinates] } };
}

function featureCollection(features: MapFeature[]) {
  return {
    type: "FeatureCollection" as const,
    features: features.map((feature) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [feature.longitude, feature.latitude] },
      properties: feature,
    })),
  };
}

type UserPosition = { longitude: number; latitude: number; accuracy: number };

function showUserPosition(map: MapLibreMap, position: UserPosition) {
  const positionSource = map.getSource("user-position") as GeoJSONSource | undefined;
  const accuracySource = map.getSource("user-accuracy") as GeoJSONSource | undefined;
  if (!positionSource || !accuracySource) return false;
  positionSource.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [position.longitude, position.latitude] } });
  accuracySource.setData(circlePolygon(position.longitude, position.latitude, position.accuracy));
  map.easeTo({ center: [position.longitude, position.latitude], zoom: Math.max(map.getZoom(), 15) });
  return true;
}

export function MapExplorer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const querySequence = useRef(0);
  const pendingPosition = useRef<UserPosition | null>(null);
  const filtersRef = useRef<MapFilters>({});
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [filters, setFilters] = useState<MapFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bench, setBench] = useState<BenchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [located, setLocated] = useState(false);

  const loadVisible = useCallback(async (map: MapLibreMap, nextFilters: MapFilters) => {
    const sequence = ++querySequence.current;
    const bounds = map.getBounds();
    try {
      const result = await getMapFeatures({ bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, zoom: map.getZoom(), filters: nextFilters });
      if (sequence === querySequence.current) {
        setFeatures(result);
        (map.getSource("benchly") as GeoJSONSource | undefined)?.setData(featureCollection(result));
        setMessage(null);
      }
    } catch {
      if (sequence === querySequence.current) setMessage("Bänke konnten nicht geladen werden.");
    } finally { if (sequence === querySequence.current) setMapLoading(false); }
  }, []);

  const selectBench = useCallback(async (id: string) => {
    setSelectedId(id); setDetailLoading(true); setBench(null);
    try { setBench(await getBenchDetail(id)); }
    catch { setMessage("Bankdetails konnten nicht geladen werden."); }
    finally { setDetailLoading(false); }
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    import("maplibre-gl").then(({ Map }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({
        container: containerRef.current,
        center: [8.25, 46.82],
        zoom: 7.2,
        minZoom: 6,
        maxZoom: 19,
        maxBounds: [[5.45, 45.55], [10.9, 48.05]],
        attributionControl: { compact: true, customAttribution: "Bankdaten © OpenStreetMap-Mitwirkende" },
        style: {
          version: 8,
          sources: {
            swisstopo: {
              type: "raster",
              tiles: ["https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-karte-farbe/default/current/3857/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© swisstopo",
              maxzoom: 18,
            },
          },
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#e9efe8" } },
            { id: "swisstopo", type: "raster", source: "swisstopo", paint: { "raster-opacity": 0.58, "raster-saturation": -0.7, "raster-contrast": -0.2, "raster-brightness-min": 0.08, "raster-brightness-max": 0.98 } },
          ],
        },
      });
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("benchly", { type: "geojson", data: featureCollection([]) });
        map.addLayer({ id: "clusters", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "cluster"], paint: { "circle-color": "#236548", "circle-opacity": 0.94, "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 14, 50, 20, 500, 27], "circle-stroke-width": 2, "circle-stroke-color": "#fffdf5" } });
        map.addLayer({ id: "cluster-count", type: "symbol", source: "benchly", filter: ["==", ["get", "kind"], "cluster"], layout: { "text-field": ["to-string", ["get", "count"]], "text-size": 12 }, paint: { "text-color": "#ffffff" } });
        map.addLayer({ id: "benches", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "bench"], paint: { "circle-color": ["case", ["==", ["get", "sunnyNow"], true], "#efb83f", "#236548"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 6, 18, 9], "circle-stroke-width": 2, "circle-stroke-color": "#fffdf5" } });
        map.addSource("user-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("user-position", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "user-accuracy", type: "fill", source: "user-accuracy", paint: { "fill-color": "#2d79c7", "fill-opacity": 0.12 } });
        map.addLayer({ id: "user-position", type: "circle", source: "user-position", paint: { "circle-color": "#2878c8", "circle-radius": 7, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
        if (pendingPosition.current && showUserPosition(map, pendingPosition.current)) pendingPosition.current = null;
        const click = (event: MapLayerMouseEvent) => {
          const item = event.features?.[0]?.properties as MapFeature | undefined;
          if (!item) return;
          if (item.kind === "cluster") map.easeTo({ center: [item.longitude, item.latitude], zoom: Math.min(map.getZoom() + 2, 16) });
          else {
            map.easeTo({ center: [item.longitude, item.latitude], offset: [0, -100], duration: 450 });
            selectBench(item.id);
          }
        };
        map.on("click", "clusters", click);
        map.on("click", "benches", click);
        for (const layer of ["clusters", "cluster-count", "benches"]) {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }
        loadVisible(map, filtersRef.current);
      });
      let timeout: number | undefined;
      map.on("moveend", () => { window.clearTimeout(timeout); timeout = window.setTimeout(() => loadVisible(map, filtersRef.current), 220); });
    });
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; };
  // Initialization is intentionally one-shot; filter changes are handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("benchly") as GeoJSONSource | undefined)?.setData(featureCollection(features));
  }, [features]);

  useEffect(() => {
    filtersRef.current = filters;
    const map = mapRef.current;
    if (map?.isStyleLoaded()) loadVisible(map, filters);
  }, [filters, loadVisible]);

  const locate = () => {
    if (!navigator.geolocation) { setMessage("Dein Browser unterstützt die Standortsuche nicht."); return; }
    setMessage("Standort wird gesucht …");
    navigator.geolocation.getCurrentPosition((position) => {
      const { longitude, latitude, accuracy } = position.coords;
      const nextPosition = { longitude, latitude, accuracy };
      const map = mapRef.current;
      setLocated(true);
      window.dispatchEvent(new Event("benchly:engaged"));
      if (!map || !showUserPosition(map, nextPosition)) pendingPosition.current = nextPosition;
      setMessage(`Standort auf etwa ${Math.round(accuracy)} m genau.`);
      window.setTimeout(() => setMessage(null), 3500);
    }, () => setMessage("Standort nicht verfügbar. Du kannst die Karte weiterhin verwenden."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };

  const choosePlace = (place: PlaceResult) => { setLocated(true); window.dispatchEvent(new Event("benchly:engaged")); mapRef.current?.easeTo({ center: [place.longitude, place.latitude], zoom: 14 }); };
  const activeFilterCount = Object.values(filters).filter((value) => value !== undefined && value !== false && value !== "").length;
  const visibleBenchCount = features.reduce((sum, feature) => sum + (feature.kind === "cluster" ? feature.count : 1), 0);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-base-200">
      <div ref={containerRef} className="benchly-map absolute inset-0" aria-label="Karte der Schweizer Sitzbänke" />
      <header className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 px-3 md:max-w-xl md:px-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="hidden h-12 items-center gap-2 rounded-box bg-base-100 px-4 font-black text-primary shadow-lg sm:flex"><Armchair size={22} /> Benchly</div>
          <SearchBox onSelect={choosePlace} onLocate={locate} />
          <button aria-label="Filter öffnen" className={`btn btn-circle min-h-12 min-w-12 shadow-lg ${activeFilterCount ? "btn-secondary" : "bg-base-100"}`} onClick={() => setFilterOpen((open) => !open)}><SlidersHorizontal size={20} />{activeFilterCount > 0 && <span className="badge badge-sm badge-primary absolute -right-1 -top-1">{activeFilterCount}</span>}</button>
        </div>
        <div className="pointer-events-auto mt-2 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <span className="badge h-8 whitespace-nowrap border-base-300 bg-base-100/95 shadow"><Armchair size={14} /> {new Intl.NumberFormat("de-CH").format(visibleBenchCount)} im Ausschnitt</span>
          {filters.sunnyNow && <button className="badge badge-warning h-8 whitespace-nowrap" onClick={() => setFilters({ ...filters, sunnyNow: undefined })}><Sun size={14} /> Sonne jetzt ×</button>}
          {filters.minViewScore && <button className="badge badge-primary h-8 whitespace-nowrap" onClick={() => setFilters({ ...filters, minViewScore: undefined })}>Aussicht ab {filters.minViewScore} ×</button>}
          {filters.viewType && <button className="badge badge-primary h-8 whitespace-nowrap" onClick={() => setFilters({ ...filters, viewType: undefined })}>{filters.viewType === "mountain" ? <MountainSnow size={14} /> : filters.viewType === "lake" ? <Waves size={14} /> : null}{viewFilterLabel(filters.viewType)} ×</button>}
        </div>
      </header>
      {filterOpen && <FilterPanel filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />}
      {mapLoading && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center"><div className="rounded-full bg-base-100/90 p-3 shadow-lg backdrop-blur"><span className="loading loading-spinner text-primary" /></div></div>}
      {message && <div role="status" className="toast toast-center top-36 z-30"><div className="alert border border-base-300 bg-base-100 py-2 shadow-lg"><Info size={18} /><span>{message}</span></div></div>}
      {!selectedId && !located && <div className="safe-bottom pointer-events-none absolute inset-x-3 bottom-0 z-20 flex justify-center"><button className="pointer-events-auto flex min-h-16 w-full max-w-sm items-center gap-3 rounded-box border border-base-300 bg-base-100/96 px-4 py-3 text-left shadow-xl backdrop-blur" onClick={locate}><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-content"><LocateFixed size={21} /></span><span><span className="block font-bold">Bänke in meiner Nähe</span><span className="block text-xs opacity-65">Standort nur für diesen Kartenausschnitt verwenden</span></span></button></div>}
      {selectedId && <BenchSheet bench={bench} loading={detailLoading} onClose={() => { setSelectedId(null); setBench(null); }} />}
      <footer className="pointer-events-none absolute bottom-1 left-1 z-10 hidden text-[10px] opacity-60 md:block">© swisstopo · © OpenStreetMap-Mitwirkende</footer>
    </main>
  );
}

function viewFilterLabel(value: NonNullable<MapFilters["viewType"]>) { return ({ mountain: "Bergblick", lake: "See/Wasser", open: "Weitsicht", limited: "Begrenzte Sicht" })[value]; }
