# syntax=docker/dockerfile:1

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
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
# Migrator — läuft einmal beim Stack-Start und beendet sich wieder.
#
# Bewusst ein eigenes Image mit vollständigen node_modules: der Prisma-CLI hat
# transitive Abhängigkeiten, die sich nicht verlässlich in das schlanke
# Runner-Image herauspicken lassen. Das Laufzeit-Image bleibt so klein.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS migrator
WORKDIR /app
ENV NODE_ENV=production
# Kein "Update available"-Kasten im Log; Prisma-Updates laufen über package.json.
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
RUN apk add --no-cache libc6-compat
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY docker/seed-admin.mjs docker/db-state.mjs docker/schema-diff-check.mjs docker/tcp-forward.mjs ./docker/
COPY docker/migrate.sh /migrate.sh
# sed: falls das Skript unter Windows mit CRLF ausgecheckt wurde.
RUN sed -i 's/\r$//' /migrate.sh && chmod +x /migrate.sh
CMD ["/migrate.sh"]

# ---------------------------------------------------------------------------
# Runner — nur die Anwendung, kein Migrationswerkzeug.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
