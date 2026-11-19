#!/bin/sh
# Prisma-CLI im App-Image, als /usr/local/bin/prisma installiert. Für
# entrypoint.sh und für Handgriffe im Container, z.B.:
#
#   docker exec <stack>-app-1 prisma migrate status
#   docker run --rm ... -e RUN_MIGRATIONS=false <image> prisma migrate resolve --rolled-back <name>
#
# - Query-Engine: die aus dem Next-Standalone-Bundle (der CLI-Ordner enthält
#   keine eigene, siehe Dockerfile; ohne die Variable würde das CLI
#   versuchen, sie herunterzuladen).
# - Läuft aus /opt/prisma-cli, damit das CLI nicht die package.json der App
#   einliest (sonst eine Prisma-7-Warnung bei jedem Aufruf), und bekommt für
#   `migrate …` und `db …` das Schema des Images, falls --schema fehlt.
set -e

export PRISMA_QUERY_ENGINE_LIBRARY="${PRISMA_QUERY_ENGINE_LIBRARY:-/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node}"
cd /opt/prisma-cli

case "$1" in
  migrate|db)
    case " $* " in
      *" --schema"*) ;;
      *) set -- "$@" --schema /app/prisma/schema.prisma ;;
    esac
    ;;
esac

exec node /opt/prisma-cli/node_modules/prisma/build/index.js "$@"
