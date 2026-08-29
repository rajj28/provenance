# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm ci` runs the postinstall `prisma generate`, so the client is baked in.
RUN npm ci

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.ts reads NODE_ENV at build time to decide CSP/HSTS.
ENV NODE_ENV=production
# env.ts validates at import time and the build imports it, so supply
# placeholders that satisfy the schema. Real values are injected at runtime.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime" \
    APP_ENCRYPTION_KEY="build-time-placeholder-key-not-used-at-runtime" \
    CRON_SECRET="build-time-placeholder-cron-not-used-at-runtime" \
    npm run build

# ---------- runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# `output: "standalone"` emits a server plus only the node_modules it traced.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations and the Prisma CLI/engines, so the release step can run
# `prisma migrate deploy` from this same image.
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# ---------- worker ----------
# The BullMQ worker is not part of the Next standalone output, so it runs from a
# full install with tsx. Same repo, different entrypoint.
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json tsconfig.json ./
COPY --chown=nextjs:nodejs prisma ./prisma
COPY --chown=nextjs:nodejs src ./src
USER nextjs
# STOPSIGNAL is the default SIGTERM; worker.ts drains in-flight jobs on it.
CMD ["npx", "tsx", "src/worker.ts"]
