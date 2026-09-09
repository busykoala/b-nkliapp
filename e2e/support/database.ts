import Database from "better-sqlite3";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

export function fixtureDatabase() {
  const path = process.env.BENCHLY_E2E_DATABASE;
  if (!path || dirname(resolve(path)) !== resolve(tmpdir()) || !/^benchly-e2e-\d+\.sqlite$/.test(basename(path))) throw new Error("Browser fixtures require the disposable local test database.");
  const database = new Database(path, { fileMustExist: true });
  database.pragma("busy_timeout=5000");
  return database;
}
