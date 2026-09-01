FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
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
