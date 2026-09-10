import "server-only";
import { message } from "@/i18n/message";
import { z } from "zod";
import { DATA_RUNTIME } from "@/data/runtime.generated";
import { distanceMeters, type JourneyPoint } from "./journey";
import { routePoint, type WalkPath } from "./walking";

const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().finite().optional()]);
const line = z.object({ coordinates: z.array(coordinate).min(1).max(100000) });
const responseSchema = z.object({ paths: z.array(z.object({
  distance: z.number().nonnegative().max(300000), time: z.number().nonnegative().max(7 * 86400000), ascend: z.number().nonnegative(),
  points: line, snapped_waypoints: line,
  instructions: z.array(z.object({ sign: z.number().int().optional(), street_name: z.string().max(1000).optional(),
    street_ref: z.string().max(1000).optional(), street_destination: z.string().max(1000).optional(),
    street_destination_ref: z.string().max(1000).optional(), exit_number: z.number().int().nonnegative().optional(),
    ferry: z.string().max(80).optional(), distance: z.number().nonnegative(), interval: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]) })).max(10000).default([]),
  details: z.record(z.string(), z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.union([z.string(), z.number(), z.null()])]))).default({}),
})).min(1).max(3) });
const nearestResponseSchema = z.object({
  type: z.literal("Point"),
  coordinates: coordinate,
  distance: z.number().nonnegative().max(300000),
});
type Entry = { paths: WalkPath[]; expiry: number; bytes: number; timer: ReturnType<typeof setTimeout> };
type NearestEntry = { distance: number; expiry: number; timer: ReturnType<typeof setTimeout> };
const global = globalThis as typeof globalThis & { benchlyWalking?: { active: number; cache: Map<string, Entry>; bytes: number; cooldown: number; nearest?: Map<string, NearestEntry> } };
const state = global.benchlyWalking ??= { active: 0, cache: new Map(), bytes: 0, cooldown: 0, nearest: new Map() };
const nearestCache = state.nearest ??= new Map();
function evict(key: string) { const item = state.cache.get(key); if (item) { clearTimeout(item.timer); state.bytes -= item.bytes; state.cache.delete(key); } }
export type WalkRequest = { points: JourneyPoint[]; difficulty?: "easy" | "t2"; scenic?: boolean; roundTrip?: { meters: number; seed: number }; alternatives?: boolean };

export async function routeWalk(request: WalkRequest, signal: AbortSignal, personal = true): Promise<WalkPath[]> {
  // This address is server configuration, never client input. No public-service fallback.
  const base = new URL(process.env.WALK_ROUTER_URL ?? DATA_RUNTIME.graphHopperDefaultUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Invalid router configuration");
  const body = {
    profile: request.difficulty === "t2" ? "walk_t2" : "walk", points: request.points.map((p) => [p.longitude, p.latitude]),
    points_encoded: false, elevation: true, instructions: true, "ch.disable": true, timeout_ms: 10000,
    details: ["road_class", "road_environment", "hike_rating", "surface", "time", "edge_id"],
    ...(request.scenic ? { custom_model: { priority: [{ if: "road_class == PRIMARY || road_class == SECONDARY", multiply_by: .15 }, { if: "road_class == TERTIARY", multiply_by: .5 }] } } : {}),
    ...(request.roundTrip ? { algorithm: "round_trip", "round_trip.distance": request.roundTrip.meters, "round_trip.seed": request.roundTrip.seed } : request.alternatives ? { algorithm: "alternative_route", "alternative_route.max_paths": 2 } : {}),
  };
  const key = `${personal ? "personal" : "public"}:${JSON.stringify(body)}`, cached = state.cache.get(key);
  signal.throwIfAborted();
  if (cached && cached.expiry > Date.now()) return cached.paths;
  while (state.active >= 2) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error("deadline")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 25);
      signal.addEventListener("abort", abort, { once: true });
    });
    signal.throwIfAborted();
  }
  if (Date.now() < state.cooldown) throw new Error("Router busy");
  state.active++; const started = Date.now(); let status = "unavailable";
  try {
    const response = await fetch(new URL("/route", base), { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, signal, redirect: "error", cache: "no-store" });
    status = String(response.status);
    if (response.status === 429 || response.status === 503) state.cooldown = Date.now() + 30000;
    if (!response.ok) throw new Error("Router unavailable");
    const reader = response.body?.getReader(); if (!reader) throw new Error("Empty routing response");
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 4_000_000) { await reader.cancel(); throw new Error("Route too large"); } chunks.push(value); }
    const result = responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const paths = result.paths.map((p): WalkPath => {
      // round_trip returns generated intermediate waypoints plus the start again.
      // Only its first and last point correspond to the caller's single origin.
      const snapped = request.roundTrip ? [p.snapped_waypoints.coordinates[0], p.snapped_waypoints.coordinates.at(-1)!] : p.snapped_waypoints.coordinates;
      const requested = request.roundTrip ? [request.points[0], request.points[0]] : request.points;
      if (p.points.coordinates.length < 2 || snapped.length !== requested.length || (request.roundTrip && p.snapped_waypoints.coordinates.length < 2)) throw new Error("Incomplete path");
      const warnings = snapped.flatMap((c, i) => {
        const gap = distanceMeters(routePoint([c[0], c[1]]), requested[i]);
        return gap > 15 ? [message(i === 0 ? "routing.warnings.start" : i === requested.length - 1 ? "routing.warnings.end" : "routing.warnings.via", {distance: Math.round(gap)})] : [];
      });
      return { geometry: p.points.coordinates.map(([lon, lat]) => [lon, lat]), distance: p.distance, ascent: p.ascend, referenceSeconds: p.time / 1000, instructions: p.instructions, details: p.details, warnings };
    });
    evict(key);
    while (state.cache.size >= 100 || state.bytes + bytes > 8_000_000) evict(state.cache.keys().next().value!);
    const ttl = personal ? 300000 : 7 * 86400000;
    const timer = setTimeout(() => evict(key), ttl); timer.unref();
    state.cache.set(key, { paths, expiry: Date.now() + ttl, bytes, timer }); state.bytes += bytes;
    return paths;
  } finally { state.active--; console.info("walking-provider", { status, elapsedMs: Date.now() - started }); }
}
export async function walkPath(a: JourneyPoint, b: JourneyPoint, signal: AbortSignal, personal: boolean) {
  return (await routeWalk({ points: [a, b] }, signal, personal))[0];
}

export async function nearestMappedWayDistance(point: JourneyPoint, signal: AbortSignal): Promise<number> {
  const base = new URL(process.env.WALK_ROUTER_URL ?? DATA_RUNTIME.graphHopperDefaultUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Invalid router configuration");
  const key = `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
  const cached = nearestCache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.distance;
  signal.throwIfAborted();
  const url = new URL("/nearest", base);
  url.searchParams.set("point", `${point.latitude},${point.longitude}`);
  const response = await fetch(url, { signal, redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error("Router unavailable");
  const text = await response.text();
  if (text.length > 10_000) throw new Error("Nearest response too large");
  const distance = nearestResponseSchema.parse(JSON.parse(text)).distance;
  while (nearestCache.size >= 2_000) {
    const oldest = nearestCache.keys().next().value;
    if (oldest === undefined) break;
    clearTimeout(nearestCache.get(oldest)?.timer);
    nearestCache.delete(oldest);
  }
  const expiry = Date.now() + 7 * 86400000;
  const timer = setTimeout(() => nearestCache.delete(key), expiry - Date.now());
  timer.unref();
  nearestCache.set(key, { distance, expiry, timer });
  return distance;
}
