# syntax=docker/dockerfile:1
# Multi-stage build producing the Next.js `output: "standalone"` server.
# Base image oven/bun:1 is Debian, so users are created with groupadd/useradd
# (not the Alpine addgroup/adduser syntax).
# Not yet proven by a real `docker build`: the PR run of docker-publish.yml is
# the first one. Remove this line once it has gone green.

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

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["bun", "run", "server.js"]
