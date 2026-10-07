#!/usr/bin/env bash
# ─── pg-common.sh — partagé par backup-pg.sh et restore-pg.sh ─────────────────
# À « sourcer », pas à exécuter.

_PG_ROOT_DIR="$(dirname "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)")"

# Résout la base visée dans DB_USER / DB_PASSWORD / DB_HOST / DB_PORT / DB_NAME.
# Un DATABASE_URL déjà exporté l'emporte : .env n'est lu que s'il n'y en a pas. L'ancienne
# version chargeait .env par-dessus — une restauration lancée avec un DATABASE_URL explicite
# partait quand même sur la base de .env.
pg_load_target() {
  if [[ -z "${DATABASE_URL:-}" && -f "$_PG_ROOT_DIR/.env" ]]; then
    local line
    line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$_PG_ROOT_DIR/.env" | tail -1 || true)"
    line="${line#*DATABASE_URL=}"
    line="${line%\"}"; line="${line#\"}"; line="${line%\'}"; line="${line#\'}"
    DATABASE_URL="$line"
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "[ERROR] DATABASE_URL non défini (ni dans l'environnement, ni dans .env)." >&2
    exit 1
  fi
  local url="${DATABASE_URL%%\?*}"
  if [[ ! "$url" =~ ^postgres(ql)?://([^:/@]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^/]+)$ ]]; then
    echo "[ERROR] DATABASE_URL illisible (attendu : postgresql://utilisateur:motdepasse@hôte:port/base)." >&2
    exit 1
  fi
  DB_USER="${BASH_REMATCH[2]}"
  local encoded_password="${BASH_REMATCH[4]}"
  DB_HOST="${BASH_REMATCH[5]}"
  DB_PORT="${BASH_REMATCH[7]:-5432}"
  DB_NAME="${BASH_REMATCH[8]}"
  # Le mot de passe d'une URL est encodé (%40 pour @, etc.) : PGPASSWORD attend la valeur réelle.
  DB_PASSWORD="$(printf '%b' "${encoded_password//%/\\x}")"
  if [[ ! "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
    echo "[ERROR] Nom de base inattendu : ${DB_NAME}" >&2
    exit 1
  fi
}

# Choisit où tournent les outils PostgreSQL : sur l'hôte s'ils y sont, sinon dans le conteneur
# (PG_CONTAINER, ou le service `postgres` de docker compose). Un déploiement Docker Compose
# n'a en général pas pg_dump sur l'hôte, et « postgres » n'y est pas un nom d'hôte résolu.
pg_pick_runner() {
  if [[ -z "${PG_CONTAINER:-}" ]] && ! command -v pg_dump >/dev/null 2>&1; then
    if command -v docker >/dev/null 2>&1; then
      PG_CONTAINER="$(cd "$_PG_ROOT_DIR" && docker compose ps -q postgres 2>/dev/null | head -1 || true)"
    fi
    if [[ -z "${PG_CONTAINER:-}" ]]; then
      echo "[ERROR] pg_dump introuvable sur l'hôte et aucun conteneur PostgreSQL trouvé." >&2
      echo "        Installez le client PostgreSQL 16 ou précisez PG_CONTAINER=<conteneur>." >&2
      exit 1
    fi
  fi
  if [[ -n "${PG_CONTAINER:-}" ]]; then PG_WHERE="conteneur ${PG_CONTAINER:0:12}"; else PG_WHERE="${DB_HOST}:${DB_PORT}"; fi
}

# pg_run <outil> [arguments…] — lance un outil PostgreSQL là où pg_pick_runner l'a décidé.
pg_run() {
  if [[ -n "${PG_CONTAINER:-}" ]]; then
    # MSYS_NO_PATHCONV : sous Git Bash, évite la réécriture des arguments commençant par « / ».
    MSYS_NO_PATHCONV=1 docker exec -i "$PG_CONTAINER" "$@"
  else
    PGPASSWORD="$DB_PASSWORD" "$@"
  fi
}

# pg_conn_args <base> — arguments de connexion à <base> (socket locale dans le conteneur).
pg_conn_args() {
  if [[ -n "${PG_CONTAINER:-}" ]]; then
    printf -- '--username=%s --dbname=%s' "$DB_USER" "$1"
  else
    printf -- '--host=%s --port=%s --username=%s --no-password --dbname=%s' "$DB_HOST" "$DB_PORT" "$DB_USER" "$1"
  fi
}

# pg_sql <base> <requête> — exécute une requête, arrêt à la première erreur, sortie brute.
pg_sql() {
  pg_run psql $(pg_conn_args "$1") --no-psqlrc --quiet --tuples-only --no-align -v ON_ERROR_STOP=1 -c "$2"
}
