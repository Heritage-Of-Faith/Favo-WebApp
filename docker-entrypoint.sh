#!/bin/sh
# Container entrypoint — AT-170.
#
# No arguments (the normal start):
#   1. migrate.js checks DATABASE_URL (and that no retired URL lingers) and applies pending
#      migrations under an advisory lock (scripts/migrate.ts);
#   2. only if that exits 0 does the server start. A non-zero exit stops the
#      container here, before it can serve traffic on a wrong schema or with
#      SSE silently degraded.
# With arguments, runs them instead — e.g. the one-shot migration ahead of a
# container swap: docker run --rm <image> bun migrate.js
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

bun /app/migrate.js
exec bun /app/server.js
