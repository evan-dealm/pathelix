#!/usr/bin/env bash
# ─── backup-pg.sh — Sauvegarde PostgreSQL rotative ────────────────────────────
#
# Usage :
#   ./scripts/backup-pg.sh
#
# Configuration (variables d'environnement ; une variable déjà définie l'emporte sur .env) :
#   DATABASE_URL  — base à sauvegarder (requis)
#   BACKUP_DIR    — répertoire des sauvegardes (défaut : /var/backups/pathelix)
#   BACKUP_KEEP   — jours de conservation (défaut : 7)
#   PG_CONTAINER  — conteneur PostgreSQL dans lequel lancer pg_dump. Par défaut : pg_dump de
#                   l'hôte s'il est installé, sinon le service `postgres` de docker compose.
#
# Cron quotidien à 02:00 :
#   0 2 * * * /opt/pathelix/scripts/backup-pg.sh >> /var/log/pathelix-backup.log 2>&1
#
# Fichier produit : pathelix_AAAA-MM-JJ_HHMM.dump (format « custom » de pg_dump, compressé).
# Le fichier n'apparaît sous ce nom qu'une fois le dump terminé ET relu par pg_restore :
# un dump interrompu ne laisse jamais un fichier qui ressemble à une sauvegarde.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/pg-common.sh
source "$SCRIPT_DIR/pg-common.sh"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pathelix}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
FILENAME="pathelix_$(date +%Y-%m-%d_%H%M).dump"
BACKUP_PATH="${BACKUP_DIR}/${FILENAME}"
PARTIAL="${BACKUP_PATH}.partial"

pg_load_target
pg_pick_runner

echo "[INFO] $(date -Iseconds) — Sauvegarde de ${DB_NAME} (${PG_WHERE})"
echo "[INFO] Destination : ${BACKUP_PATH}"

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR" 2>/dev/null || true
trap 'rm -f "$PARTIAL"' EXIT

if ! pg_run pg_dump $(pg_conn_args "$DB_NAME") --format=custom --no-owner --no-privileges > "$PARTIAL"; then
  echo "[ERROR] pg_dump a échoué — aucune sauvegarde créée" >&2
  exit 2
fi

# Relecture complète de la table des matières : détecte un fichier tronqué ou illisible.
OBJECTS="$(pg_run pg_restore --list < "$PARTIAL" | grep -c 'TABLE DATA' || true)"
if [[ ! -s "$PARTIAL" || "${OBJECTS:-0}" -eq 0 ]]; then
  echo "[ERROR] Sauvegarde illisible ou vide (aucune table) — abandonnée" >&2
  exit 2
fi

mv "$PARTIAL" "$BACKUP_PATH"
echo "[OK] ${FILENAME} — $(du -sh "$BACKUP_PATH" | cut -f1), ${OBJECTS} tables"

# ─── Rotation (les anciens .sql.gz de la version précédente du script suivent la même règle) ──
DELETED=0
while IFS= read -r -d '' old_file; do
  rm -f "$old_file"
  DELETED=$((DELETED + 1))
  echo "[ROTATE] Supprimé : $(basename "$old_file")"
done < <(find "$BACKUP_DIR" -maxdepth 1 \( -name 'pathelix_*.dump' -o -name 'pathelix_*.sql.gz' \) -mtime +"$BACKUP_KEEP" -print0)

TOTAL="$(find "$BACKUP_DIR" -maxdepth 1 \( -name 'pathelix_*.dump' -o -name 'pathelix_*.sql.gz' \) | wc -l)"
echo "[INFO] Rotation : ${DELETED} supprimé(s), ${TOTAL} sauvegarde(s) conservée(s)"
echo "[INFO] $(date -Iseconds) — Terminé"
