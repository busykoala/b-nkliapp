import { useId } from "react";
import { WatercolorPigment } from "@/components/watercolor-pigment";

export type BadgeArt = "discoverer" | "pioneer" | "scout" | "checker" | "detective" | "poet" | "expert" | "guru" | "legend";

export function BadgeIllustration({ kind, label, earned }: { kind: BadgeArt; label: string; earned: boolean }) {
  const instance = useId().replaceAll(":", "");
  const pigmentId = `badge-pigment-${instance}`;
  const environment = kind === "guru" || kind === "legend" ? "/ui-art/v2/bench-scene-alpine-winter.webp"
    : kind === "poet" || kind === "expert" ? "/ui-art/v2/bench-scene-lake.webp"
      : kind === "detective" || kind === "checker" ? "/ui-art/v2/bench-scene-village.webp"
        : "/ui-art/v1/bench-scene-country-v1.webp";

  return <svg className="badge-illustration" viewBox="0 0 180 116" role="img" aria-label={label} data-earned={earned}>
    <defs><WatercolorPigment id={pigmentId} /><clipPath id={`${pigmentId}-edge`}><path d="M7 10 35 7 68 9 95 6 130 8 172 7l3 24-2 25 2 27-2 25-29 1-31-2-28 2-33-1-44 1-3-27 2-30-1-24Z" /></clipPath></defs>
    <g clipPath={`url(#${pigmentId}-edge)`}>
    <image className="badge-painted-environment" href={environment} x="2" y="4" width="176" height="108" preserveAspectRatio="xMidYMid slice" />
    <image className="badge-painted-bench" href="/ui-art/v1/bench-wood-back-v1.webp" x="72" y="61" width="76" height="51" />
    </g>
    <g className="badge-emblem" filter={`url(#${pigmentId})`}>
    {(kind === "pioneer" || kind === "legend") && <g className="badge-flag"><path d="M42 42v45" /><path d="m43 44 25 8-25 9Z" /></g>}
    {kind === "scout" && <path className="badge-path" d="M8 100q34-37 65-12t56-15q21-15 43-6" />}
    {kind === "detective" && <g className="badge-glass"><circle cx="46" cy="72" r="17" /><path d="m58 84 15 15" /></g>}
    {kind === "poet" && <g className="badge-quill"><path d="M39 88q10-35 35-40-3 24-31 37" /><path d="m39 88 28-31" /></g>}
    {(kind === "expert" || kind === "legend") && <g className="badge-stars"><path d="m32 27 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /><path d="m79 17 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5Z" /></g>}
    {kind === "discoverer" && <g className="badge-sprout"><path d="M43 94V75" /><path d="M43 82q-15-2-14-13 13 0 14 13Zm0-2q14-3 15-14-13 0-15 14Z" /></g>}
    {kind === "checker" && <path className="badge-check" d="m31 73 10 10 20-25" />}
    {kind === "pioneer" && <path className="badge-trail" d="M13 103q19-18 37-8" />}
    {kind === "expert" && <circle className="badge-seal" cx="143" cy="85" r="14" />}
    {kind === "legend" && <path className="badge-rays" d="M98 42V22M87 46 77 30m32 16 11-16" />}
    </g>
  </svg>;
}
