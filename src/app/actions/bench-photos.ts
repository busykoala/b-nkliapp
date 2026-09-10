"use server";

import { actionError } from "@/i18n/action-error";

import { getTranslations } from "next-intl/server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { ensurePeopleFreePhoto } from "@/features/bench-photos/moderation";
import { validateBenchPhoto } from "@/features/bench-photos/photo-file";
import { deleteBenchPhoto, readBenchPhoto, storeBenchPhoto } from "@/features/bench-photos/storage";
import { assertContributorAllowed, consumeRateLimit, contributorHashForUser, getContributorIdentity, requireUser } from "@/lib/security";
import type { ActionResult } from "@/lib/types";
import { z } from "zod";

const inputSchema = z.object({ caption: z.string().trim().max(180), website: z.string().max(0).optional() });
const benchIdSchema = z.string().regex(/^(osm-(node|way)-\d+|community-[0-9a-f-]{36}|inventory-[0-9a-f]{24})$/);
const allowedTypes = new Set(["image/webp", "image/jpeg", "image/png"]);

export type BenchPhotoResult = { ok: true; dataUrl: string } | { ok: false; message: string };

export async function loadBenchPhoto(momentId: number): Promise<BenchPhotoResult> {
  const t = await getTranslations();
  const parsed = z.number().int().positive().safeParse(momentId);
  if (!parsed.success) return { ok: false, message: t("photos.server.notFound") };
  const moment = sqlite.prepare(`
    SELECT photo_url FROM bench_moments
    WHERE id=? AND visible=1 AND kind='photo'
  `).get(parsed.data) as { photo_url: string | null } | undefined;
  if (!moment?.photo_url?.startsWith("garage:")) return { ok: false, message: t("photos.server.notFound") };
  try {
    const photo = await readBenchPhoto(moment.photo_url);
    if (!photo || !allowedTypes.has(photo.contentType)) return { ok: false, message: t("photos.server.notFound") };
    return { ok: true, dataUrl: `data:${photo.contentType};base64,${Buffer.from(photo.bytes).toString("base64")}` };
  } catch {
    return { ok: false, message: t("photos.server.unavailable") };
  }
}

export async function uploadBenchPhoto(benchId: string, formData: FormData): Promise<ActionResult> {
  const t = await getTranslations();
  try {
    const id = benchIdSchema.parse(benchId);
    const parsed = inputSchema.parse({ caption: formData.get("caption") ?? "", website: formData.get("website") ?? "" });
    const photo = formData.get("photo");
    if (!(photo instanceof File) || !allowedTypes.has(photo.type) || photo.size < 8_000 || photo.size > 1_800_000) {
      return { ok: false, message: t("photos.server.choose") };
    }
    const user = await requireUser();
    const identity = await getContributorIdentity();
    const contributor = contributorHashForUser(user.id);
    assertContributorAllowed(contributor);
    consumeRateLimit(contributor, "bench-photo-day", 8, 86_400);
    consumeRateLimit(identity.ipHash, "bench-photo-ip-day", 20, 86_400);
    const bench = sqlite.prepare("SELECT row_id FROM benches WHERE id=? AND active=1").get(id) as { row_id: number } | undefined;
    if (!bench) return { ok: false, message: t("common.errors.benchNotFound") };
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const format = validateBenchPhoto(bytes, photo.type);
    await ensurePeopleFreePhoto(bytes, format.type);
    const now = new Date().toISOString();
    const objectKey = `benches/${id}/${randomUUID()}.${format.extension}`;
    const url = await storeBenchPhoto(objectKey, bytes, format.type);
    try {
      sqlite.prepare(`INSERT INTO bench_moments (bench_row_id,user_id,kind,body,photo_url,created_at,updated_at,visible)
        VALUES (?,?,'photo',?,?,?,?,1)`).run(bench.row_id, user.id, parsed.caption, url, now, now);
    } catch (error) {
      await deleteBenchPhoto(url).catch(() => undefined);
      throw error;
    }
    revalidatePath(`/bank/${id}`); revalidatePath("/feed");
    return { ok: true, message: t("photos.server.saved") };
  } catch (error) {
    return { ok: false, message: actionError(t, error, "photos.server.saveFailed") };
  }
}
