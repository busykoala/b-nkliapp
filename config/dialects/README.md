# Dialect build data

`catalogue.json` is the versioned editorial and source catalogue. It contains 140 stable area IDs and the sourced local text variants that can be published immediately and corrected forward. It intentionally has no review-state field or release gate.

`areas.generated.json` is built offline from the pinned swissBOUNDARIES3D 2026-01 GeoPackage and the BFS `sprg20220501` language regions. It contains only unions of explicitly named current municipalities for the fine-grained dialect areas. The four BFS regions provide complete conservative coverage; foreign coordinates fall back to the selected app language.

Commands:

- `npm run dialects:generate` regenerates the 38 complete message packs and registries.
- `npm run dialects:geography:generate` regenerates the licensed geometry artifact from the ignored source cache.
- `npm run dialects:audit` evaluates a local bench snapshot without writing to it.

Source downloads and geometry generation stay outside release CI. CI validates the committed artifact, all ICU arguments, complete key coverage, stable IDs, Unicode and resolver behavior.
