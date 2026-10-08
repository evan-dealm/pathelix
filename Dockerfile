# Node 20 reached end of life in April 2026 (no more security fixes). 24 is the LTS line the test
# suite runs on. Override with --build-arg NODE_VERSION=22 if needed.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# postinstall (scripts/sync-maplibre-worker.js) must exist before npm ci
COPY scripts ./scripts
RUN npm ci

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV DATABASE_URL=${DATABASE_URL}
# Public origin of the website, baked into its static pages (canonical URLs, sitemap, Open Graph).
ARG NEXT_PUBLIC_SITE_URL="http://localhost:3000"
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
# NEXT_PUBLIC_* values are inlined in the browser bundles at build time: setting them on the
# running container has no effect. Both are public by nature (they end up in the page source).
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ARG NEXT_PUBLIC_MAPTILER_KEY=""
ENV NEXT_PUBLIC_MAPTILER_KEY=${NEXT_PUBLIC_MAPTILER_KEY}
RUN npx prisma generate
# `next build` needs more than Node's default heap on a host with little memory visible to Docker
# (2 GB heap on an 8 GB machine: the build died with "JavaScript heap out of memory").
ARG BUILD_HEAP_MB=4096
RUN NODE_OPTIONS=--max-old-space-size=${BUILD_HEAP_MB} npm run build

FROM node:${NODE_VERSION}-alpine AS proddeps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci --omit=dev

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# Prisma 7 reads the datasource URL for `migrate deploy` from prisma.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/generated ./src/generated
# Solver thread bundle (npm run build:solver, part of npm run build): route searches run in it
# instead of the web server's event loop (src/lib/vrp/solverPool.ts).
COPY --from=builder /app/dist/workers/vrpSolver.mjs ./dist/workers/vrpSolver.mjs
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=deps /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
# Uploads (photos, signatures) live on the photo_storage volume mounted here; a named volume
# takes the ownership of the image directory on first creation, so it must exist and be writable.
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/ready || exit 1
# exec: node replaces the shell and receives SIGTERM itself (clean shutdown instead of a kill).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node server.js"]
