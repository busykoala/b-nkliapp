import "server-only";
import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import * as SunCalc from "suncalc";
import { distanceMeters } from "../journey";
import { pathTimes, routePoint, type WalkPath } from "../walking";
import type { RouteEvidence, WalkQuery } from "./model";
import { loadWeatherGrid, sampleWeatherGrid } from "@/integrations/weather/repository";

type Cell = { quiet: number; nature: number; water: number; view: number | null; canopy: number; horizon: string | null; latitude: number; longitude: number; updated_at: string };
export function evaluateRoute(path: WalkPath, query: WalkQuery): RouteEvidence {
  const result: RouteEvidence = { quiet: null, nature: null, water: null, view: null, light: null, lightCoverage: 0, coverage: 0, updatedAt: null, reasons: [], warnings: [] };
  let db: Database.Database | undefined;
  try {
    db = new Database(process.env.LANDSCAPE_DATABASE_PATH ?? join(dirname(process.env.DATABASE_PATH ?? "data/benchly.sqlite"), "landscape.sqlite"), { readonly: true, fileMustExist: true });
    const lookup = db.prepare("SELECT * FROM cells WHERE x=? AND y=?");
    const clouds = loadWeatherGrid("CLCT");
    let total = 0, known = 0, quiet = 0, nature = 0, water = 0, view = 0, viewKnown = 0, lit = 0, lightKnown = 0;
    const times = pathTimes(path, query.speed);
    let elapsed = 0;
    for (let i = 1; i < path.geometry.length; i++) {
      const a = path.geometry[i - 1], b = path.geometry[i], distance = distanceMeters(routePoint(a), routePoint(b));
      const seconds = times[i] - times[i - 1];
      const count = Math.max(1, Math.ceil(distance / 25));
      for (let n = 0; n < count; n++) {
        const longitude = a[0] + (b[0] - a[0]) * (n + .5) / count, latitude = a[1] + (b[1] - a[1]) * (n + .5) / count;
        const weight = seconds / count; total += weight;
        const c = lookup.get(Math.round(longitude * 4000), Math.round(latitude * 4000)) as Cell | undefined;
        if (!c || !Number.isFinite(Date.parse(c.updated_at)) || Date.now() - Date.parse(c.updated_at) > 30 * 86400000) continue;
        result.updatedAt = !result.updatedAt || c.updated_at < result.updatedAt ? c.updated_at : result.updatedAt;
        known += weight; quiet += c.quiet * weight; nature += c.nature * weight; water += c.water * weight;
        if (c.view !== null) { view += c.view * weight; viewKnown += weight; }
        if (c.horizon) {
          const horizon: unknown = JSON.parse(c.horizon);
          if (!Array.isArray(horizon) || horizon.length !== 72 || !horizon.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
          const at = new Date(Date.parse(query.time) + (elapsed + seconds * (n + .5) / count) * 1000);
          const sun = SunCalc.getPosition(at, latitude, longitude);
          if (sun.altitude <= 0) continue; // Night is not evidence for a shaded walk.
          const azimuth = (sun.azimuth * 180 / Math.PI + 180 + 360) % 360;
          const blocked = sun.altitude * 180 / Math.PI <= horizon[Math.round(azimuth / 5) % 72];
          // Leaf cover is explicitly a seasonal proxy, not a measured clear-sky forecast.
          const leaf = at.getUTCMonth() >= 3 && at.getUTCMonth() <= 9 ? .8 : .35;
          const direct = blocked ? 0 : 1 - c.canopy * leaf;
          const cloudValue = clouds && Math.abs(at.getTime() - Date.parse(clouds.valid_at)) <= 3600000 ? sampleWeatherGrid(clouds, latitude, longitude) : null;
          if (cloudValue === null) continue;
          const cloud = Math.max(0, Math.min(1, cloudValue > 1 ? cloudValue / 100 : cloudValue));
          lightKnown += weight; lit += (query.light === "shade" ? 1 - direct : direct) * (1 - cloud) * weight;
        }
      }
      elapsed += seconds;
    }
    result.coverage = known / Math.max(1, total); result.lightCoverage = lightKnown / Math.max(1, total);
    if (result.coverage >= .8) { result.quiet = quiet / known; result.nature = nature / known; result.water = water / known; }
    if (viewKnown / Math.max(1, total) >= .8) result.view = view / viewKnown;
    if (query.light !== "any" && result.lightCoverage >= .8) result.light = lit / Math.max(total, 1);
    if ((result.water ?? 0) >= .55) result.reasons.push("Viel Weg in Wassernähe");
    if ((result.quiet ?? 0) >= .75) result.reasons.push("Wenig Hauptstrasse im Umfeld");
    if ((result.nature ?? 0) >= .55) result.reasons.push("Viel natürliche Umgebung");
    if ((result.view ?? 0) >= .65) result.reasons.push("Offenes Gelände entlang des Wegs");
  } catch { /* Plain routing still works without the offline landscape artifact. */ }
  finally { db?.close(); }
  if (result.coverage < .8) result.warnings.push("Landschaftsdaten noch unvollständig; die schönste Variante ist nicht sicher einschätzbar.");
  if (query.light !== "any" && result.lightCoverage < .8) result.warnings.push("Sonne und Schatten entlang dieses Wegs sind noch nicht verlässlich einschätzbar.");
  result.reasons = result.reasons.slice(0, 2);
  return result;
}
