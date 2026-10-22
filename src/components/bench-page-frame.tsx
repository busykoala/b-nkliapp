"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./bench-page-frame.module.css";

/** Keep browser/document scrolling on deep links so existing return tokens work. */
export function BenchPageFrame({ header, footer, children }: { header: ReactNode; footer: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const [flow, setFlow] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const heading = node.querySelector<HTMLElement>(".bench-page-header")!;
    const actions = node.querySelector<HTMLElement>(".bench-page-footer")!;
    const measure = () => {
      node.style.setProperty("--bench-actions-height", `${actions.offsetHeight}px`);
      setFlow(heading.offsetHeight + actions.offsetHeight > (window.visualViewport?.height ?? innerHeight) * .35);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(heading); observer.observe(actions);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.visualViewport?.removeEventListener("resize", measure); };
  }, []);
  return <main ref={root} className={`standalone-bench min-h-dvh ${styles.page}`} data-reading-layout={flow ? "flow" : "reserved"}>
    <div className="bench-page-header">{header}</div>
    {children}
    <footer className="bench-page-footer">{footer}</footer>
  </main>;
}
