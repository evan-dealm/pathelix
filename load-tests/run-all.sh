#!/usr/bin/env bash
# Run all Pathélix load scenarios sequentially.
# Prerequisites: k6 installed (https://k6.io/docs/getting-started/installation/)
#
# Usage:
#   export BASE_URL=http://localhost:3000
#   export AUTH_TOKEN=<value of your session cookie>
#   bash load-tests/run-all.sh
#
# Optional env overrides (all have defaults):
#   DRIVER_COUNT   — number of simulated drivers (default 150)
#   TENANT_ID      — tenant ID injected in requests (default tenant-load-test)

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
DRIVER_COUNT="${DRIVER_COUNT:-150}"
TENANT_ID="${TENANT_ID:-tenant-load-test}"
RESULTS_DIR="load-tests/results/$(date +%Y%m%d-%H%M%S)"

mkdir -p "$RESULTS_DIR"

K6_FLAGS=(
  -e "BASE_URL=$BASE_URL"
  -e "AUTH_TOKEN=$AUTH_TOKEN"
  -e "DRIVER_COUNT=$DRIVER_COUNT"
  -e "TENANT_ID=$TENANT_ID"
)

run_scenario() {
  local name="$1"
  local file="$2"
  echo ""
  echo "========================================================="
  echo " Running: $name"
  echo "========================================================="
  k6 run "${K6_FLAGS[@]}" \
    --out "json=$RESULTS_DIR/${name}.json" \
    --summary-export "$RESULTS_DIR/${name}-summary.json" \
    "$file" || {
    echo "[WARN] $name returned non-zero — check $RESULTS_DIR/${name}-summary.json"
  }
}

echo "Pathélix 150-driver load test suite"
echo "BASE_URL=$BASE_URL  DRIVER_COUNT=$DRIVER_COUNT"
echo "Results → $RESULTS_DIR"
echo ""

run_scenario "gps-ingestion"   load-tests/scenarios/gps-ingestion.js
run_scenario "sse-connections"  load-tests/scenarios/sse-connections.js
run_scenario "mission-crud"     load-tests/scenarios/mission-crud.js
run_scenario "dashboard"        load-tests/scenarios/dashboard.js

echo ""
echo "All scenarios complete.  Summaries in $RESULTS_DIR/"
