# Deployment charts

`benchly/` is the authoritative application chart. The repository-scoped self-hosted runner
performs digest-pinned upgrades after successful checks and image builds. The server repository
manages the runner and shared infrastructure, not a duplicate Benchly chart.

GraphHopper and inference are infrastructure owned exclusively by `busykoala/server`:
`../server/deploy/graphhopper` and `../server/deploy/inference`. No runtime image, model catalog
or infrastructure chart is mirrored here. Benchly only configures their service addresses and
reads the existing inference API credential. The landscape and GTFS pipelines remain Benchly workers.
