"use client";

import { useEffect, type RefObject } from "react";

/** Isolate a covering task without moving/remounting its content or native dialogs. */
export function useTaskIsolation(root: RefObject<HTMLElement | null>, active: boolean, media?: string) {
  useEffect(() => {
    if (!active) return;
    const query = media ? matchMedia(media) : null;
    let release = () => {};
    const apply = () => {
      release();
      const changed: HTMLElement[] = [];
      let node: HTMLElement | null = query && !query.matches ? null : root.current;
      while (node && node !== document.body) {
        const parent: HTMLElement | null = node.parentElement;
        for (const sibling of parent?.children ?? []) {
          if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert && !sibling.matches("script,style,link")) {
            sibling.setAttribute("inert", "");
            changed.push(sibling);
          }
        }
        node = parent;
      }
      release = () => { for (const node of changed) node.removeAttribute("inert"); };
    };
    apply(); query?.addEventListener("change", apply);
    return () => { query?.removeEventListener("change", apply); release(); };
  }, [root, active, media]);
}
