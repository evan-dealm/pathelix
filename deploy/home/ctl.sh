#!/usr/bin/env bash
# ─── ctl.sh — Pathélix on a personal server (docker-compose.home.yml) ────────
#
# One entry point so that every command uses the same project name, compose file and secrets
# file. Run it from anywhere:  /opt/pathelix/deploy/home/ctl.sh <command>
#
#   check            validate .env.production and the compose file; start nothing
#   build            build the two images (app, workers)
#   migrate-status   list migrations applied / pending; change nothing
#   migrate          BACK UP, then apply pending migrations (asks for confirmation)
#   up [args]        start or update the stack (e.g. `up --profile tunnel`)
#   update           check → build → backup → migrate → up, stopping at the first failure
#   status           containers, health, memory and CPU in use
#   logs [service]   follow logs
#   superadmin       create / reset the platform account (SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD
#                    read from the terminal, never stored)
#   backup           database + uploaded files (scripts/backup-all.sh)
#   restore <file>   restore a database backup (scripts/restore-pg.sh), app and workers stopped
#   stop             stop the containers; volumes and data are kept
#   compose <args>   any other docker compose command with the right flags
#
# There is deliberately no command that deletes a volume.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${PATHELIX_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE_PATH="$ROOT/docker-compose.home.yml"
PROJECT="${PATHELIX_PROJECT:-pathelix}"
APP_SERVICES=(app worker worker-pdf worker-ml worker-recurring worker-business worker-retention)

dc() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE_PATH" --env-file "$ENV_FILE" "$@"; }
die() { echo "[ERROR] $*" >&2; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

check() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE introuvable — cp deploy/home/env.example .env.production"
  local problems=0 name value perms
  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
  if [[ "$perms" != "600" && "$perms" != "400" && "$perms" != "?" ]]; then
    echo "[WARN] $ENV_FILE est lisible par d'autres comptes (droits $perms) — chmod 600"
  fi
  for name in DB_PASSWORD REDIS_PASSWORD SESSION_SECRET INTEGRATION_ENCRYPTION_KEY NEXT_PUBLIC_SITE_URL; do
    value="$(env_value "$name")"
    if [[ -z "$value" ]]; then echo "[ERROR] $name est vide"; problems=1; continue; fi
    if [[ "$value" =~ [Cc]hange[-_]?[Mm]e ]]; then echo "[ERROR] $name contient encore la valeur d'exemple"; problems=1; fi
  done
  for name in DB_PASSWORD REDIS_PASSWORD; do
    value="$(env_value "$name")"
    [[ "$value" =~ ^[A-Za-z0-9_-]{24,}$ ]] || { echo "[ERROR] $name : 24 caractères au moins, lettres et chiffres uniquement (openssl rand -hex 24)"; problems=1; }
  done
  [[ "$(env_value SESSION_SECRET | wc -c)" -ge 33 ]] || { echo "[ERROR] SESSION_SECRET : 32 caractères au moins (openssl rand -base64 48)"; problems=1; }
  [[ "$(env_value INTEGRATION_ENCRYPTION_KEY)" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "[ERROR] INTEGRATION_ENCRYPTION_KEY : 64 caractères hexadécimaux (openssl rand -hex 32)"; problems=1; }
  [[ "$(env_value NEXT_PUBLIC_SITE_URL)" =~ ^https:// ]] || { echo "[ERROR] NEXT_PUBLIC_SITE_URL doit commencer par https://"; problems=1; }
  [[ "$problems" -eq 0 ]] || die "configuration incomplète — rien n'a été lancé"
  dc config --quiet || die "docker-compose.home.yml invalide"
  # Nothing but the application port, and only on the loopback interface.
  local published
  published="$(dc --profile tunnel --profile tools config --format json | grep -o '"host_ip": *"[^"]*"\|"published": *"[^"]*"' | tr '\n' ' ')"
  if [[ "$published" != *'"host_ip": "127.0.0.1"'* || "$(grep -o '"published"' <<<"$published" | wc -l)" -ne 1 ]]; then
    die "ports publiés inattendus : $published"
  fi
  echo "[OK] configuration valide — un seul port publié : 127.0.0.1:$(env_value PATHELIX_PORT || true)"
}

confirm() {
  [[ "${PATHELIX_YES:-}" == "1" ]] && return 0
  read -r -p "$1 [oui/non] " answer
  [[ "$answer" == "oui" ]] || die "abandonné"
}

backup() {
  local pg
  pg="$(dc ps -q postgres | head -1)"
  [[ -n "$pg" ]] || die "le conteneur PostgreSQL ne tourne pas"
  # The tools run inside the PostgreSQL container (local socket): no client to install on the
  # host, no database port to publish. The URL only carries the user and database names.
  PG_CONTAINER="$pg" \
  DATABASE_URL="postgresql://pathelix:unused@localhost:5432/pathelix_fleet" \
  UPLOADS_VOLUME="${PROJECT}_photo_storage" \
    "$ROOT/scripts/backup-all.sh"
}

migrate() {
  echo "── Migrations en attente ──"
  dc run --rm migrate npx prisma migrate status || true
  local tables
  tables="$(dc exec -T postgres psql -U pathelix -d pathelix_fleet -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" | tr -d '[:space:]')"
  [[ "$tables" =~ ^[0-9]+$ ]] || die "impossible de lire l'état de la base — rien n'a été appliqué"
  if [[ "$tables" -eq 0 ]]; then
    echo "[INFO] Base vide (première installation) : pas de sauvegarde préalable."
    confirm "Créer le schéma ?"
  else
    confirm "Sauvegarder la base puis appliquer les migrations en attente ?"
    # A failed backup stops here (set -e): no migration without a readable backup.
    backup
  fi
  dc run --rm migrate
}

cmd="${1:-}"; shift || true
case "$cmd" in
  check)          check ;;
  build)          check; dc build "$@" ;;
  migrate-status) dc run --rm migrate npx prisma migrate status ;;
  migrate)        check; migrate ;;
  up)             check; dc "$@" up -d --remove-orphans; dc ps ;;
  update)
    check
    dc build
    dc up -d postgres redis
    migrate
    dc up -d --remove-orphans
    dc ps ;;
  status)         dc ps; echo; docker stats --no-stream $(dc ps -q) ;;
  logs)           dc logs -f --tail=200 "$@" ;;
  superadmin)
    read -r -p "E-mail du superadmin : " SUPERADMIN_EMAIL
    read -r -s -p "Mot de passe (12 caractères au moins, minuscules, majuscules, chiffres) : " SUPERADMIN_PASSWORD; echo
    export SUPERADMIN_EMAIL SUPERADMIN_PASSWORD
    dc run --rm --no-deps -e SUPERADMIN_EMAIL -e SUPERADMIN_PASSWORD worker tsx prisma/seed-superadmin.ts ;;
  backup)         backup ;;
  restore)
    [[ -n "${1:-}" ]] || die "usage : ctl.sh restore <sauvegarde.dump>"
    # Checked before anything is stopped: a wrong path must not take the application down.
    [[ -f "$1" ]] || die "fichier introuvable : $1 — rien n'a été arrêté"
    pg="$(dc ps -q postgres | head -1)"; [[ -n "$pg" ]] || die "le conteneur PostgreSQL ne tourne pas"
    dc stop "${APP_SERVICES[@]}"
    PG_CONTAINER="$pg" DATABASE_URL="postgresql://pathelix:unused@localhost:5432/pathelix_fleet" \
      "$ROOT/scripts/restore-pg.sh" "$1"
    echo "Ensuite : ctl.sh migrate-status, puis ctl.sh up" ;;
  stop)           dc stop ;;
  compose)        dc "$@" ;;
  *)              sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
