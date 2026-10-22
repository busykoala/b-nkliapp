"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Establish the reading position before paint without interrupting an input. */
export function useSheetHeadingFocus(ref: RefObject<HTMLHeadingElement | null>) {
  useLayoutEffect(() => {
    const heading = ref.current;
    if (!heading || heading.closest(".map-sheet-shell")?.contains(document.activeElement)) return;
    heading.focus({ preventScroll: true });
  }, [ref]);
}
