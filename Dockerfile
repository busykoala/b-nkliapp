FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=20000 \
    npm_config_fetch_retry_maxtimeout=120000
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json next-env.d.ts next.config.ts postcss.config.mjs tsconfig.json ./
COPY config ./config
COPY deploy/charts/benchly/data-jobs.generated.json ./deploy/charts/benchly/data-jobs.generated.json
COPY scripts/generate-data-jobs.ts ./scripts/generate-data-jobs.ts
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/data/benchly.sqlite \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 benchly && useradd --system --uid 1001 --gid benchly benchly && mkdir -p /data && chown benchly:benchly /data
COPY --from=builder --chown=benchly:benchly /app/public ./public
COPY --from=builder --chown=benchly:benchly /app/.next/standalone ./
COPY --from=builder --chown=benchly:benchly /app/.next/static ./.next/static
USER benchly
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
