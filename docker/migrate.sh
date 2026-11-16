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

# Drei Fälle (siehe README, Abschnitt "Schema und Migrationen"):
#
#   migrations — die Datenbank wird über prisma/migrations verwaltet:
#                `migrate deploy` spielt fehlende Migrationen ein.
#   empty      — Neuinstallation: ebenfalls `migrate deploy`, damit die
#                Datenbank von Anfang an eine Migrationshistorie hat.
#   pushed     — bestehende Installation aus der Zeit vor den Migrationen
#                (angelegt per `db push`). Verhalten bleibt wie bisher:
#                Schema direkt anwenden. Umstellen erst nach bewusstem
#                Baselining (`prisma migrate resolve --applied 0_init`).
STATE="empty"
if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  STATE="$(node docker/db-state.mjs)"
else
  STATE="no-migrations"
fi

case "$STATE" in
  migrations|empty)
    echo "[migrate] Migrationen anwenden ($STATE)…"
    $PRISMA migrate deploy
    ;;
  *)
    echo "[migrate] Datenbank ohne Migrationshistorie ($STATE) — Schema wird direkt angewendet."
    echo "[migrate] Hinweis: Umstellung auf Migrationen siehe README (Baselining)."
    $PRISMA db push --skip-generate --accept-data-loss
    ;;
esac

# Idempotent: legt den Admin aus INITIAL_ADMIN_EMAIL an bzw. hebt ihn auf ADMIN.
if [ -n "$INITIAL_ADMIN_EMAIL" ]; then
  echo "[migrate] Admin sicherstellen: $INITIAL_ADMIN_EMAIL"
  node docker/seed-admin.mjs
fi

echo "[migrate] Fertig."
