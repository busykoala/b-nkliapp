"use server";

import { randomInt, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { refreshUserBadges } from "@/lib/badges";
import { requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const threshold = Math.max(2, Math.min(10, Number(process.env.BENCH_VERIFICATION_THRESHOLD ?? 3) || 3));
const addSchema = z.object({
  latitude: z.coerce.number().min(45.7).max(47.9),
  longitude: z.coerce.number().min(5.7).max(10.7),
  name: z.string().trim().max(80).optional(),
  dedication: z.string().trim().max(180).optional(),
  locationName: z.string().trim().min(2).max(100),
  postcode: z.string().trim().max(10).optional(),
  canton: z.string().trim().max(30).optional(),
});
const editSchema = z.object({
  name: z.string().trim().max(80).optional(),
  dedication: z.string().trim().max(180).optional(),
  locationName: z.string().trim().min(2).max(100),
  postcode: z.string().trim().max(10).optional(),
  canton: z.string().trim().max(30).optional(),
});

function locationKey(value: string) { return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("de-CH"); }
function rowFor(id: string) {
  const row = sqlite.prepare("SELECT row_id FROM benches WHERE id=? AND active=1").get(id) as { row_id: number } | undefined;
  if (!row) throw new Error("Dieses Bänkli wurde nicht gefunden.");
  return row.row_id;
}
function refresh(id: string) { revalidatePath("/"); revalidatePath(`/bank/${id}`); }

export async function addBench(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Bitte Standort und Ort prüfen." };
  try {
    const user = await requireUser();
    const now = new Date().toISOString();
    const id = `community-${randomUUID()}`;
    const transaction = sqlite.transaction(() => {
      const result = sqlite.prepare(`INSERT INTO benches(
        id,osm_type,osm_id,latitude,longitude,description,raw_tags,active,source_updated_at,imported_at,
        name,dedication,location_name,location_key,location_postcode,location_canton,created_by_user_id,verification_status
      ) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,'unverified')`).run(
        id, "community", -randomInt(1, 2_000_000_000), parsed.data.latitude, parsed.data.longitude,
        parsed.data.name || "Sitzbank", "{}", now, now, parsed.data.name || null, parsed.data.dedication || null,
        parsed.data.locationName, locationKey(parsed.data.locationName), parsed.data.postcode || null, parsed.data.canton || null, user.id,
      );
      sqlite.prepare("INSERT INTO bench_confirmations(bench_row_id,user_id,created_at) VALUES(?,?,?)")
        .run(Number(result.lastInsertRowid), user.id, now);
    });
    transaction();
    refreshUserBadges(user.id);
    refresh(id);
    return { ok: true, message: `Bänkli eingetragen – noch ${threshold - 1} Bestätigung${threshold - 1 === 1 ? "" : "en"}.` };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Bänkli konnte nicht gespeichert werden." }; }
}

export async function confirmBench(benchId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const rowId = rowFor(benchId);
    const now = new Date().toISOString();
    sqlite.prepare("INSERT OR IGNORE INTO bench_confirmations(bench_row_id,user_id,created_at) VALUES(?,?,?)").run(rowId, user.id, now);
    const count = (sqlite.prepare("SELECT count(*) count FROM bench_confirmations WHERE bench_row_id=?").get(rowId) as { count: number }).count;
    if (count >= threshold) sqlite.prepare("UPDATE benches SET verification_status='verified',verified_at=? WHERE row_id=?").run(now, rowId);
    refreshUserBadges(user.id); refresh(benchId);
    return { ok: true, message: count >= threshold ? "Dieses Bänkli ist jetzt bestätigt!" : `Noch ${threshold - count} Bestätigung${threshold - count === 1 ? "" : "en"}.` };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Bestätigung fehlgeschlagen." }; }
}

export async function requestBenchRemoval(benchId: string): Promise<ActionResult> {
  try {
    const user = await requireUser(); const rowId = rowFor(benchId); const now = new Date().toISOString();
    const transaction = sqlite.transaction(() => {
      let request = sqlite.prepare("SELECT id FROM bench_removal_requests WHERE bench_row_id=? AND status='pending'").get(rowId) as { id: number } | undefined;
      if (!request) {
        const result = sqlite.prepare("INSERT INTO bench_removal_requests(bench_row_id,created_by_user_id,created_at) VALUES(?,?,?)").run(rowId, user.id, now);
        request = { id: Number(result.lastInsertRowid) };
      }
      sqlite.prepare("INSERT OR IGNORE INTO bench_removal_confirmations(request_id,user_id,created_at) VALUES(?,?,?)").run(request.id, user.id, now);
      const count = (sqlite.prepare("SELECT count(*) count FROM bench_removal_confirmations WHERE request_id=?").get(request.id) as { count: number }).count;
      if (count >= threshold) {
        sqlite.prepare("UPDATE benches SET active=0,verification_status='removed',removed_at=? WHERE row_id=?").run(now, rowId);
        sqlite.prepare("UPDATE bench_removal_requests SET status='confirmed',resolved_at=? WHERE id=?").run(now, request.id);
      }
      return count;
    });
    const count = transaction(); refreshUserBadges(user.id); refresh(benchId);
    return { ok: true, message: count >= threshold ? "Als nicht mehr vorhanden bestätigt." : `Hinweis gespeichert – noch ${threshold - count} Stimme${threshold - count === 1 ? "" : "n"}.` };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Hinweis fehlgeschlagen." }; }
}

export async function editBenchMetadata(benchId: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Bitte Angaben prüfen." };
  try {
    const user = await requireUser(); const rowId = rowFor(benchId); const now = new Date().toISOString();
    const old = sqlite.prepare("SELECT name,dedication,location_name FROM benches WHERE row_id=?").get(rowId) as Record<string, string | null>;
    const next = { name: parsed.data.name || null, dedication: parsed.data.dedication || null, location: parsed.data.locationName };
    const transaction = sqlite.transaction(() => {
      sqlite.prepare("UPDATE benches SET name=?,dedication=?,location_name=?,location_key=?,location_postcode=?,location_canton=?,description=coalesce(?,description) WHERE row_id=?")
        .run(next.name, next.dedication, next.location, locationKey(next.location), parsed.data.postcode || null, parsed.data.canton || null, next.name, rowId);
      const insert = sqlite.prepare("INSERT INTO bench_metadata_edits(bench_row_id,user_id,field,old_value,new_value,created_at) VALUES(?,?,?,?,?,?)");
      for (const field of ["name", "dedication", "location"] as const) {
        const oldValue = field === "location" ? old.location_name : old[field];
        if (oldValue !== next[field]) insert.run(rowId, user.id, field, oldValue, next[field], now);
      }
    });
    transaction(); refreshUserBadges(user.id); refresh(benchId);
    return { ok: true, message: "Angaben aktualisiert." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Änderung fehlgeschlagen." }; }
}
