"use client";
/* eslint-disable @next/next/no-img-element -- immutable full-circle artifacts are repeated for seamless panning */

import { ArrowLeft, ArrowRight, Armchair, Compass, LoaderCircle, Maximize2, X, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { loadBenchPanorama, requestBenchPanorama } from "@/app/actions/panorama";
import type { PanoramaDescriptor } from "@/features/bench-panorama/types";
import { retainPanoramaArtifact } from "../descriptor";
import type { BenchDetail } from "@/lib/types";
import { panoramaSkyTop, projectNightSky, type ProjectedStar } from "@/lib/night-sky";
import { panoramaMaterialIsSkyPixel } from "@/lib/panorama-material";
import { clampPanoramaPitch, normalizePanoramaHeading, panoramaHasSnowCover, panoramaProjection,
  panoramaRasterBounds, precipitationParticleCount, precipitationParticles } from "@/lib/panorama-scene";
import { PanoramaWebgl } from "@/features/bench-panorama/components/panorama-webgl";
import { PanoramaClouds } from "./panorama-clouds";
import { resolveWeatherCondition, panoramaCloudCover } from "@/features/weather/conditions";
import { paintingFrameClass, paintingFrameStyle } from "@/components/painting-frame";
import { useTaskIsolation } from "@/components/use-task-isolation";
import controlsStyles from "./panorama-controls.module.css";
import benchFraming from "../bench-framing.json";
import { benchBearingTurn } from "../bearing";

const PANORAMA_FAST_POLL_MS = 1_000;
const PANORAMA_SLOW_POLL_MS = 5_000;
const PANORAMA_FAST_POLL_ATTEMPTS = 20;
const PANORAMA_POLL_ATTEMPTS = 76;

export function panoramaPollDelay(attempt: number, retryAfterMs?: number) {
  return Math.max(retryAfterMs ?? 0, attempt <= PANORAMA_FAST_POLL_ATTEMPTS
    ? PANORAMA_FAST_POLL_MS : PANORAMA_SLOW_POLL_MS);
}

export const clampPanoramaVertical = clampPanoramaPitch;

function property(bench: BenchDetail, key: string) {
  return bench.properties.find((item) => item.key === key)?.value ?? "";
}

export function panoramaTrackOffset(viewportWidth: number, viewportHeight: number, heading: number, zoom = 1) {
  return panoramaProjection(viewportWidth, viewportHeight, heading, 0, zoom).left;
}

export function panoramaWrappedPositions(heading: number) {
  const position = normalizePanoramaHeading(heading) / 360 * 100;
  return [position, position + 100];
}

export function panoramaCelestialTop(altitude: number) {
  return panoramaSkyTop(altitude);
}

export function panoramaMaterialIsSky(pixel: Uint8ClampedArray) {
  return panoramaMaterialIsSkyPixel(pixel);
}

export function panoramaShadowContrast(cloudCover: number) {
  return cloudCover < .35 ? 1 : cloudCover < .65 ? .62 : cloudCover < .8 ? .28 : .08;
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
  if (cycle < .008 || cycle > .992) return "";
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

function MoonDisc({ phase, illumination }: { phase: number; illumination: number }) {
  const clipId = useId().replaceAll(":", "");
  if (illumination < .015) return null;
  const path = moonLightPath(phase);
  return <svg viewBox="0 0 48 48" aria-hidden="true">
    <defs><clipPath id={clipId}><path d={path} /></clipPath></defs>
    <path d={path} fill="#f5ecc8" opacity=".96" />
    <g clipPath={`url(#${clipId})`} fill="#908d7c">
      <circle cx="18" cy="18" r="2.2" opacity=".24" />
      <circle cx="29" cy="29" r="3.1" opacity=".18" />
      <circle cx="31" cy="16" r="1.5" opacity=".14" />
    </g>
  </svg>;
}

function PanoramaPlaceholder({ bench, status, children, onRetry, description }: {
  bench: BenchDetail;
  status: PanoramaDescriptor["status"];
  description: string;
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
    <span className="sr-only">{bench.title || bench.id} · {description}</span>
    {children}
  </figure>;
}

export function BenchPanorama({ bench, children }: { bench: BenchDetail; children?: ReactNode }) {
  const t = useTranslations("bench.landscape");
  const all = useTranslations();
  const condition = resolveWeatherCondition(bench.weather);
  const conditionKey = condition === "partly-cloudy" ? "partlyCloudy" : condition;
  const sceneDescription = [
    t("panoramaDescription"),
    bench.dayPhase === "night" ? all("bench.summary.night") : null,
    condition !== "unknown" ? all(`bench.weather.conditions.${conditionKey}`) : null,
    bench.weather && Number.isFinite(bench.weather.temperatureC) ? `${Math.round(bench.weather.temperatureC)} °C` : null,
  ].filter(Boolean).join(" · ");
  const initialHeading = normalizePanoramaHeading(bench.directionDegrees ?? 0);
  const [heading, setHeading] = useState(initialHeading);
  const [descriptor, setDescriptor] = useState<PanoramaDescriptor>(bench.panorama ?? { status: bench.panoramaStatus });
  const [failed, setFailed] = useState(false);
  const assetIdentity = `${descriptor.artifactUrl ?? ""}\n${descriptor.materialUrl ?? ""}`;
  const activeArtwork = useRef(assetIdentity);
  useLayoutEffect(() => { activeArtwork.current = assetIdentity; }, [assetIdentity]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [pitch, setPitch] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [terrainReadyUrl, setTerrainReadyUrl] = useState<string | null>(null);
  const figure = useRef<HTMLElement>(null);
  useTaskIsolation(figure, expanded);
  const viewport = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; heading: number; pitch: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const hintId = useId();
  const markTerrainReady = useCallback(() => setTerrainReadyUrl(descriptor.materialUrl ?? null), [descriptor.materialUrl]);
  const markTerrainError = useCallback(() => setFailed(true), []);

  const load = async () => {
    const result = await loadBenchPanorama(bench.id).catch((): PanoramaDescriptor => ({ status: "error", retryAfterMs: 30_000 }));
    setDescriptor((current) => retainPanoramaArtifact(current, result));
    setFailed(false);
    return result;
  };
  const request = () => void requestBenchPanorama(bench.id).then(load, load);

  useEffect(() => {
    const incoming = bench.panorama;
    if (!incoming?.artifactUrl) return;
    // The parent can learn of a finished worker render before our own poll.
    // Update its assets in-place instead of using status as a React key.
    const frame = requestAnimationFrame(() => {
      const changed = `${incoming.artifactUrl}\n${incoming.materialUrl ?? ""}` !== activeArtwork.current;
      setDescriptor((current) => retainPanoramaArtifact(current, incoming));
      // A parent refresh of the same immutable assets cannot repair a failed mask.
      // Keep its error evidence visible until new assets or an explicit retry.
      if (changed) setFailed(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [bench.panorama]);

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let lightAttempts = 0;
    const poll = async () => {
      if (!active) return;
      const result = await loadBenchPanorama(bench.id).catch((): PanoramaDescriptor => ({ status: "error", retryAfterMs: 30_000 }));
      if (!active) return;
      setDescriptor((current) => retainPanoramaArtifact(current, result));
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

  const cloudCover = panoramaCloudCover(bench.weather);
  const celestial = useMemo(() => bench.sunAltitudeDegrees > 0
    ? { kind: "sun" as const, azimuth: bench.sunAzimuthDegrees, altitude: bench.sunAltitudeDegrees }
    : bench.moonVisible ? { kind: "moon" as const, azimuth: bench.moonAzimuthDegrees, altitude: bench.moonAltitudeDegrees } : null,
  [bench.sunAltitudeDegrees, bench.sunAzimuthDegrees,
    bench.moonVisible, bench.moonAzimuthDegrees, bench.moonAltitudeDegrees]);
  const observationTime = bench.skyObservedAt ?? bench.weather?.observedAt ?? "2000-01-01T00:00:00Z";
  const stars = useMemo(() => bench.dayPhase === "day" ? []
    : projectNightSky(new Date(observationTime), bench.latitude, bench.longitude),
  [bench.dayPhase, bench.latitude, bench.longitude, observationTime]);

  if (failed || !descriptor.artifactUrl) {
    return <PanoramaPlaceholder bench={bench} status={failed ? "error" : descriptor.status} description={sceneDescription} onRetry={request}>{children}</PanoramaPlaceholder>;
  }
  const artifactUrl = descriptor.artifactUrl;

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId || !size.height) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size > 1) return;
    const projection = panoramaProjection(size.width, size.height, active.heading, active.pitch);
    setHeading(normalizePanoramaHeading(active.heading - (event.clientX - active.x) / projection.copyWidth * 360));
    setPitch(clampPanoramaPitch(size.height, active.pitch + (event.clientY - active.y) / projection.pixelsPerDegree));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  // Inline art follows the recorded bench direction. An open 360 view belongs
  // to the visitor; metadata refreshes must not reset their heading or pitch.
  const visibleHeading = expanded ? heading : initialHeading;
  const rasterBounds = panoramaRasterBounds(descriptor.rasterBounds);
  const projection = panoramaProjection(size.width, size.height, visibleHeading, expanded ? pitch : 0, 1, rasterBounds);
  const degrees = Math.round(visibleHeading) % 360;
  const benchTurn = benchBearingTurn(visibleHeading, bench.directionDegrees);
  const cloudContrast = panoramaShadowContrast(cloudCover);
  const precipitation = bench.weather?.precipitationType ?? "unknown";
  const raining = precipitation === "rain" || precipitation === "mixed";
  const snowing = precipitation === "snow" || precipitation === "mixed";
  const precipitationRate = bench.weather?.precipitationRateMmH ?? null;
  const mixed = precipitation === "mixed";
  const rainCount = precipitationParticleCount("rain", size.width, size.height, precipitationRate, mixed);
  const snowCount = precipitationParticleCount("snow", size.width, size.height, precipitationRate, mixed);
  const rainParticles = raining ? precipitationParticles("rain", rainCount, `${bench.id}:rain`) : [];
  const snowParticles = snowing ? precipitationParticles("snow", snowCount, `${bench.id}:snow`) : [];
  const snowGround = panoramaHasSnowCover(bench.weather?.snowDepthCm, bench.weather?.snowCoverPercent);
  const covered = bench.covered;
  const foregroundAsset = benchAsset(bench);
  const foregroundVariant = foregroundAsset.split("/").at(-1)!.replace(".webp", "") as keyof typeof benchFraming;
  // Frame the seat at the viewport edge. Legs stay below the view, so the
  // foreground needs no invented soil or detached ground-plane shadow.
  const seatBottom = benchFraming[foregroundVariant];
  const twilightOpacity = bench.dayPhase === "day" ? 0 : Math.max(.08, Math.min(1, (-bench.sunAltitudeDegrees + 2) / 10));
  // Actual cloud pixels occlude the stars; clear openings should not be globally washed out.
  const starOpacity = twilightOpacity * (bench.moonVisible ? 1 - bench.moonIllumination * .25 : 1);
  const celestialOpacity = 1;
  const panoramaStyle = {
    "--panorama-offset": `${projection.left}px`,
    "--panorama-copy-width": `${projection.copyWidth}px`,
    "--panorama-track-height": `${projection.trackHeight}px`,
    "--panorama-track-top": `${projection.top}px`,
    "--panorama-raster-height": `${projection.rasterHeight}px`,
    "--panorama-raster-bottom": `${projection.rasterBottom}px`,
    "--foreground-shift": `${projection.maximumPitch ? Math.min(132, projection.pitch / projection.maximumPitch * 132) : 0}%`,
    "--precip-opacity": Math.max(.5, Math.min(.94, .58 + (precipitationRate ?? 1.1) * .08)).toFixed(3),
    "--lightmap-opacity": (cloudContrast * .32).toFixed(3),
    "--star-opacity": starOpacity.toFixed(3),
    "--celestial-opacity": celestialOpacity.toFixed(3),
  } as CSSProperties;
  // With a material map, the alpha terrain canvas performs pixel-perfect
  // occlusion. Without one we only expose the conservative sky extension.
  const materialReady = Boolean(descriptor.materialUrl && terrainReadyUrl === descriptor.materialUrl);
  const celestialPositions = celestial && (materialReady || celestial.altitude > rasterBounds.maximumAltitude)
    ? [normalizePanoramaHeading(celestial.azimuth) / 3.6] : [];
  const visibleStars = materialReady ? stars
    : stars.filter((star) => star.altitudeDegrees > rasterBounds.maximumAltitude);
  const celestialTop = celestial ? `${panoramaCelestialTop(celestial.altitude).toFixed(3)}%` : "0%";
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expanded) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.shiftKey ? 30 : 5;
      setHeading((current) => normalizePanoramaHeading(current + (event.key === "ArrowRight" ? step : -step)));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setPitch((current) => clampPanoramaPitch(size.height, current + (event.key === "ArrowUp" ? 3 : -3)));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHeading(initialHeading);
      setPitch(0);

    }
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!expanded) return;
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    setPitch((current) => clampPanoramaPitch(size.height, current - event.deltaY * units / 18));
  };

  const closeExpanded = () => {
    setExpanded(false);
    requestAnimationFrame(() => expandButton.current?.focus());
  };
  const modalKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!expanded) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeExpanded(); return; }
    if (event.key !== "Tab" || !figure.current) return;
    const controls = [...figure.current.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [href], [tabindex="0"]')]
      .filter((control) => control.offsetParent !== null);
    if (!controls.length) return;
    const first = controls[0]; const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <figure ref={figure} data-recorded-direction={initialHeading} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined}
    aria-label={expanded ? t("panoramaExpandedTitle") : undefined} onKeyDown={modalKeyDown}
    className={`bench-panorama ${expanded ? controlsStyles.viewer : ""} phase-${bench.dayPhase} season-${bench.season}${expanded ? " is-expanded" : " is-static"}${dragging ? " is-dragging" : ""}${raining ? " is-raining" : ""}${snowing ? " is-snowing" : ""}${snowGround ? " has-snow-cover" : ""}${covered ? " has-shelter" : ""}${bench.sunnyNow ? " is-sunny" : " is-shaded"}`} style={panoramaStyle}>
    <div ref={viewport} className={`bench-panorama-viewport${expanded ? "" : ` ${paintingFrameClass}`}`} data-painting-treatment="hero" style={expanded ? undefined : paintingFrameStyle(bench.id)} role={expanded ? "group" : "img"} tabIndex={expanded ? 0 : -1}
      aria-label={`${sceneDescription} · ${t("panoramaHeading", { degrees })}`} aria-describedby={hintId}
      onKeyDown={keyDown}
      onWheel={wheel}
      onPointerDown={expanded ? (event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size > 1) return;
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, heading, pitch: projection.pitch };
        setDragging(true);
      } : undefined}
      onPointerMove={expanded ? move : undefined} onPointerUp={expanded ? finish : undefined} onPointerCancel={expanded ? finish : undefined}>
      <div className="bench-panorama-track" style={panoramaStyle} aria-hidden="true">
        {[0, 1, 2].map((copy) => <div className="bench-panorama-copy" key={copy}>
          <span className="bench-panorama-sky" />
          {visibleStars.length > 0 && <span className="bench-panorama-stars">{visibleStars.map((star: ProjectedStar) => <i key={star.id}
            className={star.important ? "is-guide" : undefined} style={{ left: `${star.leftPercent.toFixed(3)}%`, top: `${star.topPercent.toFixed(3)}%`,
              "--star-size": `${star.sizePixels.toFixed(3)}px`, "--star-alpha": star.opacity.toFixed(3), "--star-tone": star.tone.toFixed(3) } as CSSProperties} />)}</span>}
          {celestial && celestialPositions.map((left) => <span key={left} className={`bench-panorama-celestial is-${celestial.kind}`}
            style={{ left: `${left.toFixed(3)}%`, top: celestialTop }}>
            {celestial.kind === "moon" ? <MoonDisc phase={bench.moonPhase} illumination={bench.moonIllumination} /> : <i />}
          </span>)}
          {cloudCover > .08 && <PanoramaClouds cover={cloudCover} night={bench.dayPhase === "night"} sunAltitude={bench.sunAltitudeDegrees} />}
          <div className="bench-panorama-raster">
            <PanoramaWebgl imageUrl={artifactUrl} materialUrl={descriptor.materialUrl} lightMapUrl={descriptor.lightMapUrl} season={bench.season}
              sunAltitude={bench.sunAltitudeDegrees} cloudCover={cloudCover} dayPhase={bench.dayPhase}
              snowCover={snowGround} rasterAltitudeRange={rasterBounds.maximumAltitude - rasterBounds.minimumAltitude}
              onReady={markTerrainReady} onError={markTerrainError} />
          </div>
        </div>)}
      </div>
      <div className="bench-panorama-foreground" aria-hidden="true">
        <div className="bench-panorama-bench" data-bench-variant={foregroundVariant}
          style={{ "--bench-seat-bottom": `${seatBottom}%` } as CSSProperties}>
          <img className="bench-panorama-rear-bench" src={foregroundAsset} alt="" draggable={false} />
        </div>
      </div>
      {raining && <div className="bench-panorama-rain" aria-hidden="true">{rainParticles.map((particle, index) => <i key={index} style={{ "--drop-x": `${particle.x.toFixed(3)}%`, "--drop-y": `${particle.y.toFixed(3)}%`, "--drop-delay": `${particle.delay.toFixed(3)}s`, "--drop-duration": `${particle.duration.toFixed(3)}s`, "--drop-size": `${particle.size.toFixed(2)}px`, "--drop-length": `${particle.length.toFixed(2)}px`, "--drop-drift": `${particle.drift.toFixed(2)}px`, "--drop-alpha": particle.alpha.toFixed(3) } as CSSProperties} />)}</div>}
      {snowing && <div className="bench-panorama-snow" aria-hidden="true">{snowParticles.map((particle, index) => <i key={index} style={{ "--drop-x": `${particle.x.toFixed(3)}%`, "--drop-y": `${particle.y.toFixed(3)}%`, "--drop-delay": `${particle.delay.toFixed(3)}s`, "--drop-duration": `${particle.duration.toFixed(3)}s`, "--drop-size": `${particle.size.toFixed(2)}px`, "--drop-drift": `${particle.drift.toFixed(2)}px`, "--drop-alpha": particle.alpha.toFixed(3) } as CSSProperties} />)}</div>}
    </div>
    {covered && <div className="bench-panorama-shelter" aria-hidden="true"><i /><i /></div>}
    {covered && <div className="bench-panorama-shelter-shade" aria-hidden="true" />}
    <div className="bench-panorama-hud">
      {expanded && <>
        <details className={controlsStyles.bearingHelp}>
          <summary aria-label={`${t("panoramaHeading", { degrees })} · ${t("panoramaHelp")}`} title={t("panoramaHelp")}>
            <span className="bench-panorama-bearing"><Compass size={16} aria-hidden="true" />{degrees}°</span>
          </summary>
          <p id={hintId}>{t("panoramaHelpBody")}</p>
        </details>
        {benchTurn && <button type="button" className={controlsStyles.benchDirection} data-turn={benchTurn}
          aria-label={t("panoramaBenchDirection")} title={t("panoramaBenchDirection")}
          onClick={() => {
            setHeading(initialHeading); setPitch(0);
            // The cue disappears on arrival; return focus to the scene.
            viewport.current?.focus();
          }}>
          {benchTurn === "left" && <ArrowLeft size={18} aria-hidden="true" />}
          <Armchair size={16} aria-hidden="true" />
          {benchTurn === "right" && <ArrowRight size={18} aria-hidden="true" />}
        </button>}
      </>}
      {!expanded && <span id={hintId} className="sr-only">{t("panoramaStaticHint")}</span>}
      <button ref={expandButton} type="button" className="bench-panorama-expand" aria-expanded={expanded} aria-label={t(expanded ? "panoramaCloseExpanded" : "panoramaOpenExpanded")} title={t(expanded ? "panoramaCloseExpanded" : "panoramaOpenExpanded")} onClick={() => { if (expanded) closeExpanded(); else setExpanded(true); }}>
        {expanded ? <X size={20} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}<span>{t(expanded ? "panoramaClose" : "panorama360")}</span>
      </button>
    </div>
    {children}
  </figure>;
}
