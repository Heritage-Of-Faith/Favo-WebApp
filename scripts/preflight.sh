#!/usr/bin/env bash
# preflight.sh — AT-81 (G23)
# Runs the full pre-flight gate: typecheck → lint → unit tests → E2E full suite → Lighthouse.
# Outputs preflight.json. Exits 0 only when every gate passes.
#
# Required env:
#   PUBLIC_BASE_URL   — staging URL (default: http://localhost:3000)
#   DATABASE_URL      — Postgres connection string
#   AUTH_SECRET       — Auth.js secret
# Optional env:
#   TEST_AUDIT_SECRET — enables audit coverage assertion in E2E suite
#   CRON_SECRET       — must be "e2e-cron-secret" for cron tests to assert 200
#   SKIP_LIGHTHOUSE   — set to 1 to skip Lighthouse (e.g. in headless CI without Chrome)

set -euo pipefail

BASE_URL="${PUBLIC_BASE_URL:-http://localhost:3000}"
REPORT_FILE="preflight.json"
PASS=0
FAIL=1
OVERALL=$PASS

gates_json=""

# ─── Helper: time a command and append to gates_json ──────────────────────────

run_gate() {
  local name="$1"
  shift
  local label="$1"
  shift

  echo ""
  echo "▶  ${label}"
  local start_ms
  start_ms=$(date +%s%3N)

  local exit_code=0
  "$@" || exit_code=$?

  local end_ms
  end_ms=$(date +%s%3N)
  local duration_ms=$(( end_ms - start_ms ))

  local pass_str="true"
  if [ "$exit_code" -ne 0 ]; then
    pass_str="false"
    OVERALL=$FAIL
    echo "   ✗ ${label} failed (exit ${exit_code}, ${duration_ms}ms)"
  else
    echo "   ✓ ${label} passed (${duration_ms}ms)"
  fi

  local entry="\"${name}\":{\"pass\":${pass_str},\"duration_ms\":${duration_ms}}"
  if [ -n "$gates_json" ]; then
    gates_json="${gates_json},${entry}"
  else
    gates_json="${entry}"
  fi
}

# ─── Gate 1: typecheck ────────────────────────────────────────────────────────

run_gate "typecheck" "TypeScript typecheck (bun typecheck)" \
  bun typecheck

# ─── Gate 2: lint ─────────────────────────────────────────────────────────────

run_gate "lint" "ESLint (bun lint)" \
  bun lint

# ─── Gate 3: unit tests ───────────────────────────────────────────────────────

run_gate "test_unit" "Unit tests (bun test:unit)" \
  bun test:unit

# ─── Gate 4: E2E full suite ───────────────────────────────────────────────────

run_gate "test_e2e" "E2E full suite (bun test:e2e:ci tests/e2e/full-suite.spec.ts)" \
  bun test:e2e:ci tests/e2e/full-suite.spec.ts

# ─── Gate 5: Lighthouse ───────────────────────────────────────────────────────

if [ "${SKIP_LIGHTHOUSE:-0}" = "1" ]; then
  echo ""
  echo "▶  Lighthouse (skipped — SKIP_LIGHTHOUSE=1)"
  gates_json="${gates_json},\"lighthouse_landing\":{\"pass\":null,\"skipped\":true}"
  gates_json="${gates_json},\"lighthouse_dashboard\":{\"pass\":null,\"skipped\":true}"
  gates_json="${gates_json},\"lighthouse_pos\":{\"pass\":null,\"skipped\":true}"
elif command -v lighthouse &> /dev/null; then
  lh_pages=(
    "landing:/"
    "dashboard:/admin"
    "pos:/pos"
  )

  for entry in "${lh_pages[@]}"; do
    lh_name="${entry%%:*}"
    lh_path="${entry##*:}"
    lh_url="${BASE_URL}${lh_path}"
    lh_out="/tmp/lh_${lh_name}.json"

    echo ""
    echo "▶  Lighthouse: ${lh_name} (${lh_url})"
    lh_start=$(date +%s%3N)

    lighthouse_exit=0
    lighthouse "${lh_url}" \
      --output json \
      --output-path "${lh_out}" \
      --chrome-flags="--headless --no-sandbox --disable-dev-shm-usage" \
      --quiet \
      || lighthouse_exit=$?

    lh_end=$(date +%s%3N)
    lh_duration=$(( lh_end - lh_start ))

    if [ "$lighthouse_exit" -eq 0 ] && [ -f "${lh_out}" ]; then
      # Extract performance score (0.0–1.0) and multiply by 100
      lh_score=$(python3 -c "
import json, sys
data = json.load(open('${lh_out}'))
score = data.get('categories', {}).get('performance', {}).get('score', 0)
print(int(round((score or 0) * 100)))
" 2>/dev/null || echo "0")
      # Require ≥ 75 performance score
      lh_pass="true"
      if [ "$lh_score" -lt 75 ]; then
        lh_pass="false"
        OVERALL=$FAIL
        echo "   ✗ Lighthouse ${lh_name}: score ${lh_score}/100 (< 75 threshold, ${lh_duration}ms)"
      else
        echo "   ✓ Lighthouse ${lh_name}: score ${lh_score}/100 (${lh_duration}ms)"
      fi
      gates_json="${gates_json},\"lighthouse_${lh_name}\":{\"pass\":${lh_pass},\"score\":${lh_score},\"duration_ms\":${lh_duration}}"
    else
      echo "   ✗ Lighthouse ${lh_name}: failed to run (exit ${lighthouse_exit})"
      OVERALL=$FAIL
      gates_json="${gates_json},\"lighthouse_${lh_name}\":{\"pass\":false,\"score\":null,\"duration_ms\":${lh_duration}}"
    fi
  done
else
  echo ""
  echo "▶  Lighthouse (skipped — 'lighthouse' CLI not found)"
  gates_json="${gates_json},\"lighthouse_landing\":{\"pass\":null,\"skipped\":true}"
  gates_json="${gates_json},\"lighthouse_dashboard\":{\"pass\":null,\"skipped\":true}"
  gates_json="${gates_json},\"lighthouse_pos\":{\"pass\":null,\"skipped\":true}"
fi

# ─── Write preflight.json ────────────────────────────────────────────────────

SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo "unknown")}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
OVERALL_STR="pass"
if [ "$OVERALL" -ne 0 ]; then
  OVERALL_STR="fail"
fi

cat > "${REPORT_FILE}" << EOF
{
  "timestamp": "${TIMESTAMP}",
  "sha": "${SHA}",
  "base_url": "${BASE_URL}",
  "gates": {${gates_json}},
  "overall": "${OVERALL_STR}"
}
EOF

echo ""
echo "────────────────────────────────────────"
echo "Pre-flight result: ${OVERALL_STR}"
echo "Report: ${REPORT_FILE}"
echo "────────────────────────────────────────"

exit $OVERALL
