import type { ReactNode } from "react";

/** One quiet heading scale for the appendix; no cards or nested disclosures. */
export function SourceSection({ title, children, className = "" }: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return <section className={`source-section ${className}`} aria-label={title}>
    <h3>{title}</h3>
    {children}
  </section>;
}

export function SourceGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="source-group" aria-label={title}>
    <h4>{title}</h4>
    {children}
  </section>;
}

export function DetailRows({ title, rows, className = "" }: {
  title: string;
  rows: ReadonlyArray<readonly [string, string | null]>;
  className?: string;
}) {
  const visible = rows.filter(([, value]) => value !== null && value !== "");
  if (!visible.length) return null;
  return <dl className={`source-rows ${className}`} aria-label={title}>
    {visible.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}
