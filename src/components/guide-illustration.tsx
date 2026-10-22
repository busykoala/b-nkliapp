import Image from "next/image";

/** A flat pigment horizon belongs to the page, never to a specific place. */
export function GuideIllustration({ className = "" }: { className?: string }) {
  return <span className={`guide-illustration ${className}`} aria-hidden="true">
    <Image src="/ui-art/field-guide/horizon-wash-v1.webp" width={1400} height={467} alt="" unoptimized />
  </span>;
}
