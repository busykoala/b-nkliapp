export type ObstructionChart = {
  buildings: number | null;
  plants: number | null;
  open: number | null;
  unknown: number | null;
  inconsistent: boolean;
};

export function obstructionChart(building: number | null, vegetation: number | null): ObstructionChart | null {
  const metric = (value: number | null) => value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const buildings = metric(building);
  const plants = metric(vegetation);
  if (buildings === null && plants === null) return null;
  const known = (buildings ?? 0) + (plants ?? 0);
  if (known > 100) return { buildings, plants, open: null, unknown: null, inconsistent: true };
  if (buildings !== null && plants !== null) return { buildings, plants, open: 100 - known, unknown: 0, inconsistent: false };
  return { buildings, plants, open: null, unknown: 100 - known, inconsistent: false };
}

export function minuteClock(minutes: number) {
  const value = Math.max(0, Math.min(1439, Math.floor(minutes)));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** Unknown is not zero; rounded durations avoid fractional minute labels. */
export function sourceDuration(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours ? `${hours} h${minutes ? ` ${minutes} min` : ""}` : `${minutes} min`;
}

/** Keep distinct intervals; do not imply sunlight through a gap between them. */
export function sourceWindows(windows: ReadonlyArray<{ start: string; end: string }>): string {
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return [...new Set(windows
    .filter(({ start, end }) => clock.test(start) && (clock.test(end) || end === "24:00") && start !== end)
    .map(({ start, end }) => `${start}–${end}`))].join(" · ");
}

/** The worker stores canopy_share_* as 0–1 fractions, unlike canopy_percent. */
export function sourceFractionPercent(value: number | null): string | null {
  return value === null || !Number.isFinite(value) || value < 0 || value > 1 ? null : `${Math.round(value * 100)}%`;
}
