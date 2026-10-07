#!/usr/bin/env bash
# Runs the Pathélix load scenarios against a running instance.
# Prerequisite: k6 (https://k6.io/docs/getting-started/installation/).
#
#   # 1. Test data and sessions (never against production data: the seed refuses a database
#   #    that is not a sandbox unless LOADTEST_DB names it). Same SESSION_SECRET as the app.
#   npx tsx --tsconfig tsconfig.json load-tests/seed.ts
#   # 2. The scenarios
#   BASE_URL=http://localhost:3000 bash load-tests/run-all.sh
#   # 3. Clean up
#   npx tsx --tsconfig tsconfig.json load-tests/seed.ts --clean
#
# Optional: DRIVER_COUNT (default 150, at most what the seed created), DURATION (default 2m).

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
RESULTS_DIR="load-tests/results/$(date +%Y%m%d-%H%M%S)"
K6_FLAGS=(-e "BASE_URL=$BASE_URL")
[[ -n "${DRIVER_COUNT:-}" ]] && K6_FLAGS+=(-e "DRIVER_COUNT=$DRIVER_COUNT")
[[ -n "${DURATION:-}" ]] && K6_FLAGS+=(-e "DURATION=$DURATION")

if [[ ! -f load-tests/.tokens.json ]]; then
  echo "load-tests/.tokens.json is missing — run: npx tsx --tsconfig tsconfig.json load-tests/seed.ts" >&2
  exit 1
fi
mkdir -p "$RESULTS_DIR"
FAILED=0

run_scenario() {
  local name="$1"
  k6 run "${K6_FLAGS[@]}" --summary-export "$RESULTS_DIR/${name}-summary.json" "load-tests/scenarios/${name}.js" || {
    echo "[FAIL] $name — a threshold was crossed (see $RESULTS_DIR/${name}-summary.json)"
    FAILED=$((FAILED + 1))
  }
}

echo "Pathélix load scenarios → $BASE_URL (results in $RESULTS_DIR)"

# The fleet reports its positions while the dispatchers' screens read them.
run_scenario gps-ingestion &
GPS_PID=$!
sleep 15
run_scenario dashboard
wait "$GPS_PID" || FAILED=$((FAILED + 1))
run_scenario mission-crud

if [[ "$FAILED" -eq 0 ]]; then echo "All scenarios within their thresholds."; else echo "$FAILED scenario(s) crossed a threshold."; fi
exit "$FAILED"
