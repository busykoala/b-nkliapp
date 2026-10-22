import type { CSSProperties, ReactNode } from "react";
import styles from "./painting-frame.module.css";

export type PaintingTreatment = "hero" | "journal" | "thumbnail";

/** A stable part of a place's presentation, independent of time and render order. */
export function paintingEdge(id: string): 0 | 1 | 2 {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 3) as 0 | 1 | 2;
}

export function paintingFrameStyle(id: string): CSSProperties {
  return { "--painting-edge": `url('/ui-art/field-guide/pigment-edge-${paintingEdge(id)}.svg')` } as CSSProperties;
}

export const paintingFrameClass = styles.frame;

export function PaintingFrame({ benchId, treatment, children, className = "" }: {
  benchId: string; treatment: PaintingTreatment; children: ReactNode; className?: string;
}) {
  return <span className={`${styles.frame} ${className}`} data-painting-treatment={treatment} style={paintingFrameStyle(benchId)}>{children}</span>;
}
