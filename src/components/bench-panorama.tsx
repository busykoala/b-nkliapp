"use client";
/* eslint-disable @next/next/no-img-element -- the repeated data-URL panorama is a single wrap-safe canvas */

import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { loadBenchPanorama, requestBenchPanorama } from "@/app/actions/panorama";
import type { BenchDetail } from "@/lib/types";
import { BenchLandscape } from "./bench-landscape";

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
  const panoramaWidth = viewportHeight * PANORAMA_HEIGHT_SCALE * 4;
  return viewportWidth / 2 - panoramaWidth * (1 + normalizeHeading(heading) / 360);
}

export function BenchPanorama({ bench, children }: { bench: BenchDetail; children?: ReactNode }) {
  const t = useTranslations("bench.landscape");
  const initialHeading = normalizeHeading(bench.directionDegrees ?? 0);
  const [heading, setHeading] = useState(initialHeading);
  const [failed, setFailed] = useState(false);
  const [artifact, setArtifact] = useState<{ benchId: string; dataUrl: string } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; heading: number; verticalOffset: number } | null>(null);
  const hintId = useId();
  const imageUrl = artifact?.benchId === bench.id ? artifact.dataUrl : null;

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = async () => {
      const result = await loadBenchPanorama(bench.id).catch(() => null);
      if (!active) return;
      if (result) {
        setArtifact({ benchId: bench.id, dataUrl: result.dataUrl });
        return;
      }
      attempts += 1;
      if (attempts < PANORAMA_POLL_ATTEMPTS) timeout = setTimeout(load, PANORAMA_POLL_INTERVAL_MS);
    };
    if (!bench.panoramaAvailable) void requestBenchPanorama(bench.id).then(load, load);
    else void load();
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [bench.id, bench.panoramaAvailable]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [imageUrl]);

  if (failed || !imageUrl) return <BenchLandscape bench={bench}>{children}</BenchLandscape>;

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId || !size.height) return;
    event.preventDefault();
    const panoramaWidth = size.height * PANORAMA_HEIGHT_SCALE * 4;
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
  const style = { "--panorama-offset": `${offset}px`, "--panorama-y": `${verticalOffset}px` } as CSSProperties;
  const benchStyle = { left: `${initialHeading / 360 * 100}%` } as CSSProperties;
  const showsRearBench = property(bench, "backrest") !== "Nein";
  const covered = property(bench, "covered") === "Ja";
  const material = property(bench, "material").toLocaleLowerCase();
  const materialClass = /metall|stahl|eisen|metal|steel/.test(material) ? "is-metal"
    : /stein|beton|stone|concrete/.test(material) ? "is-stone" : "is-wood";
  const cloudCover = bench.weather?.cloudCover ?? 0;
  const celestial = bench.sunAltitudeDegrees > 0 && cloudCover < .72
    ? { kind: "sun", azimuth: bench.sunAzimuthDegrees, altitude: bench.sunAltitudeDegrees }
    : bench.moonVisible && cloudCover < .72
      ? { kind: "moon", azimuth: bench.moonAzimuthDegrees, altitude: bench.moonAltitudeDegrees }
      : null;
  const celestialStyle = celestial ? {
    left: `${normalizeHeading(celestial.azimuth) / 360 * 100}%`,
    top: `${Math.max(9, Math.min(54, 55 - celestial.altitude * .72))}%`,
  } as CSSProperties : undefined;
  const precipitation = bench.weather?.precipitationType ?? "none";
  const raining = precipitation === "rain" || precipitation === "mixed";
  const snowing = precipitation === "snow" || precipitation === "mixed";
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

  return <figure className={`bench-panorama phase-${bench.dayPhase} season-${bench.season}${dragging ? " is-dragging" : ""}${raining ? " is-raining" : ""}${covered ? " has-shelter" : ""}`}>
    <div
      ref={viewport}
      className="bench-panorama-viewport"
      role="group"
      tabIndex={0}
      aria-label={`${t("panoramaDescription")} · ${t("panoramaHeading", { degrees })}`}
      aria-describedby={hintId}
      onKeyDown={keyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, heading, verticalOffset };
        setDragging(true);
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div className="bench-panorama-track" style={style} aria-hidden="true">
        {[0, 1, 2].map((copy) => <div className="bench-panorama-copy" key={copy}>
          <img className="bench-panorama-art" src={imageUrl} alt="" draggable={false} onError={() => setFailed(true)} />
          {cloudCover > .28 && <img
            className="bench-panorama-clouds"
            src="/ui-art/weather/cloud.webp"
            alt=""
            draggable={false}
            style={{ opacity: Math.min(.42, cloudCover * .45) }}
          />}
          {celestial && <img
            className={`bench-panorama-celestial is-${celestial.kind}`}
            style={celestialStyle}
            src={`/ui-art/weather/${celestial.kind}.webp`}
            alt=""
            draggable={false}
          />}
          {showsRearBench && <img
            className={`bench-panorama-rear-bench ${materialClass}`}
            style={benchStyle}
            src="/ui-art/benches/bench-rear-watercolor-v2.webp"
            alt=""
            draggable={false}
          />}
        </div>)}
      </div>
      <div className="bench-panorama-sightline" aria-hidden="true" />
      {raining && <div className="bench-panorama-rain" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ "--drop-x": `${(index * 71) % 100}%`, "--drop-y": `${(index * 37) % 90}%` } as CSSProperties} />)}</div>}
      {snowing && <div className="bench-panorama-snow" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ "--drop-x": `${(index * 61) % 100}%`, "--drop-y": `${(index * 29) % 90}%` } as CSSProperties} />)}</div>}
    </div>
    {covered && <div className="bench-panorama-shelter" aria-hidden="true"><i /><i /></div>}
    {covered && <div className="bench-panorama-shelter-shade" aria-hidden="true" />}
    <div className="bench-panorama-hud">
      <span className="bench-panorama-bearing" title={t("panoramaCalculated")}><Compass size={15} aria-hidden="true" />{degrees}°</span>
      <small id={hintId}>{t("panoramaHint")}</small>
    </div>
    {children}
  </figure>;
}
