"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PaintingFrame, type PaintingTreatment } from "@/components/painting-frame";
import { panoramaProjection, type PanoramaRasterBounds } from "@/lib/panorama-scene";
import { PANORAMA_SKY_MAX_ALTITUDE } from "@/lib/night-sky";
import styles from "./place-painting.module.css";

export type PaintingCrop = { width: number; height: number; heading: number; bounds: PanoramaRasterBounds };

export function PlacePainting({ benchId, src, framing, treatment }: {
  benchId: string; src: string; framing: PaintingCrop; treatment: PaintingTreatment;
}) {
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ width: treatment === "thumbnail" ? 72 : 390, height: treatment === "thumbnail" ? 56 : 200 });
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(node); measure();
    return () => observer.disconnect();
  }, []);
  if (failed) return null;
  const projection = panoramaProjection(size.width, size.height, framing.heading, 0, 1, framing.bounds);
  const top = projection.top + (PANORAMA_SKY_MAX_ALTITUDE - framing.bounds.maximumAltitude) * projection.pixelsPerDegree;
  return <span className={`place-painting ${styles.painting}`} aria-hidden="true" data-crop-heading={framing.heading}>
    <PaintingFrame benchId={benchId} treatment={treatment}>
      <span ref={frame} className={styles.window} data-treatment={treatment}>
        {[0, 1, 2].map(copy => <Image key={copy} src={src} width={framing.width} height={framing.height}
          sizes={`${Math.max(1, Math.ceil(projection.copyWidth))}px`} alt="" draggable={false}
          style={{ width: projection.copyWidth, height: "auto", left: projection.left + copy * projection.copyWidth, top }}
          onError={() => setFailed(true)} />)}
      </span>
    </PaintingFrame>
  </span>;
}
