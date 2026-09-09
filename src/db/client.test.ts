import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("opens an already migrated app database while enrichment holds the writer lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "benchly-writer-test-"));
  const path = join(directory, "database.sqlite");
  vi.stubEnv("DATABASE_PATH", path);
  vi.stubEnv("BENCHLY_SEED_DEMO", "false");
  vi.stubEnv("NODE_ENV", "production");
  const first = (await import("./client")).sqlite;
  const writer = new Database(path);
  let reader: Database.Database | undefined;
  try {
    writer.exec("BEGIN IMMEDIATE");
    vi.resetModules();
    reader = (await import("./client")).sqlite;
    expect(reader).not.toBe(first);
    expect(reader.prepare("SELECT id FROM _migrations WHERE id='0026_knowledge_progress'").get()).toBeTruthy();
    expect(reader.prepare("SELECT count(*) count FROM benches").get()).toEqual({ count: 0 });
  } finally {
    writer.exec("ROLLBACK");
    writer.close();
    reader?.close();
    first.close();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
