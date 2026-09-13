"use client";
/* eslint-disable @next/next/no-img-element -- immutable full-circle artifacts are repeated for seamless panning */

import { Compass, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { loadBenchPanorama, requestBenchPanorama } from "@/app/actions/panorama";
import type { PanoramaDescriptor } from "@/features/bench-panorama/types";
import type { BenchDetail } from "@/lib/types";

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

const PANORAMA_HEIGHT_SCALE = 1.16;
const PANORAMA_POLL_INTERVAL_MS = 5_000;
const PANORAMA_POLL_ATTEMPTS = 60;

export function clampPanoramaVertical(viewportHeight: number, value: number) {
  const maximum = viewportHeight * (PANORAMA_HEIGHT_SCALE - 1) / 2;
  return Math.max(-maximum, Math.min(maximum, value));
}

function property(bench: BenchDetail, key: string) {
  return bench.properties.find((item) => item.key === key)?.value ?? "";
}

export function panoramaTrackOffset(viewportWidth: number, viewportHeight: number, heading: number) {
  const panoramaWidth = Math.round(viewportHeight * PANORAMA_HEIGHT_SCALE * 4);
  return Math.round(viewportWidth / 2 - panoramaWidth * (1 + normalizeHeading(heading) / 360));
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

function MoonDisc({ phase }: { phase: number }) {
  const illuminated = Math.max(0, Math.min(1, phase));
  const sweep = illuminated < .5 ? 0 : 1;
  const radius = Math.max(1, Math.abs(.5 - illuminated) * 22);
  return <svg viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="18" fill="#f4ebc9" opacity=".95" />
    <path d={`M24 6a18 18 0 0 ${sweep} 0 36 36a${radius} 18 0 0 ${sweep} 0-36-36Z`} fill="#657477" opacity=".72" />
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
  const [descriptor, setDescriptor] = useState<PanoramaDescriptor>({ status: bench.panoramaStatus });
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; heading: number; verticalOffset: number } | null>(null);
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
    const poll = async () => {
      const result = await loadBenchPanorama(bench.id).catch((): PanoramaDescriptor => ({ status: "error", retryAfterMs: 30_000 }));
      if (!active) return;
      setDescriptor(result);
      if (result.status === "ready" && result.lightMapUrl) return;
      attempts += 1;
      if (attempts < PANORAMA_POLL_ATTEMPTS) timeout = setTimeout(poll, result.retryAfterMs ?? PANORAMA_POLL_INTERVAL_MS);
    };
    void loadBenchPanorama(bench.id).then((initial) => {
      if (!active) return;
      setDescriptor(initial);
      if (initial.status === "ready" && initial.lightMapUrl) return;
      void requestBenchPanorama(bench.id).then(poll, poll);
    }, () => void requestBenchPanorama(bench.id).then(poll, poll));
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [bench.id]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [descriptor.artifactUrl]);

  if (failed || !descriptor.artifactUrl) {
    return <PanoramaPlaceholder bench={bench} status={failed ? "error" : descriptor.status} onRetry={request}>{children}</PanoramaPlaceholder>;
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId || !size.height) return;
    event.preventDefault();
    const panoramaWidth = Math.round(size.height * PANORAMA_HEIGHT_SCALE * 4);
    setHeading(normalizeHeading(active.heading - (event.clientX - active.x) / panoramaWidth * 360));
    setVerticalOffset(clampPanoramaVertical(size.height, active.verticalOffset + event.clientY - active.y));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const offset = panoramaTrackOffset(size.width, size.height, heading);
  const degrees = Math.round(heading) % 360;
  const cloudCover = bench.weather?.cloudCover ?? 0;
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
  const covered = /^(ja|oui|sì|si|gea)$/i.test(property(bench, "covered"));
  const sunBlocked = bench.sunnyNow === false && ["gebäude", "vegetation", "gelände", "überdacht"].includes(bench.shadeCause);
  const celestial = bench.sunAltitudeDegrees > 0 && !sunBlocked && cloudCover < .8
    ? { kind: "sun" as const, azimuth: bench.sunAzimuthDegrees, altitude: bench.sunAltitudeDegrees }
    : bench.moonVisible ? { kind: "moon" as const, azimuth: bench.moonAzimuthDegrees, altitude: bench.moonAltitudeDegrees } : null;
  const benchShadow = panoramaBenchShadow(bench.sunAzimuthDegrees, bench.sunAltitudeDegrees, initialHeading);
  const panoramaStyle = {
    "--panorama-offset": `${offset}px`,
    "--panorama-y": `${verticalOffset}px`,
    "--panorama-copy-width": `${Math.round(size.height * PANORAMA_HEIGHT_SCALE * 4)}px`,
    "--cloud-opacity": String(Math.min(.76, cloudCover * .78)),
    "--cloud-high-opacity": String(Math.min(.68, cloudHigh * .74)),
    "--cloud-mid-opacity": String(Math.min(.78, cloudMid * .82)),
    "--cloud-low-opacity": String(Math.min(.7, cloudLow * .78)),
    "--precip-opacity": String(Math.max(.08, Math.min(.32, .08 + precipitationRate * .045))),
    "--lightmap-opacity": String(cloudContrast),
    "--shadow-length": `${benchShadow.lengthPercent}%`,
    "--shadow-turn": `${benchShadow.turnDegrees}deg`,
  } as CSSProperties;
  const benchStyle = { left: `${initialHeading / 360 * 100}%` } as CSSProperties;
  const celestialStyle = celestial ? {
    left: `${normalizeHeading(celestial.azimuth) / 360 * 100}%`,
    top: `${Math.max(8, Math.min(55, 55 - celestial.altitude * .72))}%`,
  } as CSSProperties : undefined;
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setHeading((current) => normalizeHeading(current + (event.key === "ArrowRight" ? 5 : -5)));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      setVerticalOffset((current) => clampPanoramaVertical(size.height, current + (event.key === "ArrowDown" ? -8 : 8)));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHeading(initialHeading);
      setVerticalOffset(0);
    }
  };

  return <figure className={`bench-panorama phase-${bench.dayPhase} season-${bench.season}${dragging ? " is-dragging" : ""}${raining ? " is-raining" : ""}${snowing ? " is-snowing" : ""}${covered ? " has-shelter" : ""}${bench.sunnyNow ? " is-sunny" : " is-shaded"}`} style={panoramaStyle}>
    <div ref={viewport} className="bench-panorama-viewport" role="group" tabIndex={0}
      aria-label={`${t("panoramaDescription")} · ${t("panoramaHeading", { degrees })}`} aria-describedby={hintId}
      onKeyDown={keyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, heading, verticalOffset };
        setDragging(true);
      }}
      onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <div className="bench-panorama-track" style={panoramaStyle} aria-hidden="true">
        {[0, 1, 2].map((copy) => <div className="bench-panorama-copy" key={copy}>
          <img className="bench-panorama-art" src={descriptor.artifactUrl} alt="" draggable={false} onError={() => setFailed(true)} />
          {descriptor.lightMapUrl && <img className="bench-panorama-lightmap" src={descriptor.lightMapUrl} alt="" draggable={false} />}
          {cloudCover > .08 && <><span className="bench-panorama-clouds is-high" /><span className="bench-panorama-clouds is-mid" /><span className="bench-panorama-clouds is-low" /></>}
          {snowGround && <span className="bench-panorama-snow-ground" />}
          {celestial && <span className={`bench-panorama-celestial is-${celestial.kind}`} style={celestialStyle}>
            {celestial.kind === "moon" ? <MoonDisc phase={bench.moonPhase} /> : <i />}
          </span>}
          {bench.sunAltitudeDegrees > 0 && <span className="bench-panorama-bench-shadow" style={benchStyle} />}
          <img className="bench-panorama-rear-bench" style={benchStyle} src={benchAsset(bench)} alt="" draggable={false} />
        </div>)}
      </div>
      <div className="bench-panorama-sightline" aria-hidden="true" />
      {raining && <div className="bench-panorama-rain" aria-hidden="true">{Array.from({ length: rainCount }, (_, index) => <i key={index} style={{ "--drop-x": `${(index * 71) % 100}%`, "--drop-y": `${(index * 37) % 90}%`, "--drop-delay": `${-(index % 9) * .13}s` } as CSSProperties} />)}</div>}
      {snowing && <div className="bench-panorama-snow" aria-hidden="true">{Array.from({ length: snowCount }, (_, index) => <i key={index} style={{ "--drop-x": `${(index * 61) % 100}%`, "--drop-y": `${(index * 29) % 90}%`, "--drop-delay": `${-(index % 11) * .24}s` } as CSSProperties} />)}</div>}
    </div>
    {covered && <div className="bench-panorama-shelter" aria-hidden="true"><i /><i /></div>}
    {covered && <div className="bench-panorama-shelter-shade" aria-hidden="true" />}
    <div className="bench-panorama-hud"><span className="bench-panorama-bearing" title={t("panoramaCalculated")}><Compass size={15} aria-hidden="true" />{degrees}°</span><small id={hintId}>{t("panoramaHint")}</small></div>
    {children}
  </figure>;
}
