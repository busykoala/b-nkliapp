import { UserFacingError } from "@/i18n/action-error";
import type Database from "better-sqlite3";

export function resolveVerificationThreshold(value = process.env.BENCH_VERIFICATION_THRESHOLD) {
  return Math.max(2, Math.min(10, Number(value ?? 3) || 3));
}

export function recordBenchConfirmation(database: Database.Database, benchRowId: number, userId: number, threshold: number, now: string) {
  return database.transaction(() => {
    const bench = database.prepare("SELECT active,verification_status,created_by_user_id FROM benches WHERE row_id=?").get(benchRowId) as { active: number; verification_status: string; created_by_user_id: number | null } | undefined;
    if (!bench || !bench.active) throw new UserFacingError("common.errors.benchNotFound");
    if (bench.verification_status === "verified") {
      const count = (database.prepare("SELECT count(*) count FROM bench_confirmations WHERE bench_row_id=?").get(benchRowId) as { count: number }).count;
      return { added: false, count, verified: true, alreadyVerified: true, creatorUserId: bench.created_by_user_id };
    }
    const added = database.prepare("INSERT OR IGNORE INTO bench_confirmations(bench_row_id,user_id,created_at) VALUES(?,?,?)")
      .run(benchRowId, userId, now).changes === 1;
    const count = (database.prepare("SELECT count(*) count FROM bench_confirmations WHERE bench_row_id=?").get(benchRowId) as { count: number }).count;
    const verified = count >= threshold;
    if (verified) database.prepare("UPDATE benches SET verification_status='verified',verified_at=? WHERE row_id=?").run(now, benchRowId);
    return { added, count, verified, alreadyVerified: false, creatorUserId: bench.created_by_user_id };
  })();
}

/** Renew a person's observation without giving them another verification vote. */
export function recordBenchPresence(database: Database.Database, benchRowId: number, userId: number, threshold: number, now: string) {
  return database.transaction(() => {
    const previous = database.prepare("SELECT coalesce(last_seen_at,created_at) observed_at FROM bench_confirmations WHERE bench_row_id=? AND user_id=?")
      .get(benchRowId, userId) as { observed_at: string } | undefined;
    const result = recordBenchConfirmation(database, benchRowId, userId, threshold, now);
    if (previous?.observed_at.slice(0, 10) === now.slice(0, 10)) return { ...result, refreshed: false, observedAt: previous.observed_at };
    database.prepare(`INSERT INTO bench_confirmations(bench_row_id,user_id,created_at,last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(bench_row_id,user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at`).run(benchRowId, userId, now, now);
    return { ...result, count: result.count + (result.alreadyVerified && !previous ? 1 : 0), added: !previous, refreshed: true, observedAt: now };
  })();
}

export function recordRemovalConfirmation(database: Database.Database, benchRowId: number, userId: number, threshold: number, now: string) {
  return database.transaction(() => {
    const bench = database.prepare("SELECT active FROM benches WHERE row_id=?").get(benchRowId) as { active: number } | undefined;
    if (!bench || !bench.active) throw new UserFacingError("common.errors.benchNotFound");
    let request = database.prepare("SELECT id FROM bench_removal_requests WHERE bench_row_id=? AND status='pending'").get(benchRowId) as { id: number } | undefined;
    if (!request) {
      const inserted = database.prepare("INSERT INTO bench_removal_requests(bench_row_id,created_by_user_id,created_at) VALUES(?,?,?)").run(benchRowId, userId, now);
      request = { id: Number(inserted.lastInsertRowid) };
    }
    const added = database.prepare("INSERT OR IGNORE INTO bench_removal_confirmations(request_id,user_id,created_at) VALUES(?,?,?)")
      .run(request.id, userId, now).changes === 1;
    const count = (database.prepare("SELECT count(*) count FROM bench_removal_confirmations WHERE request_id=?").get(request.id) as { count: number }).count;
    const removed = count >= threshold;
    if (removed) {
      database.prepare("UPDATE benches SET active=0,verification_status='removed',removed_at=? WHERE row_id=?").run(now, benchRowId);
      database.prepare("UPDATE bench_removal_requests SET status='confirmed',resolved_at=? WHERE id=?").run(now, request.id);
    }
    return { added, count, removed, requestId: request.id };
  })();
}
