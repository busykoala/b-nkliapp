import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freshnessLabel, readDataFreshness } from "./freshness";

describe("data freshness", () => {
  it("joins source probes, pipeline runs and artifact metadata without guessing", () => {
    const directory = mkdtempSync(join(tmpdir(), "benchly-freshness-"));
    const main = join(directory, "main.sqlite");
    const sources = join(directory, "sources.sqlite");
    const transit = join(directory, "transit.sqlite");
    const landscape = join(directory, "landscape.sqlite");
    const sonbase = join(directory, "sonbase.json");
    const mainDb = new Database(main);
    mainDb.exec("CREATE TABLE pipeline_runs(kind TEXT,status TEXT,finished_at TEXT); INSERT INTO pipeline_runs VALUES('import-osm','completed','2026-09-01T08:00:00Z')");
    mainDb.close();
    const sourceDb = new Database(sources);
    sourceDb.exec("CREATE TABLE external_source_versions(source_id TEXT,checked_at TEXT); INSERT INTO external_source_versions VALUES('statpop','2026-09-02T08:00:00Z')");
    sourceDb.close();
    for (const [path, value] of [[transit, "2026-09-03T08:00:00Z"], [landscape, "2026-09-04T08:00:00Z"]]) {
      const database = new Database(path);
      database.exec("CREATE TABLE metadata(key TEXT,value TEXT)");
      database.prepare("INSERT INTO metadata VALUES('updated_at',?)").run(value);
      database.close();
    }
    writeFileSync(sonbase, JSON.stringify({ downloaded_at: "2026-09-05T08:00:00Z" }));

    const result = readDataFreshness({ main, sources, transit, landscape, sonbaseState: sonbase });
    expect(result.sourceChecks.statpop).toBe("2026-09-02T08:00:00Z");
    expect(result.jobSuccesses["import-osm"]).toBe("2026-09-01T08:00:00Z");
    expect(result.jobSuccesses.transit).toBe("2026-09-03T08:00:00Z");
    expect(result.jobSuccesses.landscape).toBe("2026-09-04T08:00:00Z");
    expect(result.jobSuccesses.sonbase).toBe("2026-09-05T08:00:00Z");
  });

  it("labels missing and valid timestamps honestly", () => {
    expect(freshnessLabel(undefined)).toBe("Noch kein erfolgreicher Lauf gemeldet");
    expect(freshnessLabel("invalid")).toBe("Datenstand unbekannt");
    expect(freshnessLabel("2026-09-05T08:00:00Z")).toMatch(/^Stand .*(05\.09\.2026|5\. Sept\. 2026)/);
  });
});
