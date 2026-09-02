# Deployment chart mirror

These two charts mirror `busykoala/server/deploy/{benchly,inference}` so the repository-scoped
self-hosted runner can deploy without a cross-repository credential. Infrastructure changes are
authored and committed in the server repository first, then copied here and checked with `diff`
before the application release. The production environment remains configured by Ansible in the
server repository; this mirror only performs digest-pinned upgrades after a successful image build.
