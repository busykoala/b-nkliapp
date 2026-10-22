/** A small ink drawing shared by the folio and its margins; never a control. */
export function FieldMark({ className = "" }: { className?: string }) {
  return <svg className={`field-mark ${className}`} viewBox="0 0 76 30" fill="none" aria-hidden="true">
    <path d="M3 24.5c11-2 16 .5 25-1s16-1 25 0 13-.5 20-1" />
    <path d="m23 9 31-.7M22 13.5l32-.3M21 18l35-.5M25 18l-1.5 7M51 18l1 6.5M24 8l-.8 10M52 7.6l.5 10" />
  </svg>;
}
