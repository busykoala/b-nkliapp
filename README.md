# Bänkli

Watercolor map, bench details, journeys and walks in Switzerland. Node.js 24; npm.

```sh
nvm install && nvm use
npm ci
cp .env.example .env.local
# Replace the three *_SECRET placeholders with distinct random values.
npm run dev
```

Open http://localhost:3000. The first request migrates the local database and seeds demo benches when empty. Set `BENCHLY_SEED_DEMO=false` for an imported database.

```sh
npm run check            # Generated files, TypeScript, lint, unit tests
npm run test:bench       # Bench presentation/data regressions
npx playwright install chromium webkit
npm run test:e2e:bench   # Bench and navigation flows; isolated test database
npm run test:e2e         # Complete browser suite
npm run build           # Migrates DATABASE_PATH, then builds
npm start
npm run test:worker     # Python worker tests (requires uv)
```

Use a disposable `DATABASE_PATH` for review builds; never point tests at production.

[Development & structure](docs/development.md) · [Design system](docs/design-system.md) · [Data/operations](docs/operations.md) · [Worker](worker/README.md) · [Deployment](deploy/charts/README.md)
