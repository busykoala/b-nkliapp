export type OrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<"granted" | "denied">;
};
type CompassReading = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

export function normalizeHeading(value: number) { return ((value % 360) + 360) % 360; }
export function headingDelta(from: number, to: number) { return ((to - from + 540) % 360) - 180; }

/** A relative alpha is NOT a compass bearing. Zero is a valid north reading. */
export function compassHeading(event: Event, screenAngle = window.screen.orientation?.angle
  ?? (window as Window & { orientation?: number }).orientation ?? 0): number | null {
  const reading = event as CompassReading;
  if (typeof reading.webkitCompassAccuracy === "number"
    && (!Number.isFinite(reading.webkitCompassAccuracy) || reading.webkitCompassAccuracy < 0 || reading.webkitCompassAccuracy > 45)) return null;
  const heading = typeof reading.webkitCompassHeading === "number"
    ? reading.webkitCompassHeading + screenAngle
    : typeof reading.alpha === "number" && (reading.absolute || event.type === "deviceorientationabsolute")
      ? 360 - reading.alpha + screenAngle : null;
  return heading !== null && Number.isFinite(heading) ? normalizeHeading(heading) : null;
}

/** Cancellation removes listeners immediately, including an outstanding permission request. */
export function waitForCompassHeading(signal: AbortSignal, timeoutMs = 3_000) {
  return new Promise<number | null>((resolve) => {
    const finish = (heading: number | null) => {
      window.removeEventListener("deviceorientationabsolute", orient);
      window.removeEventListener("deviceorientation", orient);
      signal.removeEventListener("abort", cancel);
      clearTimeout(timer);
      resolve(heading);
    };
    const cancel = () => finish(null);
    const orient = (event: Event) => { const heading = compassHeading(event); if (heading !== null) finish(heading); };
    if (signal.aborted) { resolve(null); return; }
    window.addEventListener("deviceorientationabsolute", orient);
    window.addEventListener("deviceorientation", orient);
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
  });
}
