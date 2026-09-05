// Execute on the cluster via `kubectl exec -i ... -- node < this-file`.
// Read-only, consistent geographic export. No users, sessions or contributions.
async function main() {
  const { default: Database } = await import("better-sqlite3");
  const { createGzip } = await import("node:zlib");
  const { once } = await import("node:events");
  const db = new Database("/data/benchly.sqlite", { readonly: true });
  const output = createGzip({ level: 1 });
  output.pipe(process.stdout);
  output.on("error", (error) => { throw error; });
  async function emit(record) {
    if (!output.write(JSON.stringify(record) + "\n")) await once(output, "drain");
  }
  db.exec("BEGIN");
  const counts = {};
  try {
    await emit({ format: "benchly-geography-v1", exportedAt: new Date().toISOString() });
    const queries = {
      // Lakes, rivers and forest polygons are complete nationally. Existing local
      // buildings remain untouched; this is not a full database replacement.
      environment_features: "SELECT * FROM environment_features WHERE source='swissTLM3D' AND kind IN ('water','forest')",
      land_cover_features: "SELECT * FROM land_cover_features",
      bench_enrichments: "SELECT e.*,b.id AS bench_id FROM bench_enrichments e JOIN benches b ON b.row_id=e.bench_row_id",
      official_context_sources: "SELECT * FROM official_context_sources WHERE source='swissTLM3D'",
    };
    for (const [table, query] of Object.entries(queries)) {
      let count = 0;
      for (const row of db.prepare(query).iterate()) {
        if (row.geometry_wkb) row.geometry_wkb = row.geometry_wkb.toString("base64");
        await emit({ table, row });
        count++;
      }
      counts[table] = count;
      process.stderr.write(`${table}: ${count}\n`);
    }
    await emit({ complete: true, counts });
    db.exec("COMMIT");
    output.end();
    await once(output, "end");
  } finally {
    db.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
