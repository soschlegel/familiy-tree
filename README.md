# Stammbaum

Webanwendung zur Pflege und Visualisierung eines Familienstammbaums mit
Bildarchiv und rollenbasierter Benutzerverwaltung.

## Funktionsumfang

- **Rollen** — Administrator, Bearbeiter, Betrachter
- **Zugang nur auf Einladung** — ein gültiges Google-/GitHub-Konto genügt
  nicht; die E-Mail muss vom Administrator freigeschaltet sein
- **Stammbaum** — Pan/Zoom-Ansicht, Suche, Partner nebeneinander, Adoptiv- und
  Stiefverhältnisse
- **Beziehungen mit Zeitraum** — Hochzeits- und Scheidungsdatum, Adoptionsdatum;
  nachträglich korrigierbar
- **Zuordnung per Suchfeld** — Tippen statt Drop-Down, mit Geburtsdatum zur
  Unterscheidung Gleichnamiger; unbekannte Personen lassen sich direkt aus dem
  Suchfeld anlegen
- **Zwei Ansichten** — nach Generationen oder als Zeitstrahl mit Jahresachse,
  bei dem früher Geborene weiter oben stehen und Hochzeiten als eigene
  Ereignisse einsortiert werden
- **Bilder** — Upload pro Person, frei wählbares Primärbild (erscheint im
  Stammbaum), eigene Bilder an Hochzeiten, automatische Vorschaubilder,
  Auslieferung nur an angemeldete Nutzer
- **Export und Import** — JSON oder ZIP inklusive Bilddateien, Import mit
  Vorschau und Zusammenführung
- **Änderungsprotokoll** — jede Mutation landet im `AuditLog`

## Technik

| Ebene | Wahl |
|---|---|
| Frontend + API | Next.js 15 (App Router), TypeScript, Tailwind |
| Datenbank | PostgreSQL 17 + Prisma |
| Anmeldung | Auth.js v5 (GitHub, Google, Dev-Login) |
| Bilder | MinIO (S3-kompatibel), sharp |
| Visualisierung | React Flow + d3-hierarchy |
| Betrieb | Docker Compose + Caddy |

## Lokal starten

```bash
cp .env.example .env      # AUTH_SECRET und INITIAL_ADMIN_EMAIL anpassen
npm install

docker compose -f docker-compose.dev.yml up -d   # Postgres + MinIO
npm run db:push                                   # Schema anlegen
npm run db:seed                                   # Admin + Demofamilie
npm run dev
```

→ http://localhost:3000

Ohne konfiguriertes OAuth greift der **Dev-Login** (`ENABLE_DEV_LOGIN=true`):
E-Mail eingeben, kein Passwort. Er funktioniert nur mit `NODE_ENV=development`
und nur für E-Mails, die bereits in der Benutzerliste stehen.

### OAuth lokal einrichten

Beide Anbieter erlauben `localhost` als Callback — echtes Testen geht also
ohne Deployment:

- **GitHub** — Settings → Developer settings → OAuth Apps → New.
  Callback: `http://localhost:3000/api/auth/callback/github`
- **Google** — Cloud Console → Credentials → OAuth client ID (Web).
  Redirect URI: `http://localhost:3000/api/auth/callback/google`

Client-ID und Secret in die `.env` eintragen, `npm run dev` neu starten.

## Betrieb auf der NAS (Portainer)

Alle persistenten Daten liegen als Bind-Mounts unter **einem** Pfad:

```
${DATA_ROOT}/
├── postgres/     Datenbank
├── minio/        Originalbilder + Vorschauen
├── caddy/        TLS-Zertifikate
└── backups/      pg_dump-Archive + Bild-Spiegel
```

Damit erfasst die NAS-Sicherungsaufgabe genau ein Verzeichnis.

**Einrichtung:**

1. In Portainer: *Stacks → Add stack → Repository*, dieses Repo eintragen.
2. Unter *Environment variables* setzen:

   | Variable | Beispiel |
   |---|---|
   | `DATA_ROOT` | `/volume1/docker/familytree` |
   | `POSTGRES_PASSWORD` | (langes Zufallspasswort) |
   | `S3_ACCESS_KEY` / `S3_SECRET_KEY` | (Zufallswerte) |
   | `AUTH_SECRET` | Ausgabe von `openssl rand -base64 32` |
   | `DOMAIN` | `stammbaum.example.de` |
   | `PUBLIC_URL` | `https://stammbaum.example.de` |
   | `INITIAL_ADMIN_EMAIL` | deine Adresse |
   | `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | aus der OAuth-App |

3. Deploy. Der Container legt beim Start das Schema an und macht
   `INITIAL_ADMIN_EMAIL` zum Administrator.

`ENABLE_DEV_LOGIN` dort **nicht** setzen.

### Voraussetzung für OAuth

Der Callback muss von Google/GitHub erreichbar sein — die Instanz braucht also
eine öffentliche Domain mit TLS (Caddy holt das Zertifikat automatisch). Rein
im LAN funktioniert OAuth nicht; dort bliebe nur der Dev-Login oder ein
Wechsel auf E-Mail+Passwort.

## Sicherung

```bash
DATA_ROOT=/volume1/docker/familytree ./scripts/backup.sh
```

Schreibt `db_<datum>.sql.gz` und spiegelt die Bilder nach
`${DATA_ROOT}/backups/media`. Als geplante Aufgabe im NAS-Aufgabenplaner
eintragen. Aufbewahrung über `BACKUP_KEEP_DAYS` (Standard 30).

Wiederherstellung:

```bash
gunzip -c db_2026-07-19_0300.sql.gz | docker compose exec -T db \
  psql -U familytree -d familytree
```

## Austauschformat

`/admin/data` bietet Export und Import.

- **JSON** — Personen, Beziehungen und Bildzuordnungen. Bilder erscheinen als
  Verweis auf einen Dateinamen.
- **ZIP** — dasselbe JSON plus die Bilddateien unter `media/`. Damit ist der
  Export ein vollständiges Backup und ein Umzug auf eine andere Instanz
  funktioniert wirklich.

Der Import zeigt zuerst eine Vorschau (wie viel neu, wie viel aktualisiert) und
ändert erst nach ausdrücklicher Bestätigung etwas. Bestehende Einträge werden
über ihre ID wiedererkannt und aktualisiert, unbekannte ergänzt — **gelöscht
wird nie**. Importieren dürfen nur Administratoren; exportieren darf jeder, der
die Daten ohnehin sehen kann.

## Datenmodell

Beziehungen liegen in einer eigenen Tabelle statt als `parentId` auf `Person`.
Ein Stammbaum ist kein Baum, sondern ein Graph — nur so sind zwei Elternteile,
Adoption, Stiefverhältnisse, Mehrfachehen und Beziehungszeiträume abbildbar,
ohne das Schema zu ändern.

```
Person ──< Relationship >── Person     type: PARENT_OF | PARTNER_OF
Person ──< PersonMedia >── MediaAsset
User (= Allowlist) ──< AuditLog
```

## Berechtigungen

Rechte hängen an **Familien**, nicht an einer pauschalen Rolle.

- Eine Person gehört zu beliebig vielen Familien. Wer einheiratet, gehört zu
  beiden — genau so verbinden sich Familien in der Wirklichkeit.
- Ein Benutzer bekommt je Familie **lesen** oder **bearbeiten**, oder gar
  keinen Zugriff. Ohne Familienzuordnung sieht er nichts.
- Sichtbar ist eine Person, sobald der Benutzer *eine* ihrer Familien hat.
  Bearbeiten darf er, wenn er in *einer* davon Bearbeitungsrechte hat.
- Personen **ohne** Familie sieht ausschließlich der Administrator. Das ist die
  sichere Grundeinstellung: eine vergessene Zuordnung gibt nichts frei.
- Der Administrator sieht und ändert alles und vergibt die Zugriffe.

Im Stammbaum erscheinen gesperrte Personen als anonymer Platzhalter statt zu
verschwinden. So bleibt der Baum zusammenhängend und Kinder stehen nicht ohne
sichtbare Eltern da, während Name, Daten und Bilder verborgen bleiben.

Ein Zugriff auf eine gesperrte Person beantwortet die API mit **404, nicht 403**
— ein 403 würde bestätigen, dass es diese Person gibt.

Verbindlich ist [lib/scope.ts](lib/scope.ts); [lib/authz.ts](lib/authz.ts)
regelt nur noch die globalen Verwaltungsrechte (Benutzer, Familien, Import).
Auch der Export ist auf den sichtbaren Bestand beschränkt — sonst wäre er ein
Weg, das ganze Konzept mit einem Klick zu umgehen.

### Was wer darf

Die ersten beiden Spalten gelten **je Familie** — ein Benutzer kann in einer
Familie bearbeiten und in einer anderen nur lesen.

| | lesen | bearbeiten | Administrator |
|---|---|---|---|
| Personen und Bilder dieser Familie ansehen | ✓ | ✓ | ✓ |
| Personen/Beziehungen anlegen und ändern | | ✓ | ✓ |
| Bilder hochladen, Primärbild festlegen | | ✓ | ✓ |
| Personen und Bilder löschen | | ✓ | ✓ |
| Familien anlegen, Zugriffe vergeben | | | ✓ |
| Benutzer einladen und sperren | | | ✓ |
| Daten importieren | | | ✓ |
| Personen ohne Familienzuordnung sehen | | | ✓ |

Die Prüfung läuft serverseitig in [lib/api.ts](lib/api.ts) (Route-Handler) und
[lib/session.ts](lib/session.ts) (Seiten). Die UI blendet zusätzlich aus, das
ist reiner Komfort.

## Grenzen

Die Baumansicht lädt den kompletten Graphen in den Browser. Das ist bis rund
1000 Personen unproblematisch; darüber hinaus wäre auf eine fokusbasierte
Teilgraph-Abfrage umzustellen (Person im Zentrum, N Generationen).
