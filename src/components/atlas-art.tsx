/** Original vector lettering and ink drawings. No font outlines or reference artwork. */
export function AtlasWordmark({ className = "" }: { className?: string }) {
  return <svg className={`atlas-wordmark ${className}`} viewBox="0 0 154 50" aria-hidden="true" fill="none">
    <g stroke="currentColor" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 40 14 10c18-6 25 1 19 10-2 3-8 5-18 5 23-5 26 12 9 16-5 1-9 0-13-1Z" />
      <path d="M63 25c-8-8-21 1-21 10 0 9 13 7 20-3m2-11-3 20 8-3M49 13l1-1m11 1 1-1" />
      <path d="m77 22-3 19c5-14 17-24 19-15l-2 13 6-2m9-28-5 32m3-11 14-11m-13 11 12 10m12-30-4 30 7-2m10-16-2 18 7-2m-4-27 1-1" />
    </g>
  </svg>;
}

export function AtlasDrawing({ kind, className = "" }: { kind: "walk" | "remember" | "read"; className?: string }) {
  return <svg className={`atlas-drawing ${className}`} viewBox="0 0 96 60" fill="none" aria-hidden="true">
    <path d="M6 46c18-8 26 5 43-1s27-11 40-5l-1 9c-19-1-30 8-46 5S16 54 7 52Z" fill="var(--atlas-wash, #E4ECE6)" />
    <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {kind === "walk" ? <><path d="M15 46c26-20 44 7 58-17s-7-16-14-9M39 29l11-17 13 11M43 23l6 2 5-4M18 46l-4 6m64-19 4 1" /><circle cx="17" cy="44" r="3" /></>
        : kind === "remember" ? <><path d="m26 14 30-4 4 37-29 3Z M30 14l5 35m6-26 10-1m-9 8 11-2m-10 9 11-1M66 44l9-26 4 2-10 26-3 3Z" /><path d="M24 20h-4l4 32 32-1" /></>
          : <><path d="M12 19c14-4 24-2 35 5 12-8 21-10 36-8l-1 28c-14-3-25 0-35 7-11-7-22-9-35-6ZM47 24v27M19 26c8-1 14 1 20 4m-20 4c7-1 14 1 20 4m17-8c6-3 12-5 19-5m-19 12c7-4 12-5 18-5" /></>}
    </g>
  </svg>;
}
