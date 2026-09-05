# Deployment charts

`benchly/` is the authoritative application chart. The repository-scoped self-hosted runner
performs digest-pinned upgrades after successful checks and image builds. The server repository
manages the runner and shared infrastructure, not a duplicate Benchly chart.

`inference/` is a legacy mirror. The shared inference stack is deployed independently from
`busykoala/server`; Benchly releases must not reapply this older copy. The app's release workflow
only reads the existing inference API credential for its integration.
