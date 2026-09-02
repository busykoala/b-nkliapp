"use server";

import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { refreshUserBadges } from "@/lib/badges";
import { assertContributorAllowed, consumeRateLimit, contributorHashForUser, getContributorIdentity, requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const ratingSchema = z.object({
  overall: z.coerce.number().int().min(1).max(5),
  view: z.coerce.number().int().min(1).max(5),
  comfort: z.coerce.number().int().min(1).max(5),
  quiet: z.coerce.number().int().min(1).max(5),
  note: z.string().trim().max(280).optional(),
  website: z.string().max(0).optional(),
});

const correctionSchema = z.object({
  field: z.enum(["properties", "condition", "location", "removed"]),
  note: z.string().trim().max(160).optional(),
  website: z.string().max(0).optional(),
});

const correctionValues = {
  properties: "Ausstattung stimmt nicht",
  condition: "Beschädigt oder schlecht nutzbar",
  location: "Position ist ungenau",
  removed: "Bank fehlt oder wurde entfernt",
} as const;

function benchRowId(benchId: string) {
  const row = sqlite.prepare("SELECT row_id FROM benches WHERE id=? AND active=1").get(benchId) as { row_id: number } | undefined;
  if (!row) throw new Error("Bank wurde nicht gefunden.");
  return row.row_id;
}

function validationFailure(error: z.ZodError): ActionResult {
  return { ok: false, message: "Bitte prüfe deine Angaben.", errors: error.flatten().fieldErrors as Record<string, string[]> };
}

export async function submitRating(benchId: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = ratingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const user = await requireUser();
    const identity = await getContributorIdentity();
    const contributorHash = contributorHashForUser(user.id);
    assertContributorAllowed(contributorHash);
    consumeRateLimit(contributorHash, "rating-minute", 5, 60);
    consumeRateLimit(identity.ipHash, "rating-hour", 30, 3600);
    const rowId = benchRowId(benchId);
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO ratings (bench_row_id, contributor_hash, overall, view_score, comfort, quiet, note, visible, created_at, updated_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(bench_row_id, contributor_hash) DO UPDATE SET overall=excluded.overall, view_score=excluded.view_score,
        comfort=excluded.comfort, quiet=excluded.quiet, note=excluded.note, visible=1, updated_at=excluded.updated_at,user_id=excluded.user_id
    `).run(rowId, contributorHash, parsed.data.overall, parsed.data.view, parsed.data.comfort, parsed.data.quiet, parsed.data.note || null, now, now, user.id);
    refreshUserBadges(user.id);
    revalidatePath("/");
    revalidatePath(`/bank/${benchId}`);
    return { ok: true, message: "Danke – deine Bewertung ist sichtbar." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Bewertung konnte nicht gespeichert werden." };
  }
}

export async function submitCorrection(benchId: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const user = await requireUser();
    const identity = await getContributorIdentity();
    const contributorHash = contributorHashForUser(user.id);
    assertContributorAllowed(contributorHash);
    consumeRateLimit(contributorHash, "correction-day", 3, 86400);
    consumeRateLimit(identity.ipHash, "correction-ip-day", 8, 86400);
    const rowId = benchRowId(benchId);
    sqlite.prepare("DELETE FROM corrections WHERE bench_row_id=? AND contributor_hash=? AND field=?")
      .run(rowId, contributorHash, parsed.data.field);
    sqlite.prepare(`INSERT INTO corrections (bench_row_id, contributor_hash, field, proposed_value, note, visible, created_at, user_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(rowId, contributorHash, parsed.data.field, correctionValues[parsed.data.field], parsed.data.note || null, new Date().toISOString(), user.id);
    refreshUserBadges(user.id);
    revalidatePath("/");
    revalidatePath(`/bank/${benchId}`);
    return { ok: true, message: "Danke – dein Hinweis wurde veröffentlicht." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Hinweis konnte nicht gespeichert werden." };
  }
}

export async function reportContribution(targetType: "rating" | "correction", targetId: number): Promise<ActionResult> {
  if (!Number.isInteger(targetId) || targetId < 1) return { ok: false, message: "Ungültiger Beitrag." };
  try {
    const user = await requireUser();
    const identity = await getContributorIdentity();
    const contributorHash = contributorHashForUser(user.id);
    consumeRateLimit(contributorHash, "report-day", 20, 86400);
    consumeRateLimit(identity.ipHash, "report-ip-day", 60, 86400);
    sqlite.prepare("INSERT OR IGNORE INTO reports (target_type, target_id, contributor_hash, reason, created_at, user_id) VALUES (?, ?, ?, 'Unangemessener Inhalt', ?, ?)")
      .run(targetType, targetId, contributorHash, new Date().toISOString(), user.id);
    return { ok: true, message: "Beitrag wurde gemeldet." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Meldung fehlgeschlagen." };
  }
}
