"use client";

import { BenchDetailContent, type BenchDetailContentProps } from "./bench-detail-content";

/** Same mounted experience and panorama in either sheet size. */
export function BenchQuickPreview(props: BenchDetailContentProps & { onDetails?: () => void }) {
  return <BenchDetailContent {...props} compact />;
}
