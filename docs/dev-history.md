# Entwicklungsgeschichte: frühere Stände und Umstiege

Die Versionsgeschichte selbst steht in Git (`git log`). Diese Datei erklärt
nur Zusammenhänge für Leute mit **alten Installationen**: was es früher gab,
wie man von dort auf den heutigen Stand kommt, und warum manche Meldungen
noch auftauchen können. Für eine aktuelle Installation ist hier nichts nötig
— Betrieb und Updates stehen in der [README](../README.md#betrieb-auf-der-nas-portainer).

Nach Thema, jeweils mit dem Datum, bis zu dem der alte Stand galt.

## Bilder

### MinIO-Bucket statt Medienordner (bis 17.11.2026)

Frühere Versionen legten die Bilder in einem MinIO-Bucket ab. Heute liegen
sie als gewöhnliche Dateien unter `MEDIA_DIR`. Die Schlüssel sind
unverändert, die Dateien müssen nur einmal aus dem Bucket in den
Medienordner kopiert werden. MinIOs Datenordner (z.B. `data/dev-minio`)
enthält keine normalen Dateien — kopiert wird deshalb über den noch laufenden
MinIO-Container (Namen mit `docker ps` ermitteln; Zugangsdaten und Bucket wie
damals in der `.env`, lokal `minioadmin`/`familytree`):

```bash
C=familiy-tree-storage-1           # Name des MinIO-Containers
docker exec $C sh -c 'mc alias set alt http://localhost:9000 minioadmin minioadmin >/dev/null &&
  rm -rf /tmp/media-export && mc mirror alt/familytree /tmp/media-export'
mkdir -p data/media
docker cp $C:/tmp/media-export/. data/media/
docker exec $C rm -rf /tmp/media-export
```

Zur Kontrolle muss die Zahl der Dateien unter `data/media` zur Zahl der
Schlüssel in der Datenbank passen
(`SELECT count(*) + count("thumbnailKey") FROM "MediaAsset";`). Danach werden
Container und `data/dev-minio` nicht mehr gebraucht; `docker compose up`
meldet den Container bis dahin als verwaist („orphan“).

## KI-Zugang

### Profil `db-access` für einen MCP-Server am PC (bis 17.11.2026)

Früher lief der MCP-Server auf dem PC und brauchte dafür einen
Datenbankzugang aus dem Stack (Profil `db-access`). Heute läuft der
KI-Zugang in der App unter `/api/mcp` mit persönlichem Schlüssel. Wer das
Profil eingeschaltet hatte: `db-access` aus `COMPOSE_PROFILES` und
`DB_ACCESS_*` aus den Stack-Variablen streichen. Der Dienst existiert nicht
mehr; ein verbliebener Eintrag schadet nicht, startet aber auch nichts.

## Betrieb

### Zwei Images mit eigenem `migrate`-Dienst (bis 19.11.2026)

Früher wendete ein eigener `migrate`-Dienst (zweites Image) die Migrationen
an; heute macht das der App-Container beim Start. Beim Umstieg hat die
Datenbank bereits ihre Migrationshistorie; die neue App meldet beim ersten
Start „No pending migrations to apply.“ (lokal nachgeprüft). Der alte,
beendete Container `familytree-migrate-1` bleibt „verwaist“ liegen (Compose
warnt „Found orphan containers“), stört nicht und kann in Portainer unter
*Containers* gelöscht werden.

### Privates Image mit Registry-Zugang (bis 19.11.2026)

Heute ist das Paket auf ghcr.io öffentlich, und Portainer lädt es ohne
Anmeldung (README, „Erste Installation“, Schritt 2). Wer das Paket privat
hält, braucht in Portainer ein Token (classic) mit nur `read:packages` —
*fine-grained* Tokens unterstützt die Container-Registry laut GitHub-Doku
nicht (geprüft November 2026) — und unter *Registries → Add registry →
Custom registry* einen Eintrag mit *Registry URL* `ghcr.io`,
*Authentication* an, GitHub-Benutzername und Token als Passwort; Portainer
nutzt ihn für alle `ghcr.io/…`-Images (nicht auf der NAS ausprobiert). Das
Token läuft ab: laufende Container bleiben davon unberührt, aber jedes
folgende Update scheitert am Laden (`denied`/`unauthorized`) und der Stack
bleibt still auf dem alten Stand — Ablaufdatum in den Kalender, rechtzeitig
erneuern.

## Datenbank

### Baselining einer `db push`-Datenbank (bis 17.11.2026)

Vor der ersten Migration (`0_init`) wurde das Schema per `prisma db push`
angelegt. Eine solche Datenbank hat Tabellen, aber keine Migrationshistorie;
der App-Container bricht dann beim Start ab (`[start] FEHLER: Die Datenbank
enthält bereits Tabellen, aber keine Migrationshistorie …`, Prisma-Fehler
P3005) und verändert nichts. Im Betrieb gibt es eine solche Installation
nicht mehr. Dasselbe gilt aber für eine lokal mit `npm run db:push`
angelegte Datenbank, die man mit dem Produktiv-Image betreiben will.

Abhilfe: einmalig auf Migrationen umstellen (Baselining) — **vorher
sichern**. Lokal mit Repo-Kopie und `DATABASE_URL`:

```bash
# 1. Prüfen, dass die Datenbank exakt dem Schema entspricht
#    (Ausgabe muss "This is an empty migration." sein — sonst erst
#    "npx prisma db push" für den aktuellen Stand):
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script

# 2. Alle vorhandenen Migrationen als bereits angewendet markieren —
#    je Ordner unter prisma/migrations einmal, in dieser Reihenfolge:
for m in $(ls prisma/migrations | grep -v migration_lock.toml); do
  npx prisma migrate resolve --applied "$m"
done
```

Auf der NAS (SSH, Stack `familytree`) geht Schritt 2 mit dem App-Image
(Schritt 1 braucht das volle Prisma-CLI mit Repo-Kopie und ist dort nicht
vorgesehen):

```sh
docker run --rm --network familytree_default -e RUN_MIGRATIONS=false \
  -e DATABASE_URL='postgresql://familytree:<POSTGRES_PASSWORD>@db:5432/familytree' \
  ghcr.io/soschlegel/familiy-tree:latest prisma migrate resolve --applied 0_init
# … ebenso für jede weitere Migration (Liste: README, „Schema und Migrationen“)
```

Danach startet die App normal.
