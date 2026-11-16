#!/bin/sh
# Löst die Sicherung im laufenden Produktivstack aus: Datenbank-Dump und
# Bilder-Spiegel nach ${DATA_ROOT}/backups (siehe README, "Sicherung").
#
#   ./scripts/backup.sh [Stackname]      (Standard: familytree)
#
# Die eigentliche Arbeit machen die Stack-Dienste backup-db und backup-media;
# dieses Skript startet nur deren (bereits vorhandene) Container erneut. Es
# braucht deshalb weder eine Repo-Kopie noch docker compose auf der NAS — im
# Synology-Aufgabenplaner genügt derselbe Einzeiler:
#
#   docker start -a familytree-backup-db-1 && docker start -a familytree-backup-media-1
set -eu

PROJECT="${1:-${STACK_NAME:-familytree}}"

container() {
  docker ps -aq \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=$1" | head -n 1
}

for service in backup-db backup-media; do
  id="$(container "$service")"
  if [ -z "$id" ]; then
    echo "[backup] Kein Container für ${service} im Stack '${PROJECT}' gefunden." >&2
    echo "[backup] Stackname prüfen (Portainer: Stacks) oder Stack einmal deployen." >&2
    exit 1
  fi
  echo "[backup] ${service} …"
  docker start -a "$id"
  code="$(docker inspect -f '{{.State.ExitCode}}' "$id")"
  if [ "$code" != "0" ]; then
    echo "[backup] ${service} ist mit Code ${code} fehlgeschlagen." >&2
    exit 1
  fi
done

echo "[backup] Fertig."
