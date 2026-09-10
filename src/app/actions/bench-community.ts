"use server";

import { actionError } from "@/i18n/action-error";

import { getTranslations } from "next-intl/server";

import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { deleteBenchPhoto } from "@/features/bench-photos/storage";
import { assertContributorAllowed, consumeRateLimit, contributorHashForUser, getContributorIdentity, requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const momentSchema = z.object({
  kind: z.enum(["memory", "recommendation", "poem", "local_fact"]),
  body: z.string().trim().min(2).max(500),
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
  const t = await getTranslations();
  const parsed = momentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: t("community.result.momentInvalid") };
  try {
    const user = await actor("bench-moment", 12);
    const bench = benchRow(benchId);
    if (!bench) return { ok: false, message: t("common.errors.benchNotFound") };
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO bench_moments(bench_row_id,user_id,kind,body,photo_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(bench.row_id, user.id, parsed.data.kind, parsed.data.body, null, now, now);
    refresh(benchId);
    return { ok: true, message: t("community.result.momentSaved") };
  } catch (error) {
    return { ok: false, message: actionError(t, error, "community.result.momentFailed") };
  }
}

export async function deleteOwnBenchMoment(benchId: string, momentId: number): Promise<ActionResult> {
  const t = await getTranslations();
  if (!Number.isInteger(momentId) || momentId < 1) return { ok: false, message: t("community.result.invalidMoment") };
  try {
    const user = await requireUser();
    const moment = sqlite.prepare("SELECT photo_url FROM bench_moments WHERE id=? AND user_id=?").get(momentId, user.id) as { photo_url: string | null } | undefined;
    if (!moment) return { ok: false, message: t("community.result.notYourMoment") };
    const result = sqlite.prepare("DELETE FROM bench_moments WHERE id=? AND user_id=?").run(momentId, user.id);
    if (!result.changes) return { ok: false, message: t("community.result.notYourMoment") };
    // The database row is the publication boundary. Remove it first so a
    // temporarily unavailable object store cannot keep an unwanted photo live.
    if (moment.photo_url) await deleteBenchPhoto(moment.photo_url).catch(() => undefined);
    refresh(benchId);
    return { ok: true, message: t("community.result.momentDeleted") };
  } catch (error) {
    return { ok: false, message: actionError(t, error, "community.result.momentDeleteFailed") };
  }
}

export async function submitBenchCare(benchId: string, kindInput: unknown): Promise<ActionResult> {
  const t = await getTranslations();
  const kind = careSchema.safeParse(kindInput);
  if (!kind.success) return { ok: false, message: t("community.result.careInvalid") };
  try {
    const user = await actor("bench-care", 20);
    const bench = benchRow(benchId);
    if (!bench) return { ok: false, message: t("common.errors.benchNotFound") };
    const result = sqlite.prepare("INSERT OR IGNORE INTO bench_care_actions(bench_row_id,user_id,kind,created_at) VALUES(?,?,?,?)")
      .run(bench.row_id, user.id, kind.data, new Date().toISOString());
    refresh(benchId);
    return { ok: true, message: result.changes ? t("community.result.careSaved") : t("community.result.careAlreadySaved") };
  } catch (error) {
    return { ok: false, message: actionError(t, error, "community.result.careFailed") };
  }
}

export async function toggleBenchFollow(benchId: string, scope: "bench" | "place"): Promise<ActionResult & { following?: boolean }> {
  const t = await getTranslations();
  try {
    const user = await requireUser();
    const bench = benchRow(benchId);
    if (!bench) return { ok: false, message: t("common.errors.benchNotFound") };
    const now = new Date().toISOString();
    if (scope === "bench") {
      const current = sqlite.prepare("SELECT 1 FROM bench_follows WHERE bench_row_id=? AND user_id=?").get(bench.row_id, user.id);
      if (current) sqlite.prepare("DELETE FROM bench_follows WHERE bench_row_id=? AND user_id=?").run(bench.row_id, user.id);
      else sqlite.prepare("INSERT INTO bench_follows(bench_row_id,user_id,created_at) VALUES(?,?,?)").run(bench.row_id, user.id, now);
      refresh(benchId);
      return { ok: true, following: !current, message: current ? t("community.result.unfavourited") : t("community.result.favourited") };
    }
    if (!bench.location_key || !bench.location_name) return { ok: false, message: t("community.result.placeUnnamed") };
    const current = sqlite.prepare("SELECT 1 FROM place_follows WHERE location_key=? AND user_id=?").get(bench.location_key, user.id);
    if (current) sqlite.prepare("DELETE FROM place_follows WHERE location_key=? AND user_id=?").run(bench.location_key, user.id);
    else sqlite.prepare("INSERT INTO place_follows(location_key,user_id,label,created_at) VALUES(?,?,?,?)").run(bench.location_key, user.id, bench.location_name, now);
    revalidatePath("/feed");
    refresh(benchId);
    return { ok: true, following: !current, message: current ? t("community.result.placeUnfollowed", { place: bench.location_name }) : t("community.result.placeFollowed", { place: bench.location_name }) };
  } catch (error) {
    return { ok: false, message: actionError(t, error, "community.result.followFailed") };
  }
}
