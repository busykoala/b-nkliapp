# Storage decision: retain SQLite for now

Date: 2026-09-05

The read-only prototype showed that a fully prepared PostgreSQL/PostGIS snapshot
can answer the tested viewport, nearby-environment and detail queries much more
quickly under eight concurrent clients. Elasticsearch was also loaded with the
complete hot dataset; it reproduced the results but regressed single-client
latency and offered no measurable search-quality evidence because the current
dataset has almost no labelled names.

This does **not** justify a production database migration yet. The prototype did
not exercise the complete application schema, transactional community writes,
worker imports, backup/restore, recovery or the planned swissNAMES3D search
corpus. Those were explicit parts of the decision rule, and treating an
incomplete read-only subset as an accepted migration would be misleading.

Therefore:

- SQLite remains the production database.
- PostgreSQL/PostGIS is the preferred candidate if multiple app replicas or
  measured read contention become a real requirement.
- Elasticsearch is not introduced. Search stays relational until a common,
  labelled swissNAMES3D corpus can demonstrate at least 10% better MRR/NDCG.
- The temporary databases, indexes, benchmark code and raw reports are removed.
- Any future comparison must prepare the full schema and equivalent data before
  measuring it; an unprepared candidate may not be rejected on that basis.

This keeps the deployed system simple and resource-conscious while preserving
the only actionable conclusion from the experiment.
