import type { ReactNode, RefObject } from "react";
import { AtlasDrawing } from "@/components/atlas-art";
import styles from "./route-presentation.module.css";

export function RouteOpening({ eyebrow, title, titleRef, children }: {
  eyebrow: string; title: string; titleRef: RefObject<HTMLHeadingElement | null>; children: ReactNode;
}) {
  return <header className={`guide-route-opening ${styles.opening}`}>
    <div className={styles.caption}><span>{eyebrow}</span><AtlasDrawing kind="walk" /></div>
    <h2 className="programmatic-focus-heading" ref={titleRef} tabIndex={-1}>{title}</h2>
    {children}
  </header>;
}
