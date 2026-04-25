# Felo backend — production image
# Multi-stage: build with dev deps, ship a slim runtime.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src
COPY db ./db

RUN npm run build && npm prune --omit=dev

# ----- Runtime -----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Drop privileges
RUN addgroup -S felo && adduser -S felo -G felo

COPY --from=builder --chown=felo:felo /app/node_modules ./node_modules
COPY --from=builder --chown=felo:felo /app/dist ./dist
COPY --from=builder --chown=felo:felo /app/db ./db
COPY --from=builder --chown=felo:felo /app/package.json ./

USER felo

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/v1/health || exit 1

CMD ["node", "dist/src/main.js"]
