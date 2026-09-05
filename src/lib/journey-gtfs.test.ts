import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupTransfer } from "./journey-gtfs";

let folder: string;
let db: Database.Database;
const from = { label: "Station", stationId: "8507000", latitude: 46.9, longitude: 7.4, platform: "2" };
const to = { ...from, platform: "3" };
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "benchly-transfer-test-"));
  const path = join(folder, "transit.sqlite"); vi.stubEnv("TRANSIT_DATABASE_PATH", path);
  db = new Database(path);
  db.exec("CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE stops(id TEXT,public_id TEXT,parent TEXT,platform TEXT); CREATE TABLE transfers(from_stop TEXT,to_stop TEXT,type INTEGER,minimum INTEGER,from_route TEXT,to_route TEXT,from_trip TEXT,to_trip TEXT);");
  const date = new Date(); const year = date.getUTCFullYear();
  for (const [key, value] of Object.entries({ updated_at: date.toISOString(), valid_from: `${year}0101`, valid_until: `${year}1231` })) db.prepare("INSERT INTO metadata VALUES(?,?)").run(key, value);
  db.exec("INSERT INTO stops VALUES('8507000','8507000','',''),('8507000:2','8507000','8507000','2'),('8507000:3','8507000','8507000','3');");
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); rmSync(folder, { recursive: true }); });
describe("GTFS transfer lookup", () => {
  it("prefers a directional platform rule and does not use it backwards", () => {
    db.exec("INSERT INTO transfers VALUES('8507000:2','8507000:3',2,180,'','','','');");
    expect(lookupTransfer(from, to)?.minimumSeconds).toBe(180);
    expect(lookupTransfer(to, from)).toBeNull();
    expect(lookupTransfer({ ...from, platform: undefined }, to)).toBeNull();
  });
  it("ignores ambiguous and trip-specific rules instead of assuming passengers can remain seated", () => {
    db.exec("INSERT INTO transfers VALUES('8507000:2','8507000:3',4,NULL,'','','trip-a','trip-b');");
    expect(lookupTransfer(from, to)).toBeNull();
    db.exec("INSERT INTO transfers VALUES('8507000:2','8507000:3',2,180,'','','',''),('8507000:2','8507000:3',2,240,'','','','');");
    expect(lookupTransfer(from, to)).toBeNull();
  });
  it("falls back to parent rules and rejects stale or out-of-period evidence", () => {
    db.exec("INSERT INTO transfers VALUES('8507000','8507000',2,120,'','','','');");
    expect(lookupTransfer(from, to)?.minimumSeconds).toBe(120);
    expect(lookupTransfer(from, to, "1999-01-01")).toBeNull();
    db.exec("UPDATE metadata SET value='2000-01-01T00:00:00Z' WHERE key='updated_at';");
    expect(lookupTransfer(from, to)).toBeNull();
  });
  it("does not pick the first rule when multiple platform IDs disagree", () => {
    db.exec("INSERT INTO stops VALUES('alias2','8507000','8507000','2'); INSERT INTO transfers VALUES('8507000:2','8507000:3',2,180,'','','',''),('alias2','8507000:3',2,300,'','','','');");
    expect(lookupTransfer(from, to)).toBeNull();
  });
});
