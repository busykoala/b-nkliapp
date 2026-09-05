import { distanceMeters, type JourneyPoint } from "./journey";

export type WalkPath = {
  geometry: [number, number][]; distance: number; ascent: number;
  /** GraphHopper's slope-aware time at the profile's reference pace of 5 km/h. */
  referenceSeconds: number; warnings: string[];
  instructions: { text: string; distance: number; interval: [number, number] }[];
  details: Record<string, [number, number, string | number | null][]>;
};
export function pathSeconds(path: WalkPath, speed: number) { return Math.ceil(path.referenceSeconds * 5 / speed - 1e-9); }
/** Cumulative slope-aware times, using path-detail intervals rather than vertex count. */
export function pathTimes(path: WalkPath, speed: number): number[] {
  const distances = [0];
  for (let i = 1; i < path.geometry.length; i++) distances.push(distances[i - 1] + distanceMeters(routePoint(path.geometry[i - 1]), routePoint(path.geometry[i])));
  const total = distances.at(-1) ?? 0;
  const seconds = distances.map((d, i) => i ? pathSeconds(path, speed) * (d - distances[i - 1]) / Math.max(1, total) : 0);
  for (const [from, to, time] of path.details.time ?? []) {
    if (typeof time !== "number" || time < 0 || to >= distances.length || from >= to) continue;
    const length = distances[to] - distances[from];
    if (!length) continue;
    for (let i = from + 1; i <= to; i++) seconds[i] = time / 1000 * 5 / speed * (distances[i] - distances[i - 1]) / length;
  }
  const sum = seconds.reduce((a, b) => a + b, 0), scale = sum > 0 ? pathSeconds(path, speed) / sum : 1;
  const cumulative = [0];
  for (let i = 1; i < seconds.length; i++) cumulative.push(cumulative[i - 1] + seconds[i] * scale);
  return cumulative;
}
export function routePoint(coordinate: number[]): JourneyPoint {
  return { label: "Wegpunkt", longitude: coordinate[0], latitude: coordinate[1] };
}
export function nearestRoutePoint(path: WalkPath, point: JourneyPoint) {
  let index = 0, distance = Infinity;
  path.geometry.forEach((p, i) => { const d = distanceMeters(routePoint(p), point); if (d < distance) { index = i; distance = d; } });
  return { index, distance, point: routePoint(path.geometry[index]) };
}
/** Undirected segment cells: repeated return sections must not count as variety. */
export function routeCells(path: WalkPath): Set<string> {
  const cells = new Set<string>();
  for (let i = 1; i < path.geometry.length; i++) {
    const a = path.geometry[i - 1], b = path.geometry[i];
    const n = Math.max(1, Math.ceil(distanceMeters(routePoint(a), routePoint(b)) / 25));
    for (let j = 0; j < n; j++) cells.add(`${Math.round((a[0] + (b[0] - a[0]) * j / n) * 2500)},${Math.round((a[1] + (b[1] - a[1]) * j / n) * 4000)}`);
  }
  return cells;
}
export function routeOverlap(a: Set<string>, b: Set<string>) {
  return [...a].filter((cell) => b.has(cell)).length / Math.max(1, Math.min(a.size, b.size));
}
