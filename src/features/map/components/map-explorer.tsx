"use client";
import { pointLabel } from "@/i18n/point-label";
import { useTranslations } from "next-intl";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Crosshair, Footprints, Info, List, MapPin, SlidersHorizontal, X } from "lucide-react";
import type { ReturnJourney } from "@/features/journey/model";
import type { WalkDraftSnapshot } from "@/features/walks/model";
import { discardWalkDraft, getWalkDraft } from "@/app/actions/walk-draft";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getBenchDetail, getMapBenchList, getMapFeatures } from "@/app/actions/map";
import type { CurrentUser } from "@/lib/security";
import type { BenchDetail, MapBenchListResult, MapFeature, MapFilters, PlaceResult } from "@/lib/types";
import { activeMapFilterCount, activeMapFilters } from "@/features/map/filters";
import { BenchSheet } from "@/features/bench-detail/components/bench-sheet";
import { FilterPanel } from "@/features/map/components/filter-panel";
import { SearchBox } from "@/features/map/components/search-box";
import { AddBenchDialog } from "@/features/bench-submission/components/add-bench-dialog";
import { AppMenu } from "@/components/app-menu";
import { AccountDialog } from "@/features/account/components/account-controls";
import type { MapSheetPresentation } from "@/components/map-sheet-shell";
import type { JourneyDraftSnapshot } from "@/features/journey/components/use-journey-planner";
import { CORE_MAP_ART, DECORATIVE_MAP_ART, TRANSIT_MAP_ART, loadWatercolorMapStyle, MINIMAL_MAP_STYLE } from "@/features/map/watercolor-style";
import { featureCollection, lastInspectedBenchFeature, selectedAmenityFeature, selectedBenchFeature, loadMapArt, addDecorativeMapLayers, addPainterlyVectorLayers, addTransitLayers, addCoreArtLayers, addCoreMapLayers, applyMapAtmosphere, clusterExpansionZoom, showUserPosition, type UserPosition } from "@/features/map/renderer";
import { benchHistoryCloseAction, visibleMapQuery, captureMapCamera, pushBenchHistoryEntry, readBenchHistoryEntry, restoreMapCamera, type ActiveMapTask, type BenchReturnContext, type PendingBenchHistoryClose } from "@/features/map/navigation";

const WalkPlanner = dynamic(() => import("@/features/walks/components/walk-planner").then((m) => m.WalkPlanner), { ssr: false, loading: WalkLoading });
const JourneyPlanner = dynamic(() => import("@/features/journey/components/journey-planner").then((m) => m.JourneyPlanner), {
  ssr: false, loading: JourneyLoading,
});

import type { NearbyAmenity } from "@/features/bench-detail/overview";
import { useMapLocation } from "./use-map-location";
import { LocationControl } from "./location-control";
import { requestUserPosition } from "@/lib/geolocation";
import { translateMessage } from "@/i18n/message";
import { BenchResultsList } from "./bench-results-list";
type LastInspectedBench = Pick<BenchDetail, "id" | "longitude" | "latitude">;

// Survives a client navigation/remount, but never storage, sharing, or reload.
let sessionLastInspectedBench: LastInspectedBench | null = null;

function WalkLoading() {
  const t = useTranslations("map.loading");
  return <aside className="journey-panel storybook-panel" role="status">{t("walk")}</aside>;
}
function JourneyLoading() {
  const t = useTranslations("map.loading");
  return <aside className="journey-panel storybook-panel" role="status">{t("journey")}</aside>;
}

export function MapExplorer({ user, initialBench = null }: { user: CurrentUser | null; initialBench?: BenchDetail | null }) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const querySequence = useRef(0);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const featuresRef = useRef<MapFeature[]>([]);
  const selectedPointRef = useRef<LastInspectedBench | null>(initialBench);
  const lastInspectedRef = useRef<LastInspectedBench | null>(initialBench ? null : sessionLastInspectedBench);
  const pendingPosition = useRef<UserPosition | null>(null);
  const openedFromUrl = useRef<string | null>(initialBench?.id ?? null);
  const pendingHistoryClose = useRef<PendingBenchHistoryClose | null>(null);
  const initialBenchRef = useRef(initialBench);
  const initialFocusDone = useRef(false);
  const filtersRef = useRef<MapFilters>({});
  const listOpenRef = useRef(false);
  const listRef = useRef<HTMLOListElement>(null);
  const mapInteraction = useRef(0);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [filters, setFilters] = useState<MapFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [listResult, setListResult] = useState<MapBenchListResult>({ items: [], zoomRequired: true });
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialBench?.id ?? null);
  const [bench, setBench] = useState<BenchDetail | null>(initialBench);
  const [facilityFocus, setFacilityFocus] = useState<{ amenity: NearbyAmenity; bench: BenchDetail; camera: ReturnType<typeof captureMapCamera> | null } | null>(null);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [journeyDraft, setJourneyDraft] = useState<JourneyDraftSnapshot | null>(null);
  const updateJourneyDraft = useCallback((draft: JourneyDraftSnapshot) => setJourneyDraft(draft), []);
  const journeyPresentationRef = useRef<MapSheetPresentation | null>(null);
  const [walkOpen, setWalkOpen] = useState(false);
  const [walkDraft, setWalkDraft] = useState<WalkDraftSnapshot | null>(null);
  const walkPresentationRef = useRef<MapSheetPresentation | null>(null);
  const [walkDraftLoaded, setWalkDraftLoaded] = useState(false);
  const updateWalkDraft = useCallback((draft: WalkDraftSnapshot) => setWalkDraft(draft), []);
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
  const handledAmenity = useRef<string | null>(null);
  const [benchReturn, setBenchReturn] = useState<BenchReturnContext>({ kind: "map", cameraInteraction: 0 });
  const benchPresentationRef = useRef<MapSheetPresentation | null>(null);
  const benchReturnRef = useRef(benchReturn);
  useEffect(() => { benchReturnRef.current = benchReturn; }, [benchReturn]);
  const updateBenchReturn = useCallback((context: BenchReturnContext) => {
    benchReturnRef.current = context;
    setBenchReturn(context);
  }, []);
  useEffect(() => { canAdd.current = Boolean(user); }, [user]);
  const [addCoordinates, setAddCoordinates] = useState({ latitude: 46.82, longitude: 8.25 });
  useEffect(() => {
    let active = true;
    void getWalkDraft().then((draft) => { if (active) setWalkDraft(draft); }).catch(() => undefined)
      .finally(() => { if (active) setWalkDraftLoaded(true); });
    return () => { active = false; };
  }, []);

  const loadVisible = useCallback(async (map: MapLibreMap, nextFilters: MapFilters) => {
    const sequence = ++querySequence.current;
    try {
      const result = await getMapFeatures(visibleMapQuery(map, nextFilters));
      if (sequence === querySequence.current) {
        featuresRef.current = result;
        setFeatures(result);
        (map.getSource("benchly") as GeoJSONSource | undefined)?.setData(featureCollection(result));
        const last = lastInspectedRef.current;
        const lastStillVisible = Boolean(last && (activeMapFilterCount(nextFilters) === 0 || result.some((feature) => feature.kind === "bench" && feature.id === last.id)));
        if (last && !lastStillVisible) lastInspectedRef.current = sessionLastInspectedBench = null;
        (map.getSource("last-inspected-bench") as GeoJSONSource | undefined)?.setData(lastInspectedBenchFeature(lastStillVisible ? last : null));
        if (lastStillVisible && last) map.getContainer().dataset.lastInspectedBench = last.id;
        else delete map.getContainer().dataset.lastInspectedBench;
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
    if (selectedPointRef.current?.id !== id) selectedPointRef.current = null;
    lastInspectedRef.current = null;
    setJourneyOpen(false); setWalkOpen(false); setReturnJourney(null);
    setFacilityFocus(null);
    (mapRef.current?.getSource("selected-amenity") as GeoJSONSource | undefined)?.setData(selectedAmenityFeature());
    const sequence = ++detailSequence.current;
    setSelectedId(id); setDetailLoading(true); setDetailError(false); setBench(null);
    (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature());
    (mapRef.current?.getSource("last-inspected-bench") as GeoJSONSource | undefined)?.setData(lastInspectedBenchFeature());
    if (mapRef.current) delete mapRef.current.getContainer().dataset.lastInspectedBench;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const detail = await getBenchDetail(id);
        if (!detail) throw new Error("Bench not found");
        if (sequence === detailSequence.current) {
          selectedPointRef.current = detail;
          sessionLastInspectedBench = { id: detail.id, longitude: detail.longitude, latitude: detail.latitude };
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

  const openBenchTask = useCallback((id: string, returnContext: BenchReturnContext, focusOnMap = false, point?: { longitude: number; latitude: number }) => {
    benchPresentationRef.current = null;
    if (point) selectedPointRef.current = sessionLastInspectedBench = { id, ...point };
    updateBenchReturn(returnContext);
    openedFromUrl.current = id;
    void selectBench(id, focusOnMap);
    pushBenchHistoryEntry(id, returnContext);
  }, [selectBench, updateBenchReturn]);

  const locateAmenity = useCallback((amenity: NearbyAmenity) => {
    if (!bench || amenity.latitude === null || amenity.longitude === null) return;
    const selectedBench = bench;
    detailSequence.current += 1;
    setFacilityFocus({ amenity, bench: selectedBench, camera: mapRef.current ? captureMapCamera(mapRef.current) : null });
    setSelectedId(null);
    setBench(null);
    setDetailError(false);
    (mapRef.current?.getSource("selected-amenity") as GeoJSONSource | undefined)?.setData(selectedAmenityFeature({
      latitude: amenity.latitude,
      longitude: amenity.longitude,
      marker: amenity.category === "toilets" ? "WC" : amenity.category === "waste_basket" ? "♲" : "H2O",
    }));
    const map = mapRef.current;
    if (map) map.fitBounds([
      [Math.min(selectedBench.longitude, amenity.longitude), Math.min(selectedBench.latitude, amenity.latitude)],
      [Math.max(selectedBench.longitude, amenity.longitude), Math.max(selectedBench.latitude, amenity.latitude)],
    ], {padding: {top: 110, right: 55, bottom: 180, left: 55}, maxZoom: 19, duration: 650});
  }, [bench]);

  const closeAmenity = () => {
    setFacilityFocus(null);
    (mapRef.current?.getSource("selected-amenity") as GeoJSONSource | undefined)?.setData(selectedAmenityFeature());
    (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature());
  };

  const returnFromAmenity = () => {
    if (!facilityFocus) return;
    const { bench: previousBench, camera } = facilityFocus;
    closeAmenity();
    if (camera && mapRef.current) restoreMapCamera(mapRef.current, camera);
    void selectBench(previousBench.id);
  };

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
    openedFromUrl.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("bank");
    url.searchParams.delete("amenity");
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    setSelectedId(null); setBench(null); setJourneyOpen(false); setWalkOpen(false); setReturnJourney(null); setFilterOpen(false);
    (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature());
    setAddCoordinates({ latitude, longitude });
    setAddStage("position");
    mapRef.current?.stop();
    mapRef.current?.jumpTo({ center: [longitude, latitude], zoom: Math.max(17, mapRef.current.getZoom()) });
  }, [router]);

  const openAddAt = useCallback((latitude: number, longitude: number) => {
    if (!canAdd.current) {
      pendingAdd.current = { latitude, longitude };
      addAccount.current?.showModal();
      return;
    }
    beginPlacement(latitude, longitude);
  }, [beginPlacement]);

  const locationNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapLocation = useMapLocation(getJourneyMap, mapReady,
    Boolean(selectedId || journeyOpen || walkOpen || returnJourney || addStage || listOpen || facilityFocus || filterOpen),
    (notice) => {
      if (locationNoticeTimer.current) clearTimeout(locationNoticeTimer.current);
      const text = translateMessage(t, notice);
      setMessage(text);
      locationNoticeTimer.current = setTimeout(() => setMessage((current) => current === text ? null : current), 4_000);
    });
  useEffect(() => () => { if (locationNoticeTimer.current) clearTimeout(locationNoticeTimer.current); }, []);
  const locateForPlacement = async () => {
    setMessage(t("map.location.searching"));
    try {
      const { coords } = await requestUserPosition();
      if (!placingRef.current) return;
      const position = { longitude: coords.longitude, latitude: coords.latitude, accuracy: coords.accuracy };
      if (!mapRef.current || !showUserPosition(mapRef.current, position)) pendingPosition.current = position;
      beginPlacement(coords.latitude, coords.longitude);
      setMessage(t("map.location.accuracy", { meters: Math.round(coords.accuracy) }));
    } catch { if (placingRef.current) setMessage(t("map.location.unavailable")); }
  };

  const locateFromSearch = () => {
    if (addStage === "position") { void locateForPlacement(); return; }
    if (selectedId || journeyOpen || walkOpen || returnJourney || listOpen || facilityFocus) {
      const interaction = mapInteraction.current;
      const detail = detailSequence.current;
      setMessage(t("map.location.searching"));
      void requestUserPosition().then(({ coords }) => {
        const map = mapRef.current;
        if (!map || mapInteraction.current !== interaction || detailSequence.current !== detail) return;
        const bounds = map.getMaxBounds();
        if (bounds && !bounds.contains([coords.longitude, coords.latitude])) { setMessage(t("map.location.outside")); return; }
        showUserPosition(map, { longitude: coords.longitude, latitude: coords.latitude, accuracy: coords.accuracy });
        map.easeTo({ center: [coords.longitude, coords.latitude], zoom: Math.max(map.getZoom(), 15) });
        setMessage(null);
      }).catch(() => setMessage(t("map.location.unavailable")));
      return;
    }
    mapLocation.locate();
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
      const sharedBench = initialBenchRef.current;
      const map = new Map({
        container: containerRef.current,
        center: sharedBench ? [sharedBench.longitude, sharedBench.latitude] : [8.25, 46.82],
        zoom: sharedBench ? 17 : 7.2,
        minZoom: 6,
        maxZoom: 19,
        maxBounds: [[5.45, 45.55], [10.9, 48.05]],
        attributionControl: false,
        maplibreLogo: false,
        locale: { "Map.Title": t("map.canvas.interactive"), "AttributionControl.ToggleAttribution": t("map.canvas.attribution") },
        style: MINIMAL_MAP_STYLE,
      });
      map.addControl(new AttributionControl({
        compact: false,
        customAttribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
      }), "bottom-right");
      mapRef.current = map;
      map.getContainer().dataset.orientationMode = "north";
      if (sharedBench) map.getContainer().dataset.focusBench = sharedBench.id;

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
            const returnContext: BenchReturnContext = { kind: "map", camera: captureMapCamera(map), cameraInteraction: mapInteraction.current };
            map.easeTo({ center: [item.longitude, item.latitude], offset: [0, -100], duration: 450 });
            openBenchTask(item.id, returnContext, false, item);
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
          mapInteraction.current += 1;
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

      // Keep the exposed camera in sync with the live map, not only the last
      // completed animation. Back/Forward can interrupt an ease mid-frame.
      const syncCameraState = () => {
        const center = map.getCenter();
        const { dataset } = map.getContainer();
        dataset.centerLatitude = center.lat.toFixed(6);
        dataset.centerLongitude = center.lng.toFixed(6);
        dataset.zoom = map.getZoom().toFixed(2);
        // A shared/deep-linked bench is focused in the URL-sync effect after
        // the map becomes interactive. Until that first focus has actually
        // started, exposing `cameraMoving=false` creates a false settled frame:
        // callers can snapshot the constructor camera while the bench-offset
        // animation is about to move it. Keep the public camera contract busy
        // through that hand-off; the normal move/moveend events then take over.
        const initialBenchFocusPending = Boolean(sharedBench && !initialFocusDone.current);
        dataset.cameraMoving = String(initialBenchFocusPending || map.isMoving());
      };
      syncCameraState();
      map.on("movestart", syncCameraState);
      map.on("move", syncCameraState);
      map.on("moveend", syncCameraState);
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

  useEffect(() => {
    const action = searchParams.get("action");
    if (!mapReady || !action || handledAction.current === action) return;
    if (action === "journey" && !bench) return;
    handledAction.current = action;
    const timer = window.setTimeout(() => {
      if (action === "filter") setFilterOpen(true);
      if (action === "walk") setWalkOpen(true);
      if (action === "journey") setJourneyOpen(true);
      if (action === "add") { const point = mapRef.current?.getCenter(); if (point) openAddAt(point.lat, point.lng); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mapReady, searchParams, openAddAt, bench]);
  useEffect(() => {
    const sourceId = searchParams.get("amenity");
    if (!mapReady || !bench || !sourceId || handledAmenity.current === sourceId) return;
    const amenity = bench.knowledge?.amenities.find((item) => item.sourceId === sourceId || (!item.sourceId && item.category === sourceId));
    if (!amenity) return;
    handledAmenity.current = sourceId;
    const timer = window.setTimeout(() => locateAmenity(amenity), 0);
    return () => window.clearTimeout(timer);
  }, [mapReady, bench, searchParams, locateAmenity]);

  const choosePlace = (place: PlaceResult) => {
    const map = mapRef.current;
    const zoom = place.kind === "bench" ? 17 : 14;
    if (!placingRef.current && place.kind === "bench" && place.benchId) {
      const camera = map ? {
        ...captureMapCamera(map),
        center: [place.longitude, place.latitude] as [number, number],
        zoom,
      } : undefined;
      map?.easeTo({ center: [place.longitude, place.latitude], zoom });
      openBenchTask(place.benchId, { kind: "map", camera, cameraInteraction: mapInteraction.current }, false, place);
      return;
    }
    map?.easeTo({ center: [place.longitude, place.latitude], zoom });
  };
  const openAdd = () => {
    const center = mapRef.current?.getCenter();
    const fallback = selectedPointRef.current ?? initialBenchRef.current;
    // The menu is usable before the async MapLibre import has finished. Do not
    // make “Bänkli eintragen” a no-op during that short startup window: use the
    // last meaningful place, or the same Swiss centre used by placement state.
    openAddAt(
      center?.lat ?? fallback?.latitude ?? addCoordinates.latitude,
      center?.lng ?? fallback?.longitude ?? addCoordinates.longitude,
    );
  };
  const openWalk = () => {
    listOpenRef.current = false;
    setListOpen(false);
    setWalkOpen(true);
  };
  const endWalk = () => {
    void discardWalkDraft().then(() => { walkPresentationRef.current = null; setWalkDraft(null); setWalkOpen(false); setReturnJourney(null); })
      .catch(() => setMessage(t("walks.planner.failed")));
  };
  const openList = () => {
    const map = mapRef.current;
    // The list belongs to this viewport. Do not let an earlier search/bench
    // focus continue moving it while rows and their return context are read.
    map?.stop();
    listOpenRef.current = true;
    setListOpen(true);
    if (map) void loadBenchList(map, filtersRef.current);
  };
  const closeList = () => {
    listSequence.current += 1;
    listOpenRef.current = false;
    setListOpen(false);
  };
  const restoreListContext = (context: Extract<BenchReturnContext, { kind: "list" }>) => {
    if (mapRef.current && context.cameraInteraction === mapInteraction.current) restoreMapCamera(mapRef.current, context.camera);
    listOpenRef.current = true;
    setListOpen(true);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = context.scrollTop;
      const trigger = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-bench-list-id]") ?? [])]
        .find((button) => button.dataset.benchListId === context.benchId);
      trigger?.focus({ preventScroll: true });
    }));
  };
  const closeBench = () => {
    detailSequence.current += 1;
    (mapRef.current?.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature());
    setSelectedId(null);
    setBench(null);
    setDetailError(false);
    const context = benchReturnRef.current;
    const inspected = bench ?? selectedPointRef.current;
    const keepLastInspected = Boolean(context.kind === "map" && inspected && (activeMapFilterCount(filtersRef.current) === 0 || featuresRef.current.some((feature) => feature.kind === "bench" && feature.id === inspected.id)));
    lastInspectedRef.current = sessionLastInspectedBench = keepLastInspected ? inspected : null;
    (mapRef.current?.getSource("last-inspected-bench") as GeoJSONSource | undefined)?.setData(lastInspectedBenchFeature(keepLastInspected ? inspected : null));
    if (keepLastInspected && inspected && mapRef.current) mapRef.current.getContainer().dataset.lastInspectedBench = inspected.id;
    else if (mapRef.current) delete mapRef.current.getContainer().dataset.lastInspectedBench;
    if (context.kind === "walk") {
      updateBenchReturn({ kind: "map", cameraInteraction: mapInteraction.current });
      openWalk();
      return;
    }
    if (context.kind === "list") {
      restoreListContext(context);
      return;
    }
    if (context.camera && context.cameraInteraction === mapInteraction.current && mapRef.current) restoreMapCamera(mapRef.current, context.camera);
  };
  const closeBenchFromUi = () => {
    const selected = selectedId;
    const historyEntry = readBenchHistoryEntry(window.history.state);
    if (selected && historyEntry?.benchId === selected) {
      // Bench entries opened inside the app own one history entry. Keep the
      // sheet mounted until that entry is actually left: closing local state
      // first lets WebKit and Next disagree about which camera/return context
      // belongs to the visible URL. If Next has not committed the pushed URL
      // yet, the URL-sync effect starts Back as soon as both views agree.
      const pending = { benchId: selected, backStarted: searchParams.get("bank") === selected };
      pendingHistoryClose.current = pending;
      if (pending.backStarted) window.history.back();
      return;
    }
    pendingHistoryClose.current = null;
    closeBench();
    openedFromUrl.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("bank");
    // Direct links have no owned history entry to go back to. Remove the local
    // selection synchronously so an intervening render cannot reopen it.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  useEffect(() => {
    // Native history updates window.location synchronously; useSearchParams can
    // lag by one render while the local task state has already changed.
    const requestedBench = new URL(window.location.href).searchParams.get("bank");
    const routerRequestedBench = searchParams.get("bank");
    const pendingClose = pendingHistoryClose.current;
    if (pendingClose) {
      const action = benchHistoryCloseAction(pendingClose, requestedBench, routerRequestedBench);
      if (action === "back") {
        pendingClose.backStarted = true;
        window.history.back();
        return;
      }
      if (action === "complete") {
        pendingHistoryClose.current = null;
        openedFromUrl.current = null;
        if (selectedId === pendingClose.benchId) closeBench();
        return;
      }
      if (action === "wait") return;
      // Another navigation replaced the bench before the pending close
      // completed. Abandon the stale close and let the normal URL branch below
      // open the new task.
      pendingHistoryClose.current = null;
    }
    const map = mapRef.current;
    if (!mapReady || !map) return;
    // Auth refreshes may complete from a route tree captured before placement
    // started. Placement owns the foreground until it is cancelled or saved.
    if (placingRef.current) {
      openedFromUrl.current = null;
      if (requestedBench) {
        const url = new URL(window.location.href);
        url.searchParams.delete("bank");
        url.searchParams.delete("amenity");
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
      }
      return;
    }
    if (!requestedBench) {
      const hadUrlSelection = Boolean(openedFromUrl.current);
      openedFromUrl.current = null;
      if (hadUrlSelection && selectedId) closeBench();
      return;
    }
    const primed = initialBenchRef.current;
    if (primed?.id === requestedBench && openedFromUrl.current === requestedBench) {
      if (initialFocusDone.current) return;
      initialFocusDone.current = true;
      (map.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature(primed));
      map.easeTo({ center: [primed.longitude, primed.latitude], zoom: Math.max(map.getZoom(), 17), offset: [0, -100], duration: 650 });
      const sequence = ++detailSequence.current;
      void getBenchDetail(requestedBench).then((detail) => {
        if (!detail || sequence !== detailSequence.current) return;
        setBench(detail);
        (map.getSource("selected-bench") as GeoJSONSource | undefined)?.setData(selectedBenchFeature(detail));
      }).catch(() => undefined);
      return;
    }
    if (openedFromUrl.current === requestedBench) return;
    const historyEntry = readBenchHistoryEntry(window.history.state);
    updateBenchReturn(historyEntry?.benchId === requestedBench
      ? historyEntry.returnContext
      : { kind: "map", cameraInteraction: mapInteraction.current });
    openedFromUrl.current = requestedBench;
    void selectBench(requestedBench, true);
  // The URL is the external trigger. Return helpers deliberately read their
  // latest refs so ordinary render changes do not replay navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, searchParams, selectedId]);
  const closeAdd = () => {
    const source = mapRef.current?.getSource("add-position") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [] });
    placingRef.current = false;
    setAddStage(null);
  };
  const activeFilterCount = activeMapFilterCount(filters);
  const activeTask: ActiveMapTask = addStage
    ? { kind: "add", stage: addStage }
    : facilityFocus
      ? { kind: "facility", benchId: facilityFocus.bench.id }
      : returnJourney
        ? { kind: "return-journey" }
        : walkOpen
          ? { kind: "walk" }
          : journeyOpen && selectedId
            ? { kind: "journey", benchId: selectedId }
            : selectedId
              ? { kind: "bench", benchId: selectedId, origin: benchReturn.kind }
              : listOpen
                ? { kind: "list" }
                : { kind: "browse" };
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-base-200" data-active-task={activeTask.kind}>
      <div ref={containerRef} className="benchly-map absolute inset-0" aria-label={t("map.canvas.label")} aria-busy={mapLoading} />
      <header className="map-topbar safe-top pointer-events-none absolute inset-x-0 top-0 z-20 px-3 md:max-w-xl md:px-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <SearchBox onSelect={choosePlace} onLocate={locateFromSearch} />
          <button id="map-filter-toggle" aria-label={t("map.filters.open")} aria-expanded={filterOpen} className="map-filter-button" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={19} /><span>{t("map.filters.button")}</span>{activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button>
          <AppMenu user={user} onAdd={openAdd} onWalk={openWalk} />
        </div>
        {activeFilterCount > 0 && <div className="active-filter-chips pointer-events-auto" aria-label={t("map.filters.active")}>{activeMapFilters(filters, t).map(({ key, label }) => <button key={key} type="button" aria-label={t("map.filters.remove", { label })} onClick={() => setFilters((current) => ({ ...current, [key]: undefined }))}>{label}<X size={14} /></button>)}</div>}
      </header>
      {addStage === "position" && <>
        <div className="placement-crosshair" aria-hidden="true"><Crosshair size={38} /></div>
        <section className="placement-controls" aria-label={t("map.placement.title")}><h2>{t("map.placement.title")}</h2><p>{t("map.placement.instructions")}</p><button type="button" onClick={() => void locateForPlacement()}><Crosshair size={18} /> {t("map.location.use")}</button><div><button type="button" onClick={closeAdd}>{t("common.actions.cancel")}</button><button type="button" className="btn btn-primary" onClick={() => { const map = mapRef.current; if (!map) return; map.stop(); const point = map.getCenter(); setAddCoordinates({ latitude: point.lat, longitude: point.lng }); setAddStage("details"); }}>{t("map.placement.confirm")}</button></div></section>
      </>}
      {filterOpen && <FilterPanel filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />}
      {mapLoading && <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2"><div className="storybook-panel flex min-h-10 items-center gap-2 rounded-full px-3 text-xs text-base-content/65"><span className="loading loading-ring loading-sm text-primary" /><span>{t("map.canvas.loading")}</span></div></div>}
      {message && <div role="status" className="toast toast-center pointer-events-none top-36 z-30"><div className="storybook-panel flex min-h-11 items-center gap-2 rounded-2xl px-4 py-2 text-sm"><Info size={18} className="text-primary" /><span>{message === "map.canvas.failed" ? t("map.canvas.failed") : message}</span></div></div>}
      {!addStage && !journeyOpen && !walkOpen && !returnJourney && !selectedId && !listOpen && !facilityFocus && !filterOpen && <LocationControl state={mapLocation.state} onToggle={mapLocation.toggle} onNorth={mapLocation.north} />}
      {!addStage && !journeyOpen && !walkOpen && !returnJourney && !selectedId && !listOpen && !facilityFocus && <div className="map-discovery-actions">
        <button className="walk-entry" onClick={openWalk}><Footprints size={20} /><span className="walk-entry-long">{t(walkDraft?.result ? "walks.planner.resume" : "walks.planner.title")}</span><span className="walk-entry-short">{t("common.navigation.walk")}</span></button>
        <button className="list-entry" onClick={openList}><List size={20} /> {t("map.list.button")}</button>
      </div>}
      {listOpen && !selectedId && <BenchResultsList result={listResult} loading={listLoading} error={listError} activeFilterCount={activeFilterCount} scrollRef={listRef}
        onClose={closeList} onRetry={() => { const map = mapRef.current; if (map) void loadBenchList(map, filtersRef.current); }}
        onZoom={() => mapRef.current?.zoomTo(14, { duration: 450 })}
        onSelect={(item) => {
          const map = mapRef.current;
          const returnContext = map ? { kind: "list" as const, benchId: item.id, scrollTop: listRef.current?.scrollTop ?? 0, camera: captureMapCamera(map), cameraInteraction: mapInteraction.current } : null;
          closeList();
          if (returnContext) openBenchTask(item.id, returnContext, true, item);
        }} />}
      {walkOpen && walkDraftLoaded && <WalkPlanner getMap={getJourneyMap} initial={walkDraft} onSnapshot={updateWalkDraft} presentation={walkPresentationRef.current} onPresentationChange={(presentation) => { walkPresentationRef.current = presentation; }} onClose={() => setWalkOpen(false)} onEnd={endWalk} onReturn={(value) => { setWalkOpen(false); setReturnJourney(value); }} onInspectBench={(id) => { setWalkOpen(false); openBenchTask(id, { kind: "walk" }, true); }} />}
      {returnJourney && <JourneyPlanner key="return" bench={{ id: "return", title: pointLabel(returnJourney.destination, t) }} initial={returnJourney} getMap={getJourneyMap} onClose={() => { setReturnJourney(null); setWalkOpen(true); }} />}
      {journeyOpen && bench && <JourneyPlanner key={bench.id} bench={bench} draft={journeyDraft} onSnapshot={updateJourneyDraft} presentation={journeyPresentationRef.current} onPresentationChange={(presentation) => { journeyPresentationRef.current = presentation; }} getMap={getJourneyMap} onClose={() => setJourneyOpen(false)} />}
      {selectedId && !journeyOpen && !walkOpen && !returnJourney && <BenchSheet created={createdBenchId === selectedId} initiallyExpanded={searchParams.get("bank") === selectedId} returnTarget={benchReturn.kind} presentation={benchPresentationRef.current} onPresentationChange={(presentation) => { benchPresentationRef.current = presentation; }} bench={bench} loading={detailLoading} error={detailError} onRetry={() => void selectBench(selectedId)} onBenchChange={refreshSelectedBench} onJourney={() => { if (journeyDraft?.benchId !== selectedId) journeyPresentationRef.current = null; setJourneyOpen(true); }} onResumeWalk={walkDraft?.result ? openWalk : undefined} onLocateAmenity={locateAmenity} user={user} onClose={closeBenchFromUi} />}
      {facilityFocus && <section className="amenity-map-callout" aria-label={t("bench.summary.mapLocation")}>
        <MapPin size={20} /><div><small>{t("bench.summary.nearbyTitle")}</small><strong>{t(facilityFocus.amenity.category === "toilets" ? "knowledge.amenities.toilets" : facilityFocus.amenity.category === "fountain" ? "knowledge.amenities.fountain" : "knowledge.amenities.drinking_water")}</strong><span>{t("bench.summary.straightLine", {distance: Math.round(facilityFocus.amenity.distanceMeters!)})}</span></div>
        <button type="button" onClick={returnFromAmenity}>{t("bench.summary.returnToBench")}</button>
        <button type="button" className="amenity-map-close" aria-label={t("common.actions.close")} onClick={returnFromAmenity}><X size={18} /></button>
      </section>}
      {addStage === "details" && <AddBenchDialog coordinates={addCoordinates} onChoosePosition={() => setAddStage("position")} onClose={closeAdd} onExisting={(id) => { closeAdd(); openBenchTask(id, { kind: "map", cameraInteraction: mapInteraction.current }, true); }} onCreated={(id) => { closeAdd(); setCreatedBenchId(id); openBenchTask(id, { kind: "map", cameraInteraction: mapInteraction.current }, true); if (mapRef.current) void loadVisible(mapRef.current, filtersRef.current); }} />}
      <AccountDialog dialogRef={addAccount} intent={t("common.navigation.addBench")} onAuthenticated={() => { canAdd.current = true; const point = pendingAdd.current; pendingAdd.current = null; if (point) beginPlacement(point.latitude, point.longitude); }} />
    </main>
  );
}
