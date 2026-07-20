#!/bin/sh
# Wird vom migrate-Service einmal beim Stack-Start ausgeführt und beendet sich.
# Die App startet erst, wenn dieses Skript mit Code 0 durchgelaufen ist.
set -e

PRISMA="node_modules/.bin/prisma"

probe() {
  echo "SELECT 1" | $PRISMA db execute --stdin --schema prisma/schema.prisma
}

echo "[migrate] Warte auf die Datenbank…"
i=0
until probe >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "[migrate] Datenbank nach 120s nicht erreichbar. Letzte Ausgabe:"
    probe || true
    exit 1
  fi
  sleep 2
done

# migrate deploy, sobald Migrationen im Repo liegen; sonst das Schema direkt
# anwenden. So läuft der erste Start auch ohne generierte Migration durch.
if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[migrate] Migrationen anwenden…"
  $PRISMA migrate deploy
else
  echo "[migrate] Keine Migrationen gefunden — Schema wird direkt angewendet."
  $PRISMA db push --skip-generate --accept-data-loss
fi

# Idempotent: legt den Admin aus INITIAL_ADMIN_EMAIL an bzw. hebt ihn auf ADMIN.
if [ -n "$INITIAL_ADMIN_EMAIL" ]; then
  echo "[migrate] Admin sicherstellen: $INITIAL_ADMIN_EMAIL"
  node docker/seed-admin.mjs
fi

echo "[migrate] Fertig."
