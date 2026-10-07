#!/usr/bin/env bash
# ─── restore-pg.sh — Restauration d'une sauvegarde PostgreSQL ─────────────────
#
# Usage :
#   ./scripts/restore-pg.sh /var/backups/pathelix/pathelix_2026-10-07_0200.dump
#
# Arrêter d'abord l'application et les workers (docker compose stop app worker …).
#
# Déroulement — la base en service n'est touchée qu'à la toute fin, et jamais détruite :
#   1. la sauvegarde est relue (un fichier tronqué est refusé avant toute action) ;
#   2. elle est chargée dans une base NEUVE <base>_restore_<date>, en une transaction : au
#      moindre objet en erreur, cette base est supprimée et rien d'autre n'a changé ;
#   3. la base en service est renommée <base>_avant_<date> et la base restaurée prend son nom.
# Revenir en arrière = renommer dans l'autre sens ; la commande est affichée à la fin.
#
# Configuration (une variable déjà définie l'emporte sur .env) :
#   DATABASE_URL     — base à remplacer (requis)
#   PG_CONTAINER     — conteneur PostgreSQL à utiliser (voir backup-pg.sh)
#   RESTORE_CONFIRM  — nom de la base, pour confirmer sans saisie (automatisation, tests)
#
# Accepte les .dump (backup-pg.sh actuel) et les anciens .sql.gz.

set -euo pipefail

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <sauvegarde.dump | sauvegarde.sql.gz>" >&2
  exit 1
fi
if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[ERROR] Fichier introuvable : $BACKUP_FILE" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/pg-common.sh
source "$SCRIPT_DIR/pg-common.sh"

pg_load_target
pg_pick_runner
MAINT_DB="${PG_MAINTENANCE_DB:-postgres}"

# ─── 1. La sauvegarde est-elle lisible ? ──────────────────────────────────────
case "$BACKUP_FILE" in
  *.dump)
    KIND=custom
    TABLES_IN_BACKUP="$(pg_run pg_restore --list < "$BACKUP_FILE" 2>/dev/null | grep -c 'TABLE DATA' || true)"
    if [[ "${TABLES_IN_BACKUP:-0}" -eq 0 ]]; then
      echo "[ERROR] Sauvegarde illisible ou vide : $BACKUP_FILE — rien n'a été modifié." >&2
      exit 2
    fi ;;
  *.sql.gz)
    KIND=plain
    if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
      echo "[ERROR] Archive corrompue : $BACKUP_FILE — rien n'a été modifié." >&2
      exit 2
    fi
    TABLES_IN_BACKUP="?" ;;
  *)
    echo "[ERROR] Format inconnu (attendu : .dump ou .sql.gz)." >&2
    exit 1 ;;
esac

STAMP="$(date +%Y%m%d_%H%M%S)"
NEW_DB="${DB_NAME}_restore_${STAMP}"
OLD_DB="${DB_NAME}_avant_${STAMP}"
TARGET_EXISTS="$(pg_sql "$MAINT_DB" "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")"

echo "=========================================="
echo " RESTAURATION POSTGRESQL — PATHÉLIX"
echo "=========================================="
echo " Base        : ${DB_NAME} (${PG_WHERE})"
echo " Sauvegarde  : $(basename "$BACKUP_FILE") — $(du -sh "$BACKUP_FILE" | cut -f1), ${TABLES_IN_BACKUP} tables"
if [[ -n "$TARGET_EXISTS" ]]; then
  echo " La base actuelle sera conservée sous le nom ${OLD_DB}."
else
  echo " La base ${DB_NAME} n'existe pas encore : elle sera créée."
fi
echo " L'application et les workers doivent être arrêtés."
echo "=========================================="

CONFIRM="${RESTORE_CONFIRM:-}"
if [[ -z "$CONFIRM" ]]; then
  read -r -p " Pour confirmer, tapez le nom de la base (${DB_NAME}) : " CONFIRM
fi
if [[ "$CONFIRM" != "$DB_NAME" ]]; then
  echo "[ANNULÉ] Rien n'a été modifié."
  exit 0
fi

# ─── 2. Chargement dans une base neuve ────────────────────────────────────────
echo "[INFO] $(date -Iseconds) — Chargement dans ${NEW_DB}"
pg_sql "$MAINT_DB" "CREATE DATABASE \"${NEW_DB}\""
SWAPPED=0
cleanup() {
  if [[ "$SWAPPED" -eq 0 ]]; then
    pg_sql "$MAINT_DB" "DROP DATABASE IF EXISTS \"${NEW_DB}\"" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "$KIND" == custom ]]; then
  LOADED=0
  pg_run pg_restore $(pg_conn_args "$NEW_DB") --no-owner --no-privileges --exit-on-error --single-transaction < "$BACKUP_FILE" && LOADED=1
else
  LOADED=0
  gunzip -c "$BACKUP_FILE" | pg_run psql $(pg_conn_args "$NEW_DB") --no-psqlrc --quiet -v ON_ERROR_STOP=1 --single-transaction >/dev/null && LOADED=1
fi
if [[ "$LOADED" -ne 1 ]]; then
  echo "[ERROR] Le chargement a échoué — la base ${DB_NAME} n'a pas été modifiée." >&2
  exit 3
fi

RESTORED_TABLES="$(pg_sql "$NEW_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
if [[ "${RESTORED_TABLES:-0}" -eq 0 ]]; then
  echo "[ERROR] La base restaurée ne contient aucune table — la base ${DB_NAME} n'a pas été modifiée." >&2
  exit 3
fi
echo "[OK] ${RESTORED_TABLES} tables chargées"

# ─── 3. Échange ───────────────────────────────────────────────────────────────
if [[ -n "$TARGET_EXISTS" ]]; then
  # Plus aucune connexion ne doit tenir la base pendant le renommage.
  pg_sql "$MAINT_DB" "ALTER DATABASE \"${DB_NAME}\" WITH ALLOW_CONNECTIONS false" >/dev/null
  pg_sql "$MAINT_DB" "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()" >/dev/null
  if ! pg_sql "$MAINT_DB" "ALTER DATABASE \"${DB_NAME}\" RENAME TO \"${OLD_DB}\"" >/dev/null; then
    pg_sql "$MAINT_DB" "ALTER DATABASE \"${DB_NAME}\" WITH ALLOW_CONNECTIONS true" >/dev/null || true
    echo "[ERROR] Impossible de mettre de côté la base actuelle — elle reste en service, inchangée." >&2
    exit 4
  fi
  pg_sql "$MAINT_DB" "ALTER DATABASE \"${OLD_DB}\" WITH ALLOW_CONNECTIONS true" >/dev/null
fi
if ! pg_sql "$MAINT_DB" "ALTER DATABASE \"${NEW_DB}\" RENAME TO \"${DB_NAME}\"" >/dev/null; then
  if [[ -n "$TARGET_EXISTS" ]]; then
    pg_sql "$MAINT_DB" "ALTER DATABASE \"${OLD_DB}\" RENAME TO \"${DB_NAME}\"" >/dev/null || true
  fi
  echo "[ERROR] Échange impossible — la base d'origine a été remise en service." >&2
  exit 4
fi
SWAPPED=1

echo "[OK] $(date -Iseconds) — ${DB_NAME} restaurée depuis $(basename "$BACKUP_FILE")"
echo "     Ensuite : npx prisma migrate deploy (si la sauvegarde est plus ancienne que le code), puis redémarrer."
if [[ -n "$TARGET_EXISTS" ]]; then
  echo "     Base précédente conservée : ${OLD_DB}"
  echo "     Annuler   : renommer ${DB_NAME} en autre chose, puis ${OLD_DB} en ${DB_NAME} (ALTER DATABASE … RENAME TO …)"
  echo "     Nettoyer  : DROP DATABASE \"${OLD_DB}\"; une fois la restauration validée"
fi
