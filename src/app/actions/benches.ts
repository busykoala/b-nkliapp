"use server";

import { randomInt, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { refreshUserBadges } from "@/lib/badges";
import { recordBenchConfirmation, recordRemovalConfirmation, resolveVerificationThreshold } from "@/lib/bench-verification";
import { normalizeLocationKey, reverseGeocodeSwiss, type SwissLocation } from "@/integrations/geoadmin/client";
import { assertContributorAllowed, consumeRateLimit, contributorHashForUser, getContributorIdentity, requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const threshold = resolveVerificationThreshold();
const addSchema = z.object({
  latitude: z.coerce.number().min(45.7).max(47.9),
  longitude: z.coerce.number().min(5.7).max(10.7),
  name: z.string().trim().max(80).optional(),
  dedication: z.string().trim().max(180).optional(),
  backrest: z.enum(["", "yes", "no"]).optional(),
  armrest: z.enum(["", "yes", "no"]).optional(),
  covered: z.enum(["", "yes", "no"]).optional(),
  wheelchair: z.enum(["", "yes", "no"]).optional(),
  fireplaceNearby: z.enum(["", "yes", "no"]).optional(),
  wasteBasketNearby: z.enum(["", "yes", "no"]).optional(),
  material: z.enum(["", "wood", "metal", "stone", "concrete", "plastic", "mixed"]).optional(),
  seats: z.union([z.literal(""), z.coerce.number().int().min(1).max(20)]).optional(),
  direction: z.union([z.literal(""), z.coerce.number().int().min(0).max(359).refine((value) => value % 45 === 0)]).optional(),
});
const editSchema = z.object({
  name: z.string().trim().max(80).optional(),
  dedication: z.string().trim().max(180).optional(),
});
const editableFieldSchema = z.enum(["backrest", "armrest", "covered", "wheelchair", "fireplaceNearby", "wasteBasketNearby", "material", "seats", "direction"]);
const booleanValueSchema = z.enum(["yes", "no"]);
const materialValueSchema = z.enum(["wood", "metal", "stone", "concrete", "plastic", "mixed"]);

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
    const bool = (value: "" | "yes" | "no" | undefined) => value ? value === "yes" ? 1 : 0 : null;
    const transaction = sqlite.transaction(() => {
      const result = sqlite.prepare(`INSERT INTO benches(
        id,osm_type,osm_id,latitude,longitude,backrest,armrest,covered,wheelchair,fireplace_nearby,waste_basket_nearby,seats,material,direction_degrees,
        description,raw_tags,active,source_updated_at,imported_at,
        name,dedication,location_name,location_key,location_postcode,location_canton,created_by_user_id,verification_status
      ) VALUES(@id,'community',@osmId,@latitude,@longitude,@backrest,@armrest,@covered,@wheelchair,@fireplaceNearby,@wasteBasketNearby,@seats,@material,@direction,
        @description,'{}',1,@now,@now,@name,@dedication,@locationName,@locationKey,@postcode,@canton,@userId,'unverified')`).run({
        id, osmId: -randomInt(1, 2_000_000_000), latitude: parsed.data.latitude, longitude: parsed.data.longitude,
        backrest: bool(parsed.data.backrest), armrest: bool(parsed.data.armrest), covered: bool(parsed.data.covered),
        wheelchair: bool(parsed.data.wheelchair), seats: parsed.data.seats === "" ? null : parsed.data.seats ?? null,
        fireplaceNearby: bool(parsed.data.fireplaceNearby), wasteBasketNearby: bool(parsed.data.wasteBasketNearby),
        material: parsed.data.material || null, direction: parsed.data.direction === "" ? null : parsed.data.direction ?? null,
        description: parsed.data.name || "Sitzbank", now, name: parsed.data.name || null, dedication: parsed.data.dedication || null,
        locationName: location.name, locationKey: normalizeLocationKey(location.name), postcode: location.postcode,
        canton: location.canton, userId: user.id,
      });
      const rowId = Number(result.lastInsertRowid);
      sqlite.prepare("INSERT INTO bench_confirmations(bench_row_id,user_id,created_at) VALUES(?,?,?)")
        .run(rowId, user.id, now);
      const edits = [
        ["name", parsed.data.name], ["dedication", parsed.data.dedication], ["backrest", parsed.data.backrest],
        ["armrest", parsed.data.armrest], ["covered", parsed.data.covered], ["wheelchair", parsed.data.wheelchair],
        ["fireplaceNearby", parsed.data.fireplaceNearby], ["wasteBasketNearby", parsed.data.wasteBasketNearby],
        ["material", parsed.data.material], ["seats", parsed.data.seats], ["direction", parsed.data.direction],
      ].filter((entry) => entry[1] !== undefined && entry[1] !== "");
      const insertEdit = sqlite.prepare("INSERT INTO bench_metadata_edits(bench_row_id,user_id,field,old_value,new_value,created_at) VALUES(?,?,?,?,?,?)");
      for (const [field, value] of edits) insertEdit.run(rowId, user.id, field, null, String(value), now);
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
    const old = sqlite.prepare("SELECT name,dedication FROM benches WHERE row_id=?").get(rowId) as Record<string, string | null>;
    const next = { name: parsed.data.name || null, dedication: parsed.data.dedication || null };
    const transaction = sqlite.transaction(() => {
      sqlite.prepare("UPDATE benches SET name=?,dedication=? WHERE row_id=?")
        .run(next.name, next.dedication, rowId);
      const insert = sqlite.prepare("INSERT INTO bench_metadata_edits(bench_row_id,user_id,field,old_value,new_value,created_at) VALUES(?,?,?,?,?,?)");
      for (const field of ["name", "dedication"] as const) {
        if (old[field] !== next[field]) insert.run(rowId, user.id, field, old[field], next[field], now);
      }
    });
    transaction(); refreshUserBadges(user.id); refresh(benchId);
    return { ok: true, message: "Angaben aktualisiert." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Änderung fehlgeschlagen." }; }
}

export async function editBenchField(benchId: string, fieldInput: unknown, valueInput: unknown): Promise<ActionResult> {
  const field = editableFieldSchema.safeParse(fieldInput);
  if (!field.success || typeof valueInput !== "string") return { ok: false, message: "Bitte Angabe prüfen." };

  let value: string | number;
  let column: "backrest" | "armrest" | "covered" | "wheelchair" | "fireplace_nearby" | "waste_basket_nearby" | "material" | "seats" | "direction_degrees";
  if (["backrest", "armrest", "covered", "wheelchair", "fireplaceNearby", "wasteBasketNearby"].includes(field.data)) {
    const parsed = booleanValueSchema.safeParse(valueInput);
    if (!parsed.success) return { ok: false, message: "Bitte Ja oder Nein wählen." };
    value = parsed.data === "yes" ? 1 : 0;
    column = field.data === "fireplaceNearby" ? "fireplace_nearby" : field.data === "wasteBasketNearby" ? "waste_basket_nearby" : field.data as typeof column;
  } else if (field.data === "material") {
    const parsed = materialValueSchema.safeParse(valueInput);
    if (!parsed.success) return { ok: false, message: "Bitte Material wählen." };
    value = parsed.data;
    column = "material";
  } else if (field.data === "seats") {
    const parsed = z.coerce.number().int().min(1).max(20).safeParse(valueInput);
    if (!parsed.success) return { ok: false, message: "Bitte Sitzplätze zwischen 1 und 20 wählen." };
    value = parsed.data;
    column = "seats";
  } else {
    const parsed = z.coerce.number().int().min(0).max(359).refine((degrees) => degrees % 45 === 0).safeParse(valueInput);
    if (!parsed.success) return { ok: false, message: "Bitte Blickrichtung wählen." };
    value = parsed.data;
    column = "direction_degrees";
  }

  try {
    const user = await writeActor("edit-bench-field", 60, 180);
    const rowId = rowFor(benchId);
    const previous = sqlite.prepare(`SELECT ${column} AS value FROM benches WHERE row_id=?`).get(rowId) as { value: string | number | null };
    if (String(previous.value ?? "") === String(value)) return { ok: true, message: "Ist bereits so eingetragen." };
    const now = new Date().toISOString();
    const transaction = sqlite.transaction(() => {
      sqlite.prepare(`UPDATE benches SET ${column}=? WHERE row_id=?`).run(value, rowId);
      sqlite.prepare("INSERT INTO bench_metadata_edits(bench_row_id,user_id,field,old_value,new_value,created_at) VALUES(?,?,?,?,?,?)")
        .run(rowId, user.id, field.data, previous.value === null ? null : String(previous.value), String(value), now);
    });
    transaction();
    refreshUserBadges(user.id);
    refresh(benchId);
    return { ok: true, message: "Danke – ist eingetragen." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Angabe konnte nicht gespeichert werden." };
  }
}
