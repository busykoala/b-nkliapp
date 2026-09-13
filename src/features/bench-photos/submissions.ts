import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { sqlite } from "@/db/client";
import { UserFacingError } from "@/i18n/action-error";
import type { MessageKey } from "@/i18n/types";
import { ensurePeopleFreePhoto } from "./moderation";
import { deleteBenchPhoto, readBenchPhoto } from "./storage";

type Submission = {
  id: string;
  bench_row_id: number;
  caption: string;
  photo_url: string;
  user_id: number;
};

export type SubmissionStatus = {
  status: "pending" | "processing" | "accepted" | "rejected";
  lease_until: string | null;
  error_key: string | null;
};

const knownFailureKeys = new Set<MessageKey>([
  "photos.server.people",
  "photos.server.uncertain",
  "photos.server.checkBusy",
  "photos.server.checkUnavailable",
  "photos.server.format",
  "photos.server.formatMismatch",
  "photos.server.notFound",
  "photos.server.storageUnavailable",
  "photos.server.saveFailed",
]);

export function submissionFailureKey(value: string | null): MessageKey {
  return knownFailureKeys.has(value as MessageKey) ? value as MessageKey : "photos.server.saveFailed";
}

export function findOwnedSubmission(id: string, userId: number) {
  return sqlite.prepare(`SELECT status,lease_until,error_key FROM bench_photo_submissions
    WHERE id=? AND user_id=?`).get(id, userId) as SubmissionStatus | undefined;
}

export function needsSubmissionWork(submission: SubmissionStatus, now = new Date()) {
  return submission.status === "pending"
    || (submission.status === "processing" && (!submission.lease_until || submission.lease_until <= now.toISOString()));
}

export async function processBenchPhotoSubmission(id: string) {
  const startedAt = new Date();
  const leaseToken = randomUUID();
  const leaseUntil = new Date(startedAt.getTime() + 5 * 60_000).toISOString();
  const submission = sqlite.prepare(`UPDATE bench_photo_submissions
    SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
    WHERE id=? AND (status='pending' OR (status='processing' AND (lease_until IS NULL OR lease_until<=?)))
    RETURNING id,bench_row_id,caption,photo_url,user_id`).get(
      leaseToken, leaseUntil, startedAt.toISOString(), id, startedAt.toISOString(),
    ) as Submission | undefined;
  if (!submission) return;

  try {
    const photo = await readBenchPhoto(submission.photo_url);
    if (!photo) throw new UserFacingError("photos.server.notFound");
    await ensurePeopleFreePhoto(photo.bytes, photo.contentType);
    const completedAt = new Date().toISOString();
    const accept = sqlite.transaction(() => {
      const current = sqlite.prepare(`SELECT 1 present FROM bench_photo_submissions
        WHERE id=? AND status='processing' AND lease_token=?`).get(id, leaseToken);
      if (!current) return false;
      const moment = sqlite.prepare(`INSERT INTO bench_moments
        (bench_row_id,user_id,kind,body,photo_url,created_at,updated_at,visible)
        VALUES (?,?,'photo',?,?,?,?,1)`).run(
          submission.bench_row_id, submission.user_id, submission.caption,
          submission.photo_url, completedAt, completedAt,
        );
      const updated = sqlite.prepare(`UPDATE bench_photo_submissions
        SET status='accepted',moment_id=?,lease_token=NULL,lease_until=NULL,error_key=NULL,updated_at=?
        WHERE id=? AND status='processing' AND lease_token=?`).run(
          moment.lastInsertRowid, completedAt, id, leaseToken,
        );
      if (updated.changes !== 1) throw new Error("Photo submission lease was lost");
      return true;
    })();
    if (accept) {
      const bench = sqlite.prepare("SELECT id FROM benches WHERE row_id=?").get(submission.bench_row_id) as { id: string } | undefined;
      if (bench) revalidatePath(`/bank/${bench.id}`);
      revalidatePath("/feed");
    }
  } catch (error) {
    const errorKey: MessageKey = error instanceof UserFacingError ? error.key : "photos.server.saveFailed";
    if (!(error instanceof UserFacingError)) console.error("Bench photo moderation failed", error);
    const rejectedAt = new Date().toISOString();
    const rejected = sqlite.prepare(`UPDATE bench_photo_submissions
      SET status='rejected',error_key=?,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND status='processing' AND lease_token=?`).run(errorKey, rejectedAt, id, leaseToken);
    if (rejected.changes === 1) await deleteBenchPhoto(submission.photo_url).catch((cleanupError) => {
      console.error("Failed to remove rejected bench photo", cleanupError);
    });
  }
}
