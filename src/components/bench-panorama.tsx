"use client";
/* eslint-disable @next/next/no-img-element -- immutable full-circle artifacts are repeated for seamless panning */

import { Compass, LoaderCircle, Maximize2, Minimize2, Minus, Plus, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { loadBenchPanorama, requestBenchPanorama } from "@/app/actions/panorama";
import type { PanoramaDescriptor } from "@/features/bench-panorama/types";
import type { BenchDetail } from "@/lib/types";
import { PANORAMA_ARTIFACT_MAX_ALTITUDE, PANORAMA_MIN_ALTITUDE, PANORAMA_SKY_SPAN, panoramaSkyTop, projectNightSky, type ProjectedStar } from "@/lib/night-sky";
import { PanoramaWebgl } from "./panorama-webgl";

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

const PANORAMA_ARTIFACT_HEIGHT_SCALE = 1.36;
const PANORAMA_ARTIFACT_SPAN = PANORAMA_ARTIFACT_MAX_ALTITUDE - PANORAMA_MIN_ALTITUDE;
const PANORAMA_SKY_HEIGHT_SCALE = PANORAMA_ARTIFACT_HEIGHT_SCALE * PANORAMA_SKY_SPAN / PANORAMA_ARTIFACT_SPAN;
const PANORAMA_SKY_CAP_SCALE = PANORAMA_SKY_HEIGHT_SCALE - PANORAMA_ARTIFACT_HEIGHT_SCALE;
const PANORAMA_ARTIFACT_OVERSCAN = (PANORAMA_ARTIFACT_HEIGHT_SCALE - 1) / 2;
const PANORAMA_FAST_POLL_MS = 1_000;
const PANORAMA_SLOW_POLL_MS = 5_000;
const PANORAMA_FAST_POLL_ATTEMPTS = 20;
const PANORAMA_POLL_ATTEMPTS = 76;

export function panoramaPollDelay(attempt: number, retryAfterMs?: number) {
  return Math.max(retryAfterMs ?? 0, attempt <= PANORAMA_FAST_POLL_ATTEMPTS
    ? PANORAMA_FAST_POLL_MS : PANORAMA_SLOW_POLL_MS);
}

export function clampPanoramaVertical(viewportHeight: number, value: number) {
  const minimum = -viewportHeight * PANORAMA_ARTIFACT_OVERSCAN;
  const maximum = viewportHeight * (PANORAMA_SKY_CAP_SCALE + PANORAMA_ARTIFACT_OVERSCAN);
  return Math.max(minimum, Math.min(maximum, value));
}

function property(bench: BenchDetail, key: string) {
  return bench.properties.find((item) => item.key === key)?.value ?? "";
}

export function panoramaTrackOffset(viewportWidth: number, viewportHeight: number, heading: number, zoom = 1) {
  const panoramaWidth = Math.round(viewportHeight * PANORAMA_ARTIFACT_HEIGHT_SCALE * 4 * zoom);
  return Math.round(viewportWidth / 2 - panoramaWidth * (1 + normalizeHeading(heading) / 360));
}

export function panoramaWrappedPositions(heading: number) {
  const position = normalizeHeading(heading) / 360 * 100;
  return [position, position + 100];
}

export function panoramaCelestialTop(altitude: number) {
  return panoramaSkyTop(altitude);
}

export function panoramaMaterialIsSky(pixel: Uint8ClampedArray) {
  // Material G is the semantic ID; clear sky is exactly zero in the lossless
  // mask. A small allowance avoids sampling a filtered horizon edge.
  return pixel[1] < 12;
}

export function panoramaShadowContrast(cloudCover: number) {
  return cloudCover < .35 ? 1 : cloudCover < .65 ? .62 : cloudCover < .8 ? .28 : .08;
}

export function panoramaBenchShadow(sunAzimuthDegrees: number, sunAltitudeDegrees: number, benchHeading: number) {
  return {
    lengthPercent: Math.max(4, Math.min(34, 26 / Math.max(.35, Math.tan(Math.max(4, sunAltitudeDegrees) * Math.PI / 180)))),
    turnDegrees: ((sunAzimuthDegrees + 180 - benchHeading + 540) % 360) - 180,
  };
}

function benchAsset(bench: BenchDetail) {
  const material = property(bench, "material").toLocaleLowerCase();
  const backrest = property(bench, "backrest").toLocaleLowerCase();
  const armrest = property(bench, "armrest").toLocaleLowerCase();
  const yes = (value: string) => /^(ja|oui|sì|si|gea)$/.test(value);
  const no = (value: string) => /^(nein|non|no|na)$/.test(value);
  if (!yes(backrest) && !no(backrest)) return "/ui-art/panorama/benches/neutral.webp";
  const kind = /kunststoff|plastic|plastique|plastica/.test(material) ? "plastic"
    : /metall|stahl|eisen|metal|steel|fer/.test(material) ? "metal"
      : /stein|beton|stone|concrete|pierre|pietra/.test(material) ? "stone"
        : /holz|wood|bois|legno|lain/.test(material) ? "wood" : "neutral";
  if (kind === "neutral") return "/ui-art/panorama/benches/neutral.webp";
  const shape = no(backrest) ? "backless" : yes(armrest) ? "back-arm" : "back";
  return `/ui-art/panorama/benches/${kind}-${shape}.webp`;
}

export function moonLightPath(phase: number, steps = 28) {
  const cycle = ((phase % 1) + 1) % 1;
  const waxing = cycle <= .5;
  const cosine = Math.cos(cycle * Math.PI * 2);
  const rows = Array.from({ length: steps + 1 }, (_, index) => {
    const normalizedY = -1 + index * 2 / steps;
    const edge = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));
    const first = waxing ? cosine * edge : -edge;
    const second = waxing ? edge : -cosine * edge;
    return { y: 24 + normalizedY * 18, first: 24 + first * 18, second: 24 + second * 18 };
  });
  return `M ${rows.map(({ first, y }) => `${first.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} L ${[...rows].reverse().map(({ second, y }) => `${second.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
}

function MoonDisc({ phase }: { phase: number }) {
  return <svg viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="18" fill="#536470" opacity=".78" />
    <path d={moonLightPath(phase)} fill="#f5ecc8" opacity=".96" />
    <circle cx="18" cy="18" r="2.2" fill="#9d9d8b" opacity=".2" />
    <circle cx="29" cy="29" r="3.1" fill="#9d9d8b" opacity=".16" />
  </svg>;
}

function PanoramaPlaceholder({ bench, status, children, onRetry }: {
  bench: BenchDetail;
  status: PanoramaDescriptor["status"];
  children?: ReactNode;
  onRetry: () => void;
}) {
  const t = useTranslations("bench.landscape");
  const loading = status === "generating" || status === "stale";
  return <figure className="bench-panorama bench-panorama-placeholder" data-status={status}>
    <div className="panorama-paper-wash" aria-hidden="true"><i /><i /><i /></div>
    <div className="panorama-placeholder-copy" role="status">
      {loading ? <LoaderCircle size={19} className="panorama-loading-icon" /> : <RefreshCw size={18} />}
      <span>{t(loading ? "panoramaGenerating" : "panoramaUnavailable")}</span>
      {!loading && <button type="button" onClick={onRetry}>{t("panoramaRetry")}</button>}
    </div>
    <span className="sr-only">{bench.title || bench.id}</span>
    {children}
  </figure>;
}

export function BenchPanorama({ bench, children }: { bench: BenchDetail; children?: ReactNode }) {
  const t = useTranslations("bench.landscape");
  const initialHeading = normalizeHeading(bench.directionDegrees ?? 0);
  const [heading, setHeading] = useState(initialHeading);
  const [descriptor, setDescriptor] = useState<PanoramaDescriptor>(bench.panorama ?? { status: bench.panoramaStatus });
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [skyVisibility, setSkyVisibility] = useState<{ url: string; celestialClear: boolean; starIds: Set<string> } | null>(null);
  const figure = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; heading: number; verticalOffset: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const hintId = useId();

  const load = async () => {
    const result = await loadBenchPanorama(bench.id).catch((): PanoramaDescriptor => ({ status: "error", retryAfterMs: 30_000 }));
    setDescriptor(result);
    setFailed(false);
    return result;
  };
  const request = () => void requestBenchPanorama(bench.id).then(load, load);

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let lightAttempts = 0;
    const poll = async () => {
      const result = await loadBenchPanorama(bench.id).catch((): PanoramaDescriptor => ({ status: "error", retryAfterMs: 30_000 }));
      if (!active) return;
      setDescriptor(result);
      if (result.status === "ready") {
        // The optional lighting can arrive after the painting. Refresh it a
        // few times without ever returning the UI to a loading state.
        if (!result.lightMapUrl && lightAttempts < 3) {
          lightAttempts += 1;
          timeout = setTimeout(poll, PANORAMA_SLOW_POLL_MS);
        }
        return;
      }
      attempts += 1;
      if (attempts < PANORAMA_POLL_ATTEMPTS) timeout = setTimeout(poll, panoramaPollDelay(attempts, result.retryAfterMs));
    };
    // The precomputed painting is the user-visible completion boundary. A
    // short-lived light map is optional enhancement data and must never turn
    // opening an otherwise ready bench into an on-demand render request.
    if (bench.panorama?.status === "ready") return () => { active = false; };
    // The server-rendered descriptor already tells us whether the painting is
    // ready. Do not spend another action round-trip loading that same state
    // before placing a cold bench into the priority queue.
    void requestBenchPanorama(bench.id).then(poll, poll);
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [bench.id, bench.panorama]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [descriptor.artifactUrl]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => viewport.current?.focus());
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = previousOverflow; };
  }, [expanded]);

  const cloudCover = bench.weather?.cloudCover ?? 0;
  const celestial = useMemo(() => bench.sunAltitudeDegrees > 0
    ? { kind: "sun" as const, azimuth: bench.sunAzimuthDegrees, altitude: bench.sunAltitudeDegrees }
    : bench.moonVisible ? { kind: "moon" as const, azimuth: bench.moonAzimuthDegrees, altitude: bench.moonAltitudeDegrees } : null,
  [bench.sunAltitudeDegrees, bench.sunAzimuthDegrees,
    bench.moonVisible, bench.moonAzimuthDegrees, bench.moonAltitudeDegrees]);
  const observationTime = bench.skyObservedAt ?? bench.weather?.observedAt ?? "2000-01-01T00:00:00Z";
  const stars = useMemo(() => bench.dayPhase === "day" ? []
    : projectNightSky(new Date(observationTime), bench.latitude, bench.longitude),
  [bench.dayPhase, bench.latitude, bench.longitude, observationTime]);

  useEffect(() => {
    let active = true;
    if (!descriptor.materialUrl) return () => { active = false; };
    const url = descriptor.materialUrl;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0);
      const clear = ({ azimuthDegrees, altitudeDegrees }: { azimuthDegrees: number; altitudeDegrees: number }) => {
        if (altitudeDegrees > PANORAMA_ARTIFACT_MAX_ALTITUDE) return true;
        if (altitudeDegrees < PANORAMA_MIN_ALTITUDE) return false;
        const x = Math.min(canvas.width - 1, Math.floor(normalizeHeading(azimuthDegrees) / 360 * canvas.width));
        const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(
          (PANORAMA_ARTIFACT_MAX_ALTITUDE - altitudeDegrees) / PANORAMA_ARTIFACT_SPAN * canvas.height)));
        return panoramaMaterialIsSky(context.getImageData(x, y, 1, 1).data);
      };
      const celestialClear = celestial ? [-1, 0, 1].every((vertical) => [-1, 0, 1].every((horizontal) => clear({
        azimuthDegrees: celestial.azimuth + horizontal * 1.15 / Math.max(.2, Math.cos(celestial.altitude * Math.PI / 180)),
        altitudeDegrees: celestial.altitude + vertical * 1.15,
      }))) : false;
      setSkyVisibility({ url, celestialClear,
        starIds: new Set(stars.filter(clear).map((star) => star.id)) });
    };
    image.src = url;
    return () => { active = false; image.onload = null; image.onerror = null; };
  }, [celestial, descriptor.materialUrl, stars]);

  if (failed || !descriptor.artifactUrl) {
    return <PanoramaPlaceholder bench={bench} status={failed ? "error" : descriptor.status} onRetry={request}>{children}</PanoramaPlaceholder>;
  }
  const artifactUrl = descriptor.artifactUrl;

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId || !size.height) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (!pinch.current) pinch.current = { distance, zoom };
      else setZoom(Math.max(1, Math.min(2, pinch.current.zoom * distance / pinch.current.distance)));
      return;
    }
    const panoramaWidth = Math.round(size.height * PANORAMA_ARTIFACT_HEIGHT_SCALE * 4 * zoom);
    setHeading(normalizeHeading(active.heading - (event.clientX - active.x) / panoramaWidth * 360));
    setVerticalOffset(clampPanoramaVertical(size.height, active.verticalOffset + event.clientY - active.y));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const offset = panoramaTrackOffset(size.width, size.height, heading, zoom);
  const degrees = Math.round(heading) % 360;
  const cloudHigh = bench.weather?.cloudHigh ?? cloudCover * .58;
  const cloudMid = bench.weather?.cloudMid ?? cloudCover * .72;
  const cloudLow = bench.weather?.cloudLow ?? cloudCover * .46;
  const cloudContrast = panoramaShadowContrast(cloudCover);
  const precipitation = bench.weather?.precipitationType ?? "none";
  const raining = precipitation === "rain" || precipitation === "mixed";
  const snowing = precipitation === "snow" || precipitation === "mixed";
  const precipitationRate = bench.weather?.precipitationRateMmH ?? 0;
  const rainCount = Math.round(Math.max(12, Math.min(58, 14 + precipitationRate * 11)));
  const snowCount = Math.round(Math.max(12, Math.min(46, 16 + precipitationRate * 7)));
  const snowGround = (bench.weather?.snowDepthCm ?? 0) >= 1 || (bench.weather?.snowCoverPercent ?? 0) >= .2;
  const covered = bench.covered;
  const benchShadow = panoramaBenchShadow(bench.sunAzimuthDegrees, bench.sunAltitudeDegrees, heading);
  const twilightOpacity = bench.dayPhase === "day" ? 0 : Math.max(.08, Math.min(1, (-bench.sunAltitudeDegrees + 2) / 10));
  const starOpacity = twilightOpacity * Math.max(.05, 1 - cloudCover * .96);
  const celestialOpacity = Math.max(.12, 1 - cloudCover * .88);
  const panoramaStyle = {
    "--panorama-offset": `${offset}px`,
    "--panorama-y": `${verticalOffset}px`,
    "--panorama-copy-width": `${Math.round(size.height * PANORAMA_ARTIFACT_HEIGHT_SCALE * 4 * zoom)}px`,
    "--panorama-track-height": `${PANORAMA_SKY_HEIGHT_SCALE * 100}%`,
    "--panorama-track-top": `${-(PANORAMA_SKY_CAP_SCALE + PANORAMA_ARTIFACT_OVERSCAN) * 100}%`,
    "--panorama-raster-height": `${PANORAMA_ARTIFACT_SPAN / PANORAMA_SKY_SPAN * 100}%`,
    "--cloud-opacity": Math.min(.76, cloudCover * .78).toFixed(3),
    "--cloud-high-opacity": Math.min(.68, cloudHigh * .74).toFixed(3),
    "--cloud-mid-opacity": Math.min(.78, cloudMid * .82).toFixed(3),
    "--cloud-low-opacity": Math.min(.7, cloudLow * .78).toFixed(3),
    "--precip-opacity": Math.max(.08, Math.min(.32, .08 + precipitationRate * .045)).toFixed(3),
    "--lightmap-opacity": (cloudContrast * .32).toFixed(3),
    "--star-opacity": starOpacity.toFixed(3),
    "--celestial-opacity": celestialOpacity.toFixed(3),
    "--shadow-length": `${benchShadow.lengthPercent.toFixed(3)}%`,
    "--shadow-turn": `${benchShadow.turnDegrees.toFixed(3)}deg`,
  } as CSSProperties;
  const activeSkyVisibility = skyVisibility?.url === descriptor.materialUrl ? skyVisibility : null;
  const celestialPositions = celestial && activeSkyVisibility?.celestialClear
    ? [normalizeHeading(celestial.azimuth) / 3.6] : [];
  const visibleStars = activeSkyVisibility
    ? stars.filter((star) => activeSkyVisibility.starIds.has(star.id)) : [];
  const celestialTop = celestial ? `${panoramaCelestialTop(celestial.altitude).toFixed(3)}%` : "0%";
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expanded) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.shiftKey ? 30 : 5;
      setHeading((current) => normalizeHeading(current + (event.key === "ArrowRight" ? step : -step)));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setVerticalOffset((current) => clampPanoramaVertical(size.height, current + (event.key === "ArrowDown" ? -8 : 8)));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHeading(initialHeading);
      setVerticalOffset(0);
      setZoom(1);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault(); setZoom((current) => Math.min(2, current + .1));
    } else if (event.key === "-") {
      event.preventDefault(); setZoom((current) => Math.max(1, current - .1));
    }
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!expanded) return;
    const direction = Math.sign(event.deltaY);
    if ((zoom <= 1 && direction > 0) || (zoom >= 2 && direction < 0)) return;
    event.preventDefault();
    setZoom((current) => Math.max(1, Math.min(2, current - direction * .1)));
  };

  const closeExpanded = () => {
    setExpanded(false);
    requestAnimationFrame(() => expandButton.current?.focus());
  };
  const modalKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!expanded) return;
    if (event.key === "Escape") { event.preventDefault(); closeExpanded(); return; }
    if (event.key !== "Tab" || !figure.current) return;
    const controls = [...figure.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex="0"]')]
      .filter((control) => control.offsetParent !== null);
    if (!controls.length) return;
    const first = controls[0]; const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <figure ref={figure} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined}
    aria-label={expanded ? t("panoramaExpandedTitle") : undefined} onKeyDown={modalKeyDown}
    className={`bench-panorama phase-${bench.dayPhase} season-${bench.season}${expanded ? " is-expanded" : " is-static"}${dragging ? " is-dragging" : ""}${raining ? " is-raining" : ""}${snowing ? " is-snowing" : ""}${covered ? " has-shelter" : ""}${bench.sunnyNow ? " is-sunny" : " is-shaded"}`} style={panoramaStyle}>
    <div ref={viewport} className="bench-panorama-viewport" role={expanded ? "group" : "img"} tabIndex={expanded ? 0 : -1}
      aria-label={`${t("panoramaDescription")} · ${t("panoramaHeading", { degrees })}`} aria-describedby={hintId}
      onKeyDown={keyDown}
      onWheel={wheel}
      onDoubleClick={expanded ? () => setZoom((current) => current > 1 ? 1 : 1.6) : undefined}
      onPointerDown={expanded ? (event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, heading, verticalOffset };
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        setDragging(true);
      } : undefined}
      onPointerMove={expanded ? move : undefined} onPointerUp={expanded ? finish : undefined} onPointerCancel={expanded ? finish : undefined}>
      <div className="bench-panorama-track" style={panoramaStyle} aria-hidden="true">
        {[0, 1, 2].map((copy) => <div className="bench-panorama-copy" key={copy}>
          <span className="bench-panorama-sky-cap" />
          <div className="bench-panorama-raster">
            <PanoramaWebgl imageUrl={artifactUrl} materialUrl={descriptor.materialUrl} season={bench.season}
              sunAltitude={bench.sunAltitudeDegrees} cloudCover={cloudCover} dayPhase={bench.dayPhase} onError={() => setFailed(true)} />
            {descriptor.lightMapUrl && <img className="bench-panorama-lightmap" src={descriptor.lightMapUrl} alt="" draggable={false} />}
            {snowGround && <span className="bench-panorama-snow-ground" />}
          </div>
          {visibleStars.length > 0 && <span className="bench-panorama-stars">{visibleStars.map((star: ProjectedStar) => <i key={star.id}
            className={star.important ? "is-guide" : undefined} style={{ left: `${star.leftPercent.toFixed(3)}%`, top: `${star.topPercent.toFixed(3)}%`,
              "--star-size": `${star.sizePixels.toFixed(3)}px`, "--star-alpha": star.opacity.toFixed(3), "--star-tone": star.tone.toFixed(3) } as CSSProperties} />)}</span>}
          {celestial && celestialPositions.map((left) => <span key={left} className={`bench-panorama-celestial is-${celestial.kind}`}
            style={{ left: `${left.toFixed(3)}%`, top: celestialTop }}>
            {celestial.kind === "moon" ? <MoonDisc phase={bench.moonPhase} /> : <i />}
          </span>)}
          {cloudCover > .08 && <><span className="bench-panorama-clouds is-high" /><span className="bench-panorama-clouds is-mid" /><span className="bench-panorama-clouds is-low" /></>}
        </div>)}
      </div>
      <div className="bench-panorama-foreground" aria-hidden="true">
        <span className="bench-panorama-ground-patch" />
        {bench.sunAltitudeDegrees > 0 && <span className="bench-panorama-bench-shadow" />}
        <img className="bench-panorama-rear-bench" src={benchAsset(bench)} alt="" draggable={false} />
      </div>
      {raining && <div className="bench-panorama-rain" aria-hidden="true">{Array.from({ length: rainCount }, (_, index) => <i key={index} style={{ "--drop-x": `${(index * 71) % 100}%`, "--drop-y": `${(index * 37) % 90}%`, "--drop-delay": `${-(index % 9) * .13}s` } as CSSProperties} />)}</div>}
      {snowing && <div className="bench-panorama-snow" aria-hidden="true">{Array.from({ length: snowCount }, (_, index) => <i key={index} style={{ "--drop-x": `${(index * 61) % 100}%`, "--drop-y": `${(index * 29) % 90}%`, "--drop-delay": `${-(index % 11) * .24}s` } as CSSProperties} />)}</div>}
    </div>
    {covered && <div className="bench-panorama-shelter" aria-hidden="true"><i /><i /></div>}
    {covered && <div className="bench-panorama-shelter-shade" aria-hidden="true" />}
    <div className="bench-panorama-hud"><span className="bench-panorama-bearing" title={t("panoramaCalculated")}><Compass size={15} aria-hidden="true" />{degrees}°</span>{expanded && <div className="bench-panorama-zoom-controls"><button type="button" aria-label={t("panoramaZoomOut")} title={t("panoramaZoomOut")} disabled={zoom <= 1} onClick={() => setZoom((current) => Math.max(1, current - .2))}><Minus size={14} /></button><span aria-live="polite">{zoom.toFixed(1)}×</span><button type="button" aria-label={t("panoramaZoomIn")} title={t("panoramaZoomIn")} disabled={zoom >= 2} onClick={() => setZoom((current) => Math.min(2, current + .2))}><Plus size={14} /></button></div>}<small id={hintId}>{t(expanded ? "panoramaExploreHint" : "panoramaStaticHint")}</small><button ref={expandButton} type="button" className="bench-panorama-expand" aria-expanded={expanded} aria-label={t(expanded ? "panoramaCloseExpanded" : "panoramaOpenExpanded")} title={t(expanded ? "panoramaCloseExpanded" : "panoramaOpenExpanded")} onClick={() => expanded ? closeExpanded() : setExpanded(true)}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span>{t(expanded ? "panoramaClose" : "panorama360")}</span></button></div>
    {children}
  </figure>;
}
