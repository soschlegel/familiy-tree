#!/bin/sh
# Sichert Datenbank und Bilder in ${DATA_ROOT}/backups.
#
# Auf der NAS als geplante Aufgabe eintragen, z.B. täglich um 03:00:
#   /volume1/docker/familytree/repo/scripts/backup.sh
#
# Die Bilddateien liegen bereits unter ${DATA_ROOT}/minio und werden vom
# NAS-Backup miterfasst — der mc-Mirror hier erzeugt zusätzlich eine
# konsistente, unmittelbar lesbare Kopie ohne MinIO-interne Struktur.
set -eu

DATA_ROOT="${DATA_ROOT:-./data}"
STAMP="$(date +%Y-%m-%d_%H%M)"
DEST="${DATA_ROOT}/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

mkdir -p "$DEST"

echo "[backup] Datenbank -> ${DEST}/db_${STAMP}.sql.gz"
docker compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-familytree}" \
  -d "${POSTGRES_DB:-familytree}" \
  | gzip > "${DEST}/db_${STAMP}.sql.gz"

echo "[backup] Bilder -> ${DEST}/media"
docker compose run --rm backup

echo "[backup] Alte Sicherungen (> ${KEEP_DAYS} Tage) entfernen"
find "$DEST" -name 'db_*.sql.gz' -mtime "+${KEEP_DAYS}" -delete

echo "[backup] Fertig."
