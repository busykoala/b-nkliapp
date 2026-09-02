"use server";

import { randomInt, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { refreshUserBadges } from "@/lib/badges";
import { recordBenchConfirmation, recordRemovalConfirmation, resolveVerificationThreshold } from "@/lib/bench-verification";
import { normalizeLocationKey } from "@/lib/place-search";
import { reverseGeocodeSwiss, type SwissLocation } from "@/lib/reverse-geocode";
import { assertContributorAllowed, consumeRateLimit, contributorHashForUser, getContributorIdentity, requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const threshold = resolveVerificationThreshold();
const addSchema = z.object({
  latitude: z.coerce.number().min(45.7).max(47.9),
  longitude: z.coerce.number().min(5.7).max(10.7),
  name: z.string().trim().max(80).optional(),
  dedication: z.string().trim().max(180).optional(),
});
const editSchema = z.object({
  name: z.string().trim().max(80).optional(),
  dedication: z.string().trim().max(180).optional(),
  locationName: z.string().trim().min(2).max(100),
  postcode: z.string().trim().max(10).optional(),
  canton: z.string().trim().max(30).optional(),
});

function rowFor(id: string) {
  const row = sqlite.prepare("SELECT row_id FROM benches WHERE id=? AND active=1").get(id) as { row_id: number } | undefined;
  if (!row) throw new Error("Dieses Bänkli wurde nicht gefunden.");
  return row.row_id;
}
function refresh(id: string) { revalidatePath("/"); revalidatePath(`/bank/${id}`); }
async function writeActor(action: string, dailyLimit: number, ipDailyLimit: number) {
  const user = await requireUser();
  const identity = await getContributorIdentity();
  const contributorHash = contributorHashForUser(user.id);
  assertContributorAllowed(contributorHash);
  consumeRateLimit(contributorHash, `${action}-day`, dailyLimit, 86400);
  consumeRateLimit(identity.ipHash, `${action}-ip-day`, ipDailyLimit, 86400);
  return user;
}

function nearestKnownLocation(latitude: number, longitude: number): SwissLocation | null {
  const row = sqlite.prepare(`
    SELECT b.location_name AS name,b.location_postcode AS postcode,b.location_canton AS canton
    FROM bench_spatial_index s JOIN benches b ON b.row_id=s.row_id
    WHERE s.min_longitude BETWEEN ? AND ? AND s.min_latitude BETWEEN ? AND ?
      AND b.location_name IS NOT NULL AND b.location_name<>''
    ORDER BY ((b.latitude-?)*(b.latitude-?))+((b.longitude-?)*(b.longitude-?)) LIMIT 1
  `).get(longitude - .25, longitude + .25, latitude - .18, latitude + .18, latitude, latitude, longitude, longitude) as SwissLocation | undefined;
  return row ?? null;
}

async function locationFor(latitude: number, longitude: number) {
  return await reverseGeocodeSwiss(latitude, longitude) ?? nearestKnownLocation(latitude, longitude) ?? { name: "Schweiz", postcode: null, canton: null };
}

export async function resolveBenchLocation(latitude: number, longitude: number): Promise<SwissLocation | null> {
  const point = z.object({ latitude: z.number().min(45.7).max(47.9), longitude: z.number().min(5.7).max(10.7) }).safeParse({ latitude, longitude });
  return point.success ? locationFor(point.data.latitude, point.data.longitude) : null;
}

export async function addBench(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Bitte Standort prüfen." };
  try {
    const user = await writeActor("add-bench", 10, 25);
    const location = await locationFor(parsed.data.latitude, parsed.data.longitude);
    const now = new Date().toISOString();
    const id = `community-${randomUUID()}`;
    const transaction = sqlite.transaction(() => {
      const result = sqlite.prepare(`INSERT INTO benches(
        id,osm_type,osm_id,latitude,longitude,description,raw_tags,active,source_updated_at,imported_at,
        name,dedication,location_name,location_key,location_postcode,location_canton,created_by_user_id,verification_status
      ) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,'unverified')`).run(
        id, "community", -randomInt(1, 2_000_000_000), parsed.data.latitude, parsed.data.longitude,
        parsed.data.name || "Sitzbank", "{}", now, now, parsed.data.name || null, parsed.data.dedication || null,
        location.name, normalizeLocationKey(location.name), location.postcode, location.canton, user.id,
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
    const user = await writeActor("confirm-bench", 100, 300);
    const rowId = rowFor(benchId);
    const now = new Date().toISOString();
    const result = recordBenchConfirmation(sqlite, rowId, user.id, threshold, now);
    if (result.added) refreshUserBadges(user.id);
    if (result.verified && result.creatorUserId) refreshUserBadges(result.creatorUserId);
    refresh(benchId);
    if (result.alreadyVerified) return { ok: false, message: "Dieses Bänkli ist bereits bestätigt." };
    if (!result.added) return { ok: false, message: "Du hast dieses Bänkli schon bestätigt." };
    return { ok: true, message: result.verified ? "Dieses Bänkli ist jetzt bestätigt!" : `Noch ${threshold - result.count} Bestätigung${threshold - result.count === 1 ? "" : "en"}.` };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Bestätigung fehlgeschlagen." }; }
}

export async function requestBenchRemoval(benchId: string): Promise<ActionResult> {
  try {
    const user = await writeActor("remove-bench", 30, 100); const rowId = rowFor(benchId); const now = new Date().toISOString();
    const result = recordRemovalConfirmation(sqlite, rowId, user.id, threshold, now);
    if (result.added) refreshUserBadges(user.id);
    refresh(benchId);
    if (!result.added) return { ok: false, message: "Du hast das Fehlen schon bestätigt." };
    return { ok: true, message: result.removed ? "Als nicht mehr vorhanden bestätigt." : `Hinweis gespeichert – noch ${threshold - result.count} Stimme${threshold - result.count === 1 ? "" : "n"}.` };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Hinweis fehlgeschlagen." }; }
}

export async function editBenchMetadata(benchId: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Bitte Angaben prüfen." };
  try {
    const user = await writeActor("edit-bench", 30, 100); const rowId = rowFor(benchId); const now = new Date().toISOString();
    const old = sqlite.prepare("SELECT name,dedication,location_name FROM benches WHERE row_id=?").get(rowId) as Record<string, string | null>;
    const next = { name: parsed.data.name || null, dedication: parsed.data.dedication || null, location: parsed.data.locationName };
    const transaction = sqlite.transaction(() => {
      sqlite.prepare("UPDATE benches SET name=?,dedication=?,location_name=?,location_key=?,location_postcode=?,location_canton=?,description=coalesce(?,description) WHERE row_id=?")
        .run(next.name, next.dedication, next.location, normalizeLocationKey(next.location), parsed.data.postcode || null, parsed.data.canton || null, next.name, rowId);
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
