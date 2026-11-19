#!/bin/sh
# Wird vom migrate-Service bei jedem Stack-Start einmal ausgeführt und beendet
# sich. Die App startet erst, wenn dieses Skript mit Code 0 durchgelaufen ist.
# Mehrfaches Ausführen ist unschädlich (idempotent).
set -eu

PRISMA="node_modules/.bin/prisma"
SCHEMA="prisma/schema.prisma"

probe() {
  echo "SELECT 1" | $PRISMA db execute --stdin --schema "$SCHEMA"
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
#                (angelegt per `db push`). Das Schema wird direkt angewendet,
#                aber nur, wenn die Änderung rein ergänzend ist (neue Tabellen,
#                Spalten, Indizes, Enum-Werte). Alles andere wird verweigert,
#                außer MIGRATE_ALLOW_DATA_LOSS=true ist ausdrücklich gesetzt.
#                Dauerhafte Lösung: Baselining (README).
if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  STATE="$(node docker/db-state.mjs)"
else
  STATE="no-migrations"
fi

legacy_push() {
  echo "[migrate] Datenbank ohne Migrationshistorie ($STATE)."
  echo "[migrate] Hinweis: Umstellung auf Migrationen siehe README (Baselining)."

  DIFF="$(mktemp)"
  $PRISMA migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$SCHEMA" --script >"$DIFF"

  if UNSAFE="$(node docker/schema-diff-check.mjs <"$DIFF")"; then
    echo "[migrate] Änderung ist rein ergänzend — Schema wird angewendet."
    # Ohne --accept-data-loss: Prisma bricht zusätzlich selbst ab, falls es
    # doch Datenverlust erkennt.
    $PRISMA db push --skip-generate
    rm -f "$DIFF"
    return
  fi

  if [ "${MIGRATE_ALLOW_DATA_LOSS:-false}" = "true" ]; then
    echo "[migrate] WARNUNG: Nicht ergänzende Schemaänderung, MIGRATE_ALLOW_DATA_LOSS=true ist gesetzt:"
    echo "$UNSAFE"
    echo "[migrate] Wird angewendet — Daten in betroffenen Spalten/Tabellen gehen verloren."
    $PRISMA db push --skip-generate --accept-data-loss
    rm -f "$DIFF"
    return
  fi

  cat <<EOF
[migrate] ABBRUCH: Die Schemaänderung ist nicht rein ergänzend und könnte
[migrate] Daten löschen oder umwandeln. Betroffene Anweisungen:
$UNSAFE
[migrate]
[migrate] Es wurde nichts verändert. Die App startet nicht, bis das geklärt ist.
[migrate] Möglichkeiten:
[migrate]   1. Sicherung prüfen (\${DATA_ROOT}/backups, wird vor jedem Start
[migrate]      angelegt) und auf Migrationen umstellen (README, "Baselining").
[migrate]   2. Wenn der Verlust gewollt ist: Stack-Variable
[migrate]      MIGRATE_ALLOW_DATA_LOSS=true setzen, Stack neu starten und die
[migrate]      Variable danach wieder entfernen.
EOF
  rm -f "$DIFF"
  exit 3
}

case "$STATE" in
  migrations|empty)
    echo "[migrate] Migrationen anwenden ($STATE)…"
    $PRISMA migrate deploy
    ;;
  pushed|no-migrations)
    legacy_push
    ;;
  *)
    echo "[migrate] Unbekannter Datenbankzustand: $STATE"
    exit 1
    ;;
esac

# Idempotent: legt den Admin aus INITIAL_ADMIN_EMAIL an bzw. hebt ihn auf ADMIN.
if [ -n "${INITIAL_ADMIN_EMAIL:-}" ]; then
  echo "[migrate] Admin sicherstellen: $INITIAL_ADMIN_EMAIL"
  node docker/seed-admin.mjs
fi

echo "[migrate] Fertig."
