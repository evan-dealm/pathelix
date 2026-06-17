#!/usr/bin/env bash
# ─── restore-pg.sh — Restauration d'un backup PostgreSQL ─────────────────────
#
# Usage :
#   ./scripts/restore-pg.sh /var/backups/pathelix/pathelix_2026-04-22_0200.sql.gz
#
# ATTENTION : écrase la base de données cible. Confirmez avant de lancer.

set -euo pipefail

BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <backup_file.sql.gz>" >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[ERROR] Fichier introuvable : $BACKUP_FILE" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a; source "$ROOT_DIR/.env"; set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[ERROR] DATABASE_URL non défini." >&2
  exit 1
fi

DB_URL_CLEAN="${DATABASE_URL%%\?*}"
DB_REST="${DB_URL_CLEAN#*://}"
DB_USER="${DB_REST%%:*}"
DB_REST2="${DB_REST#*:}"
DB_PASSWORD="${DB_REST2%%@*}"
DB_REST3="${DB_REST2#*@}"
DB_HOST="${DB_REST3%%:*}"
DB_REST4="${DB_REST3#*:}"
DB_PORT="${DB_REST4%%/*}"
DB_NAME="${DB_REST4#*/}"

echo "=========================================="
echo " RESTAURATION POSTGRESQL — PATHÉLIX"
echo "=========================================="
echo " Base    : ${DB_NAME} @ ${DB_HOST}:${DB_PORT}"
echo " Backup  : $(basename "$BACKUP_FILE")"
echo " Taille  : $(du -sh "$BACKUP_FILE" | cut -f1)"
echo "------------------------------------------"
echo " ATTENTION : Cette opération va écraser"
echo " toutes les données de la base cible."
echo "=========================================="
read -r -p " Confirmez en tapant 'RESTAURER' : " CONFIRM

if [[ "$CONFIRM" != "RESTAURER" ]]; then
  echo "[ANNULÉ]"
  exit 0
fi

echo "[INFO] $(date -Iseconds) — Démarrage restauration"

PGPASSWORD="$DB_PASSWORD" gunzip -c "$BACKUP_FILE" | \
  PGPASSWORD="$DB_PASSWORD" psql \
    --host="$DB_HOST" \
    --port="${DB_PORT:-5432}" \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --no-password

echo "[OK] $(date -Iseconds) — Restauration terminée"
