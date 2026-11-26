#!/bin/sh
# Startskript des App-Containers (läuft als nextjs, uid 1001):
#
#   1. auf die Datenbank warten (höchstens DB_WAIT_SECONDS, Standard 60)
#   2. `prisma migrate deploy` — fehlende Migrationen aus prisma/migrations
#   3. INITIAL_ADMIN_EMAIL als Administrator sicherstellen (idempotent)
#   4. exec node server.js — Node ersetzt die Shell, SIGTERM von
#      `docker stop` kommt direkt bei ihm an
#
# Schlägt 1., 2. oder 3. fehl, beendet sich der Container mit Code 1 und die
# App startet NICHT — nie auf einem halb migrierten Schema. Die Sicherung vom
# Stack-Start (Dienst backup-db) liegt dann bereits in ${DATA_ROOT}/backups.
# Mit `restart: unless-stopped` startet Docker den Container erneut, mit
# wachsender Pause (bis etwa 1 Minute); eine als fehlgeschlagen vermerkte
# Migration wird dabei nicht erneut ausgeführt (docs/betrieb/fehlersuche.md).
#
# RUN_MIGRATIONS=false überspringt 1. bis 3. (nur zur Fehlersuche, docs/betrieb/fehlersuche.md).
set -e

log() { echo "[start] $*"; }
err() { echo "[start] $*" >&2; }

wait_for_db() {
  limit="${DB_WAIT_SECONDS:-60}"
  deadline=$(( $(date +%s) + limit ))
  log "Warte auf die Datenbank (höchstens ${limit}s)…"
  until echo "SELECT 1" | prisma db execute --stdin >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      err "FEHLER: Datenbank nach ${limit}s nicht erreichbar. Letzte Meldung:"
      echo "SELECT 1" | prisma db execute --stdin >&2 || true
      err "Prüfen: läuft der Dienst db, stimmen POSTGRES_PASSWORD, POSTGRES_USER und"
      err "POSTGRES_DB im Stack? Die App startet nicht."
      exit 1
    fi
    sleep 2
  done
}

migrate() {
  log "Migrationen anwenden (prisma migrate deploy)…"
  out="$(mktemp)"
  rcfile="$(mktemp)"
  # Ausgabe live ins Log und zugleich in eine Datei, um Fehlercodes zu erkennen.
  { prisma migrate deploy 2>&1; echo "$?" >"$rcfile"; } | tee "$out"
  rc="$(cat "$rcfile")"
  if [ "$rc" = "0" ]; then
    rm -f "$out" "$rcfile"
    return 0
  fi

  err "================================================================"
  if grep -q "P3005" "$out"; then
    err "FEHLER: Die Datenbank enthält bereits Tabellen, aber keine"
    err "Migrationshistorie (Tabelle _prisma_migrations fehlt). Sie wurde"
    err "vermutlich mit \`prisma db push\` angelegt (Installation aus der Zeit"
    err "vor den Migrationen). Dieses Image wendet nur Migrationen an und"
    err "verändert eine solche Datenbank nicht — es wurde nichts geändert."
    err "Abhilfe: Baselining (docs/dev-history.md, \"Baselining\") oder mit"
    err "leerem DATA_ROOT/postgres neu beginnen."
  elif grep -q -e "P3009" -e "P3018" "$out"; then
    err "FEHLER: Eine Migration ist fehlgeschlagen und in der Datenbank als"
    err "fehlgeschlagen vermerkt (Meldung oben). Weitere Migrationen werden"
    err "nicht angewendet, auch nicht bei einem Neustart."
    err "Abhilfe (docs/betrieb/fehlersuche.md): Sicherung vom Stack-Start aus"
    err "DATA_ROOT/backups zurückspielen, dann"
    err "  prisma migrate resolve --rolled-back <Migrationsname>"
    err "und ein Image mit korrigierter Migration einsetzen."
  else
    err "FEHLER: prisma migrate deploy ist fehlgeschlagen (Code $rc, Meldung oben)."
  fi
  err "Die App startet nicht."
  err "================================================================"
  rm -f "$out" "$rcfile"
  exit 1
}

if [ "${RUN_MIGRATIONS:-true}" = "false" ]; then
  log "RUN_MIGRATIONS=false — Datenbankprüfung, Migrationen und Admin werden übersprungen."
else
  wait_for_db
  migrate
  if [ -n "${INITIAL_ADMIN_EMAIL:-}" ]; then
    if ! node /app/docker/seed-admin.mjs; then
      err "FEHLER: Administrator ($INITIAL_ADMIN_EMAIL) konnte nicht angelegt werden. Die App startet nicht."
      exit 1
    fi
  fi
  log "Datenbank bereit, starte die App."
fi

exec "$@"
