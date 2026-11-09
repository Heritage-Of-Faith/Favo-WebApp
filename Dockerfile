# syntax=docker/dockerfile:1
# Multi-stage build producing the Next.js `output: "standalone"` server.
# Base image oven/bun:1 is Debian, so users are created with groupadd/useradd
# (not the Alpine addgroup/adduser syntax).
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
# --ignore-scripts: the root "prepare" script runs `git config`, and there is
# no git (and no repo) in the image, so bun install would exit non-zero.
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS builder
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so the
# real public Supabase URL / anon key must be passed as build args. They are
# public by design, not secrets. No server-only variable is needed to build.
# NEXT_PUBLIC_VAPID_PUBLIC_KEY (the public half of the Web Push key pair) is
# optional: if empty, push shows "not configured" instead of breaking the build.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build
# The release migration step (AT-170), bundled with drizzle-orm and postgres so
# the runner needs neither drizzle-kit nor node_modules to run it.
RUN bun build scripts/migrate.ts --target=bun --outfile=migrate.js
# The first load of an empty database (go-live gap G3, PRD §13.0): menu,
# prices, recipes, ingredient costs and the first admin. No opening stock, no
# dev staff, demo customers or demo transactions. See scripts/first-load.ts.
RUN bun build scripts/first-load.ts --target=bun --outfile=first-load.js

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# PRD §9.2: all day-close and wall-clock logic depends on it. The scheduler
# (src/server/jobs) also applies UTC+2 explicitly, so a missing TZ cannot move a job.
ENV TZ=Africa/Johannesburg

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/migrate.js ./migrate.js
COPY --from=builder --chown=nextjs:nodejs /app/first-load.js ./first-load.js
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --chown=nextjs:nodejs --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

# The commit this image was built from. SKIP_MIGRATIONS only takes effect when
# it equals this value, so a skip is one-shot per image (AT-170).
ARG IMAGE_SHA=""
ENV IMAGE_SHA=$IMAGE_SHA

# Liveness probe (bun: no curl in the image). /api/healthz returns 503 when
# Postgres is down, a configured LOKI_URL is unreachable, or DATABASE_URL_SESSION
# is unset. Yoco is advisory and never fails it. Leave LOKI_URL unset so an
# observability blip cannot mark a working cafe unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrate, then serve (docker-entrypoint.sh). To migrate one-shot ahead of a
# container swap: docker run --rm <image> bun migrate.js
# First load, after the first migration on the empty database (safe to re-run
# until the first order):
#   read -rs FIRST_ADMIN_PIN; export FIRST_ADMIN_PIN
#   docker run --rm -e DATABASE_URL -e FIRST_ADMIN_PIN <image> bun first-load.js
# (-e NAME with no value passes it from the shell, so the PIN is not typed into history.)
ENTRYPOINT ["./docker-entrypoint.sh"]
