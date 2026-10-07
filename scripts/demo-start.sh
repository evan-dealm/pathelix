#!/usr/bin/env bash
# Local demonstration of Pathélix on the test sandbox database.
#
#   bash scripts/demo-start.sh          start everything, then print the addresses
#   bash scripts/demo-start.sh stop     stop the application and its workers
#   bash scripts/demo-start.sh build    rebuild the application first, then start
#
# Starts PostgreSQL, Redis and Valhalla (docker compose), the VRP and PDF workers, and the built
# application on http://localhost:3000. The environment comes from .manualtest/env.sh (not in
# git): it points at the sandbox database that holds the demonstration company created by
# scripts/seed-pilot.ts. This script never touches the database named in .env.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=3000
LOGS=.manualtest/logs

stop_all() {
  if command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command "
      Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue | ForEach-Object { taskkill /PID \$_.OwningProcess /T /F } | Out-Null
      Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'node.exe' -and \$_.CommandLine -match 'vrpWorker|pdfWorker' } | ForEach-Object { taskkill /PID \$_.ProcessId /T /F } | Out-Null" 2>/dev/null
  else
    pkill -f "next start -p $PORT" 2>/dev/null
    pkill -f "vrpWorker|pdfWorker" 2>/dev/null
  fi
}

if [ "${1:-}" = "stop" ]; then
  stop_all
  echo "Application et workers arrêtés (les conteneurs Docker restent démarrés)."
  exit 0
fi

if [ ! -f .manualtest/env.sh ]; then
  echo "Fichier .manualtest/env.sh introuvable : il définit la base de test et les secrets locaux." >&2
  exit 1
fi
# shellcheck disable=SC1091
source .manualtest/env.sh
case "${DATABASE_URL:-}" in
  *manualtest_sandbox*) ;;
  *) echo "DATABASE_URL ne désigne pas la base de test : démarrage refusé." >&2; exit 1 ;;
esac
export NODE_ENV=production
mkdir -p "$LOGS"

echo "1/4  Services (PostgreSQL, Redis, Valhalla)…"
docker compose up -d postgres redis valhalla >"$LOGS/docker.log" 2>&1 || {
  echo "Docker n'a pas démarré les services — Docker Desktop est-il lancé ? Détail : $LOGS/docker.log" >&2
  exit 1
}
for _ in $(seq 1 60); do
  docker compose exec -T postgres pg_isready >/dev/null 2>&1 && break
  sleep 1
done

stop_all

if [ "${1:-}" = "build" ] || [ ! -f .next/BUILD_ID ]; then
  echo "2/4  Construction de l'application (quelques minutes)…"
  npx next build >"$LOGS/build.log" 2>&1 || { echo "Construction en échec — voir $LOGS/build.log" >&2; exit 1; }
else
  echo "2/4  Application déjà construite (« bash scripts/demo-start.sh build » pour reconstruire)."
fi

echo "3/4  Workers (optimisation, PDF)…"
# Every background job is fully detached (no inherited terminal stream), so this script returns.
nohup npx tsx src/workers/vrpWorker.ts >"$LOGS/worker-vrp.log" 2>&1 </dev/null &
( npm run -s build:worker:pdf && exec node dist/workers/pdfWorker.mjs ) >"$LOGS/worker-pdf.log" 2>&1 </dev/null &

echo "4/4  Application…"
nohup npx next start -p "$PORT" >"$LOGS/app.log" 2>&1 </dev/null &
for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/ready")" = "200" ] && break
  sleep 1
done
if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/ready")" != "200" ]; then
  echo "L'application ne répond pas — voir $LOGS/app.log" >&2
  exit 1
fi

cat <<TXT

Pathélix est prêt.
  Site          http://localhost:$PORT
  Connexion     http://localhost:$PORT/login
  Portail       http://localhost:$PORT/portal
  Journaux      $LOGS/
  Arrêt         bash scripts/demo-start.sh stop
TXT
