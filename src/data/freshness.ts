import "server-only";

import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connection } from "next/server";
import { z } from "zod";
import { dataCatalog, type DataJob } from "./catalog";

export type DataFreshness = {
  sourceChecks: Record<string, string>;
  jobSuccesses: Record<string, string>;
};

const sonbaseState = z.object({ downloaded_at: z.string().datetime({ offset: true }) });

function readRows<T>(path: string, query: string): T[] {
  if (!existsSync(path)) return [];
  try {
    const database = new Database(path, { readonly: true, fileMustExist: true });
    try { return database.prepare(query).all() as T[]; }
    finally { database.close(); }
  } catch { return []; }
}

function metadataTimestamp(path: string): string | null {
  const rows = readRows<{ value: string }>(path, "SELECT value FROM metadata WHERE key='updated_at' LIMIT 1");
  return rows[0]?.value ?? null;
}

function runKind(job: DataJob) {
  if (job.command === "benchmark-vision") return "vision-benchmark";
  return job.command;
}

export function readDataFreshness(paths: {
  main: string;
  sources: string;
  transit: string;
  landscape: string;
  sonbaseState: string;
}): DataFreshness {
  const sourceChecks = Object.fromEntries(readRows<{ source_id: string; checked_at: string }>(
    paths.sources,
    "SELECT source_id,checked_at FROM external_source_versions",
  ).map((row) => [row.source_id, row.checked_at]));
  const completedRuns = new Map(readRows<{ kind: string; finished_at: string }>(
    paths.main,
    "SELECT kind,max(finished_at) finished_at FROM pipeline_runs WHERE status='completed' AND finished_at IS NOT NULL GROUP BY kind",
  ).map((row) => [row.kind, row.finished_at]));
  const transit = metadataTimestamp(paths.transit);
  const landscape = metadataTimestamp(paths.landscape);
  let sonbase: string | null = null;
  try { sonbase = sonbaseState.parse(JSON.parse(readFileSync(paths.sonbaseState, "utf8"))).downloaded_at; }
  catch { /* The first successful job will create the state. */ }

  const jobSuccesses: Record<string, string> = {};
  for (const job of dataCatalog.jobs) {
    const timestamp = job.id === "transit" ? transit
      : job.id === "landscape" ? landscape
        : job.id === "sonbase" ? sonbase
          : completedRuns.get(runKind(job)) ?? null;
    if (timestamp) jobSuccesses[job.id] = timestamp;
  }
  return { sourceChecks, jobSuccesses };
}

export async function getDataFreshness(): Promise<DataFreshness> {
  await connection();
  const dataRoot = resolve(process.env.DATA_ROOT ?? "/data");
  return readDataFreshness({
    main: resolve(process.env.DATABASE_PATH ?? `${dataRoot}/benchly.sqlite`),
    sources: resolve(process.env.SOURCE_STATUS_DATABASE_PATH ?? `${dataRoot}/source-status.sqlite`),
    transit: resolve(process.env.TRANSIT_DATABASE_PATH ?? `${dataRoot}/transit.sqlite`),
    landscape: resolve(process.env.LANDSCAPE_DATABASE_PATH ?? `${dataRoot}/landscape.sqlite`),
    sonbaseState: resolve(process.env.SONBASE_STATE_PATH ?? `${dataRoot}/sources/sonbase-day.tif.json`),
  });
}

export function freshnessLabel(value: string | undefined) {
  if (!value) return "Noch kein erfolgreicher Lauf gemeldet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Datenstand unbekannt";
  return `Stand ${new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(date)}`;
}
