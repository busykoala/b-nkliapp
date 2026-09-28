export type OrientationConstructor = typeof DeviceOrientationEvent & { requestPermission?: (absolute?: boolean) => Promise<"granted" | "denied"> };
type CompassOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

export function compassHeading(event: Event) {
  const reading = event as CompassOrientationEvent;
  const screenAngle = window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
  const heading = typeof reading.webkitCompassHeading === "number"
    ? reading.webkitCompassHeading
    : typeof reading.alpha === "number" && (reading.absolute || event.type === "deviceorientationabsolute")
      ? (360 - reading.alpha + screenAngle) % 360
      : null;
  return heading !== null && Number.isFinite(heading) ? heading : null;
}

export function waitForCompassHeading(timeoutMs = 2500) {
  return new Promise<number | null>((resolve) => {
    const finish = (heading: number | null) => {
      window.removeEventListener("deviceorientationabsolute", orient);
      window.removeEventListener("deviceorientation", orient);
      window.clearTimeout(timer);
      resolve(heading);
    };
    const orient = (event: Event) => {
      const heading = compassHeading(event);
      if (heading !== null) finish(heading);
    };
    window.addEventListener("deviceorientationabsolute", orient);
    window.addEventListener("deviceorientation", orient);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}
