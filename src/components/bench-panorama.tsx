"use client";
/* eslint-disable @next/next/no-img-element -- the repeated data-URL panorama is a single wrap-safe canvas */

import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { loadBenchPanorama, requestBenchPanorama } from "@/app/actions/panorama";
import type { BenchDetail } from "@/lib/types";
import { BenchLandscape } from "./bench-landscape";

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function property(bench: BenchDetail, key: string) {
  return bench.properties.find((item) => item.key === key)?.value ?? "";
}

export function panoramaTrackOffset(viewportWidth: number, viewportHeight: number, heading: number) {
  const panoramaWidth = viewportHeight * 4;
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
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; heading: number } | null>(null);
  const imageUrl = artifact?.benchId === bench.id ? artifact.dataUrl : null;

  useEffect(() => {
    if (!bench.panoramaAvailable) {
      void requestBenchPanorama(bench.id);
      return;
    }
    let active = true;
    void loadBenchPanorama(bench.id).then((result) => {
      if (!active) return;
      if (result) setArtifact({ benchId: bench.id, dataUrl: result.dataUrl });
      else setFailed(true);
    });
    return () => { active = false; };
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

  if (!bench.panoramaAvailable || failed || !imageUrl) return <BenchLandscape bench={bench}>{children}</BenchLandscape>;

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId || !size.height) return;
    event.preventDefault();
    const panoramaWidth = size.height * 4;
    setHeading(normalizeHeading(active.heading - (event.clientX - active.x) / panoramaWidth * 360));
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const offset = panoramaTrackOffset(size.width, size.height, heading);
  const degrees = Math.round(heading) % 360;
  const style = { "--panorama-offset": `${offset}px` } as CSSProperties;
  const benchStyle = { left: `${initialHeading / 360 * 100}%` } as CSSProperties;
  const showsRearBench = property(bench, "backrest") !== "Nein";
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

  return <figure className={`bench-panorama phase-${bench.dayPhase} season-${bench.season}${dragging ? " is-dragging" : ""}${raining ? " is-raining" : ""}`}>
    <div
      ref={viewport}
      className="bench-panorama-viewport"
      aria-label={t("panoramaDescription")}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, heading };
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
    <div className="bench-panorama-controls">
      <span title={t("panoramaCalculated")}><Compass size={15} aria-hidden="true" />{degrees}°</span>
      <input
        type="range"
        min="0"
        max="359"
        step="1"
        value={degrees}
        aria-label={t("panoramaControl")}
        aria-valuetext={t("panoramaHeading", { degrees })}
        onChange={(event) => setHeading(Number(event.currentTarget.value))}
      />
      <small>{t("panoramaHint")}</small>
    </div>
    {children}
  </figure>;
}
