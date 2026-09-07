"use server";

import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { assertContributorAllowed, consumeRateLimit, contributorHashForUser, getContributorIdentity, requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const momentSchema = z.object({
  kind: z.enum(["memory", "recommendation", "poem", "local_fact", "photo"]),
  body: z.string().trim().min(2).max(500),
  photoUrl: z.union([z.literal(""), z.string().url().startsWith("https://").max(500)]).optional(),
  website: z.string().max(0).optional(),
});
const careSchema = z.enum(["cleaned", "good", "repair", "beautiful"]);

function benchRow(benchId: string) {
  return sqlite.prepare("SELECT row_id,location_key,location_name FROM benches WHERE id=? AND active=1").get(benchId) as { row_id: number; location_key: string | null; location_name: string | null } | undefined;
}

async function actor(key: string, limit: number) {
  const user = await requireUser();
  const identity = await getContributorIdentity();
  const hash = contributorHashForUser(user.id);
  assertContributorAllowed(hash);
  consumeRateLimit(hash, `${key}-day`, limit, 86_400);
  consumeRateLimit(identity.ipHash, `${key}-ip-day`, limit * 3, 86_400);
  return user;
}

function refresh(benchId: string) {
  revalidatePath("/");
  revalidatePath("/feed");
  revalidatePath(`/bank/${benchId}`);
}

export async function submitBenchMoment(benchId: string, _previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = momentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Bitte erzähle in ein paar Worten von diesem Platz." };
  try {
    const user = await actor("bench-moment", 12);
    const bench = benchRow(benchId);
    if (!bench) return { ok: false, message: "Dieses Bänkli wurde nicht gefunden." };
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,photo_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(bench.row_id, user.id, parsed.data.kind, parsed.data.body, parsed.data.photoUrl || null, now, now);
    refresh(benchId);
    return { ok: true, message: "Dein Bänkli-Moment ist jetzt am Platz zu lesen." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Moment konnte nicht gespeichert werden." };
  }
}

export async function deleteOwnBenchMoment(benchId: string, momentId: number): Promise<ActionResult> {
  if (!Number.isInteger(momentId) || momentId < 1) return { ok: false, message: "Ungültiger Moment." };
  try {
    const user = await requireUser();
    const result = sqlite.prepare("DELETE FROM bench_moments WHERE id=? AND user_id=?").run(momentId, user.id);
    if (!result.changes) return { ok: false, message: "Dieser Moment gehört nicht zu deinem Konto." };
    refresh(benchId);
    return { ok: true, message: "Dein Moment wurde entfernt." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Moment konnte nicht entfernt werden." };
  }
}

export async function submitBenchCare(benchId: string, kindInput: unknown): Promise<ActionResult> {
  const kind = careSchema.safeParse(kindInput);
  if (!kind.success) return { ok: false, message: "Unbekannte Pflegeaktion." };
  try {
    const user = await actor("bench-care", 20);
    const bench = benchRow(benchId);
    if (!bench) return { ok: false, message: "Dieses Bänkli wurde nicht gefunden." };
    const result = sqlite.prepare("INSERT OR IGNORE INTO bench_care_actions(bench_row_id,user_id,kind,created_at) VALUES(?,?,?,?)")
      .run(bench.row_id, user.id, kind.data, new Date().toISOString());
    refresh(benchId);
    return { ok: true, message: result.changes ? "Danke fürs Kümmern." : "Das hast du heute schon festgehalten." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Pflegeaktion konnte nicht gespeichert werden." };
  }
}

export async function toggleBenchFollow(benchId: string, scope: "bench" | "place"): Promise<ActionResult & { following?: boolean }> {
  try {
    const user = await requireUser();
    const bench = benchRow(benchId);
    if (!bench) return { ok: false, message: "Dieses Bänkli wurde nicht gefunden." };
    const now = new Date().toISOString();
    if (scope === "bench") {
      const current = sqlite.prepare("SELECT 1 FROM bench_follows WHERE bench_row_id=? AND user_id=?").get(bench.row_id, user.id);
      if (current) sqlite.prepare("DELETE FROM bench_follows WHERE bench_row_id=? AND user_id=?").run(bench.row_id, user.id);
      else sqlite.prepare("INSERT INTO bench_follows(bench_row_id,user_id,created_at) VALUES(?,?,?)").run(bench.row_id, user.id, now);
      refresh(benchId);
      return { ok: true, following: !current, message: current ? "Aus deinen Lieblingsplätzen entfernt." : "Dieses Bänkli gehört jetzt zu deinen Lieblingsplätzen." };
    }
    if (!bench.location_key || !bench.location_name) return { ok: false, message: "Für diesen Platz fehlt noch ein Ortsname." };
    const current = sqlite.prepare("SELECT 1 FROM place_follows WHERE location_key=? AND user_id=?").get(bench.location_key, user.id);
    if (current) sqlite.prepare("DELETE FROM place_follows WHERE location_key=? AND user_id=?").run(bench.location_key, user.id);
    else sqlite.prepare("INSERT INTO place_follows(location_key,user_id,label,created_at) VALUES(?,?,?,?)").run(bench.location_key, user.id, bench.location_name, now);
    revalidatePath("/feed");
    refresh(benchId);
    return { ok: true, following: !current, message: current ? `${bench.location_name} wird nicht mehr gefolgt.` : `Neue Bänkli-Momente aus ${bench.location_name} erscheinen jetzt bei dir.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Auswahl konnte nicht gespeichert werden." };
  }
}
