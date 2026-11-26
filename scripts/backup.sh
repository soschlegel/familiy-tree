#!/bin/sh
# Löst die Datenbanksicherung im laufenden Produktivstack aus: Dump nach
# ${DATA_ROOT}/backups (siehe docs/betrieb/sicherung.md).
#
#   ./scripts/backup.sh [Stackname]      (Standard: familytree)
#
# Die eigentliche Arbeit macht der Stack-Dienst backup-db; dieses Skript
# startet nur dessen (bereits vorhandenen) Container erneut. Es braucht
# deshalb weder eine Repo-Kopie noch docker compose auf der NAS — im
# Synology-Aufgabenplaner genügt derselbe Einzeiler:
#
#   docker start -a familytree-backup-db-1
#
# Die Bilder (${DATA_ROOT}/media) sind gewöhnliche Dateien und brauchen
# keinen eigenen Schritt — sie gehören direkt in die NAS-Sicherung.
set -eu

PROJECT="${1:-${STACK_NAME:-familytree}}"
SERVICE=backup-db

id="$(docker ps -aq \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=${SERVICE}" | head -n 1)"

if [ -z "$id" ]; then
  echo "[backup] Kein Container für ${SERVICE} im Stack '${PROJECT}' gefunden." >&2
  echo "[backup] Stackname prüfen (Portainer: Stacks) oder Stack einmal deployen." >&2
  exit 1
fi

echo "[backup] ${SERVICE} …"
docker start -a "$id"
code="$(docker inspect -f '{{.State.ExitCode}}' "$id")"
if [ "$code" != "0" ]; then
  echo "[backup] ${SERVICE} ist mit Code ${code} fehlgeschlagen." >&2
  exit 1
fi

echo "[backup] Fertig."
