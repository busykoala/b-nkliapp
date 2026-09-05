import "server-only";
import { sqlite } from "@/db/client";
import { distanceMeters } from "../journey";
import { routeWalk, type WalkRequest } from "../walking-provider";
import { nearestRoutePoint, pathSeconds, routeCells, routeOverlap, routePoint, type WalkPath } from "../walking";
import { evaluateRoute } from "./evidence";
import { landscapeScore, verifiedExtras, type WalkBench, type WalkQuery, type WalkResult, type WalkSuggestion } from "./model";

function nearbyBenches(query: WalkQuery): WalkBench[] {
  const radius = query.minutes / 60 * query.speed * 1000;
  const lat = radius / 110000, lon = radius / 74000;
  const rows = sqlite.prepare(`SELECT b.id,b.name,b.latitude,b.longitude,e.waterfront,e.view_score,e.view_confidence
    FROM bench_spatial_index s JOIN benches b ON b.row_id=s.row_id LEFT JOIN bench_enrichments e ON e.bench_row_id=b.row_id
    WHERE s.min_latitude<=? AND s.max_latitude>=? AND s.min_longitude<=? AND s.max_longitude>=? AND b.active=1
    ORDER BY abs(b.latitude-?)+abs(b.longitude-?)*.68 LIMIT 5000`).all(query.origin.latitude + lat, query.origin.latitude - lat, query.origin.longitude + lon, query.origin.longitude - lon, query.origin.latitude, query.origin.longitude) as { id: string; name: string | null; latitude: number; longitude: number; waterfront: number | null; view_score: number | null; view_confidence: string | null }[];
  return rows.filter((b) => distanceMeters({ ...b, label: "" }, query.origin) <= radius).map((b) => ({ id: b.id, label: b.name ?? "Bänkli", name: b.name, latitude: b.latitude, longitude: b.longitude, waterfront: b.waterfront === 1, quality: b.view_confidence && b.view_confidence !== "niedrig" && b.view_score !== null ? Math.max(0, Math.min(1, b.view_score / 100)) : null }));
}

export async function discoverWalks(query: WalkQuery): Promise<WalkResult> {
  const signal = AbortSignal.timeout(15000);
  const result: WalkResult = { query, suggestions: [], fetchedAt: new Date().toISOString(), partial: false };
  let calls = 0;
  const route = (request: WalkRequest) => {
    signal.throwIfAborted();
    if (++calls > 24) throw new Error("Search budget exhausted");
    return routeWalk({ ...request, difficulty: query.difficulty, scenic: true }, signal, true);
  };
  const benches = nearbyBenches(query);
  if (!benches.length) return { ...result, message: "In dieser Gehzeit wurde noch kein passendes Bänkli gefunden. Versuche eine längere Runde oder einen anderen Start." };
  const add = (path: WalkPath, bench: WalkBench) => {
    // Keep a visible gap at the user's origin (e.g. inside a building), without
    // drawing a made-up connecting line. The planned bench itself must be reached.
    const unverifiedBench = path.warnings.some((warning) => !warning.startsWith("Start:") && !(query.shape === "loop" && warning.startsWith("Ziel:")));
    if (unverifiedBench || path.distance < 100) return;
    const evidence = evaluateRoute(path, query), durationSeconds = pathSeconds(path, query.speed);
    const cells = routeCells(path), repeated = cells.size * 25 / Math.max(1, path.distance) < .6;
    const suggestion: WalkSuggestion = { id: `walk-${result.suggestions.length}`, path, bench, extraBenches: [], durationSeconds, score: landscapeScore(evidence, bench, query.light) - (repeated ? .12 : 0), evidence, withinBudget: Math.abs(durationSeconds - query.minutes * 60) <= query.minutes * 12, repeated, benchIndex: nearestRoutePoint(path, bench).index };
    if (result.suggestions.some((s) => routeOverlap(routeCells(s.path), cells) > .8)) return;
    result.suggestions.push(suggestion);
  };
  try {
    const targetMeters = query.minutes / 60 * query.speed * 1000;
    if (query.shape === "one-way") {
      // Different radii matter in steep terrain; six neighbours on one hillside
      // are not six meaningful alternatives. Keep the query pool large enough
      // that city-centre bench density cannot truncate a two-hour walk to 15min.
      const candidates: WalkBench[] = [];
      for (const fraction of [.55, .75, .4, .65, .85, .3]) {
        const available = benches.filter((b) => !candidates.some((c) => c.id === b.id || distanceMeters(c, b) < targetMeters * .12));
        const candidate = available.sort((a, b) => Math.abs(distanceMeters(query.origin, a) - targetMeters * fraction) - Math.abs(distanceMeters(query.origin, b) - targetMeters * fraction))[0];
        if (candidate) candidates.push(candidate);
      }
      for (let i = 0; i < candidates.length; i += 2) await Promise.all(candidates.slice(i, i + 2).map(async (bench) => {
        try { for (const path of await route({ points: [query.origin, bench], alternatives: true })) add(path, bench); } catch { result.partial = true; }
      }));
    } else {
      for (let seed = 0; seed < 6; seed += 2) await Promise.all([seed, seed + 1].map(async (value) => {
        try {
          let loop = (await route({ points: [query.origin], roundTrip: { seed: value, meters: targetMeters } }))[0];
          const seconds = pathSeconds(loop, query.speed), requestedSeconds = query.minutes * 60;
          if (Math.abs(seconds - requestedSeconds) > requestedSeconds * .2) {
            loop = (await route({ points: [query.origin], roundTrip: { seed: value, meters: targetMeters * Math.max(.4, Math.min(1.6, requestedSeconds / seconds)) } }))[0];
          }
          const candidate = benches.map((bench) => ({ bench, ...nearestRoutePoint(loop, bench) })).filter((b) => b.distance < 300 && distanceMeters(query.origin, b.bench) > 100).sort((a, b) => a.distance - b.distance)[0];
          if (!candidate) return;
          // round_trip accepts one point, not a forced bench. Re-route through actual waypoints.
          const anchors = [.25, .5, .75].map((fraction) => { const index = Math.floor((loop.geometry.length - 1) * fraction); return { index, point: routePoint(loop.geometry[index]) }; });
          anchors.push({ index: candidate.index, point: candidate.bench });
          const points = [query.origin, ...anchors.sort((a, b) => a.index - b.index).map((a) => a.point), query.origin];
          add((await route({ points }))[0], candidate.bench);
        } catch { result.partial = true; }
      }));
    }
    result.suggestions.sort((a, b) => Number(b.withinBudget) - Number(a.withinBudget) || (a.withinBudget ? b.score - a.score : Math.abs(a.durationSeconds - query.minutes * 60) - Math.abs(b.durationSeconds - query.minutes * 60)));
    result.suggestions = result.suggestions.slice(0, 3);
    // Only actual routed access is evidence; do not count a radius around the line.
    for (const suggestion of result.suggestions) {
      const candidates = benches.filter((b) => b.id !== suggestion.bench.id).map((bench) => ({ bench, ...nearestRoutePoint(suggestion.path, bench) })).filter((b) => b.distance <= 25).sort((a, b) => a.distance - b.distance);
      for (const candidate of candidates) {
        if (calls >= 24 || signal.aborted) break;
        try {
          const access = (await route({ points: [candidate.point, candidate.bench] }))[0];
          const end = routePoint(access.geometry.at(-1)!);
          if (!access.warnings.length && access.distance <= 25 && distanceMeters(end, candidate.bench) <= 1 && distanceMeters(routePoint(access.geometry[0]), candidate.point) <= 1) suggestion.extraBenches.push(candidate.bench);
        } catch { result.partial = true; }
      }
      suggestion.extraBenches = verifiedExtras(suggestion.extraBenches, [suggestion.bench]);
    }
  } catch { result.partial = true; }
  if (!result.suggestions.length) result.message = "Noch kein geprüfter Spaziergang verfügbar. Bitte Start oder Gehzeit ändern. Der eigene Routenservice muss bereit sein.";
  else if (!result.suggestions[0].withinBudget) result.message = "Die gewünschte Gehzeit passt hier nicht genau. Dies ist der nächstliegende geprüfte Vorschlag; die tatsächliche Dauer steht dabei.";
  return result;
}
