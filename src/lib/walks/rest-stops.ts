import { distanceMeters, type JourneyPoint } from "../journey";
import { pathSeconds, pathTimes, routePoint, type WalkPath } from "../walking";
import type { RestStop, WalkBench, WalkQuery } from "./model";

type Visit = RestStop & { distance: number; routeIndex: number };

/** Project onto segments, retaining separate visits on an out-and-back route. */
export function benchVisits(path: WalkPath, benches: WalkBench[], speed: number, radius = 1): Visit[] {
  const times = pathTimes(path, speed);
  const visits: Visit[] = [];
  for (const bench of benches) {
    const xScale = 111_195 * Math.cos(bench.latitude * Math.PI / 180), yScale = 111_195;
    let closest: Visit | null = null;
    const flush = () => { if (closest) visits.push(closest); closest = null; };
    for (let index = 1; index < path.geometry.length; index++) {
      const a = path.geometry[index - 1], b = path.geometry[index];
      const ax = (a[0] - bench.longitude) * xScale, ay = (a[1] - bench.latitude) * yScale;
      const dx = (b[0] - a[0]) * xScale, dy = (b[1] - a[1]) * yScale;
      const length2 = dx * dx + dy * dy;
      const fraction = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
      const distance = Math.hypot(ax + fraction * dx, ay + fraction * dy);
      if (distance > radius) { flush(); continue; }
      // Adjacent long segments can each pass the bench while their shared
      // turnaround is far away. Those are two visits, not one continuous stop.
      if (closest && Math.hypot(ax, ay) > radius) flush();
      const visit = { bench, distance, routeIndex: index - 1 + fraction, routeSeconds: times[index - 1] + fraction * (times[index] - times[index - 1]) };
      if (!closest || visit.distance < closest.distance) closest = visit;
    }
    flush();
  }
  return visits.sort((a, b) => a.routeSeconds - b.routeSeconds || a.distance - b.distance);
}

function selectStops(visits: Visit[], duration: number, limit: number): Visit[] | null {
  const stops: Visit[] = [];
  let current = 0;
  while (duration - current > limit + .001) {
    const next = visits.filter((visit) => visit.routeSeconds > current + 1 && visit.routeSeconds <= current + limit)
      .sort((a, b) => b.routeSeconds - a.routeSeconds || a.distance - b.distance)[0];
    if (!next) return null;
    stops.push(next);
    current = next.routeSeconds;
  }
  return stops;
}

export function restCoverage(path: WalkPath, benches: WalkBench[], query: WalkQuery) {
  if (!query.maxRestMinutes || path.warnings.length) return null;
  if (distanceMeters(routePoint(path.geometry[0]), query.origin) > 1) return null;
  if (query.shape === "loop" && distanceMeters(routePoint(path.geometry.at(-1)!), query.origin) > 1) return null;
  const duration = pathSeconds(path, query.speed);
  const stops = selectStops(benchVisits(path, benches, query.speed), duration, query.maxRestMinutes * 60);
  if (!stops) return null;
  const times = [0, ...stops.map((stop) => stop.routeSeconds), duration];
  return { stops: stops.map(({ bench, routeSeconds }) => ({ bench, routeSeconds })), maxGapSeconds: Math.max(...times.slice(1).map((time, index) => time - times[index])) };
}

/** Candidate proximity is only a routing hint. Coverage is rechecked after routing. */
export function restWaypoints(path: WalkPath, benches: WalkBench[], main: WalkBench, query: WalkQuery): JourneyPoint[] | null {
  if (!query.maxRestMinutes) return null;
  const visits = benchVisits(path, benches, query.speed, 80);
  const duration = pathSeconds(path, query.speed);
  const stops = selectStops(visits, duration, query.maxRestMinutes * 60 * .8)
    ?? selectStops(visits, duration, query.maxRestMinutes * 60);
  if (!stops) return null;
  const mainVisit = visits.find((visit) => visit.bench.id === main.id);
  if (!mainVisit) return null;
  const waypoints = [...stops, mainVisit].map((visit) => ({ index: visit.routeIndex, point: visit.bench as JourneyPoint }));
  // Preserve the shape instead of replacing a loop with shortcuts between seats.
  for (const fraction of [.25, .5, .75]) {
    const index = Math.floor((path.geometry.length - 1) * fraction);
    waypoints.push({ index, point: routePoint(path.geometry[index]) });
  }
  waypoints.sort((a, b) => a.index - b.index);
  const end = query.shape === "loop" ? query.origin : main;
  return [query.origin, ...waypoints.map((item) => item.point), end]
    .filter((point, index, all) => index === 0 || distanceMeters(point, all[index - 1]) > .5);
}
