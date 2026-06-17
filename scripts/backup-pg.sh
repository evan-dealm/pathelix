#!/usr/bin/env bash
# ─── backup-pg.sh — Sauvegarde PostgreSQL locale rotative ─────────────────────
#
# Usage :
#   ./scripts/backup-pg.sh
#
# Configuration via variables d'environnement (ou .env chargé ci-dessous) :
#   DATABASE_URL  — PostgreSQL connection string (requis)
#   BACKUP_DIR    — Répertoire de sauvegarde (défaut: /var/backups/pathelix)
#   BACKUP_KEEP   — Nombre de jours à conserver (défaut: 7)
#
# Installation comme CRON quotidien à 02:00 :
#   crontab -e
#   0 2 * * * /opt/pathelix/scripts/backup-pg.sh >> /var/log/pathelix-backup.log 2>&1
#
# Rotation : conserve BACKUP_KEEP fichiers, supprime les plus anciens.
# Format fichier : pathelix_YYYY-MM-DD_HHmm.sql.gz

set -euo pipefail

# ─── Chargement de l'environnement ───────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Charger .env si présent (priorité aux variables déjà définies dans l'env)
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT_DIR/.env"
  set +a
fi

# ─── Configuration ────────────────────────────────────────────────────────────

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pathelix}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
TIMESTAMP="$(date +%Y-%m-%d_%H%M)"
FILENAME="pathelix_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${FILENAME}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[ERROR] DATABASE_URL non défini. Export ou .env requis." >&2
  exit 1
fi

# ─── Extraction des paramètres de connexion depuis DATABASE_URL ───────────────
# Format attendu : postgresql://user:password@host:port/dbname[?params]

DB_URL_CLEAN="${DATABASE_URL%%\?*}"   # supprimer les query params
DB_PROTO="${DB_URL_CLEAN%%://*}"      # postgresql ou postgres
DB_REST="${DB_URL_CLEAN#*://}"        # user:password@host:port/dbname
DB_USER="${DB_REST%%:*}"
DB_REST2="${DB_REST#*:}"
DB_PASSWORD="${DB_REST2%%@*}"
DB_REST3="${DB_REST2#*@}"
DB_HOST="${DB_REST3%%:*}"
DB_REST4="${DB_REST3#*:}"
DB_PORT="${DB_REST4%%/*}"
DB_NAME="${DB_REST4#*/}"

if [[ -z "$DB_NAME" || -z "$DB_HOST" ]]; then
  echo "[ERROR] Impossible de parser DATABASE_URL : $DATABASE_URL" >&2
  exit 1
fi

echo "[INFO] $(date -Iseconds) — Démarrage backup PostgreSQL"
echo "[INFO] Base: ${DB_NAME} @ ${DB_HOST}:${DB_PORT}"
echo "[INFO] Destination: ${BACKUP_PATH}"

# ─── Création du répertoire de sauvegarde ────────────────────────────────────

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

# ─── Dump + compression ───────────────────────────────────────────────────────

PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="$DB_HOST" \
  --port="${DB_PORT:-5432}" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=plain \
  --no-password \
  --verbose \
  2>> "${BACKUP_DIR}/backup.log" \
| gzip -9 > "$BACKUP_PATH"

if [[ $? -ne 0 ]] || [[ ! -s "$BACKUP_PATH" ]]; then
  echo "[ERROR] Échec du dump — fichier vide ou erreur pg_dump" >&2
  rm -f "$BACKUP_PATH"
  exit 2
fi

BACKUP_SIZE="$(du -sh "$BACKUP_PATH" | cut -f1)"
echo "[OK] Backup créé : ${FILENAME} (${BACKUP_SIZE})"

# ─── Rotation : suppression des fichiers plus anciens que BACKUP_KEEP jours ──

DELETED=0
while IFS= read -r -d '' old_file; do
  rm -f "$old_file"
  DELETED=$((DELETED + 1))
  echo "[ROTATE] Supprimé : $(basename "$old_file")"
done < <(find "$BACKUP_DIR" -maxdepth 1 -name "pathelix_*.sql.gz" \
           -mtime +"$BACKUP_KEEP" -print0)

echo "[INFO] Rotation : ${DELETED} fichier(s) supprimé(s)"

# ─── Vérification intégrité (test décompression partielle) ───────────────────

if gzip -t "$BACKUP_PATH" 2>/dev/null; then
  echo "[OK] Intégrité vérifiée : ${FILENAME}"
else
  echo "[WARN] Intégrité suspecte : ${FILENAME} — vérifiez manuellement" >&2
fi

# ─── Résumé ───────────────────────────────────────────────────────────────────

TOTAL_BACKUPS="$(find "$BACKUP_DIR" -maxdepth 1 -name "pathelix_*.sql.gz" | wc -l)"
TOTAL_SIZE="$(du -sh "$BACKUP_DIR" | cut -f1)"

echo "[INFO] Total : ${TOTAL_BACKUPS} backup(s) conservé(s) — ${TOTAL_SIZE} sur disque"
echo "[INFO] $(date -Iseconds) — Backup terminé avec succès"
