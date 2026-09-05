import "server-only";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JourneyPoint, TransferRule } from "./journey";

export type TransitStop = JourneyPoint & { stationId: string };
export function openTransitData() {
  const path = process.env.TRANSIT_DATABASE_PATH ?? join(dirname(process.env.DATABASE_PATH ?? "data/benchly.sqlite"), "transit.sqlite");
  if (!existsSync(path)) return null;
  try { return new Database(path, { readonly: true, fileMustExist: true }); } catch { return null; }
}
export function transitFeedDate(): string | null {
  const db = openTransitData();
  try { return (db?.prepare("SELECT value FROM metadata WHERE key='updated_at'").get() as { value: string } | undefined)?.value ?? null; }
  catch { return null; } finally { db?.close(); }
}
export function lookupTransfer(from: JourneyPoint, to: JourneyPoint, serviceDate = new Date().toISOString().slice(0, 10)): TransferRule | null {
  const db = openTransitData();
  if (!db) return null;
  try {
    const metadata = Object.fromEntries((db.prepare("SELECT key,value FROM metadata").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    if (!Number.isFinite(Date.parse(metadata.updated_at)) || Date.now() - Date.parse(metadata.updated_at) > 14 * 86400000) return null;
    const day = serviceDate.replaceAll("-", "");
    if (!/^\d{8}$/.test(metadata.valid_from ?? "") || !/^\d{8}$/.test(metadata.valid_until ?? "")) return null;
    if (day < metadata.valid_from || day > metadata.valid_until) return null;
    const candidates = (point: JourneyPoint) => {
      if (!point.stationId) return [];
      const rows = db.prepare("SELECT id,parent,platform FROM stops WHERE public_id=?").all(point.stationId.replace(/^0+(?=\d)/, "")) as { id: string; parent: string; platform: string }[];
      if (point.platform) {
        const exact = rows.filter((r) => r.platform === point.platform);
        if (exact.length) return [exact.map((r) => r.id), [...new Set(exact.map((r) => r.parent).filter(Boolean))]];
      }
      // Without a known platform, use only station-wide rules, not arbitrary platforms.
      return [rows.filter((r) => !r.parent).map((r) => r.id)];
    };
    const fromIds = candidates(from), toIds = candidates(to);
    for (const fromGroup of fromIds) for (const toGroup of toIds) {
      // Transport API IDs do not reliably map GTFS trips/routes: qualified rules cannot be applied.
      const statement = db.prepare("SELECT type,minimum FROM transfers WHERE from_stop=? AND to_stop=? AND from_route='' AND to_route='' AND from_trip='' AND to_trip=''");
      const rules = fromGroup.flatMap((a) => toGroup.flatMap((b) => statement.all(a, b))) as { type: number; minimum: number | null }[];
      if (!rules.length) continue;
      if (rules.some((r) => r.type !== rules[0].type || r.minimum !== rules[0].minimum)) return null;
      if (rules[0].type === 4 || rules[0].type === 5) return null;
      return { type: rules[0].type, minimumSeconds: rules[0].minimum, source: "Offizielle GTFS-Mindestumsteigezeit" };
    }
    return null;
  } catch { return null; } finally { db.close(); }
}
