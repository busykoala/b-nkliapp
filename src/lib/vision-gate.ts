export function visionLabelsEnabled(setting: string | undefined, latestBenchmarkStats: string | null) {
  if (setting === "true") return true;
  if (setting !== "auto" || !latestBenchmarkStats) return false;
  try {
    const stats = JSON.parse(latestBenchmarkStats) as { recommended?: unknown };
    return typeof stats.recommended === "string" && stats.recommended.length > 0;
  } catch { return false; }
}
