import type { Map as MapLibreMap } from "maplibre-gl";
import type { UiMessage } from "@/i18n/message";
import { locationOptions } from "@/lib/geolocation";
import { compassHeading, headingDelta, normalizeHeading, waitForCompassHeading, type OrientationConstructor } from "./compass";
import { showUserPosition, showUserHeading, type UserPosition } from "./renderer";

export type LocationMode = "browse" | "north" | "heading";
export type LocationState = { mode: LocationMode; pending: "location" | "compass" | null; bearing: number };
export const initialLocationState: LocationState = { mode: "browse", pending: null, bearing: 0 };
const ownMove = { locationFollow: true };

/** Keeps raw sensor readings in memory and releases subscriptions when inactive. */
export function createLocationController(map: MapLibreMap, publish: (state: LocationState) => void,
  notify: (message: UiMessage) => void) {
  let state = { ...initialLocationState };
  let position: UserPosition | null = null;
  let watch: number | null = null;
  let generation = 0;
  let request: AbortController | null = null;
  let heading: number | null = null;
  let targetHeading: number | null = null;
  let lastFrame = 0;
  let frame: number | null = null;
  let disposed = false;
  const pointers = new Set<number>();

  const emit = (change: Partial<LocationState> = {}) => {
    state = { ...state, ...change, bearing: Math.round(map.getBearing()) };
    const data = map.getContainer().dataset;
    data.locationMode = state.mode;
    data.orientationMode = state.pending === "compass" ? "requesting" : state.mode === "heading" ? "heading" : "north";
    if (!disposed) publish(state);
  };
  const paint = () => {
    if (position) showUserPosition(map, position);
    showUserHeading(map, position, heading);
  };
  const move = (initial = false) => {
    if (!position || state.mode === "browse" || pointers.size) return;
    map.easeTo({ center: [position.longitude, position.latitude], bearing: state.mode === "heading" ? heading ?? 0 : 0,
      ...(initial ? { zoom: Math.max(map.getZoom(), 15) } : {}),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : initial ? 450 : 180 }, ownMove);
  };
  const stopCompass = () => {
    request?.abort(); request = null;
    window.removeEventListener("deviceorientationabsolute", orient);
    window.removeEventListener("deviceorientation", orient);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; heading = null; targetHeading = null;
    delete map.getContainer().dataset.deviceHeading;
    showUserHeading(map, position, null);
  };
  const pause = () => {
    generation++;
    if (watch !== null) navigator.geolocation?.clearWatch(watch);
    watch = null;
    stopCompass();
    emit({ mode: "browse", pending: null });
  };
  const locationFailure = () => { pause(); notify({ key: "map.location.unavailable" }); };
  const locate = () => {
    if (disposed || document.hidden) return;
    pause();
    if (!navigator.geolocation) { notify({ key: "map.location.unsupported" }); return; }
    const token = ++generation;
    emit({ pending: "location" });
    notify({ key: "map.location.searching" });
    try {
      watch = navigator.geolocation.watchPosition((fix) => {
        if (disposed || token !== generation) return;
        const { latitude, longitude, accuracy } = fix.coords;
        if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy < 0) { locationFailure(); return; }
        const bounds = map.getMaxBounds();
        if (bounds && !bounds.contains([longitude, latitude])) {
          pause(); notify({ key: "map.location.outside" }); return;
        }
        const first = state.pending === "location";
        position = { latitude, longitude, accuracy };
        if (first) emit({ mode: "north", pending: null });
        paint(); move(first);
        if (first) notify({ key: "map.location.accuracy", values: { meters: Math.round(accuracy) } });
      }, () => { if (token === generation && !disposed) locationFailure(); }, locationOptions);
    } catch { locationFailure(); }
  };
  function updateHeading(time: number) {
    frame = null;
    if (disposed || pointers.size || state.mode === "browse" || targetHeading === null) return;
    const elapsed = time - lastFrame;
    // Paint at most ten times a second, but keep the final reading scheduled.
    // Sensor-event frequency must not determine whether smoothing converges.
    if (elapsed >= 100) {
      lastFrame = time;
      const next = heading === null ? targetHeading
        : normalizeHeading(heading + headingDelta(heading, targetHeading) * (1 - Math.exp(-elapsed / 160)));
      heading = Math.abs(headingDelta(next, targetHeading)) <= .5 ? targetHeading : next;
      map.getContainer().dataset.deviceHeading = String(Math.round(heading));
      paint();
      if (state.mode === "heading") move();
    }
    if (heading !== targetHeading) frame = requestAnimationFrame(updateHeading);
  }
  function scheduleHeading() {
    if (disposed || pointers.size || state.mode === "browse" || frame !== null || targetHeading === null || heading === targetHeading) return;
    lastFrame = performance.now();
    frame = requestAnimationFrame(updateHeading);
  }
  function orient(event: Event) {
    if (pointers.size) return;
    const next = compassHeading(event);
    if (next === null) return;
    targetHeading = next;
    scheduleHeading();
  }
  const north = () => {
    if (state.mode !== "browse") emit({ mode: "north", pending: null });
    request?.abort(); request = null;
    map.easeTo({ bearing: 0, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250 }, ownMove);
  };
  const toggle = async () => {
    if (disposed || state.pending) return;
    if (state.mode === "browse") { locate(); return; }
    if (state.mode === "heading") { north(); return; }
    if (heading !== null) { emit({ mode: "heading" }); move(); return; }
    const Orientation = window.DeviceOrientationEvent as OrientationConstructor | undefined;
    if (!Orientation) { notify({ key: "map.orientation.unsupported" }); return; }
    const abort = new AbortController(); request = abort;
    emit({ pending: "compass" });
    try {
      // Must be called from this click, before awaiting anything (Safari activation).
      const permission = Orientation.requestPermission?.(true);
      if (permission && await permission !== "granted") {
        if (!abort.signal.aborted) notify({ key: "map.orientation.denied" });
        return;
      }
      if (abort.signal.aborted) return;
      const initial = await waitForCompassHeading(abort.signal);
      if (abort.signal.aborted || disposed) return;
      if (initial === null) { notify({ key: "map.orientation.unavailable" }); return; }
      heading = initial; targetHeading = initial;
      window.addEventListener("deviceorientationabsolute", orient);
      window.addEventListener("deviceorientation", orient);
      emit({ mode: "heading", pending: null });
      map.getContainer().dataset.deviceHeading = String(Math.round(initial));
      paint(); move();
    } catch {
      if (!abort.signal.aborted) notify({ key: "map.orientation.unavailable" });
    } finally {
      if (request === abort) { request = null; emit({ pending: null }); }
    }
  };
  const externalMove = (event: { type: string; locationFollow?: boolean }) => {
    // Search, route fitting and user gestures all release camera ownership.
    if (!event.locationFollow && (state.mode !== "browse" || state.pending)) pause();
  };
  const rotate = () => { if (state.bearing !== Math.round(map.getBearing())) emit(); };
  const visibility = () => { if (document.hidden) { pointers.clear(); pause(); } };
  const pointerDown = (event: PointerEvent) => pointers.add(event.pointerId);
  const pointerUp = (event: PointerEvent) => {
    if (pointers.delete(event.pointerId) && pointers.size === 0) { scheduleHeading(); move(); }
  };
  const canvas = map.getCanvas();
  canvas.addEventListener("pointerdown", pointerDown);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerUp);
  map.on("movestart", externalMove);
  map.on("rotate", rotate);
  map.on("zoom", paint);
  map.on("styledata", paint);
  document.addEventListener("visibilitychange", visibility);
  map.getContainer().dataset.locationMode = "browse";
  return {
    locate, toggle, north, pause,
    destroy() {
      disposed = true; pause();
      map.off("movestart", externalMove); map.off("rotate", rotate);
      map.off("zoom", paint); map.off("styledata", paint);
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("pointerdown", pointerDown);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
    },
  };
}
