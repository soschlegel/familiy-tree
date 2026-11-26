# Schema und Migrationen

Das Schema liegt in `prisma/schema.prisma`, die Migrationen in
`prisma/migrations`. Die **Liste aller Migrationen** und die
**Migrationsregeln** (nur per `npm run db:migrate`, rein ergänzend, Prüfung
mit `node docker/schema-diff-check.mjs`, veröffentlichte nie ändern) stehen
in [datenmodell.md](../komponenten/datenmodell.md#migrationen-prismamigrations).
Hier geht es darum, was im Betrieb passiert.

**Im Betrieb** wendet der App-Container beim Start `prisma migrate deploy`
an ([docker/entrypoint.sh](../../docker/entrypoint.sh)) — der einzige Weg, auf dem
sich das Produktivschema ändert:

| Zustand der Datenbank | Ergebnis |
|---|---|
| leer (Neuinstallation) | alle Migrationen werden angewendet |
| mit Migrationshistorie | fehlende Migrationen werden angewendet, sonst „No pending migrations to apply.“ |
| Tabellen, aber keine Historie (früher per `db push` angelegt) | **Abbruch**, nichts wird verändert, die App startet nicht; Log: `[start] FEHLER: Die Datenbank enthält bereits Tabellen, aber keine Migrationshistorie …` (Prisma-Fehler P3005) |

Mehrere App-Container gleichzeitig (z.B. versehentlich zwei Stacks auf
derselben Datenbank) sind beim Migrieren unkritisch: Prisma nimmt für
`migrate deploy` eine Sperre in PostgreSQL (Advisory Lock), der zweite wartet
und findet danach nichts mehr einzuspielen.

Eine Datenbank aus der Zeit vor den Migrationen (per `db push` angelegt)
gibt es im Betrieb nicht. Stößt man doch auf eine — oder will eine lokal
mit `npm run db:push` angelegte Datenbank mit dem Produktiv-Image
betreiben —, muss sie einmalig auf Migrationen umgestellt werden
(Baselining, **vorher sichern**): Anleitung in
[docs/dev-history.md](../dev-history.md#baselining-einer-db-push-datenbank-bis-17112026).

**Prisma-CLI im Image:** Das Image enthält nur das Paket `prisma` mit seinen
Abhängigkeiten in den Versionen aus `package-lock.json` (unter
`/opt/prisma-cli`, aufgerufen über `prisma`, siehe
[docker/prisma.sh](../../docker/prisma.sh)), ohne Query-Engine, Client-Vorlage und
WebAssembly-Engines — die Schema-Engine (Binärdatei für linux-musl) bleibt.
Nach einem Prisma-Update deshalb einmal prüfen, bevor es auf die NAS geht:

```bash
docker build -t familytree-local/app:dev .
# ohne Netz: Schema Engine muss gefunden werden, kein Download-Versuch
docker run --rm --network none --entrypoint prisma familytree-local/app:dev --version
# dann den Stack lokal mit docker-compose.build.yml starten; im Log von app:
# "All migrations have been successfully applied." bzw. "No pending migrations"
```
