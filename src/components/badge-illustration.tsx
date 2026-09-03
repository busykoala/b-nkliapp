export type BadgeArt = "discoverer" | "pioneer" | "scout" | "checker" | "detective" | "poet" | "expert" | "guru" | "legend";

export function BadgeIllustration({ kind, label, earned }: { kind: BadgeArt; label: string; earned: boolean }) {
  return <svg className="badge-illustration" viewBox="0 0 180 116" role="img" aria-label={label} data-earned={earned}>
    <path className="badge-sky" d="M5 13Q19 3 38 9 57 1 75 8 96 2 115 9 139 2 175 14V105H5Z" />
    <circle className="badge-sun" cx={kind === "guru" ? 137 : 145} cy="27" r={kind === "guru" ? 12 : 10} />
    {kind === "guru" && <circle className="badge-moon-cut" cx="131" cy="23" r="12" />}
    <path className="badge-mountain-far" d="M3 77 37 43l22 25 27-40 35 45 24-31 34 38v27H3Z" />
    <path className="badge-hill" d="M2 84Q38 67 80 82q50-24 100 1v26H2Z" />
    {(kind === "pioneer" || kind === "legend") && <g className="badge-flag"><path d="M42 42v45" /><path d="m43 44 25 8-25 9Z" /></g>}
    {kind === "scout" && <path className="badge-path" d="M8 100q34-37 65-12t56-15q21-15 43-6" />}
    {kind === "detective" && <g className="badge-glass"><circle cx="46" cy="72" r="17" /><path d="m58 84 15 15" /></g>}
    {kind === "poet" && <g className="badge-quill"><path d="M39 88q10-35 35-40-3 24-31 37" /><path d="m39 88 28-31" /></g>}
    {(kind === "expert" || kind === "legend") && <g className="badge-stars"><path d="m32 27 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /><path d="m79 17 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5Z" /></g>}
    <g className="badge-bench">
      <path d="M66 71h64v13H66Z" />
      <path d="M62 87h72v12H62Z" />
      <path className="badge-frame" d="M69 84v20m57-20v20" />
    </g>
    {kind === "discoverer" && <g className="badge-sprout"><path d="M43 94V75" /><path d="M43 82q-15-2-14-13 13 0 14 13Zm0-2q14-3 15-14-13 0-15 14Z" /></g>}
    {kind === "checker" && <path className="badge-check" d="m31 73 10 10 20-25" />}
    {kind === "pioneer" && <path className="badge-trail" d="M13 103q19-18 37-8" />}
    {kind === "expert" && <circle className="badge-seal" cx="143" cy="85" r="14" />}
    {kind === "legend" && <path className="badge-rays" d="M98 42V22M87 46 77 30m32 16 11-16" />}
  </svg>;
}
