"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Info } from "lucide-react";
import { getBenchDetail, getMapFeatures } from "@/app/actions/map";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail, MapFeature, MapFilters, PlaceResult } from "@/lib/types";
import { BenchSheet } from "./bench-sheet";
import { FilterPanel } from "./filter-panel";
import { SearchBox } from "./search-box";
import { AddBenchDialog } from "./add-bench-dialog";
import { AppMenu } from "./app-menu";
import { getDaylightState } from "@/lib/sun";

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

function applyMapAtmosphere(map: MapLibreMap) {
  const center = map.getCenter();
  const { phase } = getDaylightState(new Date(), center.lat, center.lng);
  map.getContainer().dataset.phase = phase;
  const paints = {
    dawn: { min: .08, max: .84, saturation: -.42, hue: 10 },
    day: { min: .12, max: .96, saturation: -.48, hue: 8 },
    dusk: { min: .06, max: .72, saturation: -.38, hue: 18 },
    night: { min: .02, max: .46, saturation: -.72, hue: 32 },
  }[phase];
  if (map.getLayer("swisstopo")) {
    map.setPaintProperty("swisstopo", "raster-brightness-min", paints.min);
    map.setPaintProperty("swisstopo", "raster-brightness-max", paints.max);
    map.setPaintProperty("swisstopo", "raster-saturation", paints.saturation);
    map.setPaintProperty("swisstopo", "raster-hue-rotate", paints.hue);
  }
  if (map.getLayer("clusters")) map.setPaintProperty("clusters", "circle-color", phase === "night" ? "#263f45" : "#294c45");
  if (map.getLayer("benches")) {
    map.setPaintProperty("benches", "circle-stroke-color", phase === "night" ? "#f2dca7" : "#fff4d8");
    map.setPaintProperty("benches", "circle-color", phase === "night"
      ? ["case", ["==", ["get", "verificationStatus"], "unverified"], "#bc765f", "#d1bd88"]
      : ["case", ["==", ["get", "verificationStatus"], "unverified"], "#d97b54", ["==", ["get", "sunnyNow"], true], "#e5aa38", "#3e7464"]);
  }
}

function showUserPosition(map: MapLibreMap, position: UserPosition) {
  const positionSource = map.getSource("user-position") as GeoJSONSource | undefined;
  const accuracySource = map.getSource("user-accuracy") as GeoJSONSource | undefined;
  if (!positionSource || !accuracySource) return false;
  positionSource.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [position.longitude, position.latitude] } });
  accuracySource.setData(circlePolygon(position.longitude, position.latitude, position.accuracy));
  map.easeTo({ center: [position.longitude, position.latitude], zoom: Math.max(map.getZoom(), 15) });
  return true;
}

export function MapExplorer({ user }: { user: CurrentUser | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const querySequence = useRef(0);
  const detailSequence = useRef(0);
  const pendingPosition = useRef<UserPosition | null>(null);
  const filtersRef = useRef<MapFilters>({});
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [filters, setFilters] = useState<MapFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bench, setBench] = useState<BenchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [mapLoading, setMapLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCoordinates, setAddCoordinates] = useState({ latitude: 46.82, longitude: 8.25 });

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
    const sequence = ++detailSequence.current;
    setSelectedId(id); setDetailLoading(true); setDetailError(false); setBench(null);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const detail = await getBenchDetail(id);
        if (!detail) throw new Error("Bench not found");
        if (sequence === detailSequence.current) setBench(detail);
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    let moveTimeout: number | undefined;
    let ambientTimer: number | undefined;
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
            { id: "background", type: "background", paint: { "background-color": "#e8dec5" } },
            { id: "swisstopo", type: "raster", source: "swisstopo", paint: { "raster-opacity": 0.72, "raster-saturation": -0.48, "raster-contrast": -0.12, "raster-brightness-min": 0.12, "raster-brightness-max": 0.96, "raster-hue-rotate": 8 } },
          ],
        },
      });
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("benchly", { type: "geojson", data: featureCollection([]) });
        map.addLayer({ id: "clusters", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "cluster"], paint: { "circle-color": "#294c45", "circle-opacity": 0.96, "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 15, 50, 21, 500, 28], "circle-stroke-width": 3, "circle-stroke-color": "#f8eed7", "circle-blur": 0.02 } });
        map.addLayer({ id: "cluster-count", type: "symbol", source: "benchly", filter: ["==", ["get", "kind"], "cluster"], layout: { "text-field": ["to-string", ["get", "count"]], "text-size": 12 }, paint: { "text-color": "#fff4d7" } });
        map.addLayer({ id: "benches", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "bench"], paint: { "circle-color": ["case", ["==", ["get", "verificationStatus"], "unverified"], "#d97b54", ["==", ["get", "sunnyNow"], true], "#e5aa38", "#3e7464"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 6.5, 18, 10], "circle-stroke-width": 2.5, "circle-stroke-color": "#fff4d8", "circle-blur": 0.01 } });
        map.addSource("user-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("user-position", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "user-accuracy", type: "fill", source: "user-accuracy", paint: { "fill-color": "#2d79c7", "fill-opacity": 0.12 } });
        map.addLayer({ id: "user-position", type: "circle", source: "user-position", paint: { "circle-color": "#2878c8", "circle-radius": 7, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
        applyMapAtmosphere(map);
        ambientTimer = window.setInterval(() => applyMapAtmosphere(map), 5 * 60 * 1000);
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
      map.on("moveend", () => {
        window.clearTimeout(moveTimeout);
        moveTimeout = window.setTimeout(() => { loadVisible(map, filtersRef.current); applyMapAtmosphere(map); }, 220);
      });
    });
    return () => { disposed = true; window.clearTimeout(moveTimeout); window.clearInterval(ambientTimer); mapRef.current?.remove(); mapRef.current = null; };
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
      if (!map || !showUserPosition(map, nextPosition)) pendingPosition.current = nextPosition;
      setMessage(`Standort auf etwa ${Math.round(accuracy)} m genau.`);
      window.setTimeout(() => setMessage(null), 3500);
    }, () => setMessage("Standort nicht verfügbar. Du kannst die Karte weiterhin verwenden."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };

  const choosePlace = (place: PlaceResult) => { mapRef.current?.easeTo({ center: [place.longitude, place.latitude], zoom: 14 }); };
  const openAdd = () => {
    const center = mapRef.current?.getCenter();
    if (center) setAddCoordinates({ latitude: center.lat, longitude: center.lng });
    setAddOpen(true);
  };
  const activeFilterCount = Object.values(filters).filter((value) => value !== undefined && value !== false && value !== "").length;
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-base-200">
      <div ref={containerRef} className="benchly-map absolute inset-0" aria-label="Karte der Schweizer Sitzbänke" />
      <header className="map-topbar safe-top pointer-events-none absolute inset-x-0 top-0 z-20 px-3 md:max-w-xl md:px-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <SearchBox onSelect={choosePlace} onLocate={locate} />
          <AppMenu user={user} onAdd={openAdd} activeFilters={activeFilterCount} onFilter={() => setFilterOpen(true)} />
        </div>
      </header>
      {filterOpen && <FilterPanel filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />}
      {mapLoading && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center"><div className="storybook-panel grid h-14 w-14 place-items-center rounded-full"><span className="loading loading-ring text-primary" /></div></div>}
      {message && <div role="status" className="toast toast-center top-36 z-30"><div className="storybook-panel flex min-h-11 items-center gap-2 rounded-2xl px-4 py-2 text-sm"><Info size={18} className="text-primary" /><span>{message}</span></div></div>}
      {selectedId && <BenchSheet bench={bench} loading={detailLoading} error={detailError} onRetry={() => void selectBench(selectedId)} user={user} onClose={() => { detailSequence.current += 1; setSelectedId(null); setBench(null); setDetailError(false); }} />}
      <AddBenchDialog open={addOpen} coordinates={addCoordinates} onClose={() => setAddOpen(false)} />
      <footer className="pointer-events-none absolute bottom-1 left-1 z-10 hidden text-[10px] opacity-60 md:block">© swisstopo · © OpenStreetMap-Mitwirkende</footer>
    </main>
  );
}
