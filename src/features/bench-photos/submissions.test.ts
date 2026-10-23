import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
let folder: string;
let database: Database.Database;
let benchRowId: number;
let userId: number;

function moderationResponse(peopleDetected: boolean) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ people_detected: peopleDetected, confidence: .99 }) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "benchly-photo-submission-"));
  vi.stubEnv("DATABASE_PATH", join(folder, "test.sqlite"));
  vi.stubEnv("BENCHLY_PHOTO_LOCAL_PATH", join(folder, "photos"));
  vi.stubEnv("BENCHLY_SEED_DEMO", "true");
  vi.stubEnv("INFERENCE_API_KEY", "test");
  vi.resetModules();
  cache.revalidatePath.mockClear();
  database = (await import("@/db/client")).sqlite;
  benchRowId = (database.prepare("SELECT row_id FROM benches WHERE id='osm-node-101'").get() as { row_id: number }).row_id;
  userId = Number(database.prepare(`INSERT INTO users(username,username_key,password_hash,created_at)
    VALUES('Photographer','photographer','hash','2026-09-13')`).run().lastInsertRowid);
});

afterEach(() => {
  database.close();
  delete (globalThis as typeof globalThis & { benchlySqlite?: Database.Database }).benchlySqlite;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});

async function createSubmission(id: string) {
  const { storeBenchPhoto } = await import("./storage");
  const url = await storeBenchPhoto(`benches/osm-node-101/${id}.jpg`, jpeg, "image/jpeg");
  database.prepare(`INSERT INTO bench_photo_submissions
    (id,bench_row_id,user_id,caption,photo_url,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending','2026-09-13','2026-09-13')`).run(id, benchRowId, userId, "Aussicht", url);
  return url;
}

describe("background bench photo moderation", () => {
  it("publishes a people-free submission and records its final status", async () => {
    const id = "12345678-1234-4234-8234-123456789abc";
    await createSubmission(id);
    vi.stubGlobal("fetch", vi.fn(async () => moderationResponse(false)));
    const { processBenchPhotoSubmission } = await import("./submissions");
    await processBenchPhotoSubmission(id);

    expect(database.prepare("SELECT status,attempts,error_key FROM bench_photo_submissions WHERE id=?").get(id))
      .toEqual({ status: "accepted", attempts: 1, error_key: null });
    expect(database.prepare("SELECT body,visible FROM bench_moments WHERE photo_url IS NOT NULL").get())
      .toEqual({ body: "Aussicht", visible: 1 });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/bank/osm-node-101");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/feed");
  });

  it("publishes when another WAL writer competes between the lease read and moment insert", async () => {
    const id = "32345678-1234-4234-8234-123456789abc";
    const url = await createSubmission(id);
    const { default: DatabaseConstructor } = await import("better-sqlite3");
    const competing = new DatabaseConstructor(join(folder, "test.sqlite"), { timeout: 0 });
    const prepare = database.prepare.bind(database);
    let competed = false;
    vi.spyOn(database, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql);
      if (sql.includes("SELECT 1 present FROM bench_photo_submissions")) {
        const get = statement.get.bind(statement);
        vi.spyOn(statement, "get").mockImplementation((...parameters) => {
          const lease = get(...parameters);
          competed = true;
          // A real second connection attempts to advance the WAL after the read.
          // A deferred transaction loses its snapshot; an immediate transaction
          // keeps its writer reservation until publication is committed.
          try {
            competing.prepare("UPDATE users SET last_login_at=? WHERE id=?").run("2026-10-23", userId);
          } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "SQLITE_BUSY") throw error;
          }
          return lease;
        });
      }
      return statement;
    });
    vi.stubGlobal("fetch", vi.fn(async () => moderationResponse(false)));
    try {
      const { processBenchPhotoSubmission } = await import("./submissions");
      const { readBenchPhoto } = await import("./storage");
      await processBenchPhotoSubmission(id);

      expect(competed).toBe(true);
      const submission = database.prepare(`SELECT status,error_key,attempts,lease_token,lease_until,moment_id
        FROM bench_photo_submissions WHERE id=?`).get(id) as { moment_id: number };
      expect(submission).toEqual({ status: "accepted", error_key: null, attempts: 1,
        lease_token: null, lease_until: null, moment_id: expect.any(Number) });
      expect(database.prepare(`SELECT id,bench_row_id,user_id,kind,body,visible
        FROM bench_moments WHERE photo_url=?`).all(url))
        .toEqual([{ id: submission.moment_id, bench_row_id: benchRowId, user_id: userId,
          kind: "photo", body: "Aussicht", visible: 1 }]);
      const photo = await readBenchPhoto(url);
      expect(Array.from(photo?.bytes ?? [])).toEqual(Array.from(jpeg));
      expect(photo?.contentType).toBe("image/jpeg");
      // Publication must release the writer reservation again.
      expect(competing.prepare("UPDATE users SET last_login_at=? WHERE id=?")
        .run("2026-10-24", userId).changes).toBe(1);
      expect(cache.revalidatePath).toHaveBeenCalledWith("/bank/osm-node-101");
      expect(cache.revalidatePath).toHaveBeenCalledWith("/feed");
    } finally {
      competing.close();
    }
  });

  it("publishes exactly once when another processor checks during moderation and retries after acceptance", async () => {
    const id = "42345678-1234-4234-8234-123456789abc";
    const url = await createSubmission(id);
    const { processBenchPhotoSubmission } = await import("./submissions");
    const moderate = vi.fn(async () => {
      // Polling schedules another processor while the first one owns the lease.
      await processBenchPhotoSubmission(id);
      return moderationResponse(false);
    });
    vi.stubGlobal("fetch", moderate);

    await processBenchPhotoSubmission(id);
    await processBenchPhotoSubmission(id);

    expect(moderate).toHaveBeenCalledTimes(1);
    expect(database.prepare("SELECT status,attempts FROM bench_photo_submissions WHERE id=?").get(id))
      .toEqual({ status: "accepted", attempts: 1 });
    expect(database.prepare("SELECT count(*) count FROM bench_moments WHERE photo_url=?").get(url))
      .toEqual({ count: 1 });
    expect(cache.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("does not publish or delete the image if its moderation lease has been replaced", async () => {
    const id = "52345678-1234-4234-8234-123456789abc";
    const url = await createSubmission(id);
    vi.stubGlobal("fetch", vi.fn(async () => {
      database.prepare("UPDATE bench_photo_submissions SET lease_token='replacement-worker' WHERE id=?").run(id);
      return moderationResponse(false);
    }));
    const { processBenchPhotoSubmission } = await import("./submissions");
    const { readBenchPhoto } = await import("./storage");

    await processBenchPhotoSubmission(id);

    expect(database.prepare("SELECT status,lease_token,error_key,moment_id FROM bench_photo_submissions WHERE id=?").get(id))
      .toEqual({ status: "processing", lease_token: "replacement-worker", error_key: null, moment_id: null });
    expect(database.prepare("SELECT count(*) count FROM bench_moments WHERE photo_url=?").get(url))
      .toEqual({ count: 0 });
    expect(Array.from((await readBenchPhoto(url))?.bytes ?? [])).toEqual(Array.from(jpeg));
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a rejected submission and removes its stored object", async () => {
    const id = "22345678-1234-4234-8234-123456789abc";
    const url = await createSubmission(id);
    vi.stubGlobal("fetch", vi.fn(async () => moderationResponse(true)));
    const { processBenchPhotoSubmission } = await import("./submissions");
    const { readBenchPhoto } = await import("./storage");
    await processBenchPhotoSubmission(id);

    expect(database.prepare("SELECT status,attempts,error_key FROM bench_photo_submissions WHERE id=?").get(id))
      .toEqual({ status: "rejected", attempts: 1, error_key: "photos.server.people" });
    await expect(readBenchPhoto(url)).rejects.toThrow();
    expect(database.prepare("SELECT count(*) count FROM bench_moments WHERE photo_url IS NOT NULL").get())
      .toEqual({ count: 0 });
  });
});
