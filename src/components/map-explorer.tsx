"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
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

const FALLBACK_MAP_STYLE = {
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
    { id: "background", type: "background", paint: { "background-color": "#ead9ad" } },
    { id: "swisstopo", type: "raster", source: "swisstopo", paint: { "raster-opacity": .7, "raster-saturation": -.36, "raster-contrast": -.18, "raster-hue-rotate": 8 } },
  ],
} satisfies StyleSpecification;

async function loadIllustratedMapStyle(): Promise<StyleSpecification> {
  try {
    const response = await fetch("https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json", { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`swisstopo style ${response.status}`);
    type MutableLayer = { id: string; type: string; "source-layer"?: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> };
    const style = JSON.parse(await response.text(), (key, value) => key === "text-font" ? ["Frutiger Neue Regular"] : value) as { layers: MutableLayer[] };
    for (const layer of style.layers) {
      const source = layer["source-layer"] ?? "";
      const paint = layer.paint ??= {};
      if (layer.type === "background") paint["background-color"] = "#f0e3bd";
      if (source === "hillshade") { paint["fill-color"] = layer.id.includes("yellow") ? "#d0b782" : "#8a8576"; paint["fill-opacity"] = layer.id.includes("yellow") ? .035 : .065; }
      if (source === "landcover") {
        if (layer.type === "fill") { paint["fill-color"] = "#a9bc8d"; paint["fill-opacity"] = layer.id.includes("pattern") ? .08 : .25; paint["fill-outline-color"] = "#728265"; }
        else { paint["line-color"] = "#728265"; paint["line-opacity"] = .4; }
      }
      if (source === "landuse") {
        if (layer.type === "fill") { paint["fill-color"] = layer.id.includes("parking") ? "#ddc9a2" : "#e2d5b5"; paint["fill-opacity"] = .3; paint["fill-outline-color"] = "#9f8e69"; }
        else { paint["line-color"] = "#9f8e69"; paint["line-opacity"] = .42; }
      }
      if (source === "water") {
        if (layer.type === "fill") { paint["fill-color"] = "#78aeb5"; paint["fill-opacity"] = .78; paint["fill-outline-color"] = "#4e7f85"; }
        else { paint["line-color"] = "#4e7f85"; paint["line-opacity"] = .7; }
      }
      if (source === "waterway" && layer.type === "line") { paint["line-color"] = "#4e858c"; paint["line-opacity"] = .78; paint["line-blur"] = .25; }
      if (source === "contour_line") { paint["line-color"] = layer.id.includes("blue") ? "#668f91" : "#a99068"; paint["line-opacity"] = .32; paint["line-blur"] = .2; }
      if (["scree", "hachure"].includes(source)) { paint["fill-color"] = "#aa956f"; paint["fill-opacity"] = .07; }
      if (source === "building" || source === "building_ln") {
        if (layer.type === "fill") { paint["fill-color"] = "#c9aa7c"; paint["fill-opacity"] = .58; paint["fill-outline-color"] = "#775d45"; }
        else { paint["line-color"] = "#755a43"; paint["line-opacity"] = .62; paint["line-blur"] = .25; }
      }
      if (source === "transportation") {
        const casing = layer.id.includes("casing");
        paint["line-color"] = casing ? "#755b48" : layer.id.includes("public_transport") ? "#87708b" : layer.id.includes("path") || layer.id.includes("pedestrian") ? "#a27952" : "#cf9275";
        paint["line-opacity"] = casing ? .56 : .68;
        paint["line-blur"] = casing ? .35 : .18;
      }
      if (source === "boundary") { paint["line-color"] = "#995d4d"; paint["line-opacity"] = .52; paint["line-blur"] = .25; }
      if (source === "park" && layer.type === "line") { paint["line-color"] = "#5f8065"; paint["line-opacity"] = .52; }
      if (layer.type === "symbol") {
        paint["text-color"] = source.includes("water") ? "#416f76" : source === "mountain_peak" ? "#604c3c" : "#3e493e";
        paint["text-halo-color"] = "#efe2bd";
        paint["text-halo-width"] = 1.3;
        paint["text-halo-blur"] = .45;
        if (["poi", "transportation_name", "spot_elevation"].includes(source)) paint["text-opacity"] = .7;
      }
    }
    return style as unknown as StyleSpecification;
  } catch {
    return FALLBACK_MAP_STYLE;
  }
}

function applyMapAtmosphere(map: MapLibreMap) {
  const center = map.getCenter();
  const { phase } = getDaylightState(new Date(), center.lat, center.lng);
  map.getContainer().dataset.phase = phase;
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
    Promise.all([import("maplibre-gl"), loadIllustratedMapStyle()]).then(([{ Map }, mapStyle]) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({
        container: containerRef.current,
        center: [8.25, 46.82],
        zoom: 7.2,
        minZoom: 6,
        maxZoom: 19,
        maxBounds: [[5.45, 45.55], [10.9, 48.05]],
        attributionControl: { compact: true, customAttribution: "Bankdaten © OpenStreetMap-Mitwirkende" },
        style: mapStyle,
      });
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("benchly", { type: "geojson", data: featureCollection([]) });
        map.addLayer({ id: "clusters", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "cluster"], paint: { "circle-color": "#294c45", "circle-opacity": 0.96, "circle-radius": ["interpolate", ["linear"], ["get", "count"], 2, 15, 50, 21, 500, 28], "circle-stroke-width": 3, "circle-stroke-color": "#f8eed7", "circle-blur": 0.02 } });
        map.addLayer({ id: "cluster-count", type: "symbol", source: "benchly", filter: ["==", ["get", "kind"], "cluster"], layout: { "text-field": ["to-string", ["get", "count"]], "text-font": ["Frutiger Neue Regular"], "text-size": 12 }, paint: { "text-color": "#fff4d7" } });
        map.addLayer({ id: "bench-hits", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "bench"], paint: { "circle-radius": 22, "circle-opacity": 0 } });
        map.addLayer({ id: "benches", type: "circle", source: "benchly", filter: ["==", ["get", "kind"], "bench"], paint: { "circle-color": ["case", ["==", ["get", "verificationStatus"], "unverified"], "#d97b54", ["==", ["get", "sunnyNow"], true], "#e5aa38", "#3e7464"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 8, 18, 12], "circle-stroke-width": 3, "circle-stroke-color": "#fff4d8", "circle-blur": 0.01 } });
        map.addSource("user-accuracy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("user-position", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("add-position", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "user-accuracy", type: "fill", source: "user-accuracy", paint: { "fill-color": "#2d79c7", "fill-opacity": 0.12 } });
        map.addLayer({ id: "user-position", type: "circle", source: "user-position", paint: { "circle-color": "#2878c8", "circle-radius": 7, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
        map.addLayer({ id: "add-position", type: "circle", source: "add-position", paint: { "circle-color": "#d58a32", "circle-radius": 10, "circle-stroke-width": 3, "circle-stroke-color": "#fff4d8" } });
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
        canvas.addEventListener("contextmenu", (event) => event.preventDefault());
        map.on("remove", () => { cancelPress(); canvas.removeEventListener("pointerdown", beginPress); canvas.removeEventListener("pointerup", cancelPress); canvas.removeEventListener("pointercancel", cancelPress); canvas.removeEventListener("pointermove", movePress); });
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
      <AddBenchDialog open={addOpen} coordinates={addCoordinates} onUseCurrentLocation={() => locate((position) => openAddAt(position.latitude, position.longitude))} onClose={closeAdd} />
      <footer className="pointer-events-none absolute bottom-1 left-1 z-10 hidden text-[10px] opacity-60 md:block">© swisstopo · © OpenStreetMap-Mitwirkende</footer>
    </main>
  );
}
