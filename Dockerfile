# syntax=docker/dockerfile:1

# Ein einziges Image: Anwendung plus das, was sie beim Start für die
# Datenbank braucht (Migrationen, Admin). Ablauf beim Containerstart:
# docker/entrypoint.sh.

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL wird zur Buildzeit nur von `prisma generate` gelesen, nicht
# verbunden — ein Platzhalter genügt.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
# Build-Angabe für die Fußzeile („Build 2026.11.19 · 68c8471“), von der
# GitHub-Action übergeben (JJJJ.MM.TT und Commit). Next.js setzt
# NEXT_PUBLIC_* beim Build fest ein; leer = „Build lokal“ (lib/build-info.ts).
# Erst hier deklariert, damit die Stufen davor im Cache bleiben.
ARG BUILD_DATE=""
ARG BUILD_SHA=""
ENV NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE NEXT_PUBLIC_BUILD_SHA=$BUILD_SHA
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
# Prisma-CLI für `prisma migrate deploy` — nur das Paket `prisma` und seine
# Abhängigkeiten (gut 30 Ordner statt der kompletten node_modules), in genau
# den Versionen aus package-lock.json, wie `npm ci` sie in der deps-Stufe
# installiert hat. Die Schema-Engine (Rust-Binärdatei, von `migrate deploy`
# gebraucht) hat der postinstall von @prisma/engines dort schon für
# linux-musl geladen.
#
# Entfernt wird, was `migrate deploy`/`migrate resolve`/`db execute` nicht
# brauchen (zusammen ~85 MB):
#   - Query-Engine (2 Kopien): das CLI bekommt über PRISMA_QUERY_ENGINE_LIBRARY
#     die aus dem Next-Standalone-Bundle (docker/prisma.sh). Ohne diese Variable
#     würde das CLI versuchen, die fehlende Engine herunterzuladen.
#   - prisma-client (Vorlage für `prisma generate`), WebAssembly-Query-Engines
#     und -Compiler (Studio, Driver-Adapter), Quelltexte und Typdateien
#     von effect.
# Nach einem Prisma-Update die Prüfschritte aus
# docs/betrieb/migrationen.md ("Prisma-CLI im Image") wiederholen.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prisma-cli
WORKDIR /src
COPY --from=deps /app/node_modules ./node_modules
COPY package-lock.json docker/prisma-cli-closure.mjs ./
RUN for dir in $(node prisma-cli-closure.mjs package-lock.json); do \
      mkdir -p "$(dirname "/opt/prisma-cli/$dir")" && cp -a "$dir" "/opt/prisma-cli/$dir"; \
    done \
 && cd /opt/prisma-cli/node_modules \
 && test -x @prisma/engines/schema-engine-linux-musl-openssl-3.0.x \
 && rm -rf @prisma/engines/libquery_engine-* prisma/libquery_engine-* \
           prisma/prisma-client prisma/build/query_engine_bg.* prisma/build/query_compiler_bg.* \
           effect/src \
 && find . \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete

# ---------------------------------------------------------------------------
# Laufzeit-Image
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma-CLI: kein "Update available"-Kasten, keine Telemetrie-Anfrage.
ENV PRISMA_HIDE_UPDATE_MESSAGE=1 CHECKPOINT_DISABLE=1

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Bilderordner. Im Stack wird ${DATA_ROOT}/media darübergemountet (Rechte
# richtet dort der Dienst media-init ein); angelegt wird er hier, damit das
# Image auch ohne Mount startet und /api/health "ok" meldet — die Bilder
# liegen dann nur im Container und sind mit ihm weg.
# Bewusst kein VOLUME: das würde bei jedem Start ohne Mount stillschweigend
# ein anonymes Volume anlegen, das bei Updates nicht mitwandert und in
# keiner Sicherung auftaucht. Der Bind-Mount in docker-compose.yml ist der
# einzige vorgesehene Speicherort.
RUN mkdir -p /data/media && chown nextjs:nodejs /data/media
ENV MEDIA_DIR=/data/media

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Schema und Migrationen (gehören root, für die App nur lesbar), Prisma-CLI,
# Startskript. Kein `prisma generate` zur Laufzeit: der Client liegt fertig
# im Standalone-Bundle.
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli
COPY docker/seed-admin.mjs ./docker/seed-admin.mjs
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/prisma.sh /usr/local/bin/prisma
# sed: falls die Skripte unter Windows mit CRLF ausgecheckt wurden.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh /usr/local/bin/prisma \
 && chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
