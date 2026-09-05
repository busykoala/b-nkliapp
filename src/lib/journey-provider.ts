import "server-only";
import { z } from "zod";
import { assessTransfer, distanceMeters, summarizeJourney, swissWallTime, walkingSeconds, type JourneyLeg, type JourneyOption, type JourneyPoint, type JourneyQuery, type JourneyResult } from "./journey";
import { lookupTransfer, transitFeedDate } from "./journey-gtfs";
import { consumeRateLimit } from "./security";

const coordinate = z.object({ x: z.number().min(-90).max(90), y: z.number().min(-180).max(180) });
const station = z.object({ id: z.union([z.string(), z.number()]).nullable().optional(), name: z.string(), coordinate: coordinate.nullable() });
const checkpoint = z.object({ station, arrival: z.string().nullable().optional(), departure: z.string().nullable().optional(), platform: z.union([z.string(), z.number()]).nullable().optional(),
  prognosis: z.object({ arrival: z.string().nullable().optional(), departure: z.string().nullable().optional(), platform: z.union([z.string(), z.number()]).nullable().optional() }).nullable().optional() });
const section = z.object({ departure: checkpoint, arrival: checkpoint, walk: z.unknown().optional(), journey: z.object({ category: z.string().nullable().optional(), number: z.union([z.string(), z.number()]).nullable().optional(), to: z.string().nullable().optional(), passList: z.array(checkpoint).optional() }).nullable().optional() });
const connectionSchema = z.object({ sections: z.array(section).min(1).max(40) });
type Checkpoint = z.infer<typeof checkpoint>;
type Connection = z.infer<typeof connectionSchema>;
type Walk = { geometry: [number, number][]; distance: number; warnings: string[] };
type CacheEntry = { expiry: number; value: unknown; bytes: number; timer: ReturnType<typeof setTimeout> };
const globals = globalThis as typeof globalThis & { journeyNetwork?: { cache: Map<string, CacheEntry>; cacheBytes: number; nextWalk: number; lastWalk: number; active: number; cooldowns: Map<string, number> } };
const network = globals.journeyNetwork ??= { cache: new Map(), cacheBytes: 0, nextWalk: 0, lastWalk: 0, active: 0, cooldowns: new Map() };
function evict(key: string) {
  const entry = network.cache.get(key);
  if (!entry) return;
  clearTimeout(entry.timer); network.cacheBytes -= entry.bytes; network.cache.delete(key);
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(new Error("deadline")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
async function json(url: URL, signal: AbortSignal, ttl: number, pedestrian = false): Promise<unknown> {
  if (!["transport.opendata.ch", "routing.openstreetmap.de"].includes(url.hostname)) throw new Error("Invalid provider");
  const key = url.toString();
  const cached = network.cache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value;
  if ((network.cooldowns.get(url.hostname) ?? 0) > Date.now()) throw new Error("Provider cooling down");
  if (pedestrian) {
    const slot = Math.max(Date.now(), network.nextWalk);
    if (slot - Date.now() > 10000) throw new Error("Routing busy");
    network.nextWalk = slot + 1050;
    await pause(Math.max(0, slot - Date.now()), signal);
  }
  // Recheck actual start times after waiting for concurrency: reserved slots alone
  // could bunch together when a slow upstream request releases several waiters.
  while (network.active >= 3 || (pedestrian && Date.now() - network.lastWalk < 1050)) await pause(50, signal);
  signal.throwIfAborted();
  const nowCached = network.cache.get(key);
  if (nowCached && nowCached.expiry > Date.now()) return nowCached.value;
  if ((network.cooldowns.get(url.hostname) ?? 0) > Date.now()) throw new Error("Provider cooling down");
  if (url.pathname.endsWith("/connections")) consumeRateLimit("journey-provider", "timetable", 900, 86400);
  if (pedestrian) network.lastWalk = Date.now();
  network.active += 1;
  const started = Date.now();
  let status = "network-error";
  try {
    const response = await fetch(url, { signal, cache: "no-store", redirect: "error", headers: { "User-Agent": "Benchly/0.1 (+https://github.com/busykoala/b-nkliapp)" } });
    status = String(response.status);
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers.get("retry-after");
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 60;
      network.cooldowns.set(url.hostname, Date.now() + Math.max(60, Number.isFinite(seconds) ? seconds : 60) * 1000);
    }
    if (!response.ok) throw new Error(`provider-${response.status}`);
    // Limit untrusted upstream payloads without allowing fetch's persistent cache to store locations.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty response");
    let bytes = 0; const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > 4000000) { await reader.cancel(); throw new Error("Response too large"); }
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    for (const [k, v] of network.cache) if (v.expiry <= Date.now()) evict(k);
    evict(key);
    while (network.cache.size >= 400 || network.cacheBytes + bytes > 16_000_000) evict(network.cache.keys().next().value!);
    // Delete personal coordinates even if the process receives no further traffic.
    // Eviction cancels the timer too, so it cannot retain an evicted response.
    const timer = setTimeout(() => evict(key), ttl); timer.unref();
    network.cache.set(key, { expiry: Date.now() + ttl, value, bytes, timer }); network.cacheBytes += bytes;
    return value;
  } finally {
    network.active -= 1;
    // Provider timing only: no URLs, origins, station pairs, or user identifiers.
    console.info("journey-provider", { provider: pedestrian ? "foot" : "timetable", status, elapsedMs: Date.now() - started });
  }
}
function point(value: z.infer<typeof station>): JourneyPoint | null {
  return value.coordinate ? { label: value.name, latitude: value.coordinate.x, longitude: value.coordinate.y, ...(value.id ? { stationId: String(value.id).replace(/^0+(?=\d)/, "") } : {}) } : null;
}
function stop(value: Checkpoint) {
  const p = point(value.station); if (!p) throw new Error("Missing stop coordinates");
  const platform = value.prognosis?.platform ?? value.platform;
  return { ...p, ...(platform !== null && platform !== undefined ? { platform: String(platform) } : {}) };
}
function iso(value: string | null | undefined): string {
  if (!value || !/(Z|[+-]\d{2}:?\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
  return new Date(value).toISOString();
}
export async function findStations(query: string, signal: AbortSignal): Promise<JourneyPoint[]> {
  const url = new URL("https://transport.opendata.ch/v1/locations"); url.searchParams.set("query", query); url.searchParams.set("type", "station");
  const data = z.object({ stations: z.array(z.unknown()) }).parse(await json(url, signal, 86400000));
  return data.stations.flatMap((item) => { const parsed = station.safeParse(item); const p = parsed.success ? point(parsed.data) : null; return p?.stationId ? [p] : []; }).slice(0, 8);
}
async function nearby(p: JourneyPoint, signal: AbortSignal): Promise<JourneyPoint[]> {
  if (p.stationId) return [p];
  const url = new URL("https://transport.opendata.ch/v1/locations"); url.searchParams.set("x", String(p.latitude)); url.searchParams.set("y", String(p.longitude));
  const data = z.object({ stations: z.array(z.unknown()) }).parse(await json(url, signal, 300000));
  const points = data.stations.flatMap((item) => { const parsed = station.safeParse(item); const s = parsed.success ? point(parsed.data) : null; return s?.stationId ? [s] : []; });
  return points.filter((s, i) => points.findIndex((v) => v.stationId === s.stationId) === i && distanceMeters(p, s) < 5400).sort((a, b) => distanceMeters(p, a) - distanceMeters(p, b)).slice(0, 4);
}
export async function walkPath(a: JourneyPoint, b: JourneyPoint, signal: AbortSignal, personal: boolean): Promise<Walk> {
  const url = new URL(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}`);
  url.searchParams.set("overview", "full"); url.searchParams.set("geometries", "geojson"); url.searchParams.set("steps", "false"); url.searchParams.set("alternatives", "false");
  const result = z.object({ code: z.literal("Ok"), waypoints: z.array(z.object({ distance: z.number().nonnegative() })).length(2), routes: z.array(z.object({ distance: z.number().nonnegative(), geometry: z.object({ coordinates: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2).max(100000) }) })).min(1) }).parse(await json(url, signal, personal ? 300000 : 7 * 86400000, true));
  const warnings = result.waypoints.flatMap((p, i) => p.distance > 15 ? [`${i === 0 ? "Start" : "Ziel"}: ${Math.round(p.distance)} m bis zum kartierten Weg. Zugang vor Ort prüfen.`] : []);
  return { geometry: result.routes[0].geometry.coordinates, distance: result.routes[0].distance, warnings };
}
function walkLeg(id: string, a: JourneyPoint, b: JourneyPoint, path: Walk, time: number, speed: number, arriveBy = false): JourneyLeg {
  const durationSeconds = walkingSeconds(path.distance, speed);
  const start = arriveBy ? time - durationSeconds * 1000 : time;
  return { id, mode: "walk", from: a, to: b, departure: new Date(start).toISOString(), arrival: new Date(start + durationSeconds * 1000).toISOString(), predicted: false, distanceMeters: path.distance, durationSeconds, geometry: path.geometry, geometryQuality: "routed", warnings: path.warnings };
}
function vehicleMode(category: string): JourneyLeg["mode"] {
  if (/ship|bat|bav|fae|kat|boat|ferry/i.test(category)) return "ferry";
  if (/fun|stand/i.test(category)) return "funicular";
  if (/cab|^gb$|^lb$|^sl$|^pb$|gond/i.test(category)) return "cable-car";
  if (/bus|^(b|bp|bn|car|cax|eb|exb|icb|rub|tx)$/i.test(category)) return "bus";
  if (/tram|^tn?$/i.test(category)) return "tram";
  if (/metro|^m$/i.test(category)) return "metro";
  return "rail";
}
async function buildConnection(raw: Connection, query: JourneyQuery, destination: JourneyPoint, access: Walk | null, egress: Walk, signal: AbortSignal, id: string): Promise<JourneyOption> {
  const legs: JourneyLeg[] = [];
  let previousVehicle: JourneyLeg | null = null;
  let transferWalkSeconds = 0;
  let transferWalkKnown = false;
  let transferHasWalk = false;
  for (const [index, s] of raw.sections.entries()) {
    const from = stop(s.departure), to = stop(s.arrival);
    const departure = iso(s.departure.prognosis?.departure ?? s.departure.departure);
    const arrival = iso(s.arrival.prognosis?.arrival ?? s.arrival.arrival);
    if (Date.parse(arrival) < Date.parse(departure)) throw new Error("Inconsistent section timing");
    if (!s.journey) {
      // walk.duration=0 is common in the Swiss API even for a real walk: never trust it.
      try {
        const path = await walkPath(from, to, signal, false);
        const start = Math.max(Date.parse(departure), legs.length ? Date.parse(legs.at(-1)!.arrival) : 0);
        const leg = walkLeg(`${id}-${index}`, from, to, path, start, query.speedKmh);
        legs.push(leg); transferWalkSeconds += leg.durationSeconds;
        transferWalkKnown = (!transferHasWalk || transferWalkKnown) && !path.warnings.length;
      } catch {
        transferWalkKnown = false;
        legs.push({ id: `${id}-${index}`, mode: "walk", from, to, departure, arrival, predicted: false, durationSeconds: 0, geometry: [], geometryQuality: "missing", warnings: ["Fussweg und Gehzeit nicht verifiziert."] });
      }
      transferHasWalk = true;
      continue;
    }
    const scheduledDeparture = iso(s.departure.departure), scheduledArrival = iso(s.arrival.arrival);
    const leg: JourneyLeg = { id: `${id}-${index}`, from, to, departure, arrival, scheduledDeparture, scheduledArrival,
      predicted: departure !== scheduledDeparture || arrival !== scheduledArrival || Boolean(s.departure.prognosis?.departure || s.arrival.prognosis?.arrival),
      mode: vehicleMode(s.journey.category ?? ""), line: `${s.journey.category ?? "ÖV"} ${s.journey.number ?? ""}`.trim(), direction: s.journey.to ?? undefined,
      durationSeconds: Math.max(0, (Date.parse(arrival) - Date.parse(departure)) / 1000), geometryQuality: "schematic",
      geometry: [[from.longitude, from.latitude], ...(s.journey.passList ?? []).flatMap((p): [number, number][] => p.station.coordinate ? [[p.station.coordinate.y, p.station.coordinate.x]] : []), [to.longitude, to.latitude]], warnings: [] };
    for (const [checkpoint, label] of [[s.departure, "Abfahrt"], [s.arrival, "Ankunft"]] as const) {
      if (checkpoint.platform != null && checkpoint.prognosis?.platform != null && String(checkpoint.platform) !== String(checkpoint.prognosis.platform)) {
        leg.platformChanges ??= [];
        leg.platformChanges.push(`${label}: Gleis/Haltekante ${checkpoint.prognosis.platform} statt ${checkpoint.platform} (Prognose).`);
      }
    }
    if (previousVehicle) {
      const rule = lookupTransfer(previousVehicle.to, from, swissWallTime(departure).slice(0, 10));
      if (!transferHasWalk && distanceMeters(previousVehicle.to, from) > 30) {
        try {
          const path = await walkPath(previousVehicle.to, from, signal, false);
          const walk = walkLeg(`${id}-transfer-${index}`, previousVehicle.to, from, path, Date.parse(previousVehicle.arrival), query.speedKmh);
          legs.push(walk);
          transferWalkSeconds = walk.durationSeconds; transferWalkKnown = !path.warnings.length;
        } catch {
          legs.push({ id: `${id}-transfer-${index}`, mode: "walk", from: previousVehicle.to, to: from, departure: previousVehicle.arrival, arrival: departure, predicted: false, durationSeconds: 0, geometry: [], geometryQuality: "missing", warnings: ["Verbindungsweg zwischen diesen Haltestellen nicht verifiziert."] });
        }
      }
      leg.transfer = assessTransfer((Date.parse(departure) - Date.parse(previousVehicle.arrival)) / 1000, transferWalkKnown ? transferWalkSeconds : null, rule, query.bufferMinutes);
      if (legs.at(-1)?.mode === "walk" && Date.parse(legs.at(-1)!.arrival) > Date.parse(departure)) leg.transfer.tone = "insufficient";
    }
    legs.push(leg); previousVehicle = leg; transferWalkSeconds = 0; transferWalkKnown = false; transferHasWalk = false;
  }
  if (access) legs.unshift(walkLeg(`${id}-access`, query.origin, legs[0].from, access, Date.parse(legs[0].departure), query.speedKmh, true));
  legs.push(walkLeg(`${id}-egress`, legs.at(-1)!.to, destination, egress, Date.parse(legs.at(-1)!.arrival), query.speedKmh));
  return summarizeJourney(id, legs);
}
export async function planJourney(query: JourneyQuery, destination: JourneyPoint): Promise<JourneyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const signal = controller.signal;
  const options: JourneyOption[] = [];
  let partial = false;
  const result = (): JourneyResult => ({ options: options.sort((a, b) => Number(b.complete && b.feasible) - Number(a.complete && a.feasible) || (query.arriveBy ? Date.parse(b.departure) - Date.parse(a.departure) : Date.parse(a.arrival) - Date.parse(b.arrival))).slice(0, 3), partial,
    fetchedAt: new Date().toISOString(), feedUpdatedAt: transitFeedDate(),
    ...(!options.length ? { message: "Keine passende Verbindung gefunden. Bitte später/früher suchen oder den Start ändern." } : partial ? { message: "Einige Wege fehlen noch. Unsichere Abschnitte sind gekennzeichnet." } : {}) });
  try {
    if (query.mode === "walk") {
      const path = await walkPath(query.origin, destination, signal, query.origin.kind !== "station");
      options.push(summarizeJourney("walk", [walkLeg("walk-direct", query.origin, destination, path, Date.parse(query.time), query.speedKmh, query.arriveBy)]));
      partial = !options[0].complete;
      return result();
    }
    const [starts, ends] = await Promise.all([nearby(query.origin, signal), nearby(destination, signal)]);
    const reachable = async (stops: JourneyPoint[], endpoint: JourneyPoint, end: boolean) => {
      const found: { point: JourneyPoint; path: Walk | null }[] = [];
      for (const p of stops) {
        if (!end && query.origin.kind === "station" && p.stationId === endpoint.stationId) { found.push({ point: p, path: null }); break; }
        try {
          const path = await walkPath(end ? p : endpoint, end ? endpoint : p, signal, !end && query.origin.kind !== "station");
          if (walkingSeconds(path.distance, query.speedKmh) <= 3600) found.push({ point: p, path });
        } catch { partial = true; }
        if (found.length === 2 || signal.aborted) break;
      }
      return found;
    };
    const [origins, destinations] = await Promise.all([reachable(starts, query.origin, false), reachable(ends, destination, true)]);
    await Promise.allSettled(origins.flatMap((a) => destinations.map(async (b) => {
      try {
        const shift = query.arriveBy ? -walkingSeconds(b.path!.distance, query.speedKmh) : a.path ? walkingSeconds(a.path.distance, query.speedKmh) : 0;
        const wall = swissWallTime(new Date(Date.parse(query.time) + shift * 1000).toISOString());
        const url = new URL("https://transport.opendata.ch/v1/connections");
        for (const [k, v] of Object.entries({ from: a.point.stationId!, to: b.point.stationId!, date: wall.slice(0, 10), time: wall.slice(11), isArrivalTime: query.arriveBy ? "1" : "0", limit: "6" })) url.searchParams.set(k, v);
        const response = z.object({ connections: z.array(z.unknown()) }).parse(await json(url, signal, 30000));
        // Process in order to get an early useful result within the bounded walking queue.
        for (const [i, raw] of response.connections.slice(0, 6).entries()) {
          if (signal.aborted) { partial = true; break; }
          const parsed = connectionSchema.safeParse(raw); if (!parsed.success) { partial = true; continue; }
          const option = await buildConnection(parsed.data, query, destination, a.path, b.path!, signal, `${a.point.stationId}-${b.point.stationId}-${i}`);
          if (query.arriveBy ? Date.parse(option.arrival) > Date.parse(query.time) : Date.parse(option.departure) < Date.parse(query.time)) continue;
          if (option.legs.some((l) => l.transfer?.tone === "insufficient" || l.transfer?.tone === "tight")) continue;
          const signature = option.legs.filter((l) => l.mode !== "walk").map((l) => `${l.line}:${l.departure}:${l.from.stationId}:${l.to.stationId}`).join("|");
          if (!options.some((o) => o.legs.filter((l) => l.mode !== "walk").map((l) => `${l.line}:${l.departure}:${l.from.stationId}:${l.to.stationId}`).join("|") === signature)) options.push(option);
          if (!option.complete || !option.feasible) partial = true;
        }
      } catch { partial = true; }
    })));
    return result();
  } catch { partial = true; return { ...result(), message: "Routenservice gerade nicht verfügbar. Die Karte bleibt bedienbar. Bitte erneut versuchen." }; }
  finally { clearTimeout(timer); }
}
