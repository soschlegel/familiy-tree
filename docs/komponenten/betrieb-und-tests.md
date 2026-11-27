# Betrieb, Werkzeuge und Tests

Diese Beschreibung fasst alles zusammen, was nicht zur App selbst gehört,
aber für Entwicklung, Prüfung und Betrieb nötig ist: Hilfsskripte, das
Container-Image und die Compose-Dateien, die Build-Pipeline, die
Mock-Umgebung, die mitgelieferten Geodaten, die Umgebungsvariablen und den
Aufbau der Unit- und End-to-End-Tests. Bedienung und Schritt-für-Schritt-
Anleitungen stehen in der [README](../../README.md) („Schnellstart lokal“),
unter [docs/entwicklung/](../entwicklung/tests.md) (Tests, Mock-Daten) und
[docs/betrieb/](../betrieb/nas-portainer.md) (Betrieb auf der NAS,
Migrationen im Betrieb, Sicherung), laufende Stolperfallen in
[UEBERGABE.md](../../UEBERGABE.md).

**Code bleibt die Wahrheit:** Weicht diese Beschreibung vom Code ab, gilt der
Code, und die Beschreibung wird berichtigt.

---

## 1. npm-Skripte (`package.json`)

| Skript | Was es aufruft | Zweck |
|---|---|---|
| `dev` | `next dev` | normaler Dev-Server (Port 3000, normale Datenbank aus `.env`) |
| `build` | `prisma generate` und `next build` | Produktionsbuild (Standalone-Ausgabe) |
| `start` | `next start` | gebauten Stand starten (im Image stattdessen `node server.js`) |
| `lint` | `eslint .` | ESLint mit Flat-Config `eslint.config.mjs` |
| `typecheck` | `tsc --noEmit` | TypeScript-Prüfung |
| `test` / `test:watch` | `vitest run` / `vitest` | Unit- und Dienst-Tests in `tests/` |
| `test:e2e` | `scripts/e2e.mjs all` | Playwright mit einem Befehl: Build prüfen/erneuern, Server starten, setup → read → write, Server beenden |
| `test:e2e:setup` / `:read` / `:write` | `scripts/e2e.mjs setup/read/write` | Teilläufe (read und write jeweils mit vorangestelltem Setup) |
| `test:e2e:headed` | `scripts/e2e.mjs all --headed --workers=1` | sichtbarer Browser, ein Test nach dem anderen |
| `test:e2e:ui` | `playwright test --ui` | Playwright-Oberfläche (geht **nicht** über `scripts/e2e.mjs`) |
| `test:e2e:report` | `playwright show-report` | HTML-Bericht des letzten Laufs |
| `db:push` | `prisma db push` | Schema in die Datenbank aus `DATABASE_URL` schieben (normale Dev-Datenbank!) |
| `db:migrate` | `prisma migrate dev` | neue Migration anlegen |
| `db:seed` | `tsx prisma/seed.ts` | Admin und ggf. Demofamilie (siehe unten); auch als `prisma.seed` eingetragen |
| `db:studio` | `prisma studio` | Datenbank-Browser |
| `db:mock` | `scripts/mock.mjs seed` | Mock-Datenbank neu befüllen |
| `mock:setup` | `scripts/mock.mjs setup` | Mock-Datenbank anlegen, Schema anwenden, befüllen |
| `dev:mock` | `scripts/mock.mjs dev` | Dev-Server gegen die Mock-Daten (Port 3100) |
| `mock:build` | `scripts/mock.mjs build` | Produktions-Build der Mock-Umgebung für die E2E-Tests (`.next-e2e`) |
| `mock:start` | `scripts/mock.mjs start` | diesen Build mit `next start` auf dem Mock-Port |
| `mock:env` | `scripts/mock.mjs env` | berechnete Mock-Umgebung anzeigen |
| `mcp:stdio` | `scripts/mock.mjs mcp` | lokaler MCP-Server über stdio gegen die Mock-Daten |
| `mcp:key` | `scripts/mock.mjs mcp-key` | festen Mock-KI-Schlüssel ausgeben |
| `gedcom:check` | `tsx lib/gedcom/cli.ts` | GEDCOM-Datei vorab prüfen ([gedcom.md](../fachlich/gedcom.md#eine-datei-vorab-prüfen)) |

---

## 2. Skripte (`scripts/`)

### `scripts/mock.mjs`

Plattformunabhängiger Starter für alles, was gegen die Mock-Umgebung läuft
(unter Windows funktioniert `VAR=wert befehl` in npm-Skripten nicht). Lädt
die `.env` des Projekts, **nachdem** es `MOCK_PORT` und `MOCK_MEDIA_DIR` aus
der Shell gelesen hat — diese beiden wirken also nur aus der Shell, nicht aus
der `.env`.

- **Ziel bestimmen:** Die Mock-Datenbank-URL kommt aus `MOCK_DATABASE_URL`
  oder wird aus `DATABASE_URL` abgeleitet (Datenbankname plus `_mock`; eine
  vorhandene Endung `_mock`/`_test` wird vorher entfernt). Medienordner:
  `MOCK_MEDIA_DIR`, Standard `data/media-mock`.
- **Sicherungen:** Bricht mit Code 2 ab, wenn der Datenbankname nicht auf
  `_mock`/`_test` oder der Medienordner nicht auf `-mock`/`-test` endet.
- **Umgebung für Kindprozesse:** setzt `DATABASE_URL`, `MEDIA_DIR`,
  `AUTH_URL` (localhost mit Mock-Port), `AUTH_TRUST_HOST`, ein Ersatz-
  `AUTH_SECRET` (wenn keins oder der Platzhalter aus `.env.example` gesetzt
  ist), `ENABLE_DEV_LOGIN=true`, `NEXT_DIST_DIR=.next-mock` und `PORT`.
- **Befehle:**
  - `setup` — Mock-Datenbank über die Wartungsdatenbank `postgres` anlegen,
    falls sie fehlt; `prisma db push --accept-data-loss` dagegen; dann `seed`.
  - `seed` — `prisma/seed-mock.ts` ausführen.
  - `dev` — `next dev` auf dem Mock-Port; eigener Build-Ordner, läuft
    parallel zum normalen Dev-Server.
  - `build [--if-stale]` — `next build` mit der Mock-Umgebung in den eigenen
    Ordner `.next-e2e` (getrennt von `.next` und `.next-mock`; Dev-Server
    und Build stören sich nicht). Schreibt danach `e2e-build-stamp.json`
    mit dem Zeitpunkt des Build-Beginns. `--if-stale` baut nur, wenn eine
    Build-Eingabe (`app`, `components`, `lib`, `public`, `geo`,
    `middleware.ts`, `prisma/schema.prisma`, `next.config.mjs`, `package-lock.json`,
    Tailwind-/PostCSS-/TS-Konfiguration) jünger ist als dieser Stempel. Der
    Build enthält nichts Ortsabhängiges (Port, Datenbank, Medienordner und
    Anmeldung liest der Server erst beim Start).
  - `start` — `next start` auf dem Mock-Port gegen `.next-e2e`, mit der
    Mock-Umgebung und zusätzlich `E2E_PRODUCTION_DEV_LOGIN=mock-only`
    (eng begrenzte Freigabe des Dev-Logins im Produktionsmodus, siehe
    `lib/dev-login.ts` in [bibliotheken.md](bibliotheken.md)) sowie
    `RATE_LIMIT=off` (viele parallele Testläufer teilen sich wenige
    Testbenutzer; die Grenzen prüft Vitest). Warnt, wenn
    die Quellen neuer sind als der Build. Die Warnung von Next.js, `next
    start` passe nicht zu `output: "standalone"`, ist hier harmlos: der
    Server läuft; nur das Image nimmt `server.js`.
  - `env` — die berechneten Werte als JSON ausgeben.
  - `mcp` — `mcp/server.ts` über `tsx` (stdio; nichts auf stdout ausgeben).
  - `mcp-key [name]` — gibt den festen Testschlüssel aus `prisma/mock-data.ts`
    aus (Standard `editor-read`), nur den Schlüssel, damit er direkt in
    `FAMILYTREE_MCP_KEY` übernommen werden kann.
- Signale (Strg+C) werden an den Kindprozess weitergereicht.

### `scripts/e2e.mjs`

Starter für Playwright in Teilen — ein Befehl für den ganzen Lauf. Erstes
Argument `all`, `read`, `write` oder `setup`; daraus wird `--project=…` und
die Variable `E2E_AREA`. Eigene Optionen: `--skip-setup` (oder
`E2E_SKIP_SETUP=1`) lässt das Setup-Projekt weg; `--dev` testet gegen den
Mock-Dev-Server statt gegen den Produktions-Build; `--rebuild` baut in jedem
Fall neu, `--no-build` nimmt den vorhandenen Build ungeprüft. Alle übrigen
Argumente gehen unverändert an `playwright test`.

**Server:** Antwortet auf `MOCK_PORT` (Standard 3100) schon ein Server, wird
er mitbenutzt und nicht beendet; das Skript erkennt an den Chunk-Namen, ob
es ein Dev-Server oder ein Build ist, und warnt, wenn das nicht zur Option
passt. Sonst ruft es `scripts/mock.mjs build --if-stale` auf (nicht bei
`--dev`/`--no-build`), startet `scripts/mock.mjs start` bzw. `dev`, wartet
auf `/login` (60 s bzw. 3 min), lässt Playwright laufen und beendet den
Server samt Kindprozessen (Windows `taskkill /T`, sonst Prozessgruppe) —
auch bei Strg+C. Setzt `E2E_SERVER=prod|dev` für die Konfiguration und
meldet am Ende die Gesamtdauer. `--list` startet keinen Server.

Besonderheit bei `all` **mit Filter** (Datei, Muster oder `-g`): Da `write` in
der Playwright-Konfiguration von `read` abhängt und Playwright Abhängigkeiten
immer vollständig ausführt, läuft der Aufruf dann in drei Schritten
nacheinander — Setup ohne Filter, gefilterte lesende Tests, gefilterte
ändernde Tests (beide mit `--pass-with-no-tests`). Bricht ein Schritt ab,
folgen die weiteren nicht. Der HTML-Bericht enthält danach nur den letzten
Schritt. Zur Erkennung eines Filters kennt das Skript, welche
Playwright-Optionen einen Wert verbrauchen.

### `scripts/backup.sh`

Löst die Datenbanksicherung im laufenden Produktivstack aus, indem es den
vorhandenen Container des Dienstes `backup-db` (gefunden über die
Compose-Labels von Projekt und Dienst) erneut startet und auf dessen
Exit-Code wartet. Stackname als erstes Argument, sonst `STACK_NAME`, sonst
`familytree`. Braucht weder Repo-Kopie noch `docker compose` auf dem Host. Die
Bilder sichert es nicht — sie sind gewöhnliche Dateien und gehören in die
Sicherung des Hosts. Wird von keinem npm-Skript aufgerufen und ist per
`.dockerignore` nicht im Image.

### `scripts/build-geodata.mjs`

Erzeugt die beiden mitgelieferten Geodaten-Dateien (siehe Abschnitt 6) aus
vorher von Hand heruntergeladenen Rohdaten: GeoNames-Exporte (Orte ab 1000
Einwohnern, Länderdateien für Deutschland/Österreich/Schweiz, Regionen erster
Ebene, Länderinfos, Alternativnamen europäischer Länder) und Natural-Earth-
Ländergrenzen. Aufruf mit zwei Ordnern (GeoNames, Natural Earth). Läuft weder
zur Laufzeit noch im Build und wird von keinem npm-Skript aufgerufen.

- **Auswahl:** Deutschland, Österreich, Schweiz mit allen bewohnten Orten
  (auch historische Ortsteile), übriges Europa ab 1000 Einwohnern, übrige
  Welt mit einer Einwohner-Mindestgrenze (Verwaltungssitze immer), dazu
  Regionen erster Ebene, alle Länder und eine kleine Liste historischer
  Landschaften mit ungefährer Mitte. Weitere Namen nur in lateinischer
  Schrift; Kürzel aus Großbuchstaben fallen weg (außer bei Ländern).
- **Normalisierung** muss mit `normalizeForLookup` in
  `lib/places/normalize.ts` übereinstimmen (im Skript doppelt geführt — bei
  Änderungen beide anpassen).
- **Ländergrenzen** werden vorab wie `lib/map/projection.ts` projiziert und
  vereinfacht; die Projektion steht in der Ausgabedatei mit drin.

---

## 3. Container und Auslieferung

### `Dockerfile` (Stufen)

Ein einziges Image mit App, Migrationen und Admin-Abgleich.

1. **`deps`** — Node 22 (Alpine), `npm ci` mit `package.json`, Lockfile und
   `prisma/` (für den postinstall der Prisma-Engines).
2. **`builder`** — kopiert alles, setzt einen Platzhalter-`DATABASE_URL` (nur
   für `prisma generate`), nimmt die Build-Argumente `BUILD_DATE` und
   `BUILD_SHA` als `NEXT_PUBLIC_BUILD_DATE`/`NEXT_PUBLIC_BUILD_SHA` an (für
   die Fußzeile, `lib/build-info.ts`; erst hier deklariert, damit frühere
   Stufen im Cache bleiben) und führt `prisma generate` und `npm run build`
   aus.
3. **`prisma-cli`** — stellt nur das Paket `prisma` mit seinen transitiven
   Abhängigkeiten in genau den Lockfile-Versionen nach `/opt/prisma-cli`
   zusammen (Liste von `docker/prisma-cli-closure.mjs`), prüft, dass die
   Schema-Engine für linux-musl da ist, und entfernt, was `migrate deploy`,
   `migrate resolve` und `db execute` nicht brauchen (Query-Engines, Vorlage
   für `generate`, WebAssembly-Engines, Typdateien).
4. **`runner`** — Laufzeit als Benutzer `nextjs` (uid 1001), `NODE_ENV=
   production`, Telemetrie und Prisma-Update-Hinweise aus. Legt
   `/data/media` an (bewusst **kein** `VOLUME`, damit kein anonymes Volume
   entsteht) und setzt `MEDIA_DIR` darauf. Kopiert `public/`, das
   Standalone-Bundle, statische Dateien, Schema und Migrationen, das
   Prisma-CLI, `docker/seed-admin.mjs`, das Startskript und den
   Prisma-Wrapper (Zeilenenden werden auf LF korrigiert). Port 3000,
   Einstieg `docker/entrypoint.sh`, Befehl `node server.js`.

`.dockerignore` hält u.a. `node_modules`, Build-Ordner, `data/`, `.env*`
(außer dem Beispiel), Markdown außer der README, `CHANGELOG.md` (die
Neuigkeiten werden beim Build eingebaut, siehe `next.config.mjs`) und der
Anwender-Hilfe (`docs/anwender/*.md`, wird zur Laufzeit gelesen), `tests/`, `e2e/`, die
Test-Konfigurationen (`vitest.config.ts`, `playwright.config.ts`),
Testergebnisse, Compose-Dateien, `scripts/backup.sh`, `stack.env*` und
`.mcp.json` aus dem Build-Kontext. Nichts davon braucht Build oder
Laufzeit (kein App-Code importiert aus `tests/`).

### `docker/entrypoint.sh`

Startskript des App-Containers:

1. auf die Datenbank warten (über `prisma db execute`, höchstens
   `DB_WAIT_SECONDS`, Standard 60 s),
2. `prisma migrate deploy` — Ausgabe live ins Log; bekannte Fehlerbilder
   werden erklärt: Tabellen ohne Migrationshistorie (P3005, Baselining
   nötig — Anleitung in `docs/dev-history.md`) und als fehlgeschlagen vermerkte Migration (P3009/P3018),
3. `INITIAL_ADMIN_EMAIL` per `docker/seed-admin.mjs` als Administrator
   sicherstellen,
4. per `exec` den eigentlichen Befehl starten (Signale kommen direkt bei Node
   an).

Schlägt 1–3 fehl, beendet sich der Container mit Code 1 — die App startet
nie auf halb migriertem Schema. `RUN_MIGRATIONS=false` überspringt 1–3 (nur
zur Fehlersuche).

### `docker/prisma.sh`

Wird im Image als `/usr/local/bin/prisma` installiert (für das Startskript
und Handgriffe im Container). Setzt `PRISMA_QUERY_ENGINE_LIBRARY` auf die
Query-Engine aus dem Standalone-Bundle (das CLI hat keine eigene), arbeitet
aus `/opt/prisma-cli` (damit die `package.json` der App nicht gelesen wird)
und hängt bei `migrate …`/`db …` das Schema des Images an, falls kein
`--schema` angegeben ist.

### `docker/prisma-cli-closure.mjs`

Nur für den Image-Build: liest `package-lock.json`, löst die Abhängigkeiten
von `node_modules/prisma` (inklusive optionaler) nach der Node-Auflösung im
Lockfile auf und gibt die benötigten Ordner der obersten Ebene aus. Fehlt eine
Pflicht-Abhängigkeit im Lockfile, bricht es ab.

### `docker/seed-admin.mjs`

Läuft beim Containerstart (reines JavaScript, kein `tsx` im Image). Legt den
Benutzer aus `INITIAL_ADMIN_EMAIL` (kleingeschrieben) als Administrator mit
Status „eingeladen“ an bzw. hebt einen vorhandenen auf Administrator.
Idempotent; ohne Variable tut es nichts.

### `docker/schema-diff-check.mjs`

Entwicklungswerkzeug (nicht im Image): liest ein Migrations-SQL von stdin,
entfernt Kommentare (auch bei CRLF), teilt in Anweisungen und meldet alle, die
nicht rein ergänzend sind. Als ergänzend gelten neue Tabellen/Typen/
Sequenzen/Erweiterungen/Schemata/Indizes, neue Enum-Werte sowie `ALTER
TABLE` nur mit `ADD …`, `SET DEFAULT` oder `DROP NOT NULL`. Exit 0 =
ergänzend (oder leer), Exit 3 = beanstandete Anweisungen auf stdout. Nach
AGENTS.md Pflichtprüfung vor jedem Release.

### `docker-compose.yml` (Produktivstack)

Für Portainer als Git-Stack; bindet keine Dateien aus dem Repository ein. Alle
dauerhaften Daten liegen als Bind-Mounts unter `DATA_ROOT`. Dienste:

- **`db`** — Postgres 17 (Alpine) mit fester Locale `C.UTF-8`, kein Port nach
  außen, Healthcheck mit `pg_isready`.
- **`media-init`** — Einmal-Job als root: legt `DATA_ROOT/media` an,
  übereignet alles, was nicht uid 1001 gehört, und macht einen Schreibtest
  mit genau der Identität der App; scheitert er (z.B. ACLs), startet die App
  nicht.
- **`backup-db`** — Einmal-Job nach gesunder Datenbank: `pg_dump` (mit
  `--clean --if-exists`) gepackt nach `DATA_ROOT/backups`, löscht Dumps älter
  als `BACKUP_KEEP_DAYS`. Läuft bei jedem Stack-Start **vor** der App, also
  vor jeder Migration.
- **`app`** — das Image aus der Registry (`IMAGE_REPO`/`IMAGE_TAG`), startet
  erst nach gesunder Datenbank, erfolgreichem `media-init` und `backup-db`.
  Port nur an `APP_BIND` (Standard localhost) und `APP_PORT`. Healthcheck auf
  `/api/health` mit großzügiger Startphase (Migrationen). Dev-Login fest aus.
  `CSP_MODE` wird durchgereicht (Standard `enforce`; Not-Schalter der
  Content-Security-Policy, wirkt ohne neues Image).
- **`proxy`** (optional, Profil `caddy`) — eigener Reverse-Proxy mit inline
  erzeugter Caddy-Konfiguration (`CADDY_*`), Standard „tls internal“.

Logs aller Dienste sind auf rotierende JSON-Dateien begrenzt.

### `docker-compose.dev.yml`

Nur Postgres 17 für die lokale Entwicklung, Port 5432 auf dem Rechner, Daten
unter `data/dev-postgres`. Die App läuft daneben mit `npm run dev` bzw.
`npm run dev:mock`. Benutzer, Passwort und Datenbankname sind feste
Entwicklungswerte und passen zum Standard in `scripts/mock.mjs` und
`vitest.config.ts`.

### `docker-compose.build.yml`

Ergänzung zur Produktivdatei: baut das App-Image lokal (Ziel `runner`) statt
es zu laden — zum Ausprobieren des Produktivstacks auf dem eigenen Rechner
(mit eigener Env-Datei und eigenem Projektnamen). Nicht für Portainer.

### `.github/workflows/images.yml`

Workflow „Images“, ausgelöst durch Push auf `main`, Tags `v*` oder von Hand.
Läufe auf demselben Ref brechen ältere ab.

1. **`checks`** — `npm ci`, `prisma generate`, Typecheck, Lint, Vitest (ohne
   Datenbank; die `*.db.test.ts` überspringen sich). Playwright läuft hier
   **nicht**.
2. **`images`** — baut das Ziel `runner` für linux/amd64 mit Build-Datum
   (deutsche Zeit) und Kurz-Commit als Build-Argumente und legt es in der
   GitHub Container Registry ab. Tags: `latest` (Standardbranch),
   `sha-<kurz>`, bei Versions-Tags `<version>` und `<major>.<minor>`.
3. **`promote`** — nur auf `main`: setzt den Branch `deploy` auf genau diesen
   Commit (Force-Push). Portainer beobachtet `deploy` und sieht neue
   Compose-Dateien so erst, wenn das passende Image fertig ist.

Rechte werden je Job minimal vergeben. Auf dem Arbeitsbranch läuft der
Workflow nicht — die Prüfungen dort sind Handarbeit (AGENTS.md, Abschnitt 3).

### `next.config.mjs`

- `distDir` aus `NEXT_DIST_DIR` (Mock-Dev-Server: `.next-mock`, E2E-Build:
  `.next-e2e`), sonst `.next`. `tsconfig.json` nennt die `types`-Ordner
  aller drei, sonst trüge `next build` sie selbst nach.
- `output: "standalone"` für ein kleines Image.
- `poweredByHeader: false` und `headers()` für jede Antwort:
  `X-Frame-Options: DENY` (nicht in fremde Seiten einbetten),
  `Referrer-Policy: same-origin` (externe Links bekommen keine Adresse der
  App samt Kennungen), `X-Content-Type-Options: nosniff`. Für `/api/…`
  zusätzlich die feste Content-Security-Policy `API_POLICY` (gleich der in
  `lib/csp.ts`; enthält `sandbox`, weil diese Kopfzeile die gleichnamige
  der Bildroute ersetzt). Die Richtlinie der Seiten setzt `middleware.ts`
  (Abschnitt „middleware.ts“ unten). `headers()` wird beim Build
  ausgewertet — Laufzeit-Schalter gehören deshalb in die Middleware. Tests:
  `tests/request-guard.test.ts`, `tests/csp.test.ts`.
- `sharp` als externes Server-Paket (nicht gebündelt).
- `outputFileTracingIncludes`: `geo/gazetteer.tsv.gz` für alle API-Routen
  (`/api/**` — Admin-Seite, Vorschlag am Ortsfeld, automatische Zuordnung
  nach dem Speichern und nach Importen, MCP), `/admin/places` und die
  Ortsseiten `/places/**`, damit die
  Datei im Standalone-Bundle landet (dort einmal unter `geo/`).
- Ebenso `docs/anwender/*.md` für `/hilfe` und `/hilfe/**`
  (Anwender-Hilfe, `lib/help/content.ts`).
- `webpack`: Regel `resourceQuery: /raw/` → `asset/source` — `import … from
  "…?raw"` liefert den Dateiinhalt als Text. Damit ist `CHANGELOG.md`
  (`lib/release-notes-data.ts`) zur Build-Zeit in den Server-Code eingebaut
  und braucht keinen Eintrag in `outputFileTracingIncludes`; im Dev-Server
  wirkt eine Änderung sofort. Gilt nur für Webpack (Turbopack ist nicht im
  Einsatz).

### `middleware.ts`

Content-Security-Policy der Seiten (Regeln in `lib/csp.ts`, Begründung je
Direktive in [docs/sicherheit.md](../sicherheit.md#content-security-policy)).
Je Anfrage eine neue Nonce; die Richtlinie geht auf die Antwort (für den
Browser) und auf die Anfrage (Next.js liest daraus die Nonce und setzt sie
an seine Skripte). Läuft in der Node.js-Laufzeit, damit `CSP_MODE` zur
Laufzeit gilt. Der `matcher` lässt `/api` (eigene Richtlinie; große Uploads
nicht durch die Körpergrenze der Middleware), `_next/static`,
`_next/image`, die Icons, `geo/` und Vorabladen über `next/link` aus. Eine
vom Client mitgeschickte CSP-Kopfzeile wird verworfen. Alle Seiten sind
ohnehin dynamisch (Wurzel-Layout liest die Sitzung); die Nonce kostet
deshalb kein statisches Rendern. Tests: `tests/csp.test.ts`,
`e2e/read/csp.spec.ts`.

---

## 4. Mock-Umgebung

Eigene Datenbank (Name endet auf `_mock`/`_test`) und eigener Medienordner
(endet auf `-mock`/`-test`) auf demselben Postgres; die normale Datenbank und
`data/media` bleiben unberührt. Für parallele Worktrees: je Worktree eigene
`MOCK_DATABASE_URL` in der `.env` und eigener `MOCK_PORT` in der Shell.

### `prisma/mock-data.ts`

Reiner, deterministischer Generator ohne Datenbank und Netz (fester
Startwert, feste „Gegenwart“): gleiche Eingabe, gleiche Daten bis zu den IDs
(`mock-p-…`, `mock-r-…`, `mock-family-…` usw.). Liefert Familien, Personen
über sechs Generationen in vier miteinander verheirateten Familien,
Beziehungen, Lebensereignisse, weitere Namen, Quellen und Belege,
Platzhalterbild-Beschreibungen, Benutzer mit Rollen und Familienrechten, feste
KI-Testschlüssel (`MOCK_API_TOKEN_KEYS`, gültig nur in der Mock-Datenbank) und
`landmarks` — die IDs der gezielt eingebauten Sonderfälle (Scheidung mit
Wiederheirat, Halb-, Stief-, Adoptiv- und Pflegeverhältnisse, Datenlücken,
ungenaue Daten, mögliche Dubletten, Personen ohne Familie, eigene Person des
Bearbeiters usw.). Unit-Tests (über `tests/helpers.ts`) und E2E-Tests (über
`e2e/support/mock.ts`) lesen IDs und Namen von hier, statt sie
abzuschreiben. Inhalt im Einzelnen:
[docs/entwicklung/mock-daten.md](../entwicklung/mock-daten.md).

### `prisma/seed-mock.ts`

Schreibt das Ergebnis des Generators in die Mock-Datenbank. Verweigert (Code
2) jede Datenbank und jeden Medienordner ohne Mock-/Test-Endung. Ablauf:
alle App-Tabellen per `TRUNCATE … CASCADE` leeren (auch Importläufe,
Herkunft, Rohdaten, Sitzungen, Orte), dann Familien, Benutzer, KI-Schlüssel
(nur als Hash), Familienrechte, Personen, Familienzugehörigkeit,
Beziehungen, eigene Personen der Benutzer, Ereignisse, weitere Namen anlegen
(alle Benutzer mit dem neuesten Release aus `CHANGELOG.md` als gesehen,
damit „Was ist neu?“ keinem Test im Weg steht);
Ortstexte automatisch über das mitgelieferte Ortsverzeichnis zuordnen;
Medienordner leeren, Platzhalterbilder (SVG → PNG mit `sharp`) über die
normale Bildverarbeitung speichern und an Personen bzw. Beziehungen hängen;
zuletzt Quellen (Scan nur, wenn das Bild angelegt wurde) und Belege. Gibt eine
Zusammenfassung samt Benutzertabelle aus.

### `prisma/seed.ts`

Seed für die **normale** Datenbank (`npm run db:seed`): legt
`INITIAL_ADMIN_EMAIL` als Administrator an bzw. hebt ihn an. Nur mit
`SEED_DEMO=true` und leerer Personentabelle zusätzlich eine kleine
Demofamilie über drei Generationen (sieben Personen, zwei Ehen,
Eltern-Kind-Beziehungen), ohne Familienzuordnung. Ohne Variable bzw. mit
vorhandenen Personen wird nur gemeldet, was übersprungen wurde.

---

## 5. Konfiguration der Testläufer

### `vitest.config.ts`

Lädt die `.env` und leitet daraus die Mock-Datenbank-URL ab (gleiche Regel
wie `scripts/mock.mjs`, `MOCK_DATABASE_URL` hat Vorrang). Setzt für alle Tests
`DATABASE_URL` auf diese Mock-Datenbank, `MEDIA_DIR` auf `data/media-test` und
`NODE_ENV=test` — nie die normale Datenbank — und `PLACE_AUTO_ASSIGN=off`
(die Zuordnung neuer Ortstexte im Hintergrund liefe sonst nach Testende
gegen schon aufgeräumte Daten weiter; `tests/places-ai.db.test.ts` schaltet
sie für sich ein). Umgebung Node, Alias `@` auf das
Projekt, nur `tests/**/*.test.ts`, Zeitgrenzen 30 s, **Dateien nacheinander**
(die Datenbank-Tests teilen sich eine Datenbank und zählen).

### `playwright.config.ts`

- Testordner `e2e/`, Ergebnisse `test-results/`, HTML-Bericht
  `playwright-report/`, Reporter „list“ plus HTML.
- Zeitgrenzen: Test 60 s, `expect` 10 s, Aktion 15 s, Navigation 45 s;
  keine Wiederholungen; Trace und Screenshot nur bei Fehlern.
- Locale `de-DE`, Zeitzone Europe/Berlin; Basis-URL localhost mit
  `MOCK_PORT` (Standard 3100).
- Server-Art aus `E2E_SERVER` (von `scripts/e2e.mjs`): `prod` (Standard,
  Produktions-Build) oder `dev` (Dev-Server).
- Worker (gilt für `read`): 6 gegen den Build, 4 gegen den Dev-Server, in
  CI 2; `--workers` übersteuert. `forbidOnly` in CI.
- **Projekte:**
  - `setup` — nur `e2e/global.setup.ts`, Zeitgrenze 10 min.
  - `read` — `e2e/read/`, voll parallel, Desktop-Chrome; hängt an `setup`
    (entfällt mit `E2E_SKIP_SETUP=1`).
  - `write` — `e2e/write/`, Dateien parallel, Tests einer Datei nacheinander;
    Obergrenze je Projekt 2 Worker (mehr war nicht schneller, aber
    anfälliger für Zählungen mit fremden „E2E …“-Datensätzen);
    `E2E_WRITE_WORKERS` übersteuert (`--workers` hebt sie nicht an); hängt an
    `read`, bei `E2E_AREA=write` nur an `setup`.
- **Web-Server:** nur für direkte Aufrufe (`playwright test`,
  `test:e2e:ui`) — `node scripts/mock.mjs start` (Build muss vorhanden sein)
  bzw. bei `E2E_SERVER=dev` `node scripts/mock.mjs dev`; bereit, wenn
  `/login` antwortet, Start bis 3 min; ein laufender Server wird mitbenutzt
  und nicht beendet. Über `scripts/e2e.mjs` steht der Server schon, bevor
  Playwright startet.

---

## 6. Geodaten

### `geo/gazetteer.tsv.gz`

Gepacktes, tabulatorgetrenntes Ortsverzeichnis (Orte, Regionen erster Ebene,
historische Landschaften, Länder mit Koordinaten, Ländercode, weiteren
Namen), erzeugt von `scripts/build-geodata.mjs`. Nur der Server liest es:
`lib/places/gazetteer-file.ts` lädt es beim ersten Bedarf (gut 100 MB im
Speicher) und gibt es nach zehn Minuten ohne Benutzung wieder frei;
`lib/places/gazetteer.ts` enthält Datenstruktur und Suche, `lib/places/match.ts`
die automatische Zuordnung. Benutzt von `lib/services/places.ts` (Admin-Seite
„Orte zuordnen“, `/api/places/…`, Vorschlag am Ortsfeld, Zuordnung nach dem
Speichern und nach Importen, MCP) und von `prisma/seed-mock.ts`; die Karte
selbst liest nur die fertigen Koordinaten aus der Tabelle `Place`. Keine
Anfrage nach außen. Über `next.config.mjs` ins Standalone-Image gebracht.

### `public/geo/countries.json`

Ländergrenzen (Natural Earth), bereits projiziert und vereinfacht, mit der
Projektionsangabe. Statisch ausgeliefert und im Browser von
`components/MapExplorer.tsx` geladen (einmal je Seite zwischengespeichert);
die Projektion muss zu `lib/map/projection.ts` passen.

---

## 7. Umgebungsvariablen

Werte stehen in `.env.example` (lokal) bzw. `stack.env.example`
(Produktivstack); hier nur der Zweck. „implizit“ = von einer Bibliothek
selbst gelesen, nicht im eigenen Code.

### App (lokal und Produktion)

| Variable | Zweck | gelesen in |
|---|---|---|
| `DATABASE_URL` | Postgres-Verbindung | Prisma (implizit), `mcp/server.ts`, Mock-/Test-Werkzeuge |
| `AUTH_SECRET` | Schlüssel für Sitzungen | Auth.js (implizit); Mock-Ersatzwert in `scripts/mock.mjs` |
| `AUTH_URL` | öffentliche Adresse der App (Callbacks, Cookies, Link in der Anmelde-Mail) | Auth.js (implizit); `mcp/http.ts` als erlaubte Herkunft; `lib/email-login.ts` (`publicBaseUrl`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Versand der Anmeldelinks über das eigene Postfach; nur vollständig (Host, Benutzer, Passwort, Absender) gibt es den E-Mail-Link. Port Standard 587, `SMTP_SECURE` Standard „an bei 465“. Geheimnisse — nur als Umgebungsvariablen, nie unter „Einstellungen“ | `lib/email-login.ts`, `lib/email-login-mail.ts`, `lib/auth.ts`, Login-Seite, `/admin/users` |
| `AUTH_TRUST_HOST` | Host-Kopf hinter Proxy vertrauen | Auth.js (implizit) |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | OAuth GitHub | `lib/auth.ts`, Login-Seite |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | OAuth Google | `lib/auth.ts`, Login-Seite |
| `ENABLE_DEV_LOGIN` | Anmeldung nur per E-Mail (lehnt bei `NODE_ENV=production` ab; einzige Ausnahme siehe `E2E_PRODUCTION_DEV_LOGIN`) | `lib/auth.ts`, `lib/dev-login.ts`, Login-Seite |
| `INITIAL_ADMIN_EMAIL` | erster Administrator | `prisma/seed.ts`, `docker/seed-admin.mjs`, `docker/entrypoint.sh` |
| `MEDIA_DIR` | Ordner der Bilddateien (zur Laufzeit gelesen, Standard `data/media`) | `lib/storage.ts`, `prisma/seed-mock.ts`, Tests |
| `MAX_UPLOAD_BYTES` | größte Bilddatei (Standard 15 MiB) | `lib/services/media-links.ts`, `lib/services/gedcom-photos.ts`, `mcp/http.ts` |
| `MCP_CONNECTOR_URL` | öffentliche Adresse des MCP-Gateways, nur für die Anleitung auf `/ai-access` — **Rückfall:** ein Wert unter „Einstellungen“ (`/admin/settings`, Schlüssel `mcpConnectorUrl`) hat Vorrang; nur http(s), sonst ignoriert | `lib/settings/registry.ts`, `lib/services/settings.ts` (`getSetting`) |
| `MCP_ALLOWED_ORIGINS` | weitere erlaubte `Origin`-Werte für `/api/mcp` (kommagetrennt) | `mcp/http.ts` — nur lokal (`.env.example`, auskommentiert); der Stack reicht sie bewusst nicht durch |
| `NODE_ENV` | Produktion/Entwicklung (Dev-Login, Prisma-Logging, Client-Singleton) | `lib/dev-login.ts`, `lib/prisma.ts` |
| `PLACE_AUTO_ASSIGN` | `off` schaltet die automatische Zuordnung neuer Ortstexte nach dem Speichern/Import ab (Standard an; `vitest.config.ts` setzt `off`) | `lib/services/places.ts` |
| `NEXT_PUBLIC_BUILD_DATE` / `NEXT_PUBLIC_BUILD_SHA` | Build-Angabe in der Fußzeile, beim Build fest eingesetzt | `lib/build-info.ts` |
| `NEXT_DIST_DIR` | eigener Build-Ordner (Mock-Dev-Server `.next-mock`, E2E-Build `.next-e2e`) | `next.config.mjs` |
| `PORT` / `HOSTNAME` | Port und Bind-Adresse des Servers | Next.js (implizit); im Image gesetzt |
| `SEED_DEMO` | Demofamilie beim `db:seed` | `prisma/seed.ts` |
| `CSP_MODE` | Not-Schalter der Content-Security-Policy der Seiten: `enforce` (Standard, auch bei unbekanntem Wert), `report-only` (nur Meldungen in der Browser-Konsole), `off`; zur Laufzeit gelesen, `docker-compose.yml` reicht ihn durch, `stack.env.example` auskommentiert ([Fehlersuche](../betrieb/fehlersuche.md#content-security-policy)) | `lib/csp.ts` (`cspMode`), `middleware.ts` |

### Containerstart und Stack

| Variable | Zweck |
|---|---|
| `RUN_MIGRATIONS` | `false` überspringt Datenbankwarten, Migrationen und Admin (`docker/entrypoint.sh`) |
| `DB_WAIT_SECONDS` | Wartezeit auf die Datenbank in Sekunden (`docker/entrypoint.sh`, Standard 60; `docker-compose.yml` reicht sie durch, `stack.env.example` auskommentiert) |
| `PRISMA_QUERY_ENGINE_LIBRARY` | Pfad der Query-Engine für das CLI im Image (`docker/prisma.sh`) |
| `DATA_ROOT` | Wurzel aller Bind-Mounts (Pflicht) |
| `POSTGRES_PASSWORD` / `POSTGRES_USER` / `POSTGRES_DB` | Zugang der Datenbank; daraus baut Compose `DATABASE_URL` |
| `PUBLIC_URL` | Adresse im Browser; wird zu `AUTH_URL` |
| `APP_BIND` / `APP_PORT` | Bind-Adresse und Port der App nach außen |
| `IMAGE_REPO` / `IMAGE_TAG` | welches Image geladen wird |
| `BACKUP_KEEP_DAYS` | Aufbewahrung der Dumps |
| `COMPOSE_PROFILES` | `caddy` schaltet den eigenen Proxy zu |
| `CADDY_SITE`, `CADDY_TLS`, `CADDY_HTTP_PORT`, `CADDY_HTTPS_PORT`, `CADDY_BIND`, `CADDY_MAX_BODY` | Einstellungen des optionalen Caddy |
| `STACK_NAME` | Stackname für `scripts/backup.sh` — Shell-Variable auf der NAS, kein Stack-Wert (in `stack.env.example` auskommentiert erklärt) |
| `BUILD_DATE` / `BUILD_SHA` | Build-Argumente des Images (von der Action gesetzt) |

### Mock, MCP-Entwicklung und Tests

| Variable | Zweck |
|---|---|
| `MOCK_DATABASE_URL` | Mock-Datenbank ausdrücklich setzen (`scripts/mock.mjs`, `vitest.config.ts`) |
| `MOCK_MEDIA_DIR` | Mock-Medienordner (nur aus der Shell wirksam) |
| `MOCK_PORT` | Port des Mock-Servers (Standard 3100; `scripts/mock.mjs`, `playwright.config.ts`, `e2e/support/api.ts`; nur aus der Shell wirksam) |
| `MCP_USER_EMAIL` | Benutzer, als der der stdio-MCP-Server handelt (Pflicht) |
| `MCP_ALLOW_WRITE` | `true` schaltet im stdio-Server Schreibwerkzeuge frei (zusätzlich KI-Recht nötig) |
| `MCP_KEY_NAME` | intern: Übergabe des Schlüsselnamens an den `mcp-key`-Unterprozess |
| `FAMILYTREE_MCP_KEY` | Schlüssel für den Eintrag in `.mcp.json` (Claude Code); im App-Code nicht gelesen |
| `E2E_SKIP_SETUP` | `1` = Setup-Projekt weglassen |
| `E2E_SERVER` | von `scripts/e2e.mjs` gesetzt: `prod` (Standard) oder `dev`; wählt Web-Server, Worker und Vorwärmen |
| `E2E_WRITE_WORKERS` | Obergrenze der Worker für das Projekt `write` (Standard 2) übersteuern, für Messungen |
| `E2E_PRODUCTION_DEV_LOGIN` | nur `scripts/mock.mjs start` setzt `mock-only`: Dev-Login im Produktions-Build — wirkt nur zusammen mit Datenbank `…_mock`/`…_test` und Medienordner `…-mock`/`…-test` (`lib/dev-login.ts`); im Stack nie gesetzt |
| `RATE_LIMIT` | `off` schaltet die Anfragegrenzen ab (`lib/rate-limit.ts`); nur `scripts/mock.mjs start` setzt es für den E2E-Build, im Stack nie. Die Drosselung der Anmelde-Mails (`lib/email-login.ts`) bleibt trotzdem an |
| `MAIL_TEST_OUTBOX` | `scripts/mock.mjs` setzt `mock-only` (Dev und E2E): Anmelde-Mails landen als JSON in `<Mock-Medienordner>/mail-outbox` statt im Versand — wirkt nur zusammen mit Datenbank `…_mock`/`…_test` und Medienordner `…-mock`/`…-test` (`lib/email-login.ts`); `scripts/mock.mjs` leert dazu `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`; im Stack nie gesetzt |
| `E2E_AREA` | von `scripts/e2e.mjs` gesetzt; `write` hängt dann nur am Setup |
| `CI` | Playwright: 2 Worker, `forbidOnly` |
| `MERGE_SCREENS` | Ordner für Bildschirmfotos in `e2e/write/merge.spec.ts`, `merge-comfort.spec.ts` und `connect.spec.ts` |
| `GEDCOM_PERF` / `GEDCOM_PERF_N` | große GEDCOM-Leistungsmessung in `tests/gedcom-performance.test.ts` |

---

## 8. Unit- und Dienst-Tests (`tests/`, Vitest)

Start: `npm test` (oder `npm run test:watch`). Zwei Arten:

- **Reine Tests** (`*.test.ts` ohne `.db`) brauchen keine Datenbank und
  laufen auch in CI.
- **Datenbank-Tests** (`*.db.test.ts`) laufen gegen die Mock-Datenbank
  (vorher `npm run mock:setup`). Jede Datei prüft zu Beginn über
  `mockDbSkipReason` (`tests/db-ready.ts`, Zeitgrenze 5 s, optional eine
  Zusatzprüfung wie „es gibt Quellen“), ob die Mock-Datenbank erreichbar und
  befüllt ist, und überspringt sich sonst mit Hinweis. Lesende Tests verlassen sich auf die
  deterministischen Mock-Daten; schreibende legen eigene, erfundene
  Datensätze an und räumen sie (samt Audit, Paketen, Importdateien) wieder
  ab. Dateien laufen nacheinander.

### Hilfsdateien

- **`helpers.ts`** — liefert die Mock-Daten (einmal erzeugt) sowie daraus die
  Baumdaten in der Form der Baumansicht (Admin-Sicht) und die Kanten für die
  Graph-Algorithmen.
- **`merge-fixtures.ts`** — erzeugt kleine, sich überschneidende
  GEDCOM-Bäume mit erfundenen Namen und je Aufruf eigener Projekt-/Datensatz-
  Kennung und eigenem Familiennamen, damit sich Läufe nicht vermischen
  (benutzt von Zusammenführen-, Importe-verbinden-, Importquellen- und
  Personen-Dubletten-Tests).
- **`fixtures/linking-generator.ts`** — deterministische erfundene
  „Wahrheit“ und daraus mehrere verrauschte, sich überschneidende Importe mit
  Fallen, für die Genauigkeitsmessung von „Importe verbinden“.
- **`fixtures/gedcom/`** — erfundene GEDCOM-Beispieldateien (minimal 5.5.1,
  MyHeritage-Stil, GEDCOM 7, Grenzfälle) sowie `generate.ts` (große
  synthetische Datei erzeugen) und `measure.ts` (Leistungsmessung, kein
  Test).

### Reine Tests

- **`ai-access.test.ts`** — Schlüsselformat und Hash, wirksame KI-Stufe,
  Eingabeschemas und die festen Mock-Schlüssel.
- **`ancestor-rings.test.ts`** — Ansicht „Ringe“: Platzvergabe (volle
  Belegung, Lücken, Seitenregel bei unbekanntem/gleichem Geschlecht,
  Ahnenschwund, Zyklus, nicht sichtbarer Vorfahr), Geometrie, Text nie
  kopfüber, Beschriftungsplan und Kürzen, Verwandtschaftsstufe,
  Zusammenfassung, Adressparameter.
- **`biography.test.ts`** — „Lebenslauf“: Daten, Orte und Alter im
  Fließtext, Sätze für Mann/Frau/unbekannt, lebend/verstorben, ungenaue
  Daten, fehlende Teile, mehrere Ehen, Geschwisterstellung nur bei sicherer
  Grundlage, nicht sichtbare Angehörige, sehr wenig Daten, gleiche Eingabe →
  gleicher Text.
- **`build-info.test.ts`** — Build-Angabe der Fußzeile, Rückfall „Build
  lokal“, ohne Anmeldung kein Commit.
- **`changelog.test.ts`** — Feldänderungen und Paket-Titel des Changelogs.
- **`consistency.test.ts`** — Plausibilitätsprüfung, auch mit ungenauen
  Daten.
- **`dates.test.ts`** — Einlesen ungenauer Daten, Anzeige und Rundlauf,
  Vergleich.
- **`descendant-rings.test.ts`** — „Ringe“, Richtung „Nachfahren“:
  Gewichtung nach Teilbaum, kinderlose Kinder, Reihenfolge, Gruppen nach
  Partnerschaft mit Lücke, Mindestbreite, Mehrfach-Nachkomme, Zyklus, nicht
  sichtbarer Nachkomme, Obergrenze, Adoption, Begriffe, Zusammenfassung,
  Richtung in der Adresse, `arcLabelPlan` gleich `ringLabelPlan`.
- **`duplicates.test.ts`** — Bewertung und Paarbildung der
  Dublettenerkennung, Vorfahren/Nachkommen-Regel.
- **`focus.test.ts`** — Ausschnitt, Layout und Startperson der
  Fokus-Ansicht, Platzhalter für fremde Familien.
- **`gedcom-dates.test.ts`** — GEDCOM-Datumsformen (genormt, nachsichtig,
  ungültig als Text) lesen und schreiben.
- **`gedcom-diagnostics.test.ts`** — Diagnose, Dokumentvergleich und das
  Prüfprogramm `gedcom:check`.
- **`gedcom-interpret.test.ts`** — Deutung von MyHeritage-Export,
  Grenzfall-Datei, GEDCOM 7 und Familienstand.
- **`gedcom-mapping.test.ts`** — Abbildung des GEDCOM-Zwischenmodells auf den
  Massenimport (Namen, Daten, Ereignisse, Familien, Quellen, Fotos,
  Rohdaten).
- **`gedcom-parser.test.ts`** — Zeilenenden, Zeichensätze, Fortsetzungs-
  zeilen und Defekte aus der Praxis.
- **`gedcom-performance.test.ts`** — Laufzeit mit kleiner Datei im normalen
  Lauf; große Messung nur mit `GEDCOM_PERF`.
- **`gedcom-writer.test.ts`** — Rundreise lesen → schreiben → lesen, Kopf und
  Format, Familien.
- **`genealogy.test.ts`** — Datumsbereiche, Ereignisregeln, Plausibilität
  mit Ereignissen, Ehestand unbekannt, Import-Hilfen.
- **`graph.test.ts`** — Vorfahren/Nachfahren, kürzester Weg, Zyklen- und
  Geschwisterprüfung, auch auf den Mock-Daten.
- **`health.test.ts`** — `/api/health` mit Datenbank-Attrappe, auch bei nicht
  beschreibbarem Medienordner; Zwischenspeicher des Ergebnisses.
- **`gedcom-html.test.ts`** — HTML-Fragmente in Text: Verhalten und Laufzeit
  bei bösartig gebauten Eingaben (ReDoS).
- **`request-guard.test.ts`** — Herkunftsprüfung schreibender Anfragen und
  Größengrenzen des Anfragekörpers.
- **`rate-limit.test.ts`** — Anfragegrenzen: Zeitfenster, Zuordnung der
  Pfade, KI-Schlüssel, Abschalten.
- **`csp.test.ts`** — Content-Security-Policy: jede Direktive der Seiten
  (Produktion, Dev-Server, http/https, Report-Only), Ziele der
  OAuth-Anmeldung in `form-action` (abgeglichen mit den Anbietern von
  Auth.js), Nonce, `CSP_MODE`, Middleware (Kopfzeilen auf Antwort und
  Anfrage, fremde Richtlinie verworfen, `matcher`), `API_POLICY` gleich in
  `lib/csp.ts` und `next.config.mjs`.
- **`email-login.test.ts`** — Anmeldung per E-Mail-Link: Einrichtung (SMTP
  nur vollständig, Test-Briefkasten nur mit allen drei Bedingungen), nur
  Eingeladene bekommen Mail, gleiche Mindestdauer, Drosselung auch bei
  `RATE_LIMIT=off`, Route und Mailtext; der Ablauf mit der eingebauten
  Auth.js-Version (Token gehasht, einmalig, abgelaufen, ersetzt, kein neues
  Konto, nachträglich gesperrt).
- **`import-linking.test.ts`** — Genauigkeit und Trefferquote von „Importe
  verbinden“ gegen erfundene Wahrheit („sicher“ muss fehlerfrei sein).
- **`import-suggestions.test.ts`** — Vorschläge beim GEDCOM-Import: derselbe
  Abgleich mit `focus` (letzter Import = Datei, übrige = Bestand), Treffer
  je Klasse („sicher“ und „sehr wahrscheinlich“ fehlerfrei), `focus` nie
  lockerer, Laufzeit 2 000 gegen gut 12 000, Abweichungen.
- **`kinship.test.ts`** — Verwandtschaftsbegriffe und Wegbeschreibung.
- **`kinship-chain.test.ts`** — Verbindungen als Personenketten
  (`lib/kinship-chain.ts`) und Sicht der Seite „Wie sind wir verwandt?“:
  beide Blickrichtungen, mehrere Verbindungen, Ahnenschwund, streng nur über
  sichtbare Personen (Verbindung nur über gesperrte = keine, sichtbarer
  Umweg), Übereinstimmung mit der Bezugsperson für jedes Paar, keine
  Verbindung, Abgleich mit `findBloodRelation`, 12 000 Personen.
- **`layout.test.ts`** — Generationen- und Zeitstrahl-Layout, auch mit
  Hochzeiten.
- **`map.test.ts`** — Lebend- und Ortsregel der Karte, Auswertung eines
  Jahres, Zeitreise (Spanne des Reglers, Alter, wer lebte, Gruppen und
  Sortierung, In diesem Jahr, Hochzeiten), Projektion, Laufzeit bei vielen
  Personen.
- **`mcp-format.test.ts`** — Formatierungshilfen der MCP-Antworten.
- **`media-links.test.ts`** — base64-Eingang, Abruf per Adresse mit
  SSRF-Schutz (ohne echtes Netz) und die Belegbild-Regel.
- **`merge-rules.test.ts`** — Regeln des Zusammenführens (Datumsverfeinerung,
  Hauptangaben, Beziehungen).
- **`places.test.ts`** — Normalisierung, Zerlegen von Ortstexten und
  Zuordnung, mit kleinem Verzeichnis und mit dem mitgelieferten
  `geo/gazetteer.tsv.gz`.
- **`places-ai.db.test.ts`** — Vorschlag am Ortsfeld (Dienst und Route
  `/api/places/suggest` mit nachgebildeter Anmeldung, Rechte, früherer Name,
  mehrdeutig, Antwortzeit), Zuordnung nach dem Speichern und nach Importen
  (MANUAL/KI bleiben, Paket, Fehler ohne Folgen), MCP-Werkzeuge
  `suggest_place`/`list_places`/`assign_place` über den HTTP-Endpunkt (Rechte,
  Stapel, eigener Ort, Protokoll), Bestätigen auf der Admin-Seite. Schaltet
  `PLACE_AUTO_ASSIGN` für sich ein.
- **`reference.test.ts`** — Verwandtschaft aller Personen zur Bezugsperson
  (gegen die Einzelabfrage), Ahnenlinien, Linienfarben, Leistung.
- **`release-notes.test.ts`** — Neuigkeiten: Parser von `CHANGELOG.md`,
  Kennungen und Reihenfolge, Auswahl „seit zuletzt gesehen“; die echte
  Datei ist fehlerfrei, gleich dem eingebauten Text und ohne
  Commit-Kennungen oder Technikbegriffe.
- **`roots.test.ts`** — „Wurzeln“: Anteile der Vorfahren (volle Belegung,
  endende Linien, fehlender Elternteil, Ahnenschwund, Zyklus, nicht
  sichtbarer Vorfahr, mehr als zwei Eltern), Zusammenfassen zu „Sonstige“,
  Prozent-Rundung, Ort → Land/Region.
- **`safe-fetch.test.ts`** — öffentliche Adressen, sicherer Abruf
  (Weiterleitungen, Größe, Typ, Zeit) und Nebenläufigkeitsgrenze.
- **`scope.test.ts`** — Sicht- und Bearbeitungsrechte je Person/Beziehung,
  Familienfilter.
- **`settings.test.ts`** — Verzeichnis der Einstellungen (eindeutige
  Kennungen, keine Namen, die nach Geheimnissen klingen), Prüfung von
  http(s)-Adressen, Rückfall auf die Umgebungsvariable.
- **`source-classify.test.ts`** — Einordnung importierter Quellen und Anzeige
  älterer Importe.
- **`research-progress.test.ts`** — Forschungs-Fortschritt
  (`lib/research-progress.ts`): Tiefe 4…10, Zählung je Generation und Linie,
  Ahnenschwund (je Platz, verschiedene Personen einmal), nicht freigegebener
  Vorfahr samt Plätzen dahinter (keine Kennung, keine Vorschläge),
  Qualitätspunkte (genau/ungenau/fehlt, Lebende ohne Sterbepunkte),
  fremder Stammbaum ist kein Beleg, vermutlich verstorben (auch über ein
  Kind), Vorschläge (Elternteil, Linie, abgeschnittene Plätze, gesperrter
  Elternteil neutral), Reihenfolge der Vorschläge.
- **`records.test.ts`** — Seite „Rekorde“ (`lib/records.ts`): Datumsregeln
  (vollendete Jahre, „etwa“, zu weite Spannen), lebend/verstorben,
  Rangfolge mit Gleichstand und Obergrenze, Datenfehler (Alter über 110,
  Eltern- und Heiratsalter, Zukunft), Partnerschaftsdauer (Tod, Scheidung,
  besteht noch, Offenes), Kinder/Paare, Nachkommen und Linie nur über
  sichtbare Personen, Kreise, Vornamen je Jahrhundert, nicht sichtbare
  Personen, Familienfilter, Leistung bei 12 000 Personen.
- **`statistics.test.ts`** — Seite „Statistik“: Datumsregeln (Jahr und
  Alter bei ungenauen Daten), Namensregeln (Geburtsname vor Ehename, erster
  Vorname, Platzhalter), Kennzahlen, Sichtbarkeit (gesperrte Personen und
  ihre Kinder/Partner zählen nicht), Geburtsorte, Geburten je Zeitraum,
  Lebensalter mit kleiner Grundlage, Kinderzahl, Heiratsalter,
  Geburtsmonate, `groupAreaSlices`.
- **`today.test.ts`** — Startseite „Heute in der Familie“ (`lib/today.ts`):
  Tag nach Europe/Berlin statt UTC, strenges `?datum=`, 29. Februar,
  nur tagesgenaue sichere Daten (auch keine Zweitangaben, keine
  Dauerereignisse), lebend/vermutlich verstorben, Sätze, runde Jahrestage
  und Jubiläen, geschiedene Ehen, nicht sichtbare Personen und Partner,
  Fenster „Demnächst“ über den Jahreswechsel, nächster Jahrestag.
- **`storage.test.ts`** — Schlüsselprüfung gegen Pfad-Ausbrüche, atomares
  Schreiben, Lesen, Löschen, Ordnerprüfung (in eigenem Temp-Ordner).
- **`validation.test.ts`** — Datumsprüfungen, Beziehungsregeln,
  Zod-Schemata, ungenaue Daten.

### Datenbank-Tests

- **`ai-access.db.test.ts`** — KI-Rechte, Schlüssel, Prüfung pro Aufruf und
  Audit über den KI-Kanal.
- **`ancestor-rings.db.test.ts`** — „Ringe“: Plätze und Begriffe, gesperrte
  Großeltern nur als „nicht freigegeben“ ohne Kennungen oder Namen dahinter,
  Tiefe 3…7, unsichtbare Mitte, Startperson (nur lesend).
- **`biography.db.test.ts`** — „Lebenslauf“: Text einer reich erfassten
  Person; Betrachter nur der Familie A: kein Name und keine Kennung einer
  nicht sichtbaren Person, gesperrte Eltern weder genannt noch für die
  Geschwisterstellung gezählt (nur lesend).
- **`changelog.db.test.ts`** — Pakete, Momentaufnahmen, Verlauf je Person mit
  Rechten und Maskierung, Admin-Übersicht, Bündeln über den KI-Zugang.
- **`changelog-subject.db.test.ts`** — Verlauf zu gelöschten und
  aufgegangenen Personen: gespeicherte Familien im Eintrag, Bearbeiter mit
  und ohne passende Familie, Administrator, ohne Familie, Altbestand,
  später gelöschte Familie, aufgegangene Person.
- **`descendant-rings.db.test.ts`** — „Ringe“, Richtung „Nachfahren“:
  Kinder, Begriffe, Bögen in den Bögen der Eltern, Zählung und Legenden,
  Adoptivkind ja, Stief- und Pflegekind nein, gesperrter Nachkomme nur als
  „nicht freigegeben“ ohne Kennung oder Namen von ihm und seiner Tochter,
  Tiefe 3…7, Obergrenze, unsichtbare Mitte, Startperson (nur lesend).
- **`focus.db.test.ts`** — Fokus-Ausschnitt mit Sichtbarkeit und Rückfall auf
  die Startperson (nur lesend).
- **`gedcom-export-selection.db.test.ts`** — GEDCOM-Export mit
  Familienauswahl: nur Gewähltes, keine hängenden Verweise, gültiges
  GEDCOM, Rechte.
- **`gedcom-import.db.test.ts`** — Vorschau, Import, Wiederholungsimporte in
  allen Varianten, zwei Bäume, doppeltes Absenden, Rechte, Vorschläge.
- **`genealogy.db.test.ts`** — Ereignisse, Namen, Orte, Ehestand unbekannt
  und Massenimport.
- **`import-linking.db.test.ts`** — zwei Importe derselben Familie abgleichen,
  zusammenführen, Fortsetzen nach Unterbrechung.
- **`import-suggestions.db.test.ts`** — Vorschläge beim GEDCOM-Import gegen
  einen anderen Import, Standard „neu anlegen“, Verknüpfen (anreichern,
  Zweitangabe, Herkunft, Änderungsgeschichte im Paket, gleiche Ereignisse
  nicht doppelt, Rohdaten beider Importe gültig), erneuter Import still,
  Nachprüfung (nicht vorgeschlagen, doppeltes Ziel, geändertes Ziel,
  fehlendes Recht, unsichtbares Ziel), Rollback bei Fehler in der
  Transaktion.
- **`import-sources.db.test.ts`** — Einordnung importierter Quellen, Links,
  doppelte Belege, Korrektur beim erneuten Import.
- **`map.db.test.ts`** — Datenschutz der Kartendaten (auch Zeitreise:
  Hochzeiten, „Wer lebte“, „In diesem Jahr“ für einen eingeschränkten
  Betrachter), Linien, Admin-Rechte und Protokoll der Ortszuordnung.
- **`mcp-http.db.test.ts`** — MCP-Endpunkt `/api/mcp` über den HTTP-Client
  des SDK (Route direkt aufgerufen, ohne Server) sowie Form der `.mcp.json`.
- **`mcp.db.test.ts`** — stdio-MCP-Server als Kindprozess: Lesewerkzeuge,
  Verbergen für Betrachter, Schreibwerkzeuge samt Audit, Weigerung gegen
  Nicht-Mock-Datenbanken.
- **`media-cleanup.db.test.ts`** — Löschen von Person/Beziehung räumt nur
  nicht mehr benutzte Bilder ab (Dateiablage als Attrappe).
- **`media-links.db.test.ts`** — Bilder an Ereignissen, Belegen und Quellen:
  Rechte, Regeln, Audit, MCP-Werkzeuge, Export.
- **`sicherheit.db.test.ts`** — Befunde der Sicherheitsprüfung
  ([../sicherheit.md](../sicherheit.md)): Löschregel für Quellen-Scans auch
  beim Lösen, verborgene Personen beim Anlegen von Beziehungen, keine
  Bildverluste über den KI-Zugang, `add_media` prüft Ziele vor dem Abruf,
  keine internen Fehlermeldungen an KI-Clients.
- **`api-guard.db.test.ts`** — `route()` wie von Next.js aufgerufen (Anmeldung
  als Attrappe): fremde Herkunft, 413, 429, Kopfzeilen; `/api/tree` ohne
  Familie; Bildauslieferung nur als Bild.
- **`merge.db.test.ts`** — Zusammenführen ohne stillen Datenverlust,
  Blockaden, erneuter Import danach, Export.
- **`merge-followups.db.test.ts`** — Folgedubletten (Klassen wie die Liste,
  gleichnamige Geschwister „unklar“, Rechte, „kein Duplikat“, gemeinsam nur
  „sicher“) und „Erst die Eltern, dann dieses Paar“ (nur vorgeschlagene
  Paare, kein schwacher Treffer, bei jedem Hindernis ändert sich nichts).
- **`kinship-view.db.test.ts`** — „Wie sind wir verwandt?“ je Rolle:
  Cousine nur über gesperrte Personen ergibt für den Bearbeiter keine
  Verbindung (wie seine Personenseite, ohne Kennung und Namen der
  Gesperrten), der Administrator sieht sie; Seite und Personenseite stimmen
  für die eigene Person überein; nicht sichtbare Auswahl gilt als nicht gefunden, angeheiratet, keine
  Verbindung, dieselbe Person.
- **`person-redirect.db.test.ts`** — alte Kennung als Umleitung: Anlegen,
  Kette, Sichtbarkeit, gelöschtes Ziel, Rückfüllung aus dem Audit (einzeln,
  gesammelt, Kette, „Importe verbinden“, unbrauchbare Einträge), KI-Zugang.
- **`person-duplicates.db.test.ts`** — mögliche Dubletten einer Person mit
  Rechten (nichts, auch keine Anzahl, ohne Bearbeitungsrecht an beiden).
- **`reference.db.test.ts`** — „Das bin ich“, Auflösung der Bezugsperson,
  keine Durchsickerung, Mitwandern beim Zusammenführen.
- **`release-notes.db.test.ts`** — Lesemarke der Neuigkeiten nur am
  eigenen Benutzer, unbekannte Kennungen abgelehnt, Mock-Benutzer haben das
  neueste Release gesehen.
- **`research.db.test.ts`** — Verwandtschaft, Zeitleisten, Plausibilität,
  erweiterte Suche (nur lesend).
- **`roots.db.test.ts`** — „Wurzeln“ je Rolle: gesperrte Großeltern nur als
  „nicht freigegeben“, keine Kennungen oder Gebiete aus gesperrten Linien,
  Stufe Region, Eingabeprüfung, Person ohne Eltern (nur lesend).
- **`services.db.test.ts`** — die zentralen Dienste (Lesen mit Rechten,
  Anlegen/Ändern/Löschen eigener Personen).
- **`settings.db.test.ts`** — Einstellungen: Vorrang App vor Umgebung,
  Rückfall nach dem Entfernen, ungültige gespeicherte Werte, Prüfung, nur
  Administratoren, Protokoll vorher → nachher samt Anzeige in der
  Änderungsübersicht; Routen `/api/settings…` (Fehlercodes, 403 für
  Nicht-Admins und fremde Herkunft).
- **`research-progress.db.test.ts`** — Forschungs-Fortschritt: Admin ohne
  eigene Person (keine Ausgangsperson) bzw. mit gewählter Person (Plätze wie
  die Ringe, Vorschläge nur zu gezeigten Personen), Tiefe begrenzt,
  Bearbeiter mit eigener Person (gesperrte Großeltern mütterlicherseits nur
  „nicht freigegeben“, keine Kennung und kein Name von ihnen oder ihren
  Vorfahren, kein falscher Vorschlag „Eltern fehlen“), nicht sichtbare bzw.
  unbekannte Person in der Adresse, Benutzer ohne Familie (nur lesend).
- **`records.db.test.ts`** — Rekorde je Rolle: Personenzahl wie die
  Statistik, eingeschränkte Benutzer sehen weniger, genannt werden nur
  sichtbare Personen (auch als Kind, Partner, Linienende), Familienfilter
  (Admin mit Familie A = Betrachter; fremde Familie = „Alle“), Benutzer ohne
  Familie (nur lesend).
- **`statistics.db.test.ts`** — Statistik je Rolle (Zahlen wie
  `getStatistics`, eingeschränkte Benutzer sehen weniger), keine Kennungen
  und keine Namen aus gesperrten Familien, Familienfilter (fremde Familie =
  „Alle“), Stufe Region, Benutzer ohne Familie (nur lesend).
- **`today.db.test.ts`** — Startseite je Rolle an einem festen Tag: Ergebnis
  von `getToday` gleich der reinen Rechnung über den Mock-Datensatz
  (Admin alle, Betrachter/Bearbeiter nur ihre Familien), ohne Familie
  leer, ohne Tag gilt heute nach Europe/Berlin (nur lesend).
- **`sources.db.test.ts`** — Quellen, Belege und ungenaue Daten.

---

## 9. End-to-End-Tests (`e2e/`, Playwright)

Bedienen die App in Chromium gegen den Produktions-Build der Mock-Umgebung
(Standard; mit `--dev` gegen den Mock-Dev-Server); sprechen nur mit der
App (Browser und HTTP-API), nie direkt mit Datenbank oder Medienordner.
Voraussetzungen: Postgres läuft, Mock-Datenbank einmal angelegt, einmalig
`npx playwright install chromium`. Start und Optionen siehe Abschnitt 1 und
`scripts/e2e.mjs`; Anmeldezustände liegen in `e2e/.auth/` (von Git
ausgenommen).

### `e2e/global.setup.ts` (Projekt `setup`)

Nacheinander: Mock-Daten neu aufbauen (`scripts/mock.mjs seed`), je Rolle
(Admin, Bearbeiter, Betrachter, ohne Familie) per Dev-Login anmelden (Ziel:
Startseite `/`, `waitForStartPage`) und den Zustand speichern, dann — nur gegen den Dev-Server (`E2E_SERVER=dev`) — als
Admin die wichtigsten Seiten und API-Routen einmal aufrufen, damit er sie
vorab übersetzt; gegen den Build entfällt dieser Schritt. Der gesperrte
Benutzer bekommt keinen gespeicherten Zustand.

### Hilfen (`e2e/support/`)

- **`fixtures.ts`** — erweitertes `test`: eine automatische Wache, die jeden
  Test an unerwarteten Konsolen- oder Seitenfehlern scheitern lässt (mit eng
  gefassten Ausnahmen und pro Test erlaubten Meldungen; ein
  Hydration-Fehler React #418 ist immer ein Testfehler, siehe
  Abschnitt 10). Darin der **CSP-Wächter**: Ein Init-Skript meldet jedes
  `securitypolicyviolation`-Ereignis als Konsolenfehler, und jede
  Konsolenmeldung zur Content-Security-Policy (auch „[Report Only]“) zählt
  als Testfehler — ein `allow` des Tests hebt das nicht auf. So prüft jeder
  Lauf die Richtlinie auf allen besuchten Seiten mit. `loginAs` für weitere
  Rollen in eigenen Kontexten; dazu Dev-Login (Feld „Dev-Login:
  E-Mail-Adresse“ — „E-Mail-Adresse“ allein ist das Feld des
  E-Mail-Links), Dialoge annehmen,
  Barrierefreiheitsprüfung mit axe (WCAG 2.1 A/AA, begründete Ausnahmen),
  Prüfung auf waagerechte Scrollleiste, Warten auf Baum und Hydration,
  Muster für erwartete HTTP-Fehler.
- **`api.ts`** — API-Kontext je Rolle, eindeutige Zusätze für Testnamen,
  Anlegen/Löschen von Personen, Beziehungen und Quellen, ein von Hand
  gebautes kleines PNG, verlängerte Zeitgrenze für Importe.
- **`mock.ts`** — derselbe Mock-Datensatz wie im Seed, Sonderfall-IDs,
  Familien, Benutzer je Rolle sowie die Listen sichtbarer bzw. verbotener
  Namen je Familienrecht.
- **`nav.ts`** — Hauptnavigation finden und das Untermenü „Verwaltung“
  aufklappen (wiederholt, bis die Hydration greift).

### Lesende Tests (`e2e/read/`, parallel)

- **`auth.spec.ts`** — Anmeldung über den Dev-Login ohne gespeicherten
  Zustand.
- **`biography.spec.ts`** — Abschnitt „Lebenslauf“ der Personenseite: Lage
  nach dem Kopf, Namen als Links, „Text kopieren“ (Zwischenablage), Hinweis
  mit Kontexthilfe; Betrachter ohne Namen gesperrter Verwandter im
  Seitenquelltext; 390 px ohne Querscrollen, axe.
- **`csp.spec.ts`** — Content-Security-Policy: Seite mit Nonce, jedes
  Skript trägt sie, jede Antwort eine neue; feste Richtlinie der API; ein
  eingeschleuster Inline-Handler wird blockiert und gemeldet (prüft den
  CSP-Wächter selbst).
- **`dates.spec.ts`** — ungenaue Daten erscheinen auf Personenseite, Liste
  und Baumkarte gleich.
- **`duplicate-banner.spec.ts`** — Dubletten-Hinweis nur für Berechtigte,
  „Vergleichen“ führt zum richtigen Paar.
- **`export.spec.ts`** — Export-Downloads über die Daten-Seite je Rolle.
- **`gedcom-export-dialog.spec.ts`** — GEDCOM-Export-Dialog mit
  Familienauswahl, Tastatur, Telefon und Rechten.
- **`map.spec.ts`** — Karte „Wurzeln nach Jahr“ je Rolle und auf dem Telefon,
  Zeitreise (Regler per Tastatur und Eingabe, Jahr in der Adresse, Liste,
  Abspielen/Pause/Weiter, „Bewegung reduzieren“, Tippflächen).
- **`mcp-http.spec.ts`** — `/api/mcp` nur über HTTP mit den festen
  Testschlüsseln (401/403/200, Werkzeuglisten, Sitzungs-Cookie meldet nicht
  an).
- **`mobile.spec.ts`** — Telefonbreite: kein waagerechtes Scrollen,
  erreichbare Navigation, ausreichend große Schrift in Eingabefeldern;
  Fußzeile am unteren Rand einer kurzen Seite (Bestätigungsseite
  `/login/email` — die Anmeldeseite ist mit E-Mail-Link und Dev-Login länger
  als ein Telefon).
- **`neuigkeiten.spec.ts`** — Link „Neuigkeiten“ in der Fußzeile, Seite mit
  allen Releases, kein Fenster für Mock-Benutzer, ohne Anmeldung weder Link
  noch Seite; `PUT /api/me/release-seen` (401, 400 bei unbekannter Kennung
  und fremden Feldern).
- **`kinship.spec.ts`** — „Wie sind wir verwandt?“: Einstieg von
  Personenseite und Recherche, Auswahl über die Suche, Sätze in beide
  Richtungen, Zeichnung mit verlinkten Karten, Verbindung nur über
  gesperrte Personen: derselbe Hinweis wie auf der Personenseite, keine
  Zeichnung, nichts Gesperrtes im Seitenquelltext, Kontexthilfe; Tauschen,
  nicht sichtbare Auswahl, dieselbe Person, keine Verbindung, Administrator
  sieht die Verbindung, 390 px und axe hell/dunkel.
- **`navigation.spec.ts`** — Navigation und Untermenü „Verwaltung“ je Rolle
  und Breite.
- **`people-list.spec.ts`** — Personenliste: Suche, Familienfilter,
  Sortierung, Seiten, Zählung; Seite jenseits des Endes behält den Ortsfilter.
- **`permissions.spec.ts`** — keine Information über fremde Familien, weder
  im Text noch im ausgelieferten HTML, über direkte Adressen oder die API.
- **`person-families.spec.ts`** — letzte bearbeitbare Familie lässt sich
  nicht abwählen (nichts wird gespeichert).
- **`quality.spec.ts`** — Barrierefreiheit (axe) und Telefonbreite quer über
  die Seiten.
- **`reference.spec.ts`** — Bezugsperson und Ahnenlinien, keine
  Durchsickerung, Telefon.
- **`research.spec.ts`** — Recherche-Seite als Admin und Betrachter.
- **`rings.spec.ts`** — Ansicht „Ringe“ der Baumseite: wählbar, Flächen mit
  Namen und Verwandtschaftsstufe, „Nicht freigegeben“ ohne Angaben und ohne
  alles dahinter, Auswahl mit „Zur Person“ und „In die Mitte“, Tiefe,
  Färbung, Tastatur, Quelltext ohne fremde Namen/Kennungen, „Person nicht
  gefunden“, 390 px mit Tippflächen und Vollbild, axe. Richtung
  „Nachfahren“: Umschalter hin und zurück, Flächen und Begriffe, Auswahl,
  „In die Mitte“ mit Richtung, Färbung, Tiefe, Tastatur, gesperrter
  Nachkomme samt Quelltext, dunkel auf 390 px.
- **`roots.spec.ts`** — Abschnitt „Wurzeln“ der Personenseite: Legende und
  Prozente, „Nicht freigegeben“, Umschalten Land/Region und Generation,
  kein Abschnitt ohne Eltern, Schnittstelle (400/404, keine Kennungen),
  390 px ohne Querscrollen, axe.
- **`sources-list.spec.ts`** — Quellenliste: eine Seite jenseits des Endes
  zeigt die letzte Seite mit Einträgen.
- **`progress.spec.ts`** — Seite „Forschungs-Fortschritt“: Einstiege von
  Recherche und Startseite, Hinweis ohne Ausgangsperson, Balken mit Zahlen
  je Generation und Linie, Vorschläge verlinken auf Personenseiten, Tiefe
  und Person wählbar (Adresse), eingeschränkter Benutzer (eigene Person,
  „nicht freigegeben“, keine fremden Namen), 390 px hell/dunkel ohne
  Querscrollen mit Tippflächen ≥ 44 px, axe.
- **`records.spec.ts`** — Seite „Rekorde“: Einstieg von der Startseite,
  alle Karten mit Zählsatz und Grundlage, Bestwerte mit verlinkten
  Personen, Hilfe-Link, Verweise Statistik ↔ Rekorde mit Familie, Filter in
  der Adresse, Betrachter sieht nur sichtbare Personen (keine fremden
  Namen, fremde Familie gibt nichts frei), ohne Familie nur Hinweis, 390 px
  hell/dunkel ohne Querscrollen mit 44-px-Tippflächen, axe.
- **`statistics.spec.ts`** — Seite „Statistik“: alle Karten mit Grundlage,
  Hilfe-Link, Umschalter Land/Region und Familienfilter in der Adresse,
  Betrachter sieht kleinere Zahlen (fremde Familie in der Adresse gibt
  nichts frei), ohne Familie nur Hinweis, 390 px hell/dunkel ohne
  Querscrollen, axe.
- **`today.spec.ts`** — Startseite „Heute in der Familie“, unabhängig vom
  echten Datum (Tag per `?datum=`, Erwartung mit `lib/today.ts` über den
  Mock-Datensatz): Sätze, verlinkte Personen, runde Einträge, „Weitere …
  anzeigen“, Tag blättern und zurück zu heute, Einstieg und Logo,
  Betrachter ohne fremde Namen, leerer Tag mit nächstem Jahrestag, ohne
  Familie nur Hinweis, 390 px hell/dunkel mit Tippflächen, axe.
- **`tree-focus.spec.ts`** — Fokus-Ansicht ab fester Person, Startperson.
- **`tree-whole.spec.ts`** — Gesamtansichten Generationen und Zeitstrahl.

### Ändernde Tests (`e2e/write/`, Dateien parallel, Tests einer Datei seriell)

Alle Dateien laufen im Modus `serial`; eigene Datensätze heißen „E2E …“ und
werden am Ende entfernt (Audit-Einträge, Pakete und Importläufe bleiben bis
zum nächsten Setup).

- **`admin.spec.ts`** — Benutzer einladen, Rolle ändern, sperren, Familie
  anlegen, Sichtbarkeit beim Eingeladenen prüfen.
- **`ai-access.spec.ts`** — KI-Recht vergeben/entziehen, Schlüssel anlegen
  (einmal sichtbar), Herabsetzen, Widerrufen.
- **`attached-media.spec.ts`** — Bilder an Ereignissen, Quellen und Belegen
  hochladen, verknüpfen, entfernen; Betrachter- und Telefonsicht.
- **`changelog.spec.ts`** — Änderungsabschnitt der Personenseite (auch
  Feldwerte zu einer inzwischen gelöschten Person je nach Familie) und
  Admin-Übersicht mit einem KI-Paket.
- **`connect.spec.ts`** — „Importe verbinden“ als Admin bis zum Folge-
  Abgleich; Bearbeiter sieht die Seite nicht.
- **`dates.spec.ts`** — ungenaue Daten über das Formular eingeben, prüfen,
  anzeigen, zurück ins Formular.
- **`email-login.spec.ts`** — Anmeldung per E-Mail-Link über den
  Test-Briefkasten (`<Mock-Medienordner>/mail-outbox`) mit eigens
  eingeladenen Benutzern und je Test eigener Absender-Adresse
  (X-Forwarded-For): anfordern, Mailtext, Vorab-Abruf verbraucht nichts,
  `GET /api/auth/callback/nodemailer` leitet nur auf die Bestätigung,
  „Jetzt anmelden“, zweiter Versuch → „gilt nicht mehr“; unbekannt/gesperrt
  gleiche Antwort ohne Mail; Drosselung (3 je Adresse); unvollständiger
  Link; Telefon im dunklen Farbschema mit axe.
- **`duplicate-banner.spec.ts`** — Dubletten-Hinweis mit eigenen Datensätzen,
  Begrenzung, „kein Duplikat“.
- **`gedcom-import.spec.ts`** — GEDCOM-Import und -Export über die Oberfläche
  mit im Test erzeugten Dateien, Wiederholungsimport, Rechte, kein Abruf nach
  außen ohne Foto-Haken.
- **`genealogy.spec.ts`** — Ereignisse, weitere Namen, Orte, Ehestand auf der
  Personenseite.
- **`import-sources.spec.ts`** — Online-Stammbaum-Quellen mit Anbieter und
  Beleg-Link.
- **`import-suggestions.spec.ts`** — Vorschläge beim GEDCOM-Import gegen
  einen früheren Import: Zusammenhang je Klasse, Standard „Neu anlegen“,
  „Alle sicheren auswählen“ und Abwahl, Nachprüfung mit 409 (nichts
  importiert, Auswahl zurückgesetzt), danach verknüpft; 390 px, dunkel, axe.
- **`import.spec.ts`** — Import geänderter Exporte (JSON, ZIP mit Bild) und
  des alten Formats, beschränkt auf eigene Datensätze.
- **`media.spec.ts`** — Bild hochladen, Porträt, ZIP-Export, Löschen und
  Wiederherstellen per Import.
- **`merge-comfort.spec.ts`** — Dialog „Zusammenführen …“, alte Kennung
  (308 für Seite, Stammbaum und API, auch über eine Kette; 409 beim
  Schreiben; 404 bei nicht sichtbarer Zielperson), Folgedubletten mit
  gemeinsamer Vorschau, „Erst die Eltern, dann dieses Paar“.
- **`merge.spec.ts`** — Dubletten zusammenführen als Bearbeiter, „kein
  Duplikat“, sichere Paare, Blockade, Betrachter ohne Zugriff.
- **`person-lifecycle.spec.ts`** — Person anlegen, bearbeiten, Beziehungen,
  Familien, löschen; als Administrator im Personenwähler angelegte Person
  landet in der Familie der Ausgangsperson.
- **`places.spec.ts`** — Orte zuordnen (nicht zuordenbar, zurücksetzen,
  automatisch, aus Verzeichnis, von Hand, Protokoll), stellt den
  Ausgangszustand wieder her.
- **`settings.spec.ts`** — Einstellungen: Menüpunkt, Ausgangszustand, axe
  hell/dunkel, Adresse des KI-Connectors anlegen (Prüfung am Feld), auf
  „KI-Zugang“ sichtbar, ändern (auch in der Änderungsübersicht), 390 px,
  entfernen stellt den Rückfall her; Betrachter/Bearbeiter ohne Menüpunkt,
  Seite und API. Entfernt den Eintrag vor und nach der Datei.
- **`reference.spec.ts`** — „Das bin ich“ setzen und aufheben, selbst und
  durch den Admin.
- **`sources.spec.ts`** — Quelle anlegen, zitieren, Beleg ändern/entfernen,
  Scan-Auswahl, Quelle löschen.
- **`whats-new.spec.ts`** — Fenster „Was ist neu?“ mit einem eigenen
  eingeladenen Benutzer (die Mock-Benutzer bleiben unberührt): nach der
  Einladung keins, nach zurückgesetzter Lesemarke mit den Releases seither,
  Fokus, axe, Escape speichert, höchstens drei plus Hinweis, „Alle
  Neuigkeiten“, Telefonbreite.

---

## 10. Bekannte Flakes und Stolperfallen

- **Hydration-Fehler (React #418) beim Laden — behoben.** Früher
  scheiterte in wenigen Prozent der Seitenaufrufe die Hydration (`/people`,
  `/sources`, `/map`, `/tree`, `/login` …), obwohl der Server dasselbe HTML
  lieferte; auf Seiten mit `loading.tsx` folgten Seitenfehler „Cannot read
  properties of null (reading 'parentNode')“. Ursache ist ein Fehler im
  React, das Next.js 15.5 mitbringt (facebook/react#35210): Kommen Teile
  einer Seite als später gesendete RSC-Daten, hält die Hydration an einem
  Element an und setzt später dort wieder auf — dabei stand der Zeiger auf
  das nächste DOM-Element schon eine Ebene tiefer. Behoben in React 19.3
  (#35494); bis dahin spielt der Webpack-Loader
  `lib/next-patches/react-hydration-replay-fix.cjs` (Regel in
  `next.config.mjs`, nur die Client-Dateien von
  `next/dist/compiled/react-dom`) dieselbe Korrektur zurück. Passt die
  Stelle nach einer Next-Aktualisierung nicht mehr, bricht der Build mit
  klarer Meldung ab; enthält React die Korrektur selbst, bleibt die Datei
  unverändert und `tests/react-hydration-replay-fix.test.ts` meldet, dass
  Loader, Regel und Test entfallen können.
  Messen: `scripts/hydration-rate.mjs` lädt Seiten gegen einen laufenden
  `mock:start` in mehreren Tabs und zählt #418; `--gap=50` streckt das
  Streaming über einen Zwischenserver und löst den Wettlauf gezielt aus
  (ohne Korrektur 13 von 240 Aufrufen, mit Korrektur 0 von 720). Die Wache
  in `fixtures.ts` wertet #418 seither immer als Testfehler.
- **Nur mit `--dev`: Dev-Server unter Last** — er wächst auf mehrere GB,
  verwirft übersetzte Seiten, und die erste Übersetzung einer Route reißt
  Zeitgrenzen. Dann vor einem Gesamtlauf neu starten, zwischen read und
  write neu starten, und während des Laufs nichts ändern (sonst übersetzt
  er neu). Der Produktions-Build (Standard) hat beides nicht: nichts wird
  nachübersetzt, der Server bleibt klein, zwischen read und write ist kein
  Neustart nötig, und Dateiänderungen während des Laufs wirken erst nach
  dem nächsten Build.
- **Veralteter Build** — `scripts/e2e.mjs` baut neu, wenn Quellen jünger
  sind; läuft auf dem Port aber schon ein Server, wird der mitbenutzt, auch
  wenn er einen älteren Stand zeigt. Nach Änderungen also einen von Hand
  gestarteten `mock:start` beenden.
- **Mehr als 2 Worker für `write`** sind nicht schneller (die längste Datei
  bestimmt die Dauer) und treffen öfter auf fremde „E2E …“-Datensätze in
  Zählungen; `serial`-Dateien überspringen nach einem Fehler den Rest der
  Datei.
- **Lesende Tests nach ändernden** brauchen ein neues Setup (Zählungen).
  Beim Sharding nur einmal Setup, dann jeden Teil mit `--skip-setup`.
- **Sperre nach Fehlversuchen** am MCP-Endpunkt: `mcp-http.spec` schickt
  abgelehnte Anfragen mit zufälliger `X-Forwarded-For`-Adresse, damit
  wiederholte Läufe gegen denselben Server nicht gesperrt werden.
- **Worktrees mit eigener Mock-Datenbank** — `tests/mcp.db.test.ts` liest den
  Namen der Mock-Datenbank aus der Testumgebung (`vitest.config.ts`) und
  läuft deshalb auch mit `MOCK_DATABASE_URL=…/familytree_<paket>_mock`.
- **Windows** — `prisma generate` scheitert mit EPERM, solange ein
  Dev-Server die Engine geladen hat. Nach `npm install` mit neueren
  npm-Versionen einmal `npx prisma generate` ausführen.
- **`npx prisma db push` ohne Mock-Skript** trifft die normale
  Dev-Datenbank (`DATABASE_URL`), nicht die Mock-Datenbank.
- **Abgebrochene Läufe** können „E2E …“-Datensätze zurücklassen; das nächste
  Setup baut die Mock-Daten ohnehin neu auf.
