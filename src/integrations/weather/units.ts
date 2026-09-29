/**
 * Convert MeteoSwiss ICON cloud-cover fields (CLCT/CLCL/CLCM/CLCH) to the
 * fraction used by the application.
 *
 * ICON stores these fields as percentage points (0..100). Do not infer the
 * unit from the numeric magnitude: a raw value of `1` means 1%, not 100%.
 */
export function iconCloudPercentToFraction(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value / 100));
}
