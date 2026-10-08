#!/usr/bin/env bash
# ─── backup-all.sh — Sauvegarde complète : base + fichiers, chiffrée, copiée hors serveur ───
#
# Usage (cron quotidien, après la purge de 02:00) :
#   30 2 * * * cd /opt/pathelix && ./scripts/backup-all.sh >> /var/log/pathelix-backup.log 2>&1
#
# Étapes — la première qui échoue arrête tout, déclenche l'alerte et renvoie un code non nul :
#   1. base PostgreSQL            → scripts/backup-pg.sh (dump relu avant d'être accepté)
#   2. fichiers (photos, signatures, justificatifs) → archive tar.gz du volume d'uploads
#      (sautée si STORAGE_DRIVER=s3 : les fichiers sont déjà dans le stockage objet — y activer
#      le versionnage du bucket) ;
#   3. chiffrement des deux fichiers (AES-256, phrase secrète lue dans un fichier) ;
#   4. copie hors serveur (rclone) ;
#   5. rotation locale, puis signal « sauvegarde réussie ».
#
# Configuration (variables d'environnement ; une variable déjà définie l'emporte sur .env) :
#   BACKUP_DIR              répertoire local (défaut /var/backups/pathelix)
#   BACKUP_KEEP             jours de conservation locale (défaut 7)
#   UPLOADS_VOLUME          volume Docker des fichiers (défaut : <projet>_photo_storage)
#   UPLOADS_DIR             ou répertoire des fichiers sur l'hôte (prioritaire sur le volume)
#   STORAGE_DRIVER          « s3 » : pas d'archive de fichiers
#   BACKUP_PASSPHRASE_FILE  fichier contenant la phrase secrète (chmod 600). Sans lui, pas de
#                           chiffrement — et la copie hors serveur est alors REFUSÉE, sauf
#                           BACKUP_ALLOW_PLAINTEXT_OFFSITE=true.
#   BACKUP_RCLONE_REMOTE    destination rclone, ex. « ovh-s3:pathelix-backups/prod »
#   BACKUP_ALERT_URL        URL appelée en POST (JSON) en cas d'échec (webhook de messagerie…)
#   BACKUP_HEARTBEAT_URL    URL appelée en GET en cas de succès (surveillance « homme mort » :
#                           l'absence de signal pendant 26 h doit déclencher une alerte)
#
# Restauration : voir DEPLOYMENT_OVH.md (§ Sauvegardes) — déchiffrer, puis scripts/restore-pg.sh
# pour la base et « tar -xzf » dans le volume pour les fichiers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Variables de .env.production / .env que l'appelant n'a pas déjà définies (lignes simples NOM=valeur).
for env_file in "$PROJECT_DIR/.env.production" "$PROJECT_DIR/.env"; do
  [[ -f "$env_file" ]] || continue
  while IFS='=' read -r name value; do
    [[ "$name" =~ ^(BACKUP_[A-Z_]+|UPLOADS_[A-Z_]+|STORAGE_DRIVER)$ ]] || continue
    [[ -n "${!name:-}" ]] && continue
    value="${value%\"}"; value="${value#\"}"
    export "$name=$value"
  done < "$env_file"
done

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pathelix}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
STAMP="$(date +%Y-%m-%d_%H%M)"
export BACKUP_DIR BACKUP_KEEP

STEP="démarrage"
alert() {
  local code=$?
  echo "[ERROR] $(date -Iseconds) — sauvegarde ÉCHOUÉE à l'étape « ${STEP} » (code ${code})" >&2
  if [[ -n "${BACKUP_ALERT_URL:-}" ]]; then
    curl -fsS -m 15 -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"Pathélix : sauvegarde ÉCHOUÉE sur $(hostname) à l'étape ${STEP} (code ${code})\"}" \
      "$BACKUP_ALERT_URL" >/dev/null 2>&1 || echo "[WARN] alerte non envoyée" >&2
  fi
  exit "$code"
}
trap alert ERR

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR" 2>/dev/null || true
PRODUCED=()

# ─── 1. Base ──────────────────────────────────────────────────────────────────
STEP="base PostgreSQL"
BEFORE="$(ls -1 "$BACKUP_DIR"/pathelix_*.dump 2>/dev/null | sort || true)"
"$SCRIPT_DIR/backup-pg.sh"
DUMP="$(comm -13 <(echo "$BEFORE") <(ls -1 "$BACKUP_DIR"/pathelix_*.dump | sort) | tail -1)"
[[ -s "$DUMP" ]] || { echo "[ERROR] dump introuvable après backup-pg.sh" >&2; false; }
PRODUCED+=("$DUMP")

# ─── 2. Fichiers ──────────────────────────────────────────────────────────────
STEP="fichiers"
FILES_ARCHIVE="${BACKUP_DIR}/pathelix_files_${STAMP}.tar.gz"
if [[ "${STORAGE_DRIVER:-local}" == "s3" ]]; then
  echo "[INFO] STORAGE_DRIVER=s3 — fichiers dans le stockage objet, pas d'archive locale"
elif [[ -n "${UPLOADS_DIR:-}" ]]; then
  tar -czf "${FILES_ARCHIVE}.partial" -C "$UPLOADS_DIR" .
  mv "${FILES_ARCHIVE}.partial" "$FILES_ARCHIVE"
  PRODUCED+=("$FILES_ARCHIVE")
else
  VOLUME="${UPLOADS_VOLUME:-$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')_photo_storage}"
  if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    # Volume monté en lecture seule : la sauvegarde ne peut rien modifier ni supprimer.
    docker run --rm -v "${VOLUME}:/data:ro" alpine:3 tar -czf - -C /data . > "${FILES_ARCHIVE}.partial"
    mv "${FILES_ARCHIVE}.partial" "$FILES_ARCHIVE"
    PRODUCED+=("$FILES_ARCHIVE")
  else
    echo "[ERROR] volume de fichiers « ${VOLUME} » introuvable (définir UPLOADS_VOLUME ou UPLOADS_DIR)" >&2
    false
  fi
fi
if [[ -f "$FILES_ARCHIVE" ]]; then
  # Une archive illisible n'est pas une sauvegarde.
  ENTRIES="$(tar -tzf "$FILES_ARCHIVE" | wc -l)"
  echo "[OK] $(basename "$FILES_ARCHIVE") — $(du -sh "$FILES_ARCHIVE" | cut -f1), ${ENTRIES} entrées"
fi

# ─── 3. Chiffrement ───────────────────────────────────────────────────────────
STEP="chiffrement"
ENCRYPTED=false
if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then
  [[ -s "$BACKUP_PASSPHRASE_FILE" ]] || { echo "[ERROR] BACKUP_PASSPHRASE_FILE vide ou illisible" >&2; false; }
  for i in "${!PRODUCED[@]}"; do
    plain="${PRODUCED[$i]}"
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:${BACKUP_PASSPHRASE_FILE}" -in "$plain" -out "${plain}.enc.partial"
    # Relecture : le fichier chiffré redonne exactement l'original.
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:${BACKUP_PASSPHRASE_FILE}" -in "${plain}.enc.partial" | cmp -s - "$plain"; then
      echo "[ERROR] vérification du chiffrement échouée pour $(basename "$plain")" >&2
      rm -f "${plain}.enc.partial"
      false
    fi
    mv "${plain}.enc.partial" "${plain}.enc"
    rm -f "$plain"
    PRODUCED[$i]="${plain}.enc"
  done
  ENCRYPTED=true
  echo "[OK] ${#PRODUCED[@]} fichier(s) chiffré(s) (AES-256, PBKDF2)"
else
  echo "[WARN] BACKUP_PASSPHRASE_FILE non défini — sauvegardes NON chiffrées"
fi
for f in "${PRODUCED[@]}"; do (cd "$(dirname "$f")" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256"); done

# ─── 4. Copie hors serveur ────────────────────────────────────────────────────
STEP="copie hors serveur"
if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  if [[ "$ENCRYPTED" != true && "${BACKUP_ALLOW_PLAINTEXT_OFFSITE:-false}" != true ]]; then
    echo "[ERROR] copie hors serveur refusée : les sauvegardes ne sont pas chiffrées (BACKUP_PASSPHRASE_FILE)" >&2
    false
  fi
  for f in "${PRODUCED[@]}"; do
    rclone copy --no-traverse "$f" "$BACKUP_RCLONE_REMOTE/"
    rclone copy --no-traverse "${f}.sha256" "$BACKUP_RCLONE_REMOTE/"
  done
  # La copie distante est comparée à l'original (taille et empreinte).
  for f in "${PRODUCED[@]}"; do
    rclone check --one-way --include "$(basename "$f")" "$(dirname "$f")" "$BACKUP_RCLONE_REMOTE/" >/dev/null
  done
  echo "[OK] copié et vérifié sur ${BACKUP_RCLONE_REMOTE}"
else
  echo "[WARN] BACKUP_RCLONE_REMOTE non défini — AUCUNE copie hors serveur (une panne du disque emporte les sauvegardes)"
fi

# ─── 5. Rotation locale (les dumps .dump sont gérés par backup-pg.sh) ─────────
STEP="rotation"
find "$BACKUP_DIR" -maxdepth 1 \( -name 'pathelix_files_*.tar.gz*' -o -name 'pathelix_*.dump.enc' -o -name 'pathelix_*.sha256' \) -mtime +"$BACKUP_KEEP" -print -delete | sed 's/^/[ROTATE] /' || true

trap - ERR
if [[ -n "${BACKUP_HEARTBEAT_URL:-}" ]]; then
  curl -fsS -m 15 "$BACKUP_HEARTBEAT_URL" >/dev/null 2>&1 || echo "[WARN] signal de succès non envoyé" >&2
fi
echo "[INFO] $(date -Iseconds) — sauvegarde complète terminée : ${PRODUCED[*]}"
