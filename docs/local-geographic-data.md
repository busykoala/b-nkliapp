# Refreshing local geographic data from the cluster

The local database originally contained the legacy OSM bounding-box import:
106,146 benches, but no exact water/forest geometry. The cluster has the official
swissTLM3D polygons needed for shoreline proximity and lake visibility.

The scripts export only official forest/water geometry, land-cover polygons,
bench enrichments, and the corresponding swissTLM3D source metadata. They do not
export accounts, sessions, ratings, corrections, or uploaded media. This is not a
complete cluster database clone: local buildings and bench source records remain
unchanged. Lake proximity alone does not create a `Seeblick` label.

Resolve the current application pod first:

```sh
kubectl --kubeconfig ../server/kubeconfig -n benchly get pods
```

Stream the read-only export to a new local archive (replace `APP_POD`):

```sh
kubectl --kubeconfig ../server/kubeconfig -n benchly exec -i APP_POD -- node \
  < scripts/export-geographic-data.cjs > /tmp/benchly-geography.jsonl.gz
python3 scripts/import-geographic-data.py /tmp/benchly-geography.jsonl.gz
python3 scripts/import-geographic-data.py /tmp/benchly-geography.jsonl.gz \
  --apply --backup data/benchly-before-geography.sqlite
```

The importer validates the entire archive before writing, uses the SQLite backup
API (including committed WAL data), and merges in one transaction. Existing
backup paths are rejected. Bench enrichments are matched by stable bench ID, not
cluster row number. Newer local analyses are retained and invalidated for a
geometry-aware refresh when next opened. User tables and bench positions/tags
are untouched. Geometry queries use the existing spatial-index triggers.

The September 5, 2026 refresh backup is
`data/benchly-before-cluster-20260905.sqlite`. Keep it until local review is done.

That refresh imported 900,173 forest/water features, 717,365 land-cover polygons,
and 3,452 enrichments, retaining 12 newer local analyses. The resulting database
has 3,497 enrichment records, 1,510 lake-view labels, and 1,492 waterfront flags.
SQLite `quick_check` passed; local benches, users, ratings, corrections and
metadata edits matched the backup. No production data was changed.

Safety checks:

```sh
python3 -m unittest discover -s scripts -p test_geographic_import.py -v
```
