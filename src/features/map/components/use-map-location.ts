"use client";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { UiMessage } from "@/i18n/message";
import { createLocationController, initialLocationState } from "../location-controller";

export function useMapLocation(getMap: () => MapLibreMap | null, ready: boolean, suspended: boolean,
  onMessage: (message: UiMessage) => void) {
  const [state, setState] = useState(initialLocationState);
  const controller = useRef<ReturnType<typeof createLocationController> | null>(null);
  const notify = useEffectEvent(onMessage);
  useEffect(() => {
    const map = getMap();
    if (!ready || !map) return;
    const next = createLocationController(map, setState, (message) => notify(message));
    controller.current = next;
    return () => { next.destroy(); controller.current = null; };
  }, [getMap, ready]);
  useEffect(() => { if (suspended) controller.current?.pause(); }, [suspended]);
  const locate = useCallback(() => controller.current?.locate(), []);
  const toggle = useCallback(() => { void controller.current?.toggle(); }, []);
  const north = useCallback(() => controller.current?.north(), []);
  return { state, locate, toggle, north };
}
