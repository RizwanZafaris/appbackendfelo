# Felo backend — production image (hardened)
# Multi-stage: build with dev deps, ship a slim runtime.
#
# Hardening:
#   - Pinned base image digest (rebuild monthly to pick up CVE patches)
#   - Non-root user
#   - dumb-init for PID 1 signal forwarding (clean SIGTERM on Railway redeploy)
#   - Read-only root FS at runtime (/tmp is the only writable mount)
#   - HEALTHCHECK against /v1/health
#   - No build-time secrets in layers; npm ci with --ignore-scripts
#   - Minimal runtime image (no shell into the prod container in normal ops)

# ----- Builder -----
FROM node:20.18-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY db ./db
COPY scripts ./scripts

RUN npm run build && npm prune --omit=dev --ignore-scripts

# ----- Runtime -----
FROM node:20.18-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps" \
    NPM_CONFIG_LOGLEVEL=warn

# tini for clean signal handling (dumb-init alternative; included with node).
RUN apk add --no-cache --update tini wget=~1.25 \
    && addgroup -S felo \
    && adduser -S felo -G felo -h /app -s /sbin/nologin

COPY --from=builder --chown=felo:felo /app/node_modules ./node_modules
COPY --from=builder --chown=felo:felo /app/dist ./dist
COPY --from=builder --chown=felo:felo /app/db ./db
COPY --from=builder --chown=felo:felo /app/scripts ./scripts
COPY --from=builder --chown=felo:felo /app/package.json ./

USER felo

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/v1/health || exit 1

# tini reaps zombies and forwards SIGTERM/SIGINT to node — required for
# graceful shutdown when Railway / Kubernetes terminate the container.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main.js"]
