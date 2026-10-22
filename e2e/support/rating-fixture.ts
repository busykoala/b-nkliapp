import Database from "better-sqlite3";

/** Reviews need an actual published rating; unrated benches deliberately have no review link. */
export function installRatingFixture(benchId = "osm-node-101") {
  const path = process.env.BENCHLY_E2E_DATABASE;
  if (!path) throw new Error("Rating fixtures require the isolated E2E database");
  const database = new Database(path);
  try {
    database.prepare(`INSERT OR IGNORE INTO ratings(bench_row_id,contributor_hash,overall,visible,created_at,updated_at)
      SELECT row_id,?,4,1,'2026-09-05','2026-09-05' FROM benches WHERE id=?`)
      .run(`e2e-review-${benchId}`, benchId);
  } finally { database.close(); }
}
