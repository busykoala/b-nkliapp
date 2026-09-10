import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { searchLocalStations } from "./journey-gtfs";

let folder: string;
let db: Database.Database;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "benchly-station-test-"));
  const path = join(folder, "transit.sqlite");
  vi.stubEnv("TRANSIT_DATABASE_PATH", path);
  db = new Database(path);
  db.exec(`CREATE TABLE stops(id TEXT,public_id TEXT,parent TEXT,platform TEXT,name TEXT,lat REAL,lon REAL);
    INSERT INTO stops VALUES
    ('platform','8507483','parent','1','Spiez',46.6866,7.6798),
    ('parent','8507483','','','Spiez',46.6864,7.6801),
    ('bus','8507484','','','Spiez, Bahnhof',46.6865,7.6802),
    ('abroad','123','','','Spiez elsewhere',48.5,7.68),
    ('unknown','bad-id','','','Spiez unknown',46.68,7.68);`);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); rmSync(folder, { recursive: true }); });

it("returns one station location per public ID and prefers the parent over a platform", () => {
  expect(searchLocalStations("SPIEZ")).toEqual([
    { stationId: "8507483", label: "Spiez", latitude: 46.6864, longitude: 7.6801 },
    { stationId: "8507484", label: "Spiez, Bahnhof", latitude: 46.6865, longitude: 7.6802 },
  ]);
});

it("treats search wildcards literally and remains usable without an imported file", () => {
  expect(searchLocalStations("Spiez%")).toEqual([]);
  expect(searchLocalStations("S_")).toEqual([]);
  vi.stubEnv("TRANSIT_DATABASE_PATH", join(folder, "missing.sqlite"));
  expect(searchLocalStations("Spiez")).toEqual([]);
});
