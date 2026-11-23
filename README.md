# Stammbaum

Webanwendung zur Pflege und Visualisierung eines Familienstammbaums mit
Bildarchiv und rollenbasierter Benutzerverwaltung.

## Quickstart

### Lokal ausprobieren (Mock-Daten)

Voraussetzungen: Node.js 22 oder neuer, Docker (für Postgres), Git.

```bash
cp .env.example .env                              # Standardwerte genügen für die Mock-Daten
npm install
npx prisma generate                               # nötig, wenn npm Install-Skripte blockiert
docker compose -f docker-compose.dev.yml up -d    # nur Postgres
npm run mock:setup                                # Mock-Datenbank, Bilder, Testbenutzer
npm run dev:mock                                  # http://localhost:3100
```

Anmelden per Dev-Login nur mit der E-Mail, z.B. `admin@example.test`
(weitere Rollen: `editor@…`, `viewer@…`). Neuere npm-Versionen führen
Install-Skripte nicht mehr automatisch aus; ohne `npx prisma generate` fehlt
dann der Prisma-Client. Alle Browser-Tests mit einem Befehl (einmalig
`npx playwright install chromium`): `npm run test:e2e` — baut die
Mock-Umgebung als Produktions-Build, startet und beendet den Server selbst
(siehe [Tests](#tests)). Mehr: [Mock-Daten](#mock-daten),
[Lokal starten](#lokal-starten) (eigene Daten statt Mock),
[Entwicklung: Prüfen und Testen](#entwicklung-prüfen-und-testen).

### Produktiv betreiben (Kurzform)

1. Image bauen lassen (Push auf `main`, GitHub Actions) und das Paket auf
   ghcr.io öffentlich machen.
2. In Portainer einen Stack aus dem Repository anlegen (Branch `deploy`,
   [docker-compose.yml](docker-compose.yml)).
3. Variablen aus [stack.env.example](stack.env.example) eintragen — Pflicht:
   `DATA_ROOT`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `PUBLIC_URL`,
   `INITIAL_ADMIN_EMAIL` und mindestens ein OAuth-Paar (GitHub/Google).
4. Reverse-Proxy auf die App zeigen lassen, mit dem Konto von
   `INITIAL_ADMIN_EMAIL` anmelden (erster Administrator), weitere Benutzer
   unter *Benutzer* einladen, Sicherung planen.

Ausführlich: [Betrieb auf der NAS](#betrieb-auf-der-nas-portainer),
Schritt für Schritt unter [Erste Installation](#erste-installation),
[Updates](#updates), [Sicherung](#sicherung).

### KI verbinden (Kurzform)

Als Administrator unter *Benutzer* das KI-Recht vergeben; dann auf
*KI-Zugang* (`/ai-access`) einen persönlichen Schlüssel anlegen. Die Seite
zeigt die Adresse (`<PUBLIC_URL>/api/mcp`) und Anleitungen für Claude Code,
Claude Desktop/Browser und das Telefon. Ausführlich:
[KI-Zugang (MCP)](#ki-zugang-mcp), besonders
[Einrichten: Schritt für Schritt](#einrichten-schritt-für-schritt).

## Inhalt

- [Funktionsumfang](#funktionsumfang) · [Technik](#technik) ·
  [Lokal starten](#lokal-starten) ·
  [Entwicklung: Prüfen und Testen](#entwicklung-prüfen-und-testen) ·
  [Mock-Daten](#mock-daten)
- Bedienung und Fachliches: [Fokus-Ansicht](#fokus-ansicht) ·
  [Bezugsperson](#bezugsperson) · [Karte und Orte](#karte-und-orte) ·
  [Ungenaue Daten](#ungenaue-daten) · [Quellen und Belege](#quellen-und-belege) ·
  [Bilder an Quellen, Ereignissen und Belegen](#bilder-an-quellen-ereignissen-und-belegen) ·
  [Austauschformat](#austauschformat) ·
  [GEDCOM](#gedcom-import-und-export) ·
  [Dubletten zusammenführen](#dubletten-zusammenführen) ·
  [Änderungsgeschichte](#änderungsgeschichte) ·
  [Neuigkeiten](#neuigkeiten)
- Technik und Betrieb: [Dienstschicht](#dienstschicht) ·
  [KI-Zugang (MCP)](#ki-zugang-mcp) ·
  [Betrieb auf der NAS](#betrieb-auf-der-nas-portainer) ·
  [Schema und Migrationen](#schema-und-migrationen) ·
  [Sicherung](#sicherung) · [Datenmodell](#datenmodell) ·
  [Berechtigungen](#berechtigungen) · [Grenzen](#grenzen)
- Weiteres: Komponenten-Doku [docs/komponenten/](docs/komponenten/README.md),
  frühere Stände und Umstiege für alte Installationen
  [docs/dev-history.md](docs/dev-history.md)

## Funktionsumfang

- **Rollen** — Administrator, Bearbeiter, Betrachter
- **Zugang nur auf Einladung** — ein gültiges Google-/GitHub-Konto genügt
  nicht; die E-Mail muss vom Administrator freigeschaltet sein
- **Stammbaum** — Pan/Zoom-Ansicht, Suche, Partner nebeneinander, Adoptiv- und
  Stiefverhältnisse
- **Beziehungen mit Zeitraum** — Hochzeits- und Scheidungsdatum, Adoptionsdatum;
  nachträglich korrigierbar
- **Ungenaue Daten** — „1850“, „03.1850“, „um 1850“, „vor 1900“, „nach 1723“
  statt eines erfundenen 1. Januar; Prüfungen berücksichtigen die Unschärfe
- **Quellen und Belege** — Kirchenbücher, Standesamtsregister, Volkszählungen,
  Grabsteine, Familienunterlagen, Erzählungen, Webseiten; je Angabe (Name,
  Geburt, Tod, Heirat, Abstammung) mit Fundstelle und Verlässlichkeit
- **Zuordnung per Suchfeld** — Tippen statt Drop-Down, mit Geburtsdatum zur
  Unterscheidung Gleichnamiger; unbekannte Personen lassen sich direkt aus dem
  Suchfeld anlegen
- **Drei Ansichten** — die [Fokus-Ansicht](#fokus-ansicht) (eine Person im
  Mittelpunkt, Vorfahren darüber, Nachkommen darunter, Wandern per Klick) als
  Einstieg, dazu der ganze Baum nach Generationen oder als Zeitstrahl mit
  Jahresachse, bei dem früher Geborene weiter oben stehen und Hochzeiten als
  eigene Ereignisse einsortiert werden
- **Bezugsperson** — „Das bin ich“ oder vorübergehend eine andere Person; der
  Baum zeigt an jeder Karte den Verwandtschaftsgrad zu ihr und färbt auf
  Wunsch die vier Großeltern-Linien ([Bezugsperson](#bezugsperson))
- **Karte „Wurzeln nach Jahr“** — wo die Vorfahren in einem Jahr lebten, auf
  einer eigenen Europa-/Weltkarte mit Jahresregler, nach Großeltern-Linien
  eingefärbt; Ortstexte bekommen Koordinaten aus einem mitgelieferten
  Ortsverzeichnis ([Karte und Orte](#karte-und-orte))
- **Bilder** — Upload pro Person, frei wählbares Primärbild (erscheint im
  Stammbaum), eigene Bilder an Hochzeiten, Scans und Fotos an Quellen,
  Lebensereignissen und Belegen („Belegbilder“, auch über die KI per Adresse
  oder Datei, [Bilder an Quellen, Ereignissen und Belegen](#bilder-an-quellen-ereignissen-und-belegen)),
  automatische Vorschaubilder;
  abgelegt als WebP-Dateien in einem Ordner (`MEDIA_DIR`), ausgeliefert nur
  durch die App an angemeldete Nutzer
- **Lebensereignisse und weitere Namen** — Taufe, Beruf, Wohnort,
  Auswanderung, Beerdigung, eigene Ereignisarten …, Ehenamen und
  Schreibvarianten; Datumsbereiche („1920–1925“, „zwischen … und …“) und
  Originalwortlaut ([Datenmodell](#lebensereignisse-namen-und-import))
- **Export und Import** — eigenes Format als JSON oder ZIP inklusive
  Bilddateien (Sicherung, Umzug), Import mit Vorschau und Zusammenführung
- **GEDCOM** — Import aus MyHeritage, Ancestry, Gramps & Co. mit Vorschau,
  Wiedererkennen bei erneutem Import, Schutz von in der App Geändertem und
  verlustfreier Aufbewahrung des Originals; Export als GEDCOM 5.5.1, auch mit
  Bildern ([GEDCOM](#gedcom-import-und-export))
- **Dubletten zusammenführen** — doppelt erfasste Personen finden (auch
  Ehe- gegen Geburtsname und aus verschiedenen Importen), mit einem Klick
  zusammenführen, ohne dass etwas verloren geht; „sichere“ Paare auch
  mehrere auf einmal ([Dubletten zusammenführen](#dubletten-zusammenführen))
- **Importe verbinden** — Personen, die in mehreren Importen vorkommen,
  finden und zusammenführen: aus mehreren Importen wird ein gemeinsamer
  Stammbaum ([Importe verbinden](#importe-verbinden))
- **Benutzerverwaltung** — einladen, Rolle ändern, sperren, löschen; die
  E-Mail-Adresse eines noch nie angemeldeten Benutzers korrigieren
  ([Benutzerverwaltung](#benutzerverwaltung))
- **Build-Angabe** — die Fußzeile jeder Seite zeigt, welcher Stand läuft
  („Build 2026.11.19 · 68c8471“; auf der Anmeldeseite nur das Datum)
- **KI-Zugang** — KI-Assistenten (Claude Code, Claude Desktop) recherchieren
  über die MCP-Schnittstelle der App mit und tragen auf Wunsch Ergebnisse samt
  Belegen ein; nur mit vom Administrator freigegebenem Recht, persönlichem
  Schlüssel und den Familienrechten des Benutzers ([KI-Zugang](#ki-zugang-mcp))
- **Änderungsgeschichte** — jede Änderung landet im `AuditLog` (vorher →
  nachher je Feld, Benutzer, Kanal App oder KI samt Schlüssel), gebündelt zu
  Paketen; Verlauf je Person für ihre Bearbeiter, Übersicht je Familie und
  Zeitraum für Administratoren ([Änderungsgeschichte](#änderungsgeschichte))
- **Neuigkeiten** — was eine neue Version bringt, in Anwendersprache: einmal
  als Fenster „Was ist neu?“ nach dem Ausrollen, jederzeit auf der Seite
  „Neuigkeiten“ (Link in der Fußzeile) ([Neuigkeiten](#neuigkeiten))

## Technik

| Ebene | Wahl |
|---|---|
| Frontend + API | Next.js 15 (App Router), TypeScript, Tailwind |
| Datenbank | PostgreSQL 17 + Prisma |
| Anmeldung | Auth.js v5 (GitHub, Google, Dev-Login) |
| Bilder | Dateien im Medienordner (`MEDIA_DIR`), sharp |
| Visualisierung | React Flow (Layout selbst geschrieben, `lib/layout-generations.ts`) |
| KI-Schnittstelle | MCP (`@modelcontextprotocol/sdk`), Streamable HTTP unter `/api/mcp`, Anmeldung mit persönlichem Schlüssel |
| Betrieb | Docker Compose (Portainer), ein App-Image aus GitHub Actions über ghcr.io |

## Lokal starten

```bash
cp .env.example .env      # AUTH_SECRET und INITIAL_ADMIN_EMAIL anpassen
npm install
npx prisma generate                               # falls npm Install-Skripte blockiert

docker compose -f docker-compose.dev.yml up -d   # Postgres
npm run db:push                                   # Schema anlegen
npm run db:seed                                   # Admin + Demofamilie
npm run dev
```

→ http://localhost:3000

Bilder legt die App als Dateien unter `MEDIA_DIR` ab (lokal `./data/media`,
per `.gitignore` ausgenommen; der Ordner wird bei Bedarf angelegt). Der
Schlüssel in der Datenbank (`MediaAsset.storageKey`, z.B.
`originals/<uuid>.webp`, Vorschau unter `thumbs/`) ist der relative Pfad
darunter. `GET /api/health` meldet `error`, wenn der Ordner nicht beschreibbar
ist; der genaue Grund steht im Server-Log.

Ohne konfiguriertes OAuth greift der **Dev-Login** (`ENABLE_DEV_LOGIN=true`):
E-Mail eingeben, kein Passwort. Er funktioniert nur außerhalb von
`NODE_ENV=production` und nur für E-Mails, die bereits in der Benutzerliste
stehen. Einzige Ausnahme: der Produktions-Build der Mock-Umgebung für die
E2E-Tests (`npm run mock:start`), und auch der nur mit Mock-Datenbank,
Mock-Medienordner und ausdrücklicher Freigabe (`lib/dev-login.ts`).

## Entwicklung: Prüfen und Testen

| Befehl | Zweck |
|---|---|
| `npm run typecheck` | TypeScript-Prüfung (`tsc --noEmit`) |
| `npm run lint` | ESLint (Flat-Config `eslint.config.mjs`, Next-Regeln) |
| `npm test` | Vitest — Unit-Tests und Dienst-Tests |
| `npm run test:watch` | Vitest im Watch-Modus |

Die Unit-Tests (Rechte, Validierung, Graph-Algorithmen, Layout) brauchen keine
Datenbank. Die Dienst-Tests (`tests/services.db.test.ts`) laufen gegen die
**Mock-Datenbank** und überspringen sich mit Hinweis, wenn diese nicht
erreichbar oder leer ist — vorher also `npm run mock:setup`. Die Tests greifen
nie auf die normale Datenbank zu; schreibende Tests räumen ihre eigenen
Datensätze wieder ab.

### Tests

**Unit- und Dienst-Tests** (Vitest, Ordner `tests/`): `npm test`. Ohne
laufende Mock-Datenbank überspringen sich die `*.db.test.ts` mit Hinweis, der
Rest läuft trotzdem (so auch in der CI).

**End-to-End-Tests** (Playwright, Ordner `e2e/`) bedienen die App im Browser
(Chromium) gegen die Mock-Umgebung — standardmäßig gegen einen
**Produktions-Build** der Mock-Umgebung (`next build` nach `.next-e2e`,
`next start` auf dem Mock-Port), nicht gegen den Dev-Server.

Voraussetzungen: Docker Desktop läuft (`docker compose -f
docker-compose.dev.yml up -d` — Postgres), die Mock-Datenbank ist
einmal angelegt (`npm run mock:setup`), und einmalig `npx playwright install
chromium`.

| Befehl | Zweck | Dauer (Build aktuell) |
|---|---|---|
| `npm run test:e2e` | **alles mit einem Befehl:** Build prüfen (nur bei geänderten Quellen neu), Server starten, setup → read → write, Server beenden | ca. 1,5–3 min, mit Neubau 1–2 min mehr (früher gegen den Dev-Server 9–10 min) |
| `npm run test:e2e:setup` | nur Ausgangszustand: Mock-Daten neu, Anmeldungen | ca. 10 s |
| `npm run test:e2e:read` | setup + lesende Tests (`e2e/read/`, 209 Tests, 6 parallel) | ca. 1 min (früher 3:10–3:20 min) |
| `npm run test:e2e:write` | setup + ändernde Tests (`e2e/write/`, 103 Tests, 2 Dateien parallel) — ohne die lesenden | ca. 1:10 min (früher 4–5 min) |
| `npm run mock:build` / `npm run mock:start` | Build von Hand erzeugen bzw. den Server von Hand starten (z.B. für mehrere Terminals) | |
| `npm run test:e2e:headed` | alles mit sichtbarem Browser, ein Test nach dem anderen | |
| `npm run test:e2e:ui` | Playwright-Oberfläche: Tests einzeln starten, Schritte ansehen | |
| `npm run test:e2e:report` | HTML-Bericht des letzten Laufs öffnen | |

Eigene Optionen von `scripts/e2e.mjs` (nach `--`): `--dev` testet wie
früher gegen den Mock-Dev-Server (`npm run dev:mock`, Vorwärmen im Setup,
4 bzw. 2 Worker), `--rebuild` baut in jedem Fall neu, `--no-build` nimmt den
vorhandenen Build ungeprüft, `--skip-setup` siehe unten. Port und Datenbank
je Worktree wie bisher: `MOCK_PORT` in der Shell, `MOCK_DATABASE_URL` in der
`.env`. Läuft auf dem Port schon ein Server, wird er mitbenutzt und nicht
beendet (das Skript sagt, ob Dev-Server oder Build) — sonst startet und
beendet es ihn selbst.

Alle `test:e2e*`-Befehle reichen weitere Argumente an `playwright test`
durch (nach `--`), z.B. eine einzelne Datei oder einen Testnamen:

```bash
npm run test:e2e:write -- e2e/write/sources.spec.ts
npm run test:e2e:read -- e2e/read/permissions.spec.ts -g "Betrachter"
npm run test:e2e -- e2e/read/export.spec.ts e2e/write/media.spec.ts
npm run test:e2e -- --dev e2e/read/auth.spec.ts      # gegen den Dev-Server
```

Mit Filter (Datei oder `-g`) läuft `npm run test:e2e` in drei Schritten
nacheinander: Setup, die passenden lesenden, dann die passenden ändernden
Tests. Sonst zöge ein Filter auf eine `write`-Datei alle lesenden Tests als
Abhängigkeit mit. Der HTML-Bericht enthält danach nur den letzten Schritt.

**Setup überspringen:** Ist der Ausgangszustand schon vorbereitet (gerade
`npm run test:e2e:setup` gelaufen), spart
`--skip-setup` (oder Umgebungsvariable `E2E_SKIP_SETUP=1`) das Setup: `npm run test:e2e:write -- --skip-setup e2e/write/sources.spec.ts`.
Die ändernden Tests räumen ihre Datensätze selbst ab und lassen sich daher
mehrfach hintereinander ohne neues Setup laufen; die lesenden zählen gegen den
frisch befüllten Stand und brauchen ein Setup, nachdem ändernde Tests liefen.

Der Produktionsserver startet in gut einer Sekunde; ein eigener Server im
Hintergrund lohnt sich kaum. Wer trotzdem einen will (oder beim Sharding):
`npm run mock:build`, dann `npm run mock:start` in einem eigenen Terminal —
die Läufe benutzen ihn mit. Nach Codeänderungen diesen Server beenden, sonst
testen die Läufe den alten Stand.

**Auf mehrere Terminals verteilen (Sharding):** `npm run mock:start` in
einem eigenen Terminal (sonst beendet der zuerst fertige Teil den Server
der anderen), einmal `npm run test:e2e:setup`, dann in jedem Terminal einen
Teil mit `--skip-setup` — etwa
`npm run test:e2e:read -- --skip-setup --shard=1/2` und
`npm run test:e2e:read -- --skip-setup --shard=2/2`. Ohne `--skip-setup`
würde jeder Teil die Mock-Daten neu aufbauen, während die anderen noch laufen.
Die ändernden Tests erst nach den lesenden starten (sie verändern Zählungen).

**Worker** (gemessen gegen den Build): lesende 6 (6 und 8 je rund 55 s);
ändernde 2 Dateien gleichzeitig — 6 waren mit 64 statt 67 s kaum schneller,
weil die längste Datei die Dauer bestimmt, und mit 4 trafen Zählungen auf
fremde „E2E …“-Datensätze.

Ablauf: `scripts/e2e.mjs` baut bei Bedarf (`npm run mock:build`, Ordner
`.next-e2e`, getrennt von `.next` und `.next-mock`) und startet `npm run
mock:start` auf dem Mock-Port. Der Dev-Login ist in Produktion gesperrt; der
Server bekommt deshalb eine eng begrenzte Freigabe, die nur zusammen mit
Mock-Datenbank (`…_mock`/`…_test`) und Mock-Medienordner wirkt
(`lib/dev-login.ts`, [Komponenten-Doku](docs/komponenten/bibliotheken.md)).
Das Projekt `setup` baut die Mock-Daten neu auf (`npm run db:mock`) und
meldet jede Rolle einmal an (`e2e/.auth/`); nur gegen den Dev-Server ruft es
zusätzlich die Seiten einmal auf, damit Next.js sie vorab kompiliert. Danach
laufen die lesenden Tests (`e2e/read/`) parallel, erst
dann die ändernden (`e2e/write/`); diese legen eigene, „E2E …“ benannte
Datensätze an und räumen sie wieder ab. Jeder Test schlägt außerdem fehl, wenn
im Browser ein unerwarteter Konsolenfehler oder eine nicht abgefangene
Ausnahme auftritt (`e2e/support/fixtures.ts`) — mit einer Ausnahme: den
bekannten, seltenen Hydration-Fehler beim Laden (React #418, siehe
UEBERGABE) meldet die Wache gegen den Build nur (`[bekannt] …` in der
Ausgabe, Anmerkung im Bericht); `E2E_STRICT_HYDRATION=1` macht ihn wieder
zum Fehler. Die Tests sprechen nur mit der
App (Browser und HTTP-API), nie direkt mit Datenbank oder Medienordner. Den
KI-Zugang prüfen `e2e/write/ai-access.spec.ts` (Recht vergeben, Schlüssel
anlegen und widerrufen) und `e2e/read/mcp-http.spec.ts` (`/api/mcp` mit den
festen Mock-Schlüsseln; abgelehnte Anfragen mit zufälliger
`X-Forwarded-For`-Adresse, damit wiederholte Läufe gegen denselben
Server nicht in die Sperre nach Fehlversuchen laufen). Den
GEDCOM-Import prüft `e2e/write/gedcom-import.spec.ts` mit eigenen, im Test
erzeugten Dateien (eigener Baum, eigene Familie): Vorschau mit Gruppen,
Baumwahl und Abbrechen, Erst- und Wiederholungsimport, geänderte Datei (in
der App geändert, fehlend, löschen nur nach Bestätigung), abgelehnte
Beziehung mit erhaltenem Original, Vorschlag, Verlauf mit Originaldatei und
Rohdaten, Sichtbarkeit ohne Familie, beide GEDCOM-Exporte (mit
`lib/gedcom` zurückgelesen), Rechte (403) und dass ohne Foto-Haken keine
Anfrage nach außen geht. Er räumt Personen, Quellen und Familien wieder ab;
ausgeführte Läufe bleiben bis zum nächsten Setup im Verlauf. Ändernde Tests,
die einen Export wieder einspielen (`import.spec.ts`, `media.spec.ts`),
beschränken ihn auf eigene Datensätze — sonst setzten sie Daten
gleichzeitig laufender Tests auf einen älteren Stand zurück.

**Fehlersuche bei einem roten E2E-Test:**

- `npm run test:e2e:report` öffnen; bei Fehlschlägen liegen dort Screenshot
  und Trace (`npx playwright show-trace test-results/…/trace.zip` zeigt jeden
  Schritt mit DOM, Netzwerk und Konsole).
- Den Test einzeln und sichtbar wiederholen:
  `npm run test:e2e:write -- --skip-setup e2e/write/sources.spec.ts --headed -g "Quelle löschen"`.
- Wackelt ein Test, mit `--repeat-each=3` wiederholen.
- Nach einem abgebrochenen Lauf können „E2E …“-Datensätze übrig sein — das
  nächste Setup baut die Mock-Daten ohnehin neu auf.

## Mock-Daten

Für Entwicklung, Tests und Vorführungen gibt es einen deterministischen
Testdatensatz in einer **eigenen Datenbank** (`familytree_mock`) und einem
**eigenen Medienordner** (`./data/media-mock`) — die normale Datenbank und
`./data/media` bleiben unberührt.

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres
npm run mock:setup    # Datenbank anlegen, Schema anwenden, befüllen, Bilder erzeugen
npm run dev:mock      # Dev-Server gegen die Mock-Daten: http://localhost:3100
```

| Befehl | Zweck |
|---|---|
| `npm run mock:setup` | legt `familytree_mock` an (falls nötig), `prisma db push`, befüllt |
| `npm run db:mock` | nur neu befüllen (löscht vorher alle Mock-Daten) |
| `npm run dev:mock` | `next dev` auf Port **3100** mit Build-Ordner `.next-mock` — läuft parallel zum normalen Dev-Server auf 3000 |
| `npm run mock:env` | zeigt die berechnete Mock-Umgebung |

Die Befehle laufen über `scripts/mock.mjs` (plattformunabhängig, auch unter
Windows). Der Name der Mock-Datenbank wird aus `DATABASE_URL` abgeleitet
(`…/familytree` → `…/familytree_mock`) oder über `MOCK_DATABASE_URL` gesetzt.
`prisma/seed-mock.ts` verweigert den Dienst, wenn der Datenbankname nicht auf
`_mock` oder `_test` endet, und ebenso, wenn der Medienordner nicht auf `-mock`
oder `-test` endet (anderer Ordner über `MOCK_MEDIA_DIR`). Jeder Lauf leert
Mock-Datenbank und Mock-Medienordner und baut alles neu auf; das Ergebnis ist
bei jedem Lauf identisch, einschließlich der IDs (`mock-p-001`, `mock-r-0001`,
`mock-family-a`, …). Geleert werden dabei auch Importläufe, Herkunft,
Fremdkennungen und Rohdaten samt den aufbewahrten Importdateien — die Mock-Daten
selbst enthalten keinen Import. Zum Ausprobieren des GEDCOM-Imports liegen
erfundene Dateien in `tests/fixtures/gedcom/` (`minimal-551.ged`,
`myheritage.ged` im MyHeritage-Stil, `gedcom7.ged`, `torture.ged` mit
Grenzfällen); echte Stammbäume gehören nicht ins Repository.

**Inhalt** (Generator: `prisma/mock-data.ts`, auch direkt in Tests nutzbar;
Quellen `mock-s-01` … `mock-s-09`, Belege `mock-c-001` …):
rund 195 Personen über sechs Generationen ab ca. 1860 in vier Familien:

| ID | Familie |
|---|---|
| `mock-family-a` | Familie Becker (Hannover) |
| `mock-family-b` | Familie Hoffmann (Sachsen) |
| `mock-family-c` | Familie Wagner (Franken) |
| `mock-family-d` | Familie Schulz (Ostsee) |

Die Familien sind durch Heiraten verbunden (Eingeheiratete gehören zu beiden
Familien). Eingebaut sind außerdem: Scheidung mit Wiederheirat,
Halbgeschwister, ein Stiefkind, eine Adoption (Kind mit leiblicher Mutter und
zwei Adoptiveltern, also drei Elternteilen), ein Pflegekind, Personen mit
fehlenden Angaben (Geburtsdatum, Geburtsort, Geschlecht, Sterbedatum bei über
100-Jährigen), drei mögliche Dubletten, drei Personen ohne Familie (nur für
Admins sichtbar), Notizen sowie Platzhalter-Porträts und zwei Hochzeitsfotos.
Die ältesten Generationen haben ungenaue Daten (nur Jahr oder Monat, „um“,
„vor“, Hochzeiten nur mit Jahr). Neun Quellen verschiedener Art belegen
Angaben über mehrere Personen und Ehen; eine davon (Heiratsregister) ist in
Familie A und für eine Person nur aus Familie B zitiert, eine nur in
Familie D, eine ist noch unbelegt. Die meisten Personen haben keinen Beleg.
Dazu kommen Lebensereignisse (`mock-e-001` …: Taufe, Beruf, Beerdigung der
Stammväter, ein Wohnort „von … bis …“, ein Abschluss „zwischen … und …“, eine
Konfirmation nur mit Wortlaut, ein sonstiges Ereignis „Kapitänspatent“, eine
Verlobung an einer Ehe, eine abweichende zweite Geburtsangabe; für die
[Karte](#karte-und-orte) Wohnorte und eine Auswanderung in GEDCOM-Ortsformen,
auch mit historischen Namen: „Breslau, Schlesien, Preußen“, „Temeswar,
Banat“, „Berkum, Peine, Lk Peine, Niedersachsen, Germany“, „New York, New
York, USA“), Heiratsorte
bei zwei von drei datierten Ehen, ein Scheidungsort, zwei Partnerschaften
mit unbekanntem Ehestand, Rufname, Titel, Namenszusatz, eine Todesursache und
zwei weitere Namen (`mock-n-01`, `mock-n-02`).
Die IDs dieser Sonderfälle liefert `generateMockData().landmarks`
(`landmarks.genealogy` für die Ereignisse und Namen).

**Benutzer** (Anmeldung per Dev-Login, nur E-Mail):

| E-Mail | Rolle | Familien | KI-Zugang |
|---|---|---|---|
| `admin@example.test` | Administrator | alle | lesen und schreiben |
| `editor@example.test` | Bearbeiter | A bearbeiten, B lesen | lesen und schreiben |
| `viewer@example.test` | Betrachter | A lesen | lesen |
| `nofamily@example.test` | Betrachter | keine | kein Zugang |
| `blocked@example.test` | gesperrt | (A lesen) — Anmeldung schlägt fehl | (lesen) |

Der Bearbeiter hat eine eigene Person (`landmarks.selfEditor`, in Familie A,
alle vier Großeltern bekannt; die Großeltern mütterlicherseits gehören nur zu
Familie D und sind für ihn gesperrt) — damit zeigt sein Baum gleich
Verwandtschaftsgrade und Linien.

**Feste KI-Schlüssel** für Tests und Entwicklung, ebenfalls deterministisch
(`npm run -s mcp:key <name>` gibt den Schlüssel aus, Standard `editor-read`):
`admin-write`, `editor-write`, `editor-read`, `viewer-read`, `viewer-write`
(Schlüssel „schreiben“ beim Betrachter mit Recht „lesen“ — wirkt nur lesend),
`editor-revoked` (widerrufen), `editor-expired` (abgelaufen),
`nofamily-read` (Benutzer ohne KI-Recht → 403), `blocked-read` (gesperrter
Benutzer → 401). Sie stehen öffentlich im Repository
([prisma/mock-data.ts](prisma/mock-data.ts)) und existieren nur in der
Mock-Datenbank — in einer echten Installation legt sie niemand an, und dort
funktionieren sie nicht.

## Fokus-Ansicht

Der ganze Baum wächst mit jeder Person in die Breite (die Mock-Daten mit 195
Personen sind über 10 000 px breit). Die Baumseite beginnt deshalb mit einem
Ausschnitt: eine Person im Mittelpunkt, darüber ihre Vorfahren, darunter ihre
Nachkommen — für die Startperson der Mock-Daten 23 Personen auf rund
1 900 × 750 px.

- **Inhalt** — Fokusperson mit allen Partnern, Vorfahren (leibliche, Adoptiv-,
  Stief- und Pflegeeltern) bis zur gewählten Tiefe, Geschwister und
  Halbgeschwister, Nachkommen bis zur gewählten Tiefe samt deren Partnern bzw.
  weiteren Elternteilen. Tiefe je Richtung 1–4 (Standard 2) über „Vorfahren“
  und „Nachkommen“ in der Werkzeugleiste.
- **Rand** — Karten am Rand zeigen, was jenseits liegt: „▲ Vorfahren“ (weitere
  Eltern) und „▼ +3 Kinder“ (Kinder außerhalb des Ausschnitts, z.B. Onkel und
  Tanten bei Großeltern). Ein Klick auf die Karte holt sie in den Ausschnitt.
- **Klicks** — in der Fokus-Ansicht stellt ein Klick auf eine Karte die Person
  in den Mittelpunkt; die angeklickte Karte bleibt dabei stehen, die übrigen
  gleiten an ihren Platz. Die Personenseite öffnet das Symbol in der
  Kartenecke (bzw. die Karte der Fokusperson selbst). Im ganzen Baum ist es
  umgekehrt: Karte → Personenseite, Ecksymbol → Fokus-Ansicht.
- **Adresse** — `/tree?focus=<id>&up=<1–4>&down=<1–4>`; Standardwerte entfallen.
  Zurück/Vor, Neuladen und „Im Stammbaum zeigen“ auf der Personenseite führen
  dorthin. Den ganzen Baum zeigen `/tree?view=generations` bzw.
  `/tree?view=timeline` (mit `focus=<id>` darauf zentriert).
- **Einstieg** — ohne `focus` die zuletzt fokussierte Person (Cookie
  `tree-focus`, wird serverseitig auf Sichtbarkeit geprüft), sonst die
  sichtbare Person, deren Ausschnitt die meisten Generationen und darin die
  meisten sichtbaren Verwandten zeigt. Ohne gemerkte Person steht die
  [Bezugsperson](#bezugsperson) im Mittelpunkt.
- **Suche** — durchsucht in der Fokus-Ansicht den ganzen sichtbaren Bestand
  (`/api/persons?q=`) und stellt den Treffer in den Mittelpunkt.
- **Gesperrte Personen** erscheinen wie im ganzen Baum als Platzhalter (ohne
  Randhinweise) und können nicht in den Mittelpunkt rücken; eine unbekannte
  oder gesperrte `focus`-ID ergibt einen Hinweis statt eines leeren Bildes.
- **Filter** — der Familienfilter ist in der Fokus-Ansicht abgeschaltet (der
  Ausschnitt zeigt ohnehin nur nahe Verwandte). „Ehen zeigen“ aus blendet
  Partner ohne gemeinsames Kind im Ausschnitt aus; Eltern der Nachkommen
  bleiben.

Der Server schickt nur den Ausschnitt (`loadFocusTree` in
[lib/services/tree.ts](lib/services/tree.ts), aufgebaut auf dem maskierten
Graphen von `loadTree`; Auswahl und Layout in
[lib/focus-tree.ts](lib/focus-tree.ts)). Den ganzen Graphen lädt die Seite erst
beim Wechsel auf „Generationen“ oder „Zeitstrahl“. Das Layout ist dasselbe wie
in der Generationenansicht, nur mit fest vorgegebenen Ebenen (Abstand zur
Fokusperson) und engerem Zeilenabstand.

## Bezugsperson

Jeder Benutzer kann sich eine Person zuordnen („das bin ich“): auf der
Personenseite mit **„Das bin ich“** (nur für Personen, die er sehen darf),
oder ein Administrator tut es in der Benutzerverwaltung („Person:
zuordnen“). Gespeichert in `User.personId` (Migration
`20261122000001_bezugsperson`, `ON DELETE SET NULL`; beim Zusammenführen
wandert der Verweis auf die bleibende Person).

Daneben lässt sich **vorübergehend eine andere Person** als Bezugsperson
wählen — etwa im Gespräch mit dem Sohn, um den Baum aus seiner Sicht zu
zeigen: „Baum aus dieser Sicht“ auf seiner Personenseite bzw.
`/tree?bezug=<id>` (auch `/people/<id>?bezug=<id>`). Der Browser merkt sie
sich im Cookie `tree-bezug`; oben steht dann deutlich „Sicht von: <Name> ·
zurück zu mir“ (ohne eigene Person: „aufheben“), `?bezug=ich` führt ebenfalls
zurück. Vorrang: Adresse vor Cookie vor eigener Person.

- **Baum** (alle drei Ansichten) — unter jeder Karte der Verwandtschaftsgrad
  zur Bezugsperson („Urgroßvater väterlicherseits“, „Cousine 1. Grades,
  eine Generation darüber“, „Schwägerin“, „angeheirateter Onkel …“), auch für
  Screenreader. Die Bezugsperson selbst ist gestrichelt umrandet und trägt
  „Bezugsperson“ bzw. „ich · Bezugsperson“. Ohne `focus` steht sie in der
  Fokus-Ansicht im Mittelpunkt.
- **Linien** (Schalter in der Werkzeugleiste, im Cookie `tree-lines` gemerkt)
  — Vorfahren nach den vier Großeltern getönt, wie bei MyHeritage: väterlich
  Blau (Vater des Vaters, „VV“) und Grün („VM“), mütterlich Rot („MV“) und
  Gelb („MM“). Nie nur Farbe: jede Karte trägt zusätzlich Streifen und
  Kurzzeichen, die Legende nennt die vier Großeltern. Vater und Mutter
  gehören zu beiden Linien ihrer Seite, Vorfahren mit Ahnenschwund zu
  mehreren; alle anderen bleiben neutral. Auch die **Verbindungen** der
  Ahnenketten sind farbig (`edgeLine` in [lib/reference.ts](lib/reference.ts)):
  eine Eltern-Kind-Linie bekommt die Farbe, wenn Eltern- und Kindseite genau
  eine Linie gemeinsam haben; Verbindungen zu Vater/Mutter/Bezugsperson
  (mehrere Linien) und zu Seitenverwandten bleiben grau, das Strichmuster der
  Elternschaftsart bleibt. Farben als CSS-Variablen (`--line-ff` …) in
  [app/globals.css](app/globals.css), je eigene Werte für das dunkle
  Farbschema.
- **Personenseite** — „Für dich (…) ist X: Großonkel väterlicherseits“, dazu
  „Das bin ich“ und „Baum aus dieser Sicht“.

**Berechnung** ([lib/reference.ts](lib/reference.ts)): ein Durchgang von der
Bezugsperson aus statt einer Abfrage je Paar — erst ihre Vorfahren
(`ancestorDistances`), dann von allen Vorfahren gleichzeitig abwärts,
geordnet nach (Abstand gesamt, Abstand hinauf); das ergibt für jede Person
den nächsten gemeinsamen Vorfahren wie `findBloodRelation`, samt Halb-,
Adoptiv- und väterlicher-/mütterlicherseits. Wer nicht blutsverwandt ist,
bekommt den Begriff des kürzesten Wegs über Eltern- und Partnerkanten
(`describePath`, dieselben Wege wie `shortestPath`); passt kein Begriff,
bleibt die Karte ohne Angabe. `tests/reference.test.ts` vergleicht das
Ergebnis für alle Paare der Mock-Daten und erzeugter Bäume mit
`kinshipInGraph`. Linien: Vater/Mutter (leiblich vor adoptiv, je
Geschlecht), deren Eltern als die vier Großeltern, und deren Vorfahren.
Gemessen: rund 1 ms auf den Mock-Daten, rund 50 ms für 10 000 erzeugte
Personen mit 23 000 Kanten.

**Datenschutz**: gerechnet wird nur auf dem Graphen der Personen, die der
Benutzer sehen darf (Kanten zwischen zwei sichtbaren Personen,
`visibleIndex` in [lib/services/reference.ts](lib/services/reference.ts)).
Gesperrte Platzhalter bekommen keine Angabe und keine Linie, kein Weg führt
über sie (ein sichtbarer Urgroßvater hinter einem gesperrten Großvater bleibt
ohne Bezeichnung), eine gesperrte Person kann nicht Bezugsperson sein
(unbekannt und gesperrt sehen gleich aus), und die Legende nennt nur
sichtbare Großeltern („nicht erfasst“ sonst). Das ist strenger als die
MCP-Abfrage `get_kinship`, die Wege durch Platzhalter zulässt.

## Karte und Orte

**Karte „Wurzeln nach Jahr“** (`/map`, Menüpunkt „Karte“): Wo lebten die
Vorfahren in einem bestimmten Jahr? Eine eigene Welt-/Europakarte mit
Jahresregler und „Abspielen“; je Ort ein Kreis, dessen Fläche mit der Zahl
der Personen wächst, eingefärbt nach den vier Großeltern-Linien der
[Bezugsperson](#bezugsperson) (gleiche Farben und Kurzzeichen VV/VM/MV/MM wie
im Baum, zusätzlich ein Muster je Linie; gemischte Orte als Tortenstücke). Ein
Klick auf einen Kreis listet die Personen mit Link zur Personenseite.

- **Ausgangsperson** — ohne Angabe die Bezugsperson (Adresse vor Cookie
  `tree-bezug` vor „das bin ich“), sonst „Andere Person …“ (`?person=<id>`;
  ändert die Bezugsperson des Baums nicht). **Auswahl** „Vorfahren“
  (Standard, samt Ausgangsperson) oder „Alle sichtbaren Personen“
  (`?mode=vorfahren|alle`; ohne Ausgangsperson „alle“, dann ohne Linien).
  `?jahr=` gibt das Jahr vor; beim Verstellen schreibt die Seite es in die
  Adresse, ohne neu zu laden.
- **Lebend** im Jahr J: Beginn ≤ J ≤ Ende. Beginn = Geburtsjahr, sonst das
  früheste datierte Ereignis (Taufe, Heirat …). Ende = Todesjahr, sonst das
  Jahr der Beerdigung/Einäscherung, sonst geschätzt: Beginn + 100 Jahre
  (mindestens das letzte datierte Ereignis, höchstens das laufende Jahr).
  Personen ganz ohne Datum stehen nur in der Zahl „ohne Lebensdaten“.
- **Ort** im Jahr J: der zuletzt bekannte bis einschließlich J — Geburt,
  Ereignisse mit Ort und Datum (Wohnort, Volkszählung, Beruf, Auswanderung …),
  Heirat und Scheidung (Ort an der Beziehung, für beide Partner), Tod. Ein
  Geburtsort ohne Geburtsdatum gilt ab dem Beginn, andere Angaben ohne Datum
  zählen nicht, abweichende Zweitangaben auch nicht; im selben Jahr zählt die
  letzte Angabe. Vor der ersten Ortsangabe: „ohne bekannten Ort“ (Zähler,
  anklickbar). Ein Ortstext ohne Koordinaten zählt als „Ort, der nicht auf
  der Karte ist“ — er verdrängt einen früheren Ort.
- **Ungenaue Daten** zählen mit ihrem Jahr: „um 1850“, „vor 1850“, „nach
  1850“ als 1850, „zwischen 1850 und 1854“ als 1852, ein Zeitraum „von …
  bis …“ mit seinem Beginn. Orte, die nur als Region oder Land bekannt sind,
  stehen in deren Mitte (in der Personenliste vermerkt).
- **Bedienung** — Ziehen verschiebt (auch mit dem Finger), Mausrad bzw. zwei
  Finger zoomen, Knöpfe „+“/„−“ und die Ausschnitte „Orte“ (alle Orte der
  Auswahl, Standard), „Europa“, „Welt“; auf der fokussierten Karte
  Pfeiltasten und +/−. Der Jahresregler ist ein normales Schiebefeld. Für
  Screenreader und Tastatur stehen dieselben Angaben in der Liste „Orte im
  Jahr …“ unter der Karte. Hinweis „heutige Grenzen“ auf der Karte.
- **Datenschutz** — gerechnet wird nur mit Personen, die der Benutzer sehen
  darf: Vorfahren und Linien auf dem Graphen der sichtbaren Personen
  (`visibleIndex`, wie bei der Bezugsperson), Ereignisse und Heiraten nur
  dieser Personen. Gesperrte erscheinen weder auf der Karte noch in einer
  Zahl; eine gesperrte `?person=` wird still ignoriert. Dieselben Daten
  liefert `GET /api/map?person=&mode=ancestors|all`.
- **Leistung** — der Server rechnet einmal je Ausgangsperson
  ([lib/services/map.ts](lib/services/map.ts),
  [lib/map/build.ts](lib/map/build.ts)), der Browser wechselt die Jahre
  selbst ([lib/map/year.ts](lib/map/year.ts)). Gemessen: Mock-Daten rund
  25 ms; mit 12 000 zusätzlichen Personen in der Mock-Datenbank 1,1–1,4 s
  auf dem Server (überwiegend das Laden des Graphen und der Ereignisse),
  1,4 MB Daten; ohne Datenbank 63 ms Aufbau und 0,6 ms je Jahr
  (`tests/map.test.ts`).

**Orte zuordnen** (`/admin/places`, nur Administratoren; verlinkt auf der
Karte und unter „Daten“): Orte sind Freitext. Die Tabelle `Place` (Migration
`20261123000001_orte`) ordnet jedem normalisierten Ortstext (`placeKey`:
Groß-/Kleinschreibung und Leerzeichen vereinheitlicht) Koordinaten zu, mit
Herkunft (automatisch/von Hand), Genauigkeit (Ort/Region/Land) oder „nicht
zuordenbar“. Die Seite listet alle vorkommenden Ortstexte (Geburt, Tod,
Heirat, Scheidung, Ereignisse) mit Häufigkeit, Zuordnung und Vorschlag
(„mehrdeutig“, wenn es einen ähnlich großen gleichnamigen Ort anderswo gibt).
Von Hand: Vorschlag übernehmen bzw. bestätigen, im Verzeichnis suchen (auch
alte Namen), Koordinaten eingeben, „nicht zuordenbar“, zurücksetzen.
**Neue Ortstexte ordnet die App selbst zu** (Migration
`20261124000001_orte_ki`): nach dem Speichern einer Person, eines Ereignisses
oder einer Beziehung und nach GEDCOM- bzw. Austausch-Import, im Hintergrund —
das Speichern wartet nicht darauf und scheitert nie daran; nur Texte ohne
Zuordnung, ohne Treffer bleiben sie offen. Der Knopf **Automatisch zuordnen**
ordnet den Altbestand neu zu (alle Texte, die weder von Hand bestätigt noch
von der KI gesetzt sind); von Hand Bestätigtes wird nie überschrieben.
**Zuordnungen des KI-Assistenten** (MCP `assign_place`, siehe
[KI-Zugang](#ki-zugang-mcp)) stehen als „von KI“ mit eigenem Filter, ggf.
„unsicher“ und der Begründung der KI; sie gelten sofort für die Karte, die
Automatik überschreibt sie nie, der Admin **bestätigt** sie (→ von Hand) oder
ändert sie. Mit eigenen Koordinaten angelegte Orte (Wüstung, Hof, Weiler)
sind **eigene Orte** und werden bei späteren Texten wieder vorgeschlagen.

**Ortsseiten** (`/places/<Kennung>`, für alle Angemeldeten): Jeder
zugeordnete Ort hat eine Seite mit heutigem Namen (früherer/deutscher Name),
Region, Land, Koordinaten und kleiner Lagekarte, Herkunft der Zuordnung
(Begründung nur für Admins), den Freitexten, die auf ihn zeigen, weiteren
Namen aus dem Verzeichnis und den Personen mit Angaben dort (Geburt, Tod,
Heirat, Scheidung, Ereignisse — mit Art und Jahr), 50 je Seite. Ein Ort sind
alle Zuordnungen mit demselben Verzeichniseintrag bzw. bei eigenen Orten
denselben Koordinaten. Es erscheinen nur Personen, die der Benutzer sehen
darf; Freitexte nur gesperrter Personen fehlen, ein Ort ohne sichtbare
Angabe gilt als nicht vorhanden. Auf der **Personenseite** wird jeder
zugeordnete Ort zum Link mit dem systematischen Namen („Karlsruhe,
Baden-Württemberg, Deutschland“, „Wrocław (Breslau), Polen“); der Freitext
steht im Titel und dezent daneben, wenn er mehr sagt als der Ortsname
(`textCoveredByLabel` in `components/PlaceText.tsx`).

**Echte Orte auswählen:** Unter jedem Ortsfeld öffnet „Ort wählen …“ die
Kandidaten (Verzeichnis und eigene Orte). Die Wahl wird nach dem Speichern
als Zuordnung „von Hand“ genau für diesen Freitext gespeichert
(`POST /api/places/choose`, für jeden, der den Eintrag bearbeiten darf);
der Text bleibt wie eingegeben. Ohne Auswahl ordnet die App automatisch zu.
Es gibt keinen Fremdschlüssel an Person oder Ereignis — die Verbindung läuft
über den normalisierten Ortstext. Eine von Hand bestätigte, andere
Zuordnung desselben Texts ändert nur ein Admin.

**Vorschlag am Ortsfeld:** Unter Geburts- und Sterbeort, dem Ort eines
Ereignisses und den Orten einer Ehe/Beziehung zeigt die App beim Tippen
dezent, welcher Ort erkannt wird — dieselbe Regel wie die automatische
Zuordnung: „→ Wrocław (Breslau), Polen · früherer bzw. deutscher Name:
Breslau“, „mehrdeutig“ (weitere Orte gleichen Namens — ein Zusatz wie Kreis
oder Land hilft) oder „Ort nicht gefunden“. Der eingegebene Text bleibt, wie
er ist. Für Administratoren und Bearbeiter (`GET /api/places/suggest?q=`,
nur Verzeichnisdaten und eigene Orte, nichts über Personen); das erste
Ortsfeld einer Seite lädt das Verzeichnis vorab (rund 0,9 s), danach dauert
ein Vorschlag wenige Millisekunden. Jede Änderung steht im
`AuditLog` (`entityType` „Place“, vorher → nachher), die automatische
Zuordnung als ein Paket „Orte automatisch zugeordnet“ (unter „Änderungen“).
Die Ortstexte sieht nur der Admin — sie enthalten auch Angaben gesperrter
Personen (`GET/PUT /api/places`, `POST /api/places/auto`,
`GET /api/places/search?q=`, sonst 403).
Zeitabhängige Staatszugehörigkeit (Breslau 1900 = Deutsches Reich) zeigt die
App nicht — die Bezeichnung nennt immer das heutige Land. Der Mock-Seed ordnet alle
Ortstexte automatisch zu.

**Automatische Zuordnung** ([lib/places/match.ts](lib/places/match.ts)):
GEDCOM-Ortsformen werden an Kommas zerlegt und vom spezifischen zum
allgemeinen Teil gesucht („Berkum, Peine, Lk Peine, Niedersachsen,
Germany“). Vorsätze („Lk“, „Kreis“, „Amt“ …), reine Beschreibungen
(„Kreisstadt“), Anschriften mit Hausnummer und Klammerzusätze fallen weg,
„St.“ = „Sankt“, „Peine-Vöhrum“ zuletzt in Hälften. Ein heutiges
Land im letzten Teil schränkt ein; ein historisches („Preußen“,
„Österreich-Ungarn“) oder ein Land zusammen mit einer historischen Landschaft
(„Breslau, Schlesien, Germany“) gibt nur einen Vorzug. Regionen (Bundesland,
Bundesstaat) schränken ein, historische Landschaften („Schlesien“,
„Ostpreußen“, „Banat“ …) bevorzugen Orte in ihrer Nähe. Nennt ein späterer
Teil ebenfalls einen Ort, muss der Kandidat höchstens 50 km davon liegen.
Ohne Ort: Region, dann Land. Ohne Länderhinweis entscheiden Heimatvorzug
(Deutschland, Österreich/Schweiz, Europa) und Größe zusammen. Auf den
Mock-Daten werden alle 36 Ortstexte (341 Angaben) als Ort zugeordnet.

**Ortsnamen** (Entscheidung des Eigentümers; Karte, Ortsliste, Seitenleiste,
„Orte zuordnen“; [lib/places/gazetteer.ts](lib/places/gazetteer.ts),
`entryLabel`): der heutige offizielle Name vorn, in Klammern der Name, unter
dem der Ort in den Daten steht, sonst der deutsche bzw. historische Name —
nur wenn er sich unterscheidet: „Wrocław (Breslau), Polen“, „Gdańsk
(Danzig), Polen“, „Timișoara (Temeswar), Rumänien“, „Kaliningrad (Königsberg),
Russland“. Orte in Deutschland, Österreich und der Schweiz nie mit Klammer,
dafür mit Bundesland bzw. Kanton: „Aachen, Nordrhein-Westfalen,
Deutschland“ (auch für „Aix-la-Chapelle“). Gespeicherte automatische Zuordnungen bekommen die neue
Form mit dem nächsten „Automatisch zuordnen“; von Hand Bestätigte behalten
ihre Bezeichnung.

**Mitgelieferte Daten** — kein Dienst im Netz, die Karte lädt nichts von
fremden Servern, die Ortsnamen verlassen den Server nie:

| Datei | Inhalt | Größe |
|---|---|---|
| `geo/gazetteer.tsv.gz` | Ortsverzeichnis: Deutschland, Österreich, Schweiz mit allen bewohnten Orten (auch Ortsteile und historische), übriges Europa ab 1000 Einwohnern, Welt ab 15 000; Regionen erster Ebene, Länder, 43 historische Landschaften (von Hand, ungefähre Mitte). Weitere Namen in lateinischer Schrift, für Europa nach Sprache gefiltert (u.a. de, en, fr, pl, cs, hu, ro, la; historische wie „Breslau“, „Aix-la-Chapelle“, „Temeswar“); Hauptname der heutige offizielle (Landessprache statt englischer Form: „München“, nicht „Munich“), dazu je Ort außerhalb des deutschen Sprachraums der deutsche bzw. historische Name („Breslau“). 229 491 Einträge | 4,4 MB (12 MB entpackt); nur auf dem Server, erst bei Bedarf geladen (rund 1 s, gut 100 MB Speicher, nach 10 min ohne Benutzung freigegeben) |
| `public/geo/countries.json` | Ländergrenzen, Natural Earth 1:50m, Mercator-projiziert und vereinfacht (Europa feiner) als SVG-Pfade | 337 KB (87 KB gzip) |

Erzeugt mit `node scripts/build-geodata.mjs <geonames-ordner>
<naturalearth-ordner>` (Eingaben und Bezugsquellen im Kopf des Skripts). Die
Größe des Ortsverzeichnisses ist bewusst: eine kleinere Auswahl (nur Orte ab
1000 Einwohnern) verfehlt Dörfer und Ortsteile wie „Berkum“ oder
„Vöhrum“, die in Stammbäumen typisch sind.

**Lizenzen:** Ortsverzeichnis aus [GeoNames](https://www.geonames.org/),
Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — ausgewählt
und umgeformt; Quellenangabe auf der Karte und hier. Ländergrenzen und
Ländermittelpunkte aus [Natural Earth](https://www.naturalearthdata.com/),
gemeinfrei.

**MCP:** bewusst kein Werkzeug — Koordinaten und Kartendaten helfen einer KI
bei der Recherche kaum, und Orte lassen sich über `search_persons` schon
suchen.

## Ungenaue Daten

Geburt, Tod und Beginn/Ende einer Beziehung (sowie das Datum einer Quelle)
lassen sich so genau eintragen, wie es die Quelle hergibt. Alle Datumsfelder
sind Textfelder; unter dem Feld steht beim Tippen, wie die Eingabe verstanden
wird („Verstanden als: um 1850“), oder eine Fehlermeldung.

| Eingabe | bedeutet | Anzeige |
|---|---|---|
| `12.03.1850`, `12. März 1850`, `1850-03-12` | genauer Tag | 12.03.1850 |
| `03.1850`, `3/1850`, `März 1850`, `1850-03` | nur Monat | März 1850 |
| `1850` | nur Jahr | 1850 |
| `um 1850`, `ca. 1850`, `circa 1850`, `~1850` | ungefähr (± 2 Jahre) | um 1850 |
| `vor 1900` | spätestens Ende 1899 | vor 1900 |
| `nach 1723` | frühestens 1724 | nach 1723 |
| `geschätzt 1850`, `errechnet 1850` | wie „um“ (± 2 Jahre) | geschätzt 1850 |
| `zwischen 1850 und 1855`, `1850–1855`, `1850-1855` | ein Zeitpunkt in diesem Zeitraum | zwischen 1850 und 1855 |
| `von 1901 bis 1910` | Zeitraum (z.B. Wohnort) | von 1901 bis 1910 |
| `ab 1901`, `seit 1901` | Zeitraum ohne Ende | ab 1901 |
| `bis 1910` | Zeitraum bis einschließlich 1910 | bis 1910 |

Zusätze lassen sich mit jeder Genauigkeit kombinieren („um 03.1850“, „vor
12.03.1900“, „zwischen 12.03.1850 und Mai 1851“). Für KI-Eingaben werden auch
die GEDCOM-Formen `ABT`, `BEF`, `AFT`, `EST`, `CAL`, `BET … AND …`,
`FROM … TO …` und englische Monatskürzel (`12 MAR 1850`) verstanden,
außerdem volle ISO-Zeitstempel (ältere API-Aufrufe).

**Wortlaut:** Was sich nicht strukturiert darstellen lässt („Weihnachten
1850“, ein Datum im julianischen Kalender, eine GEDCOM-Datumsphrase), bleibt
als Text erhalten (`…Phrase`) — allein oder neben dem Datum, angezeigt als
„1850 („Weihnachten 1850“)“. Wird das Datum geändert, ohne einen neuen
Wortlaut anzugeben, verfällt der alte; bleibt das Datum gleich, bleibt er.

**Speicherung:** Die bisherige `DateTime`-Spalte bleibt der sortierbare
Ankerpunkt (bei Monat der Monatserste, bei Jahr der 1. Januar). Daneben
stehen je Datum Genauigkeit (`…Precision`: `DAY`, `MONTH`, `YEAR`) und
Zusatz (`…Qualifier`: `EXACT`, `ABOUT`, `BEFORE`, `AFTER`, `ESTIMATED`,
`CALCULATED`, `BETWEEN`, `PERIOD`, `UNTIL`), bei Bereichen das Ende
(`…To`, `…ToPrecision`) und ggf. der Wortlaut (`…Phrase`). Die
Standardwerte (Tag, genau, kein Ende) beschreiben alle früher erfassten Daten
— es war keine Datenumstellung nötig. Eingelesen, angezeigt und verglichen wird an
einer Stelle: [lib/dates.ts](lib/dates.ts).

**Prüfungen:** Validierung, Plausibilitätsprüfung, Datenlücken, Dubletten,
Alter in Zeitleisten und die Statistik vergleichen den Zeitraum, den eine
Angabe abdeckt. Gemeldet bzw. abgelehnt wird nur, was für *jede* mögliche
Lesart widersprüchlich ist (ein Bereich zählt mit seinem ganzen Zeitraum) —
„1900 gestorben“ und „1900 geboren“ ist kein
Fehler, nur weil beides intern auf den 1. Januar fällt; „vor 1840 gestorben,
1850 geboren“ schon. Ein ungefähres Geburtsdatum gilt nicht als fehlend; die
Zeitleiste einer Person führt es aber als „genaues Geburtsdatum (bisher: um
1850)“ unter den offenen Punkten. Suche und Sortierung nach Geburtsjahr,
Jahresfilter der Familienzeitleiste und die Geburtsjahre der Statistik nutzen
den Ankerpunkt („vor 1900“ zählt als 1900, „zwischen 1850 und 1855“ als 1850).

## Quellen und Belege

Eine **Quelle** ist ein Dokument — ein Kirchenbuch, ein Standesamtsregister,
eine Volkszählungsliste, ein Grabstein, die Familienbibel, ein Gespräch mit
der Großmutter, eine Webseite. Sie hat Titel, Art, Verfasser/Herkunft,
Archiv und Signatur, Internetadresse, Datum (ungenau erlaubt), eine Abschrift
bzw. Notizen, optional einen Hauptscan (ein bereits hochgeladenes Bild einer
belegten Person oder Ehe) und beliebig viele weitere Bilder
([Bilder an Quellen, Ereignissen und Belegen](#bilder-an-quellen-ereignissen-und-belegen)).

Ein **Beleg** verbindet eine Quelle mit genau einer Angabe: an einer Person
`Name`, `Geburt`, `Tod` oder `Allgemein` (die Person als Ganzes), an einer
Beziehung `Heirat & Partnerschaft` bzw. `Abstammung` (oder `Allgemein`).
Dazu kommen Fundstelle (Seite, Eintragsnummer), Internetadresse des
Eintrags (nur http/https; angezeigt als Link „Eintrag öffnen“ mit dem
Hostnamen, nie von der App selbst abgerufen), Verlässlichkeit (gesichert,
wahrscheinlich, unsicher oder nicht bewertet) und optional eine Abschrift
(`text`). Ein Beleg
kann auch ein einzelnes Lebensereignis stützen (`eventId`, Angabe
„Ereignis“); er hängt dann zugleich an dessen Person bzw. Beziehung, Rechte
und Export gelten wie dort. Eine Quelle kann beliebig viele Angaben vieler
Personen belegen.

**Quellen aus Importen.** Genealogie-Anbieter liefern ihre Quellen mit
eigenen Angaben (MyHeritage: `_TYPE`, `_MEDI`, HTML im Text, Adressen der
Einträge in der Fundstelle). Der GEDCOM-Import ordnet sie ein
([lib/source-classify.ts](lib/source-classify.ts)):

| Art | Wann |
|---|---|
| Kirchenbuch, Standesamt, Volkszählung, Grabstein … | Titel bzw. `_TYPE` nennen, was die Sammlung **ist** — auch wenn sie bei einem Anbieter liegt (der Anbieter steht dann daneben) |
| **Online-Stammbaum** | Stammbäume anderer Nutzer („… Stammbäume“, „Family Trees“, „Smart Matches“, Geni, WikiTree): **keine unabhängige Quelle** |
| **Online-Sammlung** | Sammlung/Datenbank eines erkannten Anbieters ohne bestimmbare Inhaltsart |
| Webseite / Sonstige | alles andere, wie bisher |

Der **Anbieter** (MyHeritage, Ancestry, FamilySearch, Geneanet, Filae, Geni,
WikiTree, Find a Grave, Matricula, Archion …) wird an Adressen oder am Namen
erkannt und an der Quelle angezeigt; unbekannte Anbieter bleiben leer. HTML
in Titel, Text und Notizen wird lesbarer Text (das Original bleibt in den
Rohdaten), die erste Adresse darin wird die Internetadresse der Quelle. Eine
Adresse in der Fundstelle eines Belegs wird dessen Link. Belege auf
**Online-Stammbäume** übernehmen die Verlässlichkeit der Datei nicht
(MyHeritage schreibt „QUAY 3“ an automatische Treffer) — sie sind „nicht
bewertet“ und tragen den Hinweis „aus einem Online-Stammbaum — keine
unabhängige Quelle“. Derselbe Beleg zweimal an derselben Person fällt beim
Import zusammen; ein allgemeiner Beleg, der sein Ereignis nennt (`EVEN BIRT`),
gehört zur Geburt usw.

Für schon Importiertes genügt ein erneuter Import derselben Datei: Quellen
und Belege gelten als „in der Datei geändert“ und werden berichtigt — außer
dem, was in der App von Hand geändert wurde. Ohne Datei zur Hand: im
Importverlauf (`/admin/data`) **„Aus der aufbewahrten Datei neu einlesen“** —
das Original des Laufs geht durch die normale Vorschau; geschrieben wird erst
nach „GEDCOM-Import ausführen“, der alte Lauf bleibt unverändert. Doppelte Belege aus
älteren Importen erscheinen dabei unter „Fehlt in der Datei“ und lassen sich
dort entfernen.

**Oberfläche:**

- Personenseite, Abschnitt **„Quellen“**: Belege nach Angabe gruppiert;
  Bearbeiter können Belege hinzufügen (auch mit gleich neu angelegter
  Quelle), ändern und entfernen — auch für die Ehen und Eltern-Kind-
  Beziehungen der Person. In der Beziehungsliste („Verwaltung“) führt
  „Belege“ direkt dorthin.
- **„Quellen“** in der Navigation: Liste mit Suche und Filter nach Art
  (mit Anbieter), Detailseite mit allem, wofür die Quelle zitiert wird — je
  Person bzw. Beziehung gruppiert, seitenweise —, Anlegen, Bearbeiten,
  Löschen.
- **„Recherche“**: Datenlücke „Angaben ohne Beleg“ — Personen, deren Geburt
  bzw. Tod erfasst ist (Datum oder Ort), aber keinen Beleg für genau diese
  Angabe hat.

**Rechte** (verbindlich in [lib/services/sources.ts](lib/services/sources.ts)):

- Ein Beleg ist sichtbar bzw. änderbar, wenn die Person (bzw. Beziehung) es
  ist, an der er hängt — dieselben Regeln wie für Personen und Beziehungen.
- Eine Quelle sieht, wer mindestens einen ihrer Belege sieht, wer sie
  angelegt hat, und der Administrator. Eine frisch angelegte, noch unbelegte
  Quelle ist also zunächst nur für ihren Ersteller sichtbar.
- Wird eine Quelle auch für Personen zitiert, die der Benutzer nicht sehen
  darf (z.B. ein Kirchenbuch für Familie A und B, Benutzer hat nur A),
  erscheinen diese Belege nicht — die Detailseite nennt nur ihre Anzahl.
- Ändern darf eine Quelle, wer sie angelegt hat oder einen ihrer Belege
  bearbeiten darf; löschen (samt aller Belege) nur, wer *jeden* ihrer Belege
  bearbeiten darf. Anlegen darf, wer in mindestens einer Familie Bearbeiter
  ist.
- Jede Änderung landet im Audit-Log (`Source`, `Citation`).

API: `GET/POST /api/sources`, `GET/PATCH/DELETE /api/sources/{id}`,
`POST /api/citations`, `PATCH/DELETE /api/citations/{id}`.

## Bilder an Quellen, Ereignissen und Belegen

Neben Porträts (Person) und Hochzeitsbildern (Beziehung) lassen sich Bilder
an **Quellen** (mehrere: Seiten eines Registers, Grabstein, Titelblatt), an
**Lebensereignissen** (Taufschein, Foto der Konfirmation) und an **Belegen**
(der Ausschnitt einer Quelle, der genau diese Angabe belegt — der Eintrag auf
Seite 12) hängen. Ein Bild ist eine Datei; es kann an beliebig vielen
Einträgen hängen (Tabellen `SourceMedia`, `EventMedia`, `CitationMedia`; der
bisherige Scan `Source.mediaId` bleibt als **Hauptscan** und wird mit den
weiteren Bildern zusammen gelesen, [lib/services/attached-media.ts](lib/services/attached-media.ts)).

**Wo erscheint welches Bild?**

| Bild hängt an | erscheint |
|---|---|
| Ereignis | in der Zeile des Ereignisses auf der Personenseite (Ereignisse einer Beziehung auf beiden Personenseiten) und unter „Belegbilder“ |
| Beleg | beim Eintrag, den er belegt: bei einem Ereignis-Beleg in der Ereigniszeile (im Abschnitt „Quellen“ steht dann nur „1 Bild beim Ereignis“), bei Belegen zu Geburt/Tod, Namen oder Beziehungen am Beleg im Abschnitt „Quellen“; dazu einmal unter „Belegbilder“ und auf der Seite der Quelle beim Beleg. Kein Bild steht zugleich in der Ereigniszeile und im Abschnitt „Quellen“ (Entscheidung des Eigentümers: nur am Eintrag + Sammlung) |
| Quelle (Hauptscan oder weiteres Bild) | auf der Seite der Quelle und als **Belegbild bei jedem Beleg dieser Quelle** — **außer** das Bild hängt zugleich an mindestens einem Beleg derselben Quelle: dann gehört es erkennbar zu diesem Beleg und erscheint nur dort |

Beispiel: Am „Taufbuch St. Marien“ hängen ein Titelblatt und der Scan von
Seite 12. Solange der Scan nur an der Quelle hängt, zeigen alle Belege des
Taufbuchs beide Bilder. Wird der Scan zusätzlich an den Beleg „Geburt Anna,
S. 12“ gehängt, zeigen die übrigen Belege nur noch das Titelblatt.

Auf der Personenseite stehen diese Bilder **getrennt** von der Galerie mit
Porträt- und Familienbildern: als kleine Vorschauen (64 px, Alt-Text aus der
Beschriftung) an Ereignis und Beleg und gesammelt im Abschnitt
**„Belegbilder“** mit Herkunft („Taufe 1850 · Taufbuch, S. 12“). Antippen
öffnet das Bild groß wie in der Galerie.

**Bearbeiten in der App:** An jeder Ereignis- und Belegzeile der
Personenseite und auf der Seite der Quelle („Bilder zur Quelle“) führt
„Bild hinzufügen“ zu *Datei hochladen* (gleiche Verarbeitung wie jeder
Upload: Typ anhand der Bytes, `MAX_UPLOAD_BYTES`, WebP, Vorschau) und
*Vorhandenes Bild* verknüpfen (Bilder der Seite bzw. der belegten Personen).
„entfernen“ löst das Bild nur von diesem Eintrag; hängt es danach an nichts
mehr, wird es nach Rückfrage gelöscht. Wird ein Ereignis, Beleg, eine Quelle
oder Person gelöscht, verschwinden Bilder, die nur daran hingen; beim
Zusammenführen von Dubletten wandern die Bilder doppelter Ereignisse und
Belege mit. Der Hauptscan wird wie bisher im Formular der Quelle („Scan“)
gewählt.

**Rechte** ([lib/media-scope.ts](lib/media-scope.ts),
[lib/services/media-links.ts](lib/services/media-links.ts)):

- Sehen: wer mindestens einen Eintrag sieht, an dem das Bild hängt — ein
  Ereignis bzw. Beleg wie seine Person/Beziehung, eine Quelle wie die Quelle
  (wer einen ihrer Belege sieht, der Ersteller, Administratoren). Ein Bild an
  einer familienübergreifenden Quelle sehen also alle, die die Quelle sehen
  (das gilt jetzt auch für den Hauptscan).
- Hochladen und Verknüpfen: jedes Ziel muss der Benutzer **bearbeiten**
  dürfen (geprüft vor dem Speichern, alles oder nichts); unsichtbare Ziele
  gelten als nicht vorhanden. Ein vorhandenes Bild lässt sich nur
  verknüpfen, wenn der Benutzer es sehen darf.
- Ganz löschen (Galerie „Löschen“): wie bisher über eine bearbeitbare Person
  bzw. Beziehung — hängt das Bild zusätzlich an Ereignissen, Belegen oder
  Quellen, müssen auch diese alle bearbeitbar sein.
- Jede Änderung steht in der Änderungsgeschichte (`MediaAsset`, CREATE /
  UPDATE mit `linked` bzw. `unlinked`) bei allen betroffenen Personen; bei
  einem Quellenbild sind das alle Personen, die die Quelle belegt.

API: `POST /api/media` (Formular mit `file` und genau einem von `personId`,
`relationshipId`, `eventId`, `citationId`, `sourceId`),
`POST /api/media/{id}/links` (JSON mit einem oder mehreren Zielen, auch als
Listen `eventIds` …), `DELETE /api/media/{id}/links?eventId=…`.
Über die KI: `add_media` und `link_media` ([KI-Zugang](#ki-zugang-mcp)).

## Dienstschicht

Die Fachlogik liegt in [lib/services](lib/services) als einfache
async-Funktionen, die einen `Scope` ([lib/scope.ts](lib/scope.ts)) bekommen und
serialisierbare Daten liefern: Baum, Personensuche, Personendetail mit
gruppierten Beziehungen, Vorfahren/Nachfahren, Verwandtschaftsweg und
-bezeichnung (`getKinship`, Begriffe in [lib/kinship.ts](lib/kinship.ts)),
Zeitleisten, Statistik, Datenlücken, Plausibilitätsprüfung
(`findInconsistencies`, Regeln in [lib/consistency.ts](lib/consistency.ts)),
Dubletten sowie die Mutationen für Personen und Beziehungen
(einschließlich Validierung, Rechteprüfung und Audit). Route-Handler und Seiten
nutzen dieselben Funktionen. Die Dienste importieren weder `next/*` noch
`lib/auth.ts` und laufen daher auch in einem einfachen Node-Prozess;
`scopeForEmail()` liefert dort den Scope zu einem Benutzer. Fehler kommen als
`ServiceError` (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION`); unsichtbare
Personen gelten als `NOT_FOUND`.

### OAuth lokal einrichten

Beide Anbieter erlauben `localhost` als Callback — echtes Testen geht also
ohne Deployment:

- **GitHub** — Settings → Developer settings → OAuth Apps → New.
  Callback: `http://localhost:3000/api/auth/callback/github`
- **Google** — Cloud Console → Credentials → OAuth client ID (Web).
  Redirect URI: `http://localhost:3000/api/auth/callback/google`

Client-ID und Secret in die `.env` eintragen, `npm run dev` neu starten.

## KI-Zugang (MCP)

Ein KI-Assistent wie Claude Code oder Claude Desktop kann direkt mit den
Stammbaumdaten arbeiten: Fragen zu Personen und Verwandtschaft beantworten,
Lücken und Widersprüche finden und — wenn freigegeben — Rechercheergebnisse
samt Belegen eintragen. Die App bietet dafür unter `/api/mcp` eine
Schnittstelle nach dem [Model Context Protocol](https://modelcontextprotocol.io)
(MCP). Der Assistent meldet sich dort mit einem **persönlichen Schlüssel** an
und handelt dann **als dieser Benutzer**: Alles läuft über die
[Dienstschicht](#dienstschicht), Sichtbarkeit nach Familien, Platzhalter für
verborgene Personen („Nicht freigegeben“), Rechteprüfung, Validierung und
Audit-Log gelten genau wie in der Weboberfläche. Einen Zugang an der App
vorbei direkt zur Datenbank gibt es nicht.

### Was die KI kann

| Werkzeug | Zweck |
|---|---|
| `search_persons` | Suche nach Namenswörtern (auch Rufname und weitere Namen), Familie, Geburtsjahr (von/bis), Ort (Geburt, Tod, Ereignisse, Heirat/Scheidung), Geschlecht, verstorben; seitenweise (Standard 20) |
| `get_person` | Vollständiger Datensatz mit Notizen, Familien, Eltern, Partnern (mit Heirats-/Scheidungsdaten und -orten, Ereignissen der Partnerschaft), Kindern, Geschwistern (voll/halb), Lebensereignissen (`events`, abweichende Angaben als `alternative`), weiteren Namen (`otherNames`), Bild-Metadaten und Belegen; Bilder an Ereignissen (`events[].media`), an Belegen (`citations[].media`) und geerbte Bilder der zitierten Quelle (`citations[].sourceMedia`) |
| `list_events` | Alle Lebensereignisse einer Person oder Beziehung mit sämtlichen Feldern |
| `get_ancestors` / `get_descendants` | Vorfahren bzw. Nachfahren nach Generationen (Standard 4, höchstens 12) |
| `get_kinship` | Verwandtschaft zweier Personen mit deutscher Bezeichnung („Großmutter väterlicherseits“, „Cousin 1. Grades“, „Schwager“), gemeinsamen Vorfahren und Verbindungsweg |
| `list_families` | Sichtbare Familien mit Personenzahl und eigener Rolle |
| `get_statistics` | Überblick: Personen, Beziehungen, Familien, fehlende Angaben, Geburtsjahre |
| `find_data_gaps` | Fehlende Angaben (Geburtsdatum, Eltern, Geschlecht, vermutlich verstorben ohne Sterbedatum, …), `unsourced` (Geburt/Tod ohne Beleg) und in `relationshipGaps` Ehen ohne Ort und Partnerschaften mit unbekanntem Ehestand |
| `find_possible_duplicates` | Vermutlich doppelt erfasste Personen mit Begründung und Wert 0–1 |
| `check_consistency` | Widersprüche: Tod vor Geburt, Elternteil jünger als 12 bzw. älter als 70 (Mutter 50), Geburt nach dem Tod eines Elternteils, Lebensdauer über 110, Heirat vor 14 oder nach dem Tod, überschneidende Ehen, Beerdigung vor dem Tod, Ereignis vor der Geburt bzw. nach dem Tod |
| `get_timeline` | Zeitleiste einer Person (mit Alter und fehlenden Daten) oder einer Familie |
| `search_sources` | Quellen suchen (Titel, Verfasser, Archiv, Signatur; Art) mit Zahl der sichtbaren Belege |
| `get_source` | Quelle mit Abschrift und allem, wofür sie zitiert wird (verborgene Belege nur gezählt), dazu `images` (Bilder der Quelle) und `citations[].media` |
| `suggest_place` | Kandidaten für einen Ortstext („A, B oder C“): Wahl der automatischen Zuordnung, gleichnamige Orte mit Land, Einwohnerzahl, Entfernung, welcher Name gepasst hat (früherer/deutscher Name wie „Breslau“), eigene Orte; nur Verzeichnisdaten |
| `get_place` | Ein zugeordneter Ort wie auf seiner Seite (Name, Region, Land, Koordinaten, weitere Namen, Freitexte, Personen mit Angaben dort — nur sichtbare); `get_person` und `list_events` nennen zu jedem Ortstext den zugeordneten Ort (`places`) |
| `list_places` | Nur Administratoren: alle Ortstexte mit Anzahl, Status (offen, automatisch, von KI, von Hand, nicht zuordenbar) und Kontext (Feldarten, Jahre — ohne Personen), 50 je Seite |

Nur mit der Stufe „lesen und schreiben“ (siehe unten) kommen hinzu:

| Werkzeug | Zweck |
|---|---|
| `create_person` | Person anlegen, optional mit datierter Recherchenotiz |
| `update_person` | Felder ergänzen/korrigieren; Notizen werden nie überschrieben, `append_note` hängt eine datierte Notiz (`[JJJJ-MM-TT, KI-Recherche] … (Quelle: …)`) an — der Quellenhinweis dort ist nur Freitext |
| `create_source` | Quelle anlegen (Titel, Art, Verfasser, Archiv, Signatur, URL, Datum, Abschrift) |
| `cite_source` | Quelle für eine Angabe einer Person (NAME/BIRTH/DEATH/OTHER), einer Beziehung (PARTNERSHIP/PARENTAGE/OTHER) oder ein Lebensereignis (`event_id`) zitieren, mit Fundstelle und Verlässlichkeit |
| `create_relationship` / `update_relationship` | Eltern-Kind- oder Partnerbeziehung anlegen bzw. Art (auch „Ehestand unbekannt“), Zeitraum, Heirats-/Scheidungsort, Notiz korrigieren |
| `add_event` / `update_event` / `delete_event` | Lebensereignis (Taufe, Beruf, Wohnort, Beerdigung, Verlobung …) erfassen, korrigieren, entfernen; Geburt/Tod/Heirat/Scheidung nur als abweichende Zweitangabe (`is_alternative`) |
| `add_name_variant` | Weiteren Namen erfassen (Ehename, Schreibvariante, „auch bekannt als“ …) |
| `delete_relationship` | eine falsche Verknüpfung entfernen (die verknüpften Personen lassen sich nicht umhängen, nur löschen und neu anlegen) |
| `set_person_families` | Familienzuordnung setzen |
| `add_media` | Neues Bild an Personen, Beziehungen, Ereignisse, Belege und/oder Quellen hängen (`person_ids`, `relationship_ids`, `event_ids`, `citation_ids`, `source_ids`; mindestens ein Ziel), Bild **entweder** per `url` (https-Adresse der Bilddatei; der Server lädt sie selbst über [lib/safe-fetch.ts](lib/safe-fetch.ts)) **oder** als `data_base64` (Dateiinhalt, auch als `data:`-Adresse; `mime_type` und `file_name` optional), dazu `caption` (wird Alt-Text) |
| `link_media` | Vorhandenes Bild (`media_id`) an weitere Einträge hängen oder mit `action: "unlink"` davon lösen; die letzte Zuordnung lässt sich nicht lösen (die KI löscht keine Bilder) |
| `assign_place` | Nur Administratoren: Ortstexten Koordinaten zuordnen — einzeln oder bis 50 je Aufruf, aus dem Verzeichnis (`gazetteer_id`), als eigener Ort (Koordinaten + Bezeichnung) oder „nicht zuordenbar“, mit `uncertain` und Begründung (`note`); erscheint als „von KI“, nie über von Hand Bestätigtes |
| `begin_change_set` | Änderungspaket mit Titel öffnen (z.B. „Taufbuch St. Marien 1850–1870 ausgewertet“); die Kennung geht als `change_set_id` an die folgenden Schreibwerkzeuge, siehe [Änderungsgeschichte](#änderungsgeschichte) |

Personen, Quellen oder Bilder löschen kann die KI bewusst nicht.

**Bilder über die KI — drei Wege.** Ein Sprachmodell, dem man im Chat ein
Bild zeigt, hat die Originaldatei nicht und kann sie nicht weiterreichen.
Deshalb: (1) `add_media` mit `url` — der Server holt die Datei selbst, nur
https auf Port 443 (http-Adressen werden abgelehnt), keine Zugangsdaten in
der Adresse, der Name wird einmal aufgelöst und **alle** Adressen müssen
öffentlich sein (kein localhost, Heim- oder Firmennetz,
link-local/Cloud-Metadaten, IPv6-ULA, auf IPv4 abgebildete Adressen …), die
Verbindung geht genau an die geprüfte Adresse, höchstens 3 Weiterleitungen
(jede neu geprüft), nur `image/*` bzw. `application/octet-stream`, Größe
beim Lesen gezählt (`MAX_UPLOAD_BYTES`), 20 s Gesamtzeit; danach prüft sharp
das Bild wie beim Upload. (2) `add_media` mit `data_base64` — für Clients
mit Dateizugriff (Claude Code liest eine lokale Datei); die Größe wird vor
dem Dekodieren geprüft, der Typ anhand der Bytes (eine abweichende
`mime_type`-Angabe wird abgelehnt). Für Schlüssel mit Schreibstufe nimmt
`/api/mcp` deshalb Anfragen bis `MAX_UPLOAD_BYTES` × 4/3 + 1 MiB an (sonst
1 MiB) — ein Reverse-Proxy muss so große Anfragen durchlassen (Nginx:
`client_max_body_size`). (3) `link_media` mit der `media_id` eines Bildes,
das schon in der App ist (z.B. nach dem Hochladen in der App). Ein nur im
Chat gezeigtes Bild braucht Weg 1 oder 3; der Server-Hinweis an das Modell
sagt das ausdrücklich. Dazu kommen
drei Prompt-Vorlagen (`research_person`, `review_data_quality`,
`orte_zuordnen` — offene Ortstexte stapelweise zuordnen) und die
Ressource `familytree://person/{id}`. Die Ergebnisse sind kompaktes JSON;
Daten stehen in ihrer echten Genauigkeit (`1850`, `um 1850`, `vor 1900` —
siehe [Ungenaue Daten](#ungenaue-daten)), und Eingaben akzeptieren dieselben
Formen wie die Oberfläche. Die Anweisungen an das Modell verlangen, Erkenntnisse
als Beleg (`create_source` + `cite_source`) festzuhalten statt nur als Notiz,
und Taufe, Beruf, Wohnort usw. als Ereignis (`add_event`) statt im Notizfeld.

### Wer darf was

- **Der Administrator vergibt den KI-Zugang je Benutzer** unter *Benutzer*
  (`/admin/users`, Spalte „KI-Zugang“): *kein Zugang* (Standard), *lesen*
  oder *lesen und schreiben*. Die Rolle Administrator schließt ihn **nicht**
  ein — auch der Admin muss ihn sich selbst ausdrücklich geben.
- **Die Familienrechte gelten zusätzlich.** Die KI sieht nur, was der
  Benutzer sieht, und schreibt nur in Familien, die er bearbeiten darf. „Lesen
  und schreiben“ für einen Betrachter erlaubt also trotzdem keine Änderung.
- **Jeder Schlüssel hat eine eigene Stufe** (lesen oder lesen und
  schreiben). Wirksam ist die niedrigere von beiden: Schlüssel „lesen und
  schreiben“ bei einem Benutzer mit KI-Recht „lesen“ wirkt nur lesend.
- **Änderungen wirken sofort.** Rechte, Schlüssel und Sperre werden bei
  jedem einzelnen Aufruf neu geprüft. Herabsetzen auf „lesen“, Entziehen,
  Widerrufen eines Schlüssels oder Sperren des Benutzers greifen beim
  nächsten Aufruf — ohne Neustart von App oder Assistent.
- **Schlüssel verwaltet nur die Weboberfläche**, nie die KI selbst: Anlegen,
  Widerrufen, Löschen und Rechte vergeben gehen über die MCP-Schnittstelle
  nicht.
- **Alles wird protokolliert.** Jede Änderung durch die KI steht im
  Audit-Log unter dem Benutzer, mit Kanal `MCP` und dem verwendeten
  Schlüssel, gebündelt zu Paketen; KI-Notizen tragen zusätzlich
  „KI-Recherche“ und Datum. In der App zeigen der Abschnitt „Änderungen“ der
  Personenseite und `/admin/changes` (Filter Kanal „KI über MCP“) diese
  Änderungen ([Änderungsgeschichte](#änderungsgeschichte)). Direkt in der
  Datenbank (auf der NAS, per SSH):

  ```sh
  docker exec familytree-db-1 psql -U familytree -d familytree -c '
    SELECT a."createdAt", a.action, a."entityType", a."entityId", t.prefix, t.name
    FROM "AuditLog" a LEFT JOIN "ApiToken" t ON t.id = a."apiTokenId"
    WHERE a.channel IS NOT NULL ORDER BY a."createdAt" DESC LIMIT 50;'
  ```

Alles, was der Assistent abruft, geht an den jeweiligen KI-Anbieter — bei
lebenden Personen bedenken.

### Einrichten: Schritt für Schritt

1. **Recht geben.** Als Administrator unter *Benutzer* beim eigenen Konto
   „KI-Zugang“ auf *lesen* stellen (für die Recherche genügt das; *lesen und
   schreiben* erst, wenn die KI auch eintragen soll).
2. **Schlüssel anlegen.** In der Navigation erscheint *KI-Zugang*
   (`/ai-access`, jeder Benutzer verwaltet dort seine eigenen Schlüssel).
   Namen vergeben, der sagt, wo der Schlüssel liegt (z.B. „Laptop – Claude
   Code“), Stufe und Gültigkeit wählen (Standard 90, höchstens 365 Tage),
   *Schlüssel anlegen*. Der Schlüssel (`ftk_…`) wird **genau einmal** angezeigt —
   gleich kopieren. Die Seite zeigt dazu die Adresse der Schnittstelle
   (`<PUBLIC_URL>/api/mcp`) und den fertigen Befehl für Claude Code.
3. **Claude Code verbinden** (in einem Terminal, einmal je Rechner):

   ```bash
   claude mcp add --transport http --scope user stammbaum https://stammbaum.example.de/api/mcp --header "Authorization: Bearer ftk_…"
   ```

   `--scope user` macht den Stammbaum in allen Projekten verfügbar. Prüfen:
   `claude mcp list` zeigt `stammbaum: … ✔ Connected`. Der Schlüssel steht
   danach im Klartext in der Benutzerkonfiguration von Claude Code
   (`%USERPROFILE%\.claude.json` unter Windows, `~/.claude.json` sonst) —
   nicht in einem Projektordner, nicht im Repository. Entfernen:
   `claude mcp remove stammbaum --scope user` (löscht ihn aus der Datei);
   danach den Schlüssel in der App widerrufen.
4. **Claude Desktop verbinden** (nur nach Dokumentation, *hier nicht
   getestet*). Claude Desktop spricht MCP-Server mit eigenem Schlüssel über
   die Brücke [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) an
   (braucht Node.js). In `%APPDATA%\Claude\claude_desktop_config.json`
   (Windows) bzw. `~/Library/Application Support/Claude/claude_desktop_config.json`
   (macOS):

   ```json
   {
     "mcpServers": {
       "stammbaum": {
         "command": "npx",
         "args": [
           "-y", "mcp-remote", "https://stammbaum.example.de/api/mcp",
           "--header", "Authorization:${AUTH_HEADER}"
         ],
         "env": { "AUTH_HEADER": "Bearer ftk_…" }
       }
     }
   }
   ```

   Kein Leerzeichen nach `Authorization:` — der Wert kommt aus `env`, weil
   Leerzeichen in `args` unter Windows nicht sicher ankommen. Bei einer
   `http://`-Adresse (nicht `localhost`) zusätzlich `"--allow-http"` an die
   `args` anhängen. Danach Claude Desktop neu starten. Der Schlüssel steht
   im Klartext in dieser Datei; zum Entfernen den Eintrag löschen und den
   Schlüssel widerrufen.
5. **claude.ai im Browser, Claude Desktop und die Claude-App auf dem
   Telefon** verbinden sich über einen „Custom Connector“. Den ruft Anthropic
   aus der Cloud auf (öffentlich per HTTPS auf Port 443 erreichbar nötig) und
   meldet sich per OAuth an, nicht mit einem festen Schlüssel. Dafür steht
   ein **Gateway** (eigenes Repository) vor der App: Beim Verbinden zeigt es
   eine Anmeldeseite, auf der man seinen persönlichen Schlüssel einträgt, und
   reicht ihn als `Authorization: Bearer …` an `/api/mcp` weiter. Ohne
   Gateway, nur im Heimnetz, geht es nicht.

   Die Seite `/ai-access` zeigt dazu eine Schritt-für-Schritt-Anleitung
   (Handy, Browser/Desktop, Claude Code). Die öffentliche Adresse des
   Gateways kommt aus der Umgebungsvariablen **`MCP_CONNECTOR_URL`**
   (Stack, `stack.env.example`) — nie fest im Repository. Ist sie leer,
   verweist die Anleitung auf den Administrator. Eingerichtet wird der
   Connector einmal auf claude.ai (Customize → Connectors → „+ Add“ →
   „Add custom connector“); die Handy-App übernimmt ihn danach automatisch.
   Im kostenlosen Claude-Tarif ist nur ein eigener Connector möglich.

### Schlüssel richtig verwenden

- **Ein Schlüssel je Gerät und Zweck** — dann lässt sich einer gezielt
  widerrufen, und die Liste auf `/ai-access` zeigt je Schlüssel, wann er
  zuletzt benutzt wurde. Höchstens 10 aktive Schlüssel je Benutzer.
- **Standardmäßig „lesen“.** Einen Schlüssel „lesen und schreiben“ nur
  anlegen, wenn die KI wirklich eintragen soll.
- **Ablauf:** Schlüssel laufen nach der gewählten Zeit ab (Standard 90 Tage)
  und antworten dann mit 401; dann einen neuen anlegen und im Client
  austauschen (`claude mcp remove …` und neu `add`).
- **Verlauf und Löschen.** Die Liste auf `/ai-access` (und die
  Schlüsselliste eines Benutzers unter *Benutzer*) zeigt standardmäßig nur
  aktive Schlüssel; widerrufene und abgelaufene sind ausgeblendet, ein Zähler
  „N ausgeblendet“ nennt sie. Der Schalter „Widerrufene und abgelaufene
  anzeigen (Verlauf)“ blendet sie zur Ansicht ein (Name, Anfang, Stufe,
  angelegt, zuletzt benutzt, widerrufen bzw. abgelaufen am); er steht in der
  Adresse (`?verlauf=1`) und übersteht so das Neuladen. **Endgültig löschen**
  (mit Rückfrage) lassen sich widerrufene und abgelaufene Schlüssel sowie
  Schlüssel, die noch nie benutzt wurden — bei einem aktiven, unbenutzten ist
  Löschen zugleich Widerruf. Ein aktiver, schon benutzter Schlüssel muss
  zuerst widerrufen werden (die Schnittstelle antwortet sonst mit 409).
  Rechte wie beim Widerrufen: eigene Schlüssel jeder selbst, fremde nur
  Administratoren. Das Löschen steht im Audit-Log (`DELETE`, Name, Anfang,
  Stufe, Daten; bei fremden Schlüsseln der Besitzer) in einem eigenen Paket
  „KI-Schlüssel „…“ gelöscht“. Die Änderungsgeschichte bleibt lesbar:
  Einträge über einen gelöschten Schlüssel zeigen „Schlüssel „…“ (gelöscht)“
  — der Name kommt aus dessen Protokolleintrag —, ohne bekannten Namen
  „Schlüssel (gelöscht)“. Schnittstelle: `DELETE /api/ai-tokens/<id>`
  widerruft, `DELETE /api/ai-tokens/<id>?endgueltig=1` löscht.
- **Schlüssel verraten?** (z.B. in einen Chat, eine Datei im Repository oder
  einen Screenshot geraten): sofort auf `/ai-access` widerrufen — wirkt beim
  nächsten Aufruf. Der Administrator kann unter *Benutzer* über „Schlüssel:
  … aktiv“ jeden Schlüssel widerrufen oder das KI-Recht entziehen. Alle
  Schlüssel beginnen mit `ftk_` und lassen sich so in Dateien suchen
  (`git grep ftk_`, `findstr /s /c:ftk_ *`); die App speichert nur einen
  Hash und schreibt nie den ganzen Schlüssel ins Log, höchstens den Anfang
  `ftk_<12 Zeichen>`, wie er auch in der Schlüsselliste steht.

### Schnittstelle (Kurzreferenz)

| | |
|---|---|
| Adresse | `<PUBLIC_URL>/api/mcp` |
| Verfahren | MCP „Streamable HTTP“, nur `POST`, zustandslos, Antworten als JSON (kein SSE, kein WebSocket) |
| Anmeldung | nur `Authorization: Bearer ftk_…` — die Anmeldung der Weboberfläche (Cookie) zählt nicht, Schlüssel in der URL ebenso wenig |
| Origin | Anfragen ohne `Origin`-Header (Claude Code, `mcp-remote`) sind erlaubt; mit `Origin` nur die eigene Adresse der App (`AUTH_URL`; im Produktivstack setzt `docker-compose.yml` sie aus `PUBLIC_URL`, lokal steht sie in `.env`) oder Einträge in `MCP_ALLOWED_ORIGINS` (kommagetrennt, ganze Origins wie `http://localhost:6274`). Das braucht nur ein MCP-Client, der im Browser läuft (z.B. der MCP Inspector) — `docker-compose.yml` reicht die Variable bewusst nicht durch, sie ist für die lokale Entwicklung gedacht |
| Größe | Anfrage höchstens 1 MiB; mit Schreibstufe bis `MAX_UPLOAD_BYTES` × 4/3 + 1 MiB (Bild als base64 für `add_media`), geprüft erst nach dem Schlüssel |

| Status | Bedeutung |
|---|---|
| 200 | in Ordnung |
| 401 | Schlüssel fehlt, ist falsch, widerrufen oder abgelaufen, oder der Benutzer ist gesperrt — bewusst ohne Angabe des Grundes |
| 403 | Schlüssel gültig, aber der Benutzer hat kein KI-Recht (mehr); oder fremder `Origin` |
| 405 | andere Methode als `POST` |
| 413 | Anfrage zu groß: höchstens 1 MiB, mit einem Schlüssel der Schreibstufe bis `MAX_UPLOAD_BYTES` × 4/3 + 1 MiB (Bild als base64) |
| 500 | unerwarteter Fehler bei der Verarbeitung (Einzelheiten nur im Log der App) |
| 503 | Schlüssel konnte nicht geprüft werden, meist weil die Datenbank nicht erreichbar ist — später erneut versuchen |
| 429 | nach 20 fehlgeschlagenen Anmeldungen von derselben Adresse innerhalb von 10 Minuten — bis zum Ende dieser 10 Minuten, auch mit richtigem Schlüssel (`Retry-After` nennt die Sekunden). Ein Neustart der App hebt die Sperre auf |

### Fehlersuche KI-Zugang

| Symptom | Ursache / Abhilfe |
|---|---|
| `claude mcp list`: „Server rejected the configured Authorization header (HTTP 401)“ | Schlüssel abgelaufen, widerrufen, falsch kopiert, oder der Benutzer ist gesperrt. Auf `/ai-access` nachsehen, ggf. neuen Schlüssel anlegen |
| 403 | KI-Recht fehlt oder wurde entzogen — Administrator fragen (*Benutzer*, Spalte „KI-Zugang“) |
| 429 | zu viele Fehlversuche, meist ein Client mit altem Schlüssel in einer Schleife. Den Client korrigieren und 10 Minuten warten |
| 401, obwohl der Schlüssel stimmt; im Browser funktioniert die App | Der Reverse-Proxy reicht den `Authorization`-Header nicht durch — siehe [Reverse-Proxy](#reverse-proxy) |
| Alle KI-Clients bekommen gleichzeitig 429 | Der Proxy setzt kein `X-Forwarded-For`; dann sieht die App alle Anfragen von derselben Adresse und sperrt alle zusammen |
| Entwicklung: „Missing environment variables: FAMILYTREE_MCP_KEY“ bzw. `familytree-mock` fehlt in `claude mcp list` | Variable vor dem Start von Claude Code setzen (siehe unten) |

### Entwicklung und Tests

Für die Entwicklung läuft alles gegen die [Mock-Daten](#mock-daten); die
echte Datenbank bleibt unberührt.

1. `npm run dev:mock` — App gegen `familytree_mock` auf
   `http://localhost:3100`, Schnittstelle unter
   `http://localhost:3100/api/mcp`.
2. Schlüssel setzen. Die Mock-Daten enthalten feste, öffentlich bekannte
   Testschlüssel ([Mock-Daten](#mock-daten)); `npm run -s mcp:key [name]` gibt
   einen aus (Standard `editor-read`). In dem Terminal, aus dem Claude Code
   startet:

   ```bash
   export FAMILYTREE_MCP_KEY=$(npm run -s mcp:key)          # Bash
   ```

   ```powershell
   $env:FAMILYTREE_MCP_KEY = npm run -s mcp:key             # PowerShell
   ```

   Die Variable gilt nur für dieses Terminal und alles, was daraus startet.
   Für Claude Code in VS Code also VS Code aus diesem Terminal starten
   (`code .`; nicht eigens ausprobiert).

3. Die Datei [.mcp.json](.mcp.json) im Projekt trägt den Server
   `familytree-mock` (`http://localhost:3100/api/mcp`, Header
   `Authorization: Bearer ${FAMILYTREE_MCP_KEY}`) für Claude Code ein. Beim
   ersten Start von `claude` im Projektordner fragt Claude Code, ob es den
   Projekt-Server zulassen soll. Ohne gesetzte Variable lässt Claude Code den
   Server mit der Warnung „Missing environment variables“ weg.
4. Direkt ausprobieren, ohne KI:

   ```bash
   curl -s -X POST http://localhost:3100/api/mcp \
     -H "Authorization: Bearer $FAMILYTREE_MCP_KEY" \
     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

   ```powershell
   (Invoke-RestMethod -Method Post -Uri http://localhost:3100/api/mcp `
     -Headers @{ Authorization = "Bearer $env:FAMILYTREE_MCP_KEY"; Accept = "application/json, text/event-stream" } `
     -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}').result.tools.name
   ```

Daneben gibt es den MCP-Server noch als eigenständigen Prozess über stdio
([mcp/server.ts](mcp/server.ts), `npm run -s mcp:stdio`) — **nur für
automatische Tests und Entwicklung**. Er greift ohne Schlüssel direkt auf die
Datenbank zu und nimmt den Benutzer aus `MCP_USER_EMAIL` (Schreibwerkzeuge
zusätzlich nur mit `MCP_ALLOW_WRITE=true` und KI-Recht „lesen und
schreiben“). Deshalb startet er nur gegen Datenbanken, deren Name auf `_mock`
oder `_test` endet, und bricht gegen jede andere ab — echte Daten gibt es nur
über `/api/mcp`.

Tests: `tests/mcp-http.db.test.ts` prüft den Endpunkt mit dem HTTP-Client des
SDK (Schlüssel-Matrix, Werkzeuge je Stufe, Maskierung, Schreiben mit Audit,
Sperre nach Fehlversuchen, Größenlimit, keine Geheimnisse im Log),
`tests/ai-access.db.test.ts` die Rechte- und Schlüssellogik,
`tests/ai-token-delete.db.test.ts` das endgültige Löschen (Regeln, Rechte,
Protokoll, Änderungsgeschichte danach),
`tests/media-links.db.test.ts` die Bild-Werkzeuge (`add_media` per base64 und per Adresse mit ersetztem Netz, `link_media`, Rechte, Export), `tests/mcp.db.test.ts` den stdio-Server (alle Werkzeuge, Maskierung,
Schreiben samt ungenauer Daten, Quellen, Belegen und Audit-Log, Start wie mit
`npm run -s mcp:stdio`). Alle überspringen sich ohne Mock-Datenbank; die
E2E-Tests dazu stehen unter [Tests](#tests).

## Betrieb auf der NAS (Portainer)

Gedacht für eine NAS (x86-64) mit Portainer, erreichbar **nur im Heimnetz
bzw. über VPN**, hinter dem Reverse-Proxy, der auf der NAS ohnehin läuft
(Synology-Reverse-Proxy oder Nginx Proxy Manager).

```
git push (main)
   └─ GitHub Actions (.github/workflows/images.yml)
        ├─ prüft: Typen, Lint, Unit-Tests
        ├─ baut EIN Image und lädt es nach ghcr.io (öffentliches Paket):
        │    ghcr.io/soschlegel/familiy-tree   (App samt Migrationen)
        └─ setzt Branch "deploy" auf diesen Commit
Portainer (beobachtet "deploy") ─ lädt das Image ─ startet den Stack neu
```

Auf der NAS wird nichts gebaut, und der Stack braucht keine Dateien aus dem
Repository außer `docker-compose.yml` selbst. Das App-Image wendet beim
Start selbst die Migrationen an und stellt den Administrator sicher
([docker/entrypoint.sh](docker/entrypoint.sh)), erst danach startet der
Server. Die übrigen Images (`postgres:17-alpine`, optional `caddy`) kommen
unverändert von Docker Hub.

**Dienste** ([docker-compose.yml](docker-compose.yml)):

| Dienst | Aufgabe |
|---|---|
| `db` | PostgreSQL 17, kein Port nach außen |
| `media-init` | legt den Bilderordner `media/` an, übergibt ihn der App (uid 1001) und prüft, dass sie schreiben kann; beendet sich |
| `backup-db` | Datenbank-Dump nach `backups/` — bei jedem Stack-Start **vor** dem App-Container (und damit vor der Migration), und auf Abruf |
| `app` | startet erst nach erfolgreichem `media-init` und `backup-db`; wendet dann die Migrationen an (`prisma migrate deploy`), legt `INITIAL_ADMIN_EMAIL` als Admin an und startet den Server — schlägt das fehl, beendet sie sich, statt auf halbem Schema zu laufen. Bilder in `media/`; Port `127.0.0.1:3080` für den Proxy |
| `proxy` | *optional* (Profil `caddy`): eigener Reverse-Proxy, falls keiner vorhanden ist |

Der KI-Zugang braucht keinen eigenen Dienst und keinen zusätzlichen Port: er
läuft in der App unter `/api/mcp` ([KI-Zugang](#ki-zugang-mcp)).

Alle Daten liegen als Bind-Mounts unter **einem** Pfad — genau dieses
Verzeichnis muss die NAS-Sicherung erfassen:

```
${DATA_ROOT}/              z.B. /volume1/docker/familytree
├── postgres/     Datenbank (gehört UID 70, Rechte 0700 — nicht ändern)
├── media/        Bilder als gewöhnliche Dateien (gehört UID 1001)
│   ├── originals/    Originale
│   └── thumbs/       Vorschauen
├── backups/      db_<Datum>_<Zeit>.sql.gz
└── caddy/        nur mit Profil caddy: Zertifikate
```

Die Dateinamen unter `media/` sind die Schlüssel aus der Datenbank. Ein
Datenbank-Dump plus eine Kopie von `media/` ist deshalb eine vollständige
Sicherung ([Sicherung](#sicherung)).

Die Unterordner legt Docker beim ersten Start selbst an; vorher muss nur der
gemeinsame Ordner (bei Synology meist `docker`) existieren. Besitzer und
Rechte richten die Container selbst ein:

- `postgres/` — der Postgres-Container (UID 70, `0700`).
- `media/` — der Einmal-Dienst `media-init`. Docker legt fehlende Ordner als
  root an; die App läuft aber bewusst nicht als root, sondern als UID 1001.
  `media-init` (läuft als root, aus dem ohnehin geladenen Postgres-Image)
  übereignet deshalb bei jedem Start alles in `media/`, was nicht UID 1001
  gehört — beim ersten Start den leeren Ordner, nach einer Wiederherstellung
  die zurückkopierten Dateien, sonst nichts — und prüft mit einer
  Testdatei, dass die App dort schreiben kann. Klappt das nicht, bricht er
  mit Hinweis ab und die App startet nicht (siehe
  [Fehlersuche](#fehlersuche), Bilderordner).
- `backups/`, `caddy/` — Container, die als root laufen; nichts zu tun.

Danach in der File Station **keine** Berechtigungen auf diese Unterordner
anwenden (insbesondere nicht „auf Unterordner und Dateien anwenden“) — sonst
startet die Datenbank nicht mehr („data directory has invalid permissions“)
oder die App kann keine Bilder mehr speichern. Auf einer Synology ist das
nicht ausprobiert.

### Erste Installation

Voraussetzungen: Portainer CE 2.19 oder neuer (Git-Stacks mit
Umgebungsvariablen und Docker Compose v2), ausgehender Internetzugang der NAS
(Images laden, OAuth-Anmeldung).

1. **Image bauen lassen.** Auf `main` pushen (oder unter *Actions → Images →
   Run workflow* von Hand starten) und warten, bis der Lauf grün ist (ca.
   5–10 min). Danach gibt es den Branch `deploy` und das Paket
   `familiy-tree` (GitHub → Profil → *Packages*).
2. **Paket öffentlich machen (einmalig).** Neue Pakete auf ghcr.io sind
   privat, auch bei öffentlichem Repository. GitHub → Profil → *Packages* →
   `familiy-tree` → *Package settings* → *Danger Zone* → *Change
   visibility* → *Public* → Paketnamen bestätigen. Das lässt sich **nicht
   rückgängig machen** — GitHub erlaubt nicht, ein öffentliches Paket wieder
   privat zu stellen. Unbedenklich, weil das Image nichts enthält, was nicht
   ohnehin im öffentlichen Repository steht: gebauter Code, Schema,
   Migrationen, Prisma-CLI; keine `.env`, keine Schlüssel (Geheimnisse
   kommen erst zur Laufzeit über die Stack-Variablen). Danach lädt Portainer
   das Image ohne Anmeldung; eine Registry muss dort nicht eingetragen
   werden.

   Wer das Paket lieber privat hält, findet den früheren Weg mit
   Registry-Zugang in [docs/dev-history.md](docs/dev-history.md#privates-image-mit-registry-zugang-bis-19112026).
3. **Adresse festlegen.** Unter welcher Adresse die Familie den Stammbaum
   aufruft, z.B. `https://stammbaum.example.de` — das wird `PUBLIC_URL`.
   Der Name muss im Heimnetz (und im VPN) auf die NAS zeigen: lokaler
   DNS-Eintrag im Router/Pi-hole oder ein öffentlicher DNS-Eintrag, der auf
   die **private** IP der NAS zeigt. Welche Adressen OAuth akzeptiert, steht
   unter [Anmeldung (OAuth) im Heimnetz](#anmeldung-oauth-im-heimnetz).
4. **OAuth-App anlegen** (GitHub und/oder Google) mit der Callback-URL
   `<PUBLIC_URL>/api/auth/callback/github` bzw. `…/google`.
5. **Stack anlegen.** Portainer → *Stacks → Add stack*:
   - *Name:* `familytree` (bestimmt die Containernamen, z.B.
     `familytree-app-1` — die Befehle in diesem Abschnitt gehen davon aus)
   - *Build method:* **Repository**
   - *Repository URL:* `https://github.com/soschlegel/familiy-tree`
   - *Repository reference:* `refs/heads/deploy`
   - *Compose path:* `docker-compose.yml`
   - *Authentication:* aus (öffentliches Repository)
   - *GitOps updates:* an — *Mechanism* **Polling**, *Fetch interval* `5m`;
     **Re-pull image** an; *Force redeployment* aus (siehe
     [Updates](#updates))
   - *Environment variables:* *Advanced mode* → Inhalt von
     [stack.env.example](stack.env.example) einfügen und die Werte ausfüllen.
     Pflicht: `DATA_ROOT`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `PUBLIC_URL`,
     `INITIAL_ADMIN_EMAIL` und mindestens ein OAuth-Paar. Nur zwei
     Zufallswerte: `POSTGRES_PASSWORD` mit `openssl rand -hex 32` (nur
     Hex-Zeichen, weil es in einer URL steht), `AUTH_SECRET` mit
     `openssl rand -base64 32`.
     `ENABLE_DEV_LOGIN` **nicht** setzen (der Stack schaltet ihn ohnehin ab).
   - *Deploy the stack.*
6. **Start prüfen.** *Stacks → familytree*: `media-init` und `backup-db`
   sind „exited“ mit Code 0 (Log: `[media-init] Bilderordner bereit …`);
   `app` steht nach einigen Sekunden auf „healthy“. Im Log von `app` stehen
   beim ersten Start „Applying migration“ für `0_init` und die beiden
   weiteren Migrationen, `[seed-admin] … ist Administrator.` und
   `[start] Datenbank bereit, starte die App.` Auf der NAS:
   `curl http://127.0.0.1:3080/api/health` → `{"status":"ok"}` — das prüft
   Datenbank **und** Schreibrecht auf `media/` samt `originals/` und
   `thumbs/`. `ls -lnd
   /volume1/docker/familytree/media` zeigt den Ordner mit Besitzer `1001`.
7. **Reverse-Proxy einrichten**, siehe [Reverse-Proxy](#reverse-proxy).
8. **Erste Anmeldung:** `PUBLIC_URL` öffnen, mit dem GitHub-/Google-Konto
   anmelden, dessen E-Mail `INITIAL_ADMIN_EMAIL` ist. Weitere Personen unter
   *Benutzer* (`/admin/users`) eintragen — nur eingetragene E-Mails kommen
   hinein.
9. **Sicherung planen**, siehe [Sicherung](#sicherung).

### Anmeldung (OAuth) im Heimnetz

OAuth funktioniert auch ohne öffentlich erreichbare Instanz. Beim
Authorization-Code-Verfahren schickt der Anbieter den **Browser** zurück an
die Callback-URL; GitHub/Google rufen die NAS nie selbst auf. Die NAS braucht
nur **ausgehenden** Internetzugang (Token-Abruf bei `github.com` bzw.
`oauth2.googleapis.com`). Eine Portweiterleitung ist nicht nötig.

Regeln für die Adresse:

- `PUBLIC_URL` ist **genau** die Adresse, die im Browser eingegeben wird
  (Schema, Host, ggf. Port). Daraus bildet die App die Callback-URL
  `<PUBLIC_URL>/api/auth/callback/<anbieter>` und entscheidet über die
  Cookies. Nur über diese Adresse anmelden — nicht parallel über IP:Port.
- **GitHub** (Settings → Developer settings → OAuth Apps): akzeptiert laut
  Doku jede Callback-URL und prüft sie nur auf exakte Übereinstimmung — auch
  `http://` und interne Namen wie `http://nas.fritz.box:3080`.
- **Google** (Cloud Console → APIs & Services → Credentials → OAuth client
  ID, Typ Web): Redirect-URIs müssen laut Doku **HTTPS** verwenden, dürfen
  **keine IP-Adresse** sein und müssen auf einer Endung der Public Suffix
  List enden (Ausnahme nur `localhost`). Interne Endungen wie `.local`,
  `.lan`, `.home` oder `.internal` scheiden damit aus. Für Google also eine
  eigene Domain (z.B. `stammbaum.example.de`, per DNS auf die private
  NAS-IP) mit HTTPS am Reverse-Proxy. Der Zustimmungsbildschirm darf im
  Status „Testing“ bleiben; dann die Familienmitglieder als Testnutzer
  eintragen.

Beides ist aus der Anbieter-Dokumentation abgeleitet (Stand 11/2026), nicht
auf dieser NAS ausprobiert — beim ersten Deploy einmal durchspielen.

**HTTP oder HTTPS:**

- `PUBLIC_URL=http://…` — Cookies ohne `Secure`-Flag, funktioniert im LAN.
  Das Sitzungs-Cookie geht dann unverschlüsselt durchs Heimnetz; nur mit
  GitHub möglich.
- `PUBLIC_URL=https://…` — Cookies mit `Secure` und `__Secure-`-Präfix. TLS
  endet am Reverse-Proxy, die App selbst spricht HTTP. Das passt, weil
  Auth.js Schema und Host aus `AUTH_URL` (= `PUBLIC_URL`) nimmt und nicht aus
  der Anfrage; `AUTH_TRUST_HOST=true` setzt der Stack.
- Der Proxy muss den ursprünglichen `Host`-Header durchreichen (oder
  `X-Forwarded-Host` setzen). Next.js vergleicht bei Formular-Aktionen — auch
  beim Klick auf „Anmelden mit …“ — `Origin` mit dem Host; passt das nicht,
  passiert beim Klick nichts bzw. das Log zeigt „Invalid Server Actions
  request“.

### Reverse-Proxy

Die App lauscht auf `127.0.0.1:3080` (änderbar: `APP_PORT`, `APP_BIND`).
Für den Proxy wichtig:

| Punkt | Einstellung |
|---|---|
| Ziel | `http://127.0.0.1:3080` (bzw. LAN-IP der NAS, siehe NPM) |
| Upload-Größe | Bilder bis 15 MB (`MAX_UPLOAD_BYTES`), ZIP-Importe unter *Daten* (`/admin/data`) deutlich mehr — Limit mindestens 20 MB, besser 1 GB |
| Zeitlimit | großer ZIP-Import kann über 60 s dauern — Lese-Timeout 300 s |
| Header | `Host` unverändert durchreichen; `Authorization` durchreichen (KI-Zugang; tun alle drei unten ohne Zutun); `X-Forwarded-For` mit der Adresse des Clients **anhängen** — daran hängt die Sperre nach Fehlversuchen am KI-Zugang. Fehlt der Header, teilen sich alle KI-Clients eine Sperre |
| WebSocket, SSE | nicht nötig (auch nicht für den KI-Zugang) |
| Erreichbarkeit | die App nur über den Proxy: `APP_BIND` nie auf `0.0.0.0` — wer die App direkt erreicht, kann `X-Forwarded-For` selbst setzen |

**Synology (DSM 7)** — Systemsteuerung → Anmeldeportal → Erweitert →
Reverse Proxy → Erstellen:

- *Quelle:* Protokoll `HTTPS`, Hostname `stammbaum.example.de`, Port `443`
  (oder `HTTP`/`80`, wenn `PUBLIC_URL` mit `http://` beginnt)
- *Ziel:* Protokoll `HTTP`, Hostname `localhost`, Port `3080`
- Zertifikat: Systemsteuerung → Sicherheit → Zertifikat → *Einstellungen* —
  dem neuen Eintrag ein Zertifikat zuweisen. Let's Encrypt über DSM braucht
  Erreichbarkeit von außen; ohne Portfreigabe ein Zertifikat per DNS-Challenge
  besorgen und importieren (oder NPM nehmen, s.u.).

DSM reicht den `Host`-Header nach bisheriger Erfahrung durch. Das
Upload-Limit lässt sich in der DSM-Oberfläche nicht einstellen — nach dem
Einrichten ein Bild mit ~15 MB hochladen. Kommt „413 Request Entity Too
Large“, ist der DSM-Proxy für diese App ungeeignet; dann Nginx Proxy Manager
oder das Caddy-Profil verwenden. (Nicht auf einer Synology ausprobiert.)

`X-Forwarded-For` setzen DSM, NPM und Caddy nach ihrer Standardkonfiguration
selbst; auf der NAS ist das nicht geprüft. Prüfen lässt es sich mit einem
absichtlich falschen KI-Schlüssel von einem anderen Gerät aus: `docker logs
familytree-app-1 2>&1 | grep mcp-http` muss bei `Absender` die Adresse dieses
Geräts zeigen, nicht `127.0.0.1` oder die des Proxys.

**Nginx Proxy Manager** — läuft meist selbst in einem Container; dort zeigt
`127.0.0.1` auf NPM selbst. Deshalb im Stack `APP_BIND` auf die LAN-IP der NAS
setzen (z.B. `192.168.178.10`) und in NPM *Hosts → Proxy Hosts → Add Proxy
Host*:

- *Domain Names:* `stammbaum.example.de`; *Scheme:* `http`; *Forward
  Hostname/IP:* LAN-IP der NAS; *Forward Port:* `3080`; *Websockets
  Support:* aus
- *SSL:* Zertifikat; ohne Erreichbarkeit von außen *Use a DNS Challenge*
  (API-Token des DNS-Anbieters)
- *Advanced → Custom Nginx Configuration:*

  ```nginx
  client_max_body_size 1g;
  proxy_read_timeout 300s;
  ```

NPM reicht `Host` und `X-Forwarded-*` von sich aus durch.

**Ohne vorhandenen Proxy:** Stack-Variable `COMPOSE_PROFILES=caddy` startet
Caddy mit inline hinterlegter Konfiguration (kein Bind-Mount aus dem Repo).
Standard: HTTPS mit Caddys eigener Zertifizierungsstelle (`tls internal`) auf
Port `8443`, HTTP auf `8080`; einstellbar über `CADDY_SITE` (Hostname),
`CADDY_HTTPS_PORT`, `CADDY_HTTP_PORT`, `CADDY_BIND`, `CADDY_MAX_BODY` und
`CADDY_TLS` (`internal` oder eine E-Mail für Let's Encrypt — nur bei
öffentlicher Erreichbarkeit). `PUBLIC_URL` dann z.B.
`https://stammbaum.fritz.box:8443`. Der Browser warnt, bis das Stammzertifikat
aus `${DATA_ROOT}/caddy/data/caddy/pki/authorities/local/root.crt` auf den
Geräten importiert ist. Ob Portainer `COMPOSE_PROFILES` aus den
Stack-Variablen an Compose weitergibt, ist nicht auf der NAS geprüft (Docker
Compose selbst liest die Variable aus der Env-Datei, die Portainer übergibt);
erscheint kein `proxy`-Container, liegt es daran.

### Updates

Mit den Einstellungen aus Schritt 5 läuft ein Update ohne Handgriff:
Push auf `main` → Actions baut und prüft (ca. 5–10 min) → Branch `deploy`
rückt nach → Portainer bemerkt das beim nächsten Abruf (≤ 5 min), lädt die
Image neu (*Re-pull image*) und startet den Stack: `backup-db` → `app`
(Migrationen, dann Server).

**Warum `deploy` statt `main`:** Würde Portainer `main` beobachten, sähe es
den neuen Commit sofort, der Image-Build läuft dann aber noch. Portainer
würde das alte `latest` erneut laden — und erst beim *nächsten* Commit
nachziehen. Schlimmer: eine neue `docker-compose.yml` könnte auf Images
treffen, die es noch nicht gibt. Der Workflow setzt `deploy` erst, wenn alle
Image fertig ist; Compose-Datei und Image passen so immer zusammen.
*Force redeployment* bleibt aus: es würde den Stack bei jedem Abruf neu
starten — und damit jedes Mal eine Sicherung anlegen.
Webhooks scheiden aus, weil GitHub die NAS nicht erreicht.

**Version festhalten / zurückrollen:** Stack-Variable `IMAGE_TAG` setzen und
*Update the stack* mit *Re-pull image*:

| `IMAGE_TAG` | Bedeutung |
|---|---|
| `latest` (Standard) | jeweils der neueste Stand von `main` |
| `sha-1a2b3c4` | genau dieser Commit (die ersten 7 Zeichen, siehe GitHub → Packages) |
| `1.2.0` / `1.2` | ein Release; entsteht durch einen Git-Tag `v1.2.0` |

Achtung beim Zurückrollen über eine Migration hinweg: Die Datenbank behält
das neuere Schema. Bei rein ergänzenden Migrationen läuft die ältere App
weiter; sonst die Sicherung vor dem Update einspielen
([Wiederherstellung](#wiederherstellung)). Zum Zurückkehren `IMAGE_TAG`
wieder auf `latest` setzen.

**Von Hand aktualisieren:** *Stacks → familytree → Pull and redeploy*.

**Was ein Neustart des Stacks tut** (lokal nachgeprüft): Hat sich das
App-Image geändert, hält Compose die alte App **zuerst** an, lässt dann
`media-init` und `backup-db` laufen und startet erst danach den neuen
App-Container, der migriert — eine Migration läuft also nie neben der alten
App und nie ohne frische Sicherung. Ohne neues Image (*Update the stack*
ohne Änderung) laufen die beiden Einmal-Jobs erneut, die App läuft dabei
einfach weiter; migriert wird nichts. Startet nur der App-Container neu
(Absturz, Neustart der NAS), prüft er die Migrationen erneut — mit
demselben Image gibt es dann nichts einzuspielen („No pending migrations to
apply.“, kostet 2–3 s).

### Fehlersuche

Logs: Portainer → *Stacks → familytree* → Container → *Logs*, oder auf der
NAS `docker logs familytree-app-1` (bzw. `-backup-db-1`, `-media-init-1`, …).
Die Ausgabe der Migrationen steht im Log von **`app`**, vor dem Serverstart
(Zeilen mit `[start]` und die Meldungen von Prisma).

| Symptom | Ursache / Abhilfe |
|---|---|
| Deploy bricht ab mit „… fehlt“ | Pflichtvariable nicht gesetzt (Meldung nennt sie) |
| „pull access denied“ / „denied“ / „unauthorized“ für `ghcr.io/…` | Paket noch privat ([Erste Installation](#erste-installation), Schritt 2) oder der Workflow ist noch nie gelaufen; bei bewusst privatem Paket Token falsch oder abgelaufen ([docs/dev-history.md](docs/dev-history.md#privates-image-mit-registry-zugang-bis-19112026)) |
| Portainer findet `refs/heads/deploy` nicht | Workflow auf `main` noch nie erfolgreich durchgelaufen |
| `app` „restarting“, Log `[start] FEHLER: Eine Migration ist fehlgeschlagen …` | → [Fehlgeschlagene Migration](#fehlgeschlagene-migration) |
| `app` „restarting“, Log `[start] FEHLER: Die Datenbank enthält bereits Tabellen, aber keine Migrationshistorie` | Datenbank stammt aus einer `db push`-Installation → Baselining, siehe [Schema und Migrationen](#schema-und-migrationen) |
| `app` „restarting“, Log `[start] FEHLER: Datenbank nach 60s nicht erreichbar` | `db` läuft nicht, oder die Zugangsdaten passen nicht zur Datenbank (`POSTGRES_PASSWORD` nach der Ersteinrichtung geändert — Postgres übernimmt es nur beim allerersten Start) |
| `app` startet nicht, `backup-db` Exit ≠ 0 | Sicherung fehlgeschlagen (Platz, Rechte auf `backups/`) — App und Migration starten absichtlich nicht ohne Sicherung |
| `db` startet nicht: „invalid permissions“ / „Operation not permitted“ | Rechte von `postgres/` verändert (File Station/ACL). Bei Neuinstallation den leeren Ordner löschen und neu deployen; sonst per SSH `chown -R 70:70` und `chmod 700` darauf |
| `app` startet nicht, `media-init` Exit ≠ 0, Log „FEHLER: Die App (uid 1001) kann nicht … schreiben“ | ACLs des gemeinsamen Ordners verhindern das Schreiben trotz Besitzer 1001 → [Bilderordner nicht beschreibbar](#bilderordner-nicht-beschreibbar) |
| `app` „unhealthy“, `/api/health` → `{"status":"error"}` (503) | Datenbank nicht erreichbar **oder** `media/`, `media/originals/` bzw. `media/thumbs/` nicht beschreibbar (z.B. Rechte nachträglich in der File Station geändert, oder nach einer Wiederherstellung gehören die Unterordner root). Welches, steht in `docker logs familytree-app-1` (`[health] Medienordner: … /data/media/originals nicht beschreibbar (EACCES)`). Für `media/`: Stack neu starten (`media-init` repariert Besitzer), sonst [Bilderordner nicht beschreibbar](#bilderordner-nicht-beschreibbar) |
| Einzelne Bilder fehlen (kaputtes Bildsymbol), `/api/media/…` antwortet 404 | Datei fehlt in `media/`, der Datenbankeintrag existiert aber — typisch nach einer Wiederherstellung, bei der `media/` älter ist als der Dump ([Wiederherstellung](#wiederherstellung)). Datei aus einer neueren NAS-Sicherung zurückholen oder das Bild in der App löschen und neu hochladen |
| Anmeldung: GitHub „redirect_uri is not associated“ / Google „redirect_uri_mismatch“ | Callback-URL beim Anbieter ≠ `<PUBLIC_URL>/api/auth/callback/…` (Schema, Port, Schreibweise) |
| Klick auf „Anmelden mit …“ tut nichts, Log „Invalid Server Actions request“ | Proxy reicht `Host` nicht durch |
| Nach der Anmeldung wieder auf `/login` | Seite über eine andere Adresse als `PUBLIC_URL` aufgerufen, oder `https://`-`PUBLIC_URL` über `http://` geöffnet |
| „Anmeldung fehlgeschlagen … nicht freigeschaltet“ | E-Mail des Kontos steht nicht in der Benutzerliste (oder gesperrt); bei falscher OAuth-Konfiguration erscheint dieselbe Meldung — dann das Log von `app` lesen |
| Upload bricht ab, 413 | Upload-Limit des Proxys (siehe Tabelle oben) |
| Port 3080 belegt | `APP_PORT` ändern und im Proxy anpassen |

#### Fehlgeschlagene Migration

Scheitert `prisma migrate deploy`, beendet sich der App-Container mit
Code 1, **bevor** der Server startet; das Log zeigt Prismas Meldung (z.B.
`Error: P3018 … Migration name: …`, darunter der Datenbankfehler) und einen
Block `[start] FEHLER: …`. Docker startet den Container wegen
`restart: unless-stopped` neu, mit wachsender Pause bis etwa einer Minute
(lokal: nach zwei Minuten 11 Versuche, danach einer pro Minute). Das ist
gewollt billig und ungefährlich: Prisma vermerkt die Migration als
fehlgeschlagen und spielt bei den weiteren Versuchen **nichts** mehr ein
(`Error: P3009`), bis sie freigegeben wird. Die App ist so lange nicht
erreichbar (der Proxy meldet 502). Wer die Schleife anhalten will:
`docker stop familytree-app-1`.

Prisma führt eine Migration in PostgreSQL als Ganzes aus; scheitert eine
Anweisung, wird der Rest der Datei zurückgenommen (lokal nachgeprüft: eine
im selben Skript angelegte Tabelle war danach nicht vorhanden). Vorgehen:

1. App anhalten: `docker stop familytree-app-1`, Ursache im Log verstehen.
2. Nur falls die Migration doch etwas verändert hat: die Sicherung vom
   Stack-Start einspielen ([Wiederherstellung](#wiederherstellung), Schritte
   1–2; sie ist der neueste Dump in `backups/`).
3. Die Migration als zurückgenommen markieren (Name aus dem Log):
   ```sh
   docker run --rm --network familytree_default -e RUN_MIGRATIONS=false \
     -e DATABASE_URL='postgresql://familytree:<POSTGRES_PASSWORD>@db:5432/familytree' \
     ghcr.io/soschlegel/familiy-tree:latest \
     prisma migrate resolve --rolled-back <Migrationsname>
   ```
4. Ein Image mit korrigierter Migration bereitstellen (Push auf `main`) —
   oder per `IMAGE_TAG` auf das vorige Image zurückgehen — und
   *Pull and redeploy*.

#### Start ohne Migrationen (RUN_MIGRATIONS=false)

Nur zur Fehlersuche: Stack-Variable `RUN_MIGRATIONS=false` setzen und den
Stack aktualisieren. Der App-Container überspringt dann das Warten auf die
Datenbank, `migrate deploy` und den Admin-Abgleich (Log: `[start]
RUN_MIGRATIONS=false — … übersprungen.`) und startet sofort den Server — auf
eigene Gefahr, wenn das Schema nicht zum Image passt. Variable danach wieder
entfernen. Für einzelne Prisma-Befehle braucht es den Schalter im Stack
nicht: ein Einmal-Container wie oben (`docker run … -e RUN_MIGRATIONS=false
<image> prisma …`) führt nur den angegebenen Befehl aus, und
`docker exec familytree-app-1 prisma migrate status` zeigt im laufenden
Container den Stand.

#### Bilderordner nicht beschreibbar

`media-init` übereignet `media/` an UID 1001 und testet dann, ob die App
dort eine Datei anlegen kann. Scheitert der Test trotzdem, entscheiden
nicht die Unix-Rechte, sondern Windows-artige ACLs des gemeinsamen Ordners
(Synology: File Station → *Eigenschaften → Berechtigung*). UID 1001 ist kein
DSM-Benutzer und lässt sich dort nicht auswählen. Abhilfe per SSH als root
(Stack vorher anhalten; Pfad anpassen; nicht auf einer Synology
ausprobiert):

```sh
M=/volume1/docker/familytree/media
synoacltool -get "$M"          # zeigt die ACL; "Linux mode" = keine ACL
synoacltool -del "$M"          # ACL nur von media/ entfernen
chown -R 1001:1001 "$M"
chmod -R u+rwX "$M"
```

Danach *Update the stack*; `media-init` muss „Bilderordner bereit“ melden.
`synoacltool -del` wirkt nur auf `media/`; bereits vorhandene Dateien darin
mit eigener ACL ggf. einzeln (`find "$M" -exec synoacltool -del {} \;`).
Die gröbere Alternative in der File Station: für `media/` der Gruppe
*Everyone* Lesen/Schreiben geben (*auf diesen Ordner, Unterordner und
Dateien anwenden*). Auf einem Netzlaufwerk, das `chown` verweigert (NFS mit
`root_squash`, SMB), muss `media/` stattdessen auf dem Server UID 1001
gehören oder für alle beschreibbar sein.

## Schema und Migrationen

Das Schema liegt in `prisma/schema.prisma`, die Migrationen in
`prisma/migrations`:

| Migration | Inhalt |
|---|---|
| `0_init` | Ausgangsstand |
| `20261116000000_ungenaue_daten_und_quellen` | Genauigkeit/Zusatz für alle Daten (Spalten mit Standardwert), Tabellen `Source` und `Citation` — rein ergänzend, keine Datenumstellung |
| `20261117000000_ki_zugang` | KI-Zugang: `User.aiAccess` (Standard „kein Zugang“), Tabelle `ApiToken`, im `AuditLog` die Spalten `channel` und `apiTokenId` — rein ergänzend; nach dem Update hat niemand KI-Zugang, bis der Administrator ihn vergibt |
| `20261119000000_genealogie_ereignisse_import` | Lebensereignisse (`Event`), weitere Namen (`PersonName`), Importläufe, Herkunft, Fremdkennungen und Rohdaten (`ImportBatch`, `ImportLink`, `ExternalId`, `ImportRawRecord`); neue Datumszusätze und je Datum Bereichsende und Wortlaut; Rufname, Titel, Namenszusatz, Todesursache; Heirats-/Scheidungsort; Beleg an einem Ereignis; Ehestand unbekannt (`PARTNER_UNKNOWN`) — rein ergänzend (neue Enum-Werte, Spalten mit Standardwert, neue Tabellen) |
| `20261120000000_dubletten_zusammenfuehren` | Mehrere Herkunftsangaben je Datensatz: die Unique-Indizes auf den sieben Träger-Spalten von `ImportLink` werden gewöhnliche Indizes; neue Spalten `ImportLink.mergedFromId`/`mergedAt`; Tabelle `DuplicateDismissal` — **nicht rein ergänzend** (`schema-diff-check` meldet die sieben `DROP INDEX`), aber ohne Datenänderung: aus „höchstens ein Link je Datensatz“ wird „beliebig viele“, jede bestehende Zeile erfüllt die gelockerte Regel |
| `20261121000000_quellen_einordnen` | Quellenarten `ONLINE_TREE` und `ONLINE_COLLECTION`, `Source.provider`, `Citation.url` — rein ergänzend |
| `20261122000000_changelog` | Änderungsgeschichte: Tabelle `ChangeSet` (Pakete), im `AuditLog` die Spalten `changeSetId` (Fremdschlüssel, beim Löschen des Pakets `NULL`), `personIds` und `familyIds` (Listen mit leerem Standardwert, GIN-Indizes) — rein ergänzend; ältere Einträge bleiben unverändert (ohne Paket, leere Listen) |
| `20261122000001_bezugsperson` | Bezugsperson: `User.personId` (Fremdschlüssel, `ON DELETE SET NULL`) — rein ergänzend |
| `20261123000000_medien_an_eintraegen` | Bilder an Quellen, Ereignissen und Belegen: Tabellen `SourceMedia`, `EventMedia`, `CitationMedia` (Muster `PersonMedia`, `sortOrder`, `CASCADE` an beiden Seiten) — rein ergänzend, ohne Datenänderung; `Source.mediaId` bleibt der Hauptscan und wird nicht kopiert (die App liest beide Stellen) |
| `20261123000001_orte` | Ortszuordnung für die Karte: Tabelle `Place` (normalisierter Ortstext → Koordinaten, Herkunft automatisch/von Hand, Genauigkeit, „nicht zuordenbar“), Enums `PlaceSource` und `PlacePrecision` — rein ergänzend |
| `20261124000001_orte_ki` | Ortszuordnung durch die KI: `PlaceSource` um `AI` (`ALTER TYPE … ADD VALUE`), `Place.note` (Begründung) und `Place.uncertain` (Standard `false`) — rein ergänzend |

Schemaänderungen künftig mit `npm run db:migrate` (`prisma migrate dev`) als
Migration anlegen und mit einchecken. Vor dem Commit prüfen, ob sie rein
ergänzend ist (neue Tabellen, Spalten, Indizes, Fremdschlüssel, Enum-Werte,
Standardwerte) — alles andere kann beim Update Daten löschen oder umwandeln
und gehört bewusst entschieden:

```bash
node docker/schema-diff-check.mjs < prisma/migrations/<name>/migration.sql
# Exit 0: rein ergänzend; sonst Liste der kritischen Anweisungen, Exit 3
```

**Im Betrieb** wendet der App-Container beim Start `prisma migrate deploy`
an ([docker/entrypoint.sh](docker/entrypoint.sh)) — der einzige Weg, auf dem
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
[docs/dev-history.md](docs/dev-history.md#baselining-einer-db-push-datenbank-bis-17112026).

**Prisma-CLI im Image:** Das Image enthält nur das Paket `prisma` mit seinen
Abhängigkeiten in den Versionen aus `package-lock.json` (unter
`/opt/prisma-cli`, aufgerufen über `prisma`, siehe
[docker/prisma.sh](docker/prisma.sh)), ohne Query-Engine, Client-Vorlage und
WebAssembly-Engines — die Schema-Engine (Binärdatei für linux-musl) bleibt.
Nach einem Prisma-Update deshalb einmal prüfen, bevor es auf die NAS geht:

```bash
docker build -t familytree-local/app:dev .
# ohne Netz: Schema Engine muss gefunden werden, kein Download-Versuch
docker run --rm --network none --entrypoint prisma familytree-local/app:dev --version
# dann den Stack lokal mit docker-compose.build.yml starten; im Log von app:
# "All migrations have been successfully applied." bzw. "No pending migrations"
```

## Sicherung

Eine vollständige Sicherung besteht aus genau zwei Teilen:

1. **Datenbank-Dump** — `backups/db_<Datum>_<Zeit>.sql.gz`, erzeugt vom
   Dienst `backup-db` (`pg_dump --clean --if-exists`, also direkt wieder
   einspielbar). Er löscht Dumps, die älter als `BACKUP_KEEP_DAYS`
   (Standard 30) Tage sind.
2. **Bilderordner** — `media/` selbst. Die Bilder sind gewöhnliche Dateien,
   benannt nach den Schlüsseln in der Datenbank; es gibt keinen eigenen
   Sicherungsdienst und keine zweite Kopie innerhalb von `${DATA_ROOT}` (sie
   läge auf demselben Datenträger und würde die NAS-Sicherung nur
   vergrößern). Gesichert wird `media/` von der NAS-Sicherung.

`backup-db` läuft **bei jedem Stack-Start vor dem App-Container** (und damit
vor dessen Migration), damit es zu
jedem Update eine Sicherung vom Stand davor gibt (mehrere Updates am Tag
ergeben mehrere Dumps), und zusätzlich täglich per Aufgabenplaner.

**Täglich planen (Synology):** Systemsteuerung → Aufgabenplaner → Erstellen →
Geplante Aufgabe → Benutzerdefiniertes Script; Benutzer `root`; Zeitplan
z.B. täglich 03:00; Script:

```sh
docker start -a familytree-backup-db-1
```

Das startet nur den vorhandenen Container erneut — es braucht weder eine
Repo-Kopie noch `docker compose` auf der NAS. `-a` hängt die Ausgabe ans
Aufgabenprotokoll; ein Fehlschlag lässt die Aufgabe fehlschlagen (Mail-
Benachrichtigung im Aufgabenplaner einschalten). Mit Repo-Kopie geht
dasselbe über `./scripts/backup.sh [Stackname]`.

**NAS-Sicherung (Hyper Backup o.ä.) — Pflicht:** `${DATA_ROOT}` vollständig
sichern, mindestens `backups/` **und** `media/`, mit Versionierung (sonst
überschreibt eine versehentliche Löschung die einzige Kopie). Zeitplan
**nach** dem Dump, z.B. Dump 03:00, Hyper Backup 03:30 — dann stammt
`media/` in jeder Version vom selben oder einem etwas späteren Zeitpunkt als
der Dump darin, und genau das braucht eine konsistente Wiederherstellung
(siehe unten). Die Rohdateien unter `postgres/` sind im laufenden Betrieb
nur zusammen mit einem Snapshot (Btrfs) konsistent; maßgeblich sind die
Dumps. Zusätzlich ist der ZIP-Export unter `/admin/data` ein vollständiges,
instanzunabhängiges Backup ([Austauschformat](#austauschformat)).

**Wenn Dump und Bilder nicht exakt zusammenpassen:**

| Lage | Folge |
|---|---|
| `media/` neuer als der Dump (Bilder nach dem Dump hochgeladen) | verwaiste Dateien ohne Datenbankeintrag — harmlos, belegen nur Platz |
| `media/` älter als der Dump bzw. Datei fehlt | Datenbankeintrag ohne Datei — das Bild erscheint als kaputtes Symbol, `/api/media/…` antwortet 404; der Rest der App läuft normal. Datei aus einer neueren Sicherung holen oder Bild löschen und neu hochladen |

Deshalb: Bilder immer vom selben oder einem späteren Zeitpunkt als der Dump
zurückspielen — nie umgekehrt.

### Wiederherstellung

Beispiel für Stack `familytree` und `DATA_ROOT=/volume1/docker/familytree`,
per SSH als root auf der NAS. Funktioniert genauso auf einer frisch
installierten NAS (erst den Stack wie oben deployen; `postgres/` **nicht**
aus der NAS-Sicherung zurückholen, sondern den Dump einspielen).

Vorher aus der NAS-Sicherung (Hyper Backup → *Wiederherstellen* →
*Daten*, Ziel ein eigener Ordner) den gewünschten Dump und den Ordner
`media/` derselben Version holen — z.B. nach `/volume1/restore/familytree/`.
Ein Dump, der noch in `backups/` liegt, kann direkt verwendet werden; dann
`media/` aus einer NAS-Sicherung vom selben Tag oder später.

```sh
# 1. App anhalten
docker stop familytree-app-1

# 2. Datenbank: Schema leeren, Dump einspielen
docker exec -i familytree-db-1 psql -U familytree -d familytree -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c /volume1/docker/familytree/backups/db_2026-11-16_030000.sql.gz \
  | docker exec -i familytree-db-1 psql -U familytree -d familytree -v ON_ERROR_STOP=1 -q

# 3. Bilder zurückkopieren — ergänzend (vorhandene neuere Dateien bleiben,
#    sie sind nur verwaist und schaden nicht). Besitzer egal, siehe 4.
cp -a /volume1/restore/familytree/media/. /volume1/docker/familytree/media/

# 4. Wieder starten — Portainer: Stacks → familytree → "Update the stack".
#    Das lässt media-init laufen (übereignet die zurückkopierten Dateien an
#    die App), sichert den eingespielten Stand und startet die App, die ggf.
#    neuere Migrationen anwendet. Ohne Portainer:
#    docker start -a familytree-media-init-1 && docker start familytree-app-1
```

Danach `curl http://127.0.0.1:3080/api/health` → `{"status":"ok"}` und
einige Personen mit Bildern ansehen. Ist der Dump älter als der aktuelle
Programmstand, holt die App beim Start die fehlenden Migrationen nach
(Log von `app`).

## Austauschformat

`/admin/data` bietet Export und Import.

- **JSON** — Personen, Beziehungen, Quellen mit Belegen und Bildzuordnungen.
  Bilder erscheinen als Verweis auf einen Dateinamen.
- **ZIP** — dasselbe JSON plus die Bilddateien unter `media/`. Damit ist der
  Export ein vollständiges Backup und ein Umzug auf eine andere Instanz
  funktioniert wirklich.
- **GEDCOM** — Export als GEDCOM 5.5.1 (UTF-8), auf Wunsch als ZIP mit den
  Bildern; Import mit Vorschau und Abgleich, siehe [GEDCOM](#gedcom-import-und-export).

Der Import zeigt zuerst eine Vorschau (wie viel neu, wie viel aktualisiert) und
ändert erst nach ausdrücklicher Bestätigung etwas. Bestehende Einträge werden
über ihre ID wiedererkannt und aktualisiert, unbekannte ergänzt — **gelöscht
wird nie**. Importieren dürfen nur Administratoren; exportieren darf jeder, der
die Daten ohnehin sehen kann.

Formatversion 2 enthält zusätzlich je Datum Genauigkeit und Zusatz
(`birthDatePrecision`, `birthDateQualifier`, …) sowie `sources` und
`citations`. Belege werden nur für exportierte Personen und Beziehungen
mitgenommen, Quellen nur, soweit sie dafür zitiert sind (Administratoren:
alle; sonst zusätzlich die eigenen unbelegten). Ältere Exporte (Version 1)
ohne diese Felder lassen sich unverändert importieren; ihre Daten gelten als
tagesgenau.

Formatversion 3 enthält zusätzlich Datumsbereiche und Wortlaut (`…To`,
`…ToPrecision`, `…Phrase`), die neuen Zusätze, Rufname, Titel,
Namenszusatz, Todesursache, Heirats- und Scheidungsort, `events`
(Lebensereignisse), `personNames` (weitere Namen), Belege an Ereignissen,
`externalIds` (Fremdkennungen) und `rawRecords` (nicht zugeordnete
Importdaten) — jeweils nur für exportierte Personen, Beziehungen und Quellen.
Importläufe und ihre Herkunftsangaben gehören zur Instanz und reisen nicht
mit. Dateien der Versionen 1 und 2 lassen sich weiter unverändert importieren.

Formatversion 4 enthält zusätzlich die Bilder an Quellen (`sources[].media`,
neben dem Hauptscan `mediaId`), an Ereignissen (`events[].media`) und an
Belegen (`citations[].media`), je `{ mediaId, sortOrder }` mit Verweis auf
`media`. Sie reisen mit, wenn ihr Eintrag exportiert wird (bei der
Familienauswahl also nur an Exportiertem); der Import hängt sie ergänzend
wieder an. Dateien der Versionen 1–3 lassen sich weiter importieren.

## GEDCOM (Import und Export)

GEDCOM ist das Austauschformat der Stammbaumprogramme (MyHeritage, Ancestry,
Gramps, Ahnenblatt …). Die App liest GEDCOM 5.5, 5.5.1 und 7.0 (auch die
Eigenheiten von MyHeritage) und schreibt GEDCOM 5.5.1 in UTF-8. Alles liegt
auf `/admin/data`; **importieren dürfen nur Administratoren** — Bearbeiter und
Betrachter sehen den Import nicht, die Schnittstellen antworten ihnen mit 403.

### Eine Datei vorab prüfen

```bash
npm run gedcom:check -- meine-datei.ged                 # Zählungen, Auffälligkeiten, Vollständigkeit
npm run gedcom:check -- meine-datei.ged --show-names    # Diagnosen zusätzlich mit Personennamen
npm run gedcom:check -- neu.ged --compare alt.ged       # was hat sich zwischen zwei Exporten geändert?
npm run gedcom:check -- meine-datei.ged --json          # alles als JSON
```

Ohne `--show-names` gibt das Programm keine Namen, Daten, Orte oder Texte
aus, nur Zählungen, Tag-Pfade und Kennungen (`@I12@`) — so lässt sich die
Ausgabe gefahrlos weitergeben. Es liest nur die Datei, die Datenbank bleibt
unberührt. Bibliothek dahinter: [lib/gedcom](lib/gedcom/README.md).

### Import Schritt für Schritt

1. **Datei wählen** (`.ged` oder `.zip` mit einer `.ged`) und „Vorschau der
   GEDCOM-Datei“. Die Originaldatei wird aufbewahrt (siehe unten); an den
   Stammbaumdaten ändert die Vorschau nichts. Sie lässt den echten Import
   probeweise laufen, zeigt also genau, was passieren würde.
2. **Welcher Baum ist das?** Die App erkennt einen früher importierten Baum
   am Dateikopf (MyHeritage `_PROJECT_GUID`, sonst Site-ID) oder an
   übereinstimmenden `_UID`-Kennungen. Im Auswahlfeld lässt sich das
   übersteuern: „Automatisch erkennen“, „Neuer, unabhängiger Baum“ oder
   „Aktualisierung von …“ (frühere Bäume mit Datum und Zahl gleicher
   Kennungen). Abgeglichen wird immer nur innerhalb des gewählten Baums.
3. **Übersicht und Gruppen.** Kacheln und Tabelle zählen je Art (Personen,
   Beziehungen, Ereignisse, weitere Namen, Quellen, Belege); die Gruppen
   lassen sich aufklappen, durchsuchen und seitenweise nachladen:

   | Gruppe | Bedeutung | Standard |
   |---|---|---|
   | Neu | gibt es in der App noch nicht | wird angelegt |
   | In der Datei geändert | seit dem letzten Import in der Datei geändert, in der App nicht (mit den abweichenden Feldern) | wird mit den Werten der Datei aktualisiert |
   | In der App geändert | seit dem letzten Import hier bearbeitet; „auch in der Datei geändert“, wenn beide Seiten abweichen | **App-Version bleibt** — für alle oder je Eintrag auf „Dateiversion übernehmen“ umstellbar |
   | Fehlt in der Datei | früher importiert, im neuen Stand nicht mehr enthalten | **bleibt erhalten** und wird vermerkt; gelöscht wird nur, was einzeln angekreuzt (oder mit „Angezeigte zum Löschen vormerken“ vorgemerkt) und beim Ausführen noch einmal bestätigt wird |
   | Nicht übernehmbar | verstößt gegen eine Regel der App, mit Grund (z.B. „Eltern und Kind können nicht als Partner verbunden werden“, dritter leiblicher Elternteil, Zyklus) | wird ausgelassen — **das Original bleibt erhalten** (siehe unten) |
   | Schon vorhanden | gibt es in der App schon, aber nicht aus diesem Baum (z.B. dieselbe Beziehung von Hand angelegt) | bleibt unverändert |
   | Unverändert | Datei und App stimmen überein | nichts zu tun |

4. **Vorschläge.** Sieht eine neue Person einer von Hand angelegten ähnlich
   (Name, Geburtsjahr und -ort, Namen der Eltern), steht bei ihr „Ist das eine
   dieser Personen?“. Nur wenn du eine auswählst, wird die Datei-Person ihr
   zugeordnet: ihre Angaben in der App bleiben, Ereignisse und Namen aus der
   Datei kommen hinzu. Zusammengeführt wird nie automatisch.
5. **Familienzuordnung der neuen Personen:** keiner Familie (Standard),
   vorhandenen Familien oder einer neuen Familie. In der Datei als privat
   bzw. lebend markierte Personen bleiben auf Wunsch (Standard) ohne
   Familie. Vorhandene Personen behalten ihre Zuordnung. Warum das zählt:
   Sichtbarkeit hängt an Familien ([Berechtigungen](#berechtigungen)) —
   **importierte Personen ohne Familie sieht nur der Administrator**, bis er
   sie einer Familie zuordnet (Personenseite, „Familien“). So wird durch einen
   Import nichts versehentlich für alle sichtbar.
6. **Fotos** (nur wenn die Datei Fotoverweise enthält): siehe unten; der
   Haken ist aus.
7. **„Was der Import tut“** fasst alles in Sätzen zusammen (wie viel neu,
   aktualisiert, behalten, gelöscht, ausgelassen). „GEDCOM-Import ausführen“
   fragt noch einmal nach (mit Hinweis, falls etwas gelöscht oder Fotos
   geladen werden) und läuft im Hintergrund; danach zeigt die Seite das
   Ergebnis je Art. „Abbrechen“ verwirft die Vorschau samt aufbewahrter
   Datei.

Unter „Hinweise“ stehen Auffälligkeiten der Datei (fehlende Verweise, Kind
vor den Eltern geboren, leere Familien …), was beim Übernehmen angepasst
wurde, und die Vollständigkeit („nichts geht verloren — x von y Zeilen
gedeutet, z unverändert als Rohdaten erhalten“).

### Wiederholte Importe

Der Normalfall ist, denselben Baum regelmäßig neu zu exportieren und
einzuspielen. Jeder importierte Datensatz merkt sich seine Herkunft
(`ImportLink`): den Baum, seinen Schlüssel in der Datei (`_UID`, sonst RIN,
sonst Xref; Ereignisse über eigene `_UID` bzw. Art und Nummer) und einen
Fingerabdruck der importierten Werte. Daran erkennt der nächste Import jeden
Eintrag wieder — auch wenn das Programm die Xrefs neu durchnummeriert hat —
und sieht, ob er seither in der Datei, in der App oder in beiden geändert
wurde. Beziehungen werden über das Personenpaar erkannt, Quellen ohne
Kennung über Xref und Titel bzw. Titel und Verfasser. Ein zweiter Import
derselben Datei ergibt „alles unverändert“ und schreibt nichts Neues.

**In der App Geändertes** wird nie still überschrieben: Standard ist, die
App-Version zu behalten; ersetzt wird nur, was du ausdrücklich auf
„Dateiversion übernehmen“ stellst. Was in der Datei fehlt, bleibt
standardmäßig erhalten und wird beim nächsten Import wieder unter „Fehlt in
der Datei“ angeboten.

### Nichts geht verloren

- Jeder Personen-, Familien- und Quellendatensatz der Datei liegt zusätzlich
  unverändert als **Rohdaten** (`ImportRawRecord`) am zugehörigen Eintrag —
  auch alles, was die App nicht abbildet (fremde Tags, Koordinaten,
  Fotoverweise …). Der GEDCOM-Export schreibt es von dort zurück.
- Eine **abgelehnte Beziehung** (z.B. eine Partnerschaft zwischen Mutter und
  Sohn, ein dritter leiblicher Elternteil) wird nicht angelegt; das Original
  ihrer Familie samt Ereignissen, Notizen und Belegen bleibt aber bei einer
  der beteiligten Personen liegen. Die Vorschau sagt das je Eintrag („… —
  nicht übernehmbar, Original bleibt bei *Person* erhalten“), und der Export
  schreibt eine abgelehnte Partnerschaft wieder als Familie (ohne Kinder —
  deren Abstammung steht bei der eigentlichen Familie). Eine abgelehnte
  Eltern-Kind-Verbindung steht weiter im Original der Ein-Eltern-Familie bei
  diesem Elternteil; der Export schreibt sie aber nicht zurück.
- Widersprechen sich Abstammung und Partnerschaft derselben zwei Personen
  (Kind zugleich Partner eines Elternteils), bleibt die Abstammung, und die
  Partnerschaft wird abgelehnt.
- Unplausible Daten (vor dem Jahr 1000, in der Zukunft, Tod vor Geburt)
  kommen nur als Wortlaut, damit die Person nicht ausfällt.

**Wo die Dateien liegen:** Die Originaldatei jedes Laufs und der Plan der
Vorschau liegen unter `MEDIA_DIR/imports/` — im Betrieb also in
`${DATA_ROOT}/media/imports/` und damit in derselben Sicherung wie die
Bilder ([Sicherung](#sicherung)). Rohdaten stehen in der Datenbank.

**Importverlauf** („Importe“ auf derselben Seite): jeder ausgeführte Lauf mit
Ergebnis, Benutzer und „Originaldatei“ zum Herunterladen. Ersetzt ein
späterer Import Rohdaten durch einen neueren Stand, bleiben die alten als
„überholt“ stehen, bis du sie mit „Überholte Rohdaten entfernen“ löschst (die
Originaldatei des Laufs bleibt). Nie ausgeführte Vorschauen stehen
zugeklappt darunter, lassen sich verwerfen und verschwinden nach 7 Tagen von
selbst.

Zur Sicherung im eigenen Format: Wird eine ältere JSON/ZIP-Sicherung
eingespielt, nachdem seither erneut per GEDCOM importiert wurde, kommen deren
Rohdaten mit ihrem damaligen Stand zurück; zu einer Person können dann zwei
gültige Rohdatensätze liegen, und der GEDCOM-Export nimmt einen davon. Ein
erneuter GEDCOM-Import bringt das wieder in Ordnung.

### Fotos aus der Datei

MyHeritage und andere verweisen in der Datei auf Fotos auf ihren Servern.
Die Vorschau zählt diese Verweise; heruntergeladen wird **nur, wenn du den
Haken „Fotos jetzt herunterladen“ setzt** (Standard: aus — dann bleiben die
Verweise gespeichert, ein späterer Import kann sie holen, und die App stellt
keine einzige Verbindung nach außen her). Schutz beim Herunterladen: nur
`https`, nur öffentliche Adressen (nichts im Heimnetz oder auf dem Server
selbst, auch nicht über Weiterleitungen — höchstens 3, jede neu geprüft),
Verbindung genau zur geprüften Adresse, höchstens 15 MB und 20 s je Bild,
nur Bilddateien, die sharp lesen kann; jedes Bild wird wie ein Upload
verarbeitet, ein schon geholtes nicht noch einmal geladen, und jede Adresse
steht im Lauf. Verweise auf lokale Dateipfade (`C:\…`) werden nie gelesen.
**Gegen echte MyHeritage-Server ist das noch nicht ausprobiert** — getestet
ist es mit Testservern und den Schutzregeln.

### Export

Zwei Downloads auf `/admin/data` für jeden Benutzer, beschränkt auf das, was
er sehen darf — verborgene Personen fehlen samt aller Verweise auf sie:

- **GEDCOM** — eine `.ged`-Datei (GEDCOM 5.5.1, UTF-8) mit Personen, Namen,
  Ereignissen, Familien, Quellen und Belegen sowie allem, was aus einem
  Import als Rohdaten erhalten ist.
- **GEDCOM mit Bildern (ZIP)** — dieselbe Datei plus die Bilddateien unter
  `media/`; Porträts, Hochzeitsbilder und Quellenbilder sind in der
  `.ged`-Datei mit ihrem Pfad verknüpft — als `OBJE` an der Person bzw.
  Familie, im `SOUR`-Datensatz (Hauptscan zuerst, dann weitere Bilder), unter
  dem Ereignis (`EVENT_DETAIL`) und unter dem Beleg (`SOURCE_CITATION`), wie
  GEDCOM 5.5.1 es an diesen Stellen erlaubt. Bilder am Beleg einer
  Eltern-Kind-Beziehung stehen am Beleg beim Kind.
- **Orte im GEDCOM** (Entscheidung des Eigentümers, immer): Ein zugeordneter
  Ortstext steht als heutige Form „Ort, Region, Land“ im `PLAC` (Namen aus
  dem Ortsverzeichnis, z.B. „Wrocław, Województwo dolnośląskie, Polen“),
  darunter `MAP`/`LATI`/`LONG` und — wenn er abweicht — der Originaltext als
  `NOTE Originaltext: Breslau`. Nicht zugeordnete Orte bleiben Freitext. Der
  eigene GEDCOM-Import liest den Originaltext zurück; eine wieder
  eingespielte eigene Datei ändert die Ortsangaben deshalb nicht. Das
  Austauschformat (JSON/ZIP, Version 5) behält den Freitext und nimmt die
  Zuordnungen zusätzlich mit; beim Einspielen werden nur Ortstexte ohne
  vorhandene Zuordnung übernommen.

Beide Knöpfe öffnen einen Dialog mit den Familien, die der Benutzer sehen
darf (alle vorausgewählt, „Alle“/„Keine“, für Administratoren zusätzlich
„Personen ohne Familie“) und der Personenzahl der Auswahl. Eine Person mit
mehreren Familien ist dabei, sobald eine davon gewählt ist; Beziehungen nur
zwischen exportierten Personen, Ereignisse, Namen, Belege, Rohdaten und
Bilder nur an Exportiertem, Quellen nur die zitierten. Ist alles angekreuzt,
ist es derselbe Export wie bisher (auch mit noch unbelegten Quellen). Über
die Schnittstelle: `/api/export?format=gedcom&families=<id>,<id>` bzw.
`&withoutFamily=1` (nur Administratoren); fremde oder unbekannte Familien
lehnt der Server mit 403 ab. Der Dateiname nennt nur die Anzahl
(`stammbaum_<Datum>_auswahl-2-familien.ged`).

Ob MyHeritage, Ancestry, Gramps & Co. den Export vollständig übernehmen, ist
**nicht ausprobiert**; die Tests lesen ihn mit der eigenen Bibliothek zurück
(Zählungen, keine offenen Verweise).

### Grenzen des GEDCOM-Imports

- Große Dateien laufen im Hintergrund: etwa 25 s für 5 000 Personen, wenige
  Sekunden für 500.
- Ein Lauf betrifft einen Baum; mehrere Bäume nebeneinander sind möglich,
  werden aber nicht miteinander abgeglichen (gleiche `_UID` in einem „neuen“
  Baum wird nicht zusammengeführt).
- Eine abgelehnte Eltern-Kind-Verbindung schreibt der Export nicht zurück
  (siehe oben).
- Doppelte Personen lassen sich nachträglich zusammenführen
  ([Dubletten zusammenführen](#dubletten-zusammenführen)); Vorschläge beim
  Import betreffen bisher nur von Hand angelegte Personen.

Dienste: [lib/services/gedcom-import.ts](lib/services/gedcom-import.ts)
(Vorschau; Ausführen im Hintergrund über
[import-jobs.ts](lib/services/import-jobs.ts)), Abbildung:
[lib/gedcom-import/mapping.ts](lib/gedcom-import/mapping.ts), Massenimport:
[lib/services/import-apply.ts](lib/services/import-apply.ts), Export:
[lib/services/gedcom-export.ts](lib/services/gedcom-export.ts), Fotos:
[lib/services/gedcom-photos.ts](lib/services/gedcom-photos.ts) mit
[lib/safe-fetch.ts](lib/safe-fetch.ts).

## Dubletten zusammenführen

Steht dieselbe Person zweimal im Archiv — von Hand doppelt erfasst, einmal
unter dem Ehe- und einmal unter dem Geburtsnamen, oder aus zwei Importen —,
werden beide Einträge zu einem. Die App ist dabei die eine Wahrheit; ein
Import ist eine Quelle, aus der sie sich bedient. Bearbeiter (Recht an
**beiden** Personen nötig) finden das unter **Recherche → Mögliche
Dubletten** (alle Paare: `/research/duplicates`) und auf jeder Personenseite
mit dem Knopf **Zusammenführen …** neben „Im Stammbaum zeigen“ (Dialog:
zuerst die möglichen Dubletten dieser Person mit Klasse und Begründung,
darunter die freie Personensuche). Nach dem Zusammenführen nennt die
Ergebnisseite **Folgedubletten** (Eltern, Partner, Kinder der bleibenden
Person; „sichere“ gemeinsam nur über die Vorschau des
Sammel-Zusammenführens); ein nur wegen doppelt erfasster Eltern gesperrtes
Paar geht mit **„Erst die Eltern, dann dieses Paar“** in einem Schritt. Die
**alte Kennung** der aufgegangenen Person leitet danach auf die bleibende um
(`/people/<alt>`, `/tree?focus=<alt>` und `GET /api/persons/<alt>` mit 308;
`PATCH`/`DELETE` mit 409 und `mergedInto`; nur, wenn die bleibende Person
für den Benutzer sichtbar ist — sonst 404 wie bei einer unbekannten Kennung;
der KI-Zugang löst still auf und meldet `resolvedFrom`). Einzelheiten:
[docs/komponenten/dienste.md](docs/komponenten/dienste.md),
`merge-followups.ts` und `redirects.ts`.

### Mögliche Dubletten

Verglichen werden sichtbare Personen mit gleichem erstem Vornamen (darin nur
gleiche oder ähnlich geschriebene Nachnamen — einige tausend Personen in
Sekundenbruchteilen); bewertet nach Vor- und Nachname (auch Geburtsname und
weitere Namen — „Anna Müller geb. Schmidt“ und „Anna Schmidt“ passen),
Geburts- und Sterbedatum (auch ungenaue: „um 1760“ passt zu „12.03.1760“),
Geburtsort und Verwandten (dieselben oder gleichnamige Eltern bzw. Partner).
Direkt verbundene Personen (Vater und Sohn gleichen Namens), eingetragene
Vorfahren und Nachkommen über beliebig viele Generationen (auch über
Adoptiv-, Stief- und Pflegeeltern — der gleichnamige Urgroßvater ist nicht
sein Urenkel) und Personen verschiedenen Geschlechts kommen nie in Frage.
Die Abstammungskette zählt nur über Personen, die der Benutzer sehen darf;
das Fehlen eines Paares verrät so nichts über verborgene Personen (das
Zusammenführen selbst sperrt Zyklen ohnehin über alle Kanten). Drei Klassen:

| Klasse | Bedeutung |
|---|---|
| **sicher** | gleicher ganzer Name, gleiches tagesgenaues Geburtsdatum, gleiches tagesgenaues Sterbedatum (oder beide ohne Tod, aber dieselben bzw. gleichnamigen Eltern/Partner) und kein Widerspruch |
| **wahrscheinlich** | viele Übereinstimmungen, kein Widerspruch |
| **unklar — bitte prüfen** | einzelne Übereinstimmungen oder ein Widerspruch (verschiedene Sterbedaten, verschiedene Eltern, nur der erste Vorname gleich) |

**Kein Duplikat** blendet ein Paar dauerhaft aus (für alle, Tabelle
`DuplicateDismissal`); zusammengeführte Paare verschwinden ohnehin — die
Liste wird kürzer, je weiter man kommt. Paare der Klasse „sicher“ lassen sich
auswählen und nach einer gemeinsamen Vorschau **in einem Rutsch**
zusammenführen: Eltern vor Kindern, jedes Paar in einer eigenen Transaktion,
die Klasse wird dabei neu geprüft; bleibend ist der Eintrag mit mehr Angaben.

### Vergleich und Zusammenführen

Der schnelle Weg: Vergleich öffnen, lesen, was geschieht, **Zusammenführen**.
Die Vorgaben reichern an, statt zu streiten: Leeres wird aus dem anderen
Eintrag ergänzt, von zwei vereinbaren Daten gewinnt das genauere, bei
„Geburtsname als Nachname“ gegen „Ehename geb. …“ entsteht eine Person mit
Ehename und Geburtsname, Notizen werden aneinandergehängt; bei echtem
Widerspruch gilt der Wert des bleibenden Eintrags, und der andere bleibt
erhalten — eine abweichende Geburts- oder Todesangabe als Zweitangabe
(Ereignis mit `isAlternative`), ein anderer Name als Namensvariante, sofern
er nicht schon im Ergebnis steckt. Nur ein abweichendes Geschlecht lässt sich
nicht aufbewahren; das steht dann ausdrücklich in der Zusammenfassung. Wer
will, klappt **„Angaben einzeln ansehen und wählen“** auf (beide Einträge
nebeneinander, Abweichungen markiert, je Angabe wählbar); „Seiten tauschen“
bestimmt, welcher Eintrag bleibt.

Danach zieht alles um: Lebensereignisse, Namensvarianten, Belege, Bilder
(ein Hauptbild, kein doppelter Verweis), Familien (Vereinigung — wer eine
der Familien sehen darf, sieht die Person danach; die Vorschau sagt das),
Fremdkennungen, Rohdaten und die Herkunft aus Importen. Gleiches fällt
zusammen (gleiche Ereignisse, Belege, Namen); Beziehungen werden umgehängt,
und zwei gleiche Beziehungen (beide Einträge mit demselben Elternteil bzw.
Partner) werden eine — mit der genaueren Art (verheiratet vor „Ehestand
unbekannt“, Adoption vor leiblich; wählbar), ergänzten Daten und Orten,
abweichender Heirat/Scheidung als Zweitangabe und den Belegen und Ereignissen
beider.

**Blockiert** — mit Erklärung, schon in der Vorschau — wird, was die Regeln
der App verletzen würde: die beiden sind miteinander verbunden; zusammen
hätten sie mehr als zwei leibliche Eltern (dann sind meist die Eltern selbst
doppelt — der Vergleich verlinkt das Elternpaar: erst die Eltern, dann das
Kind); ein Zyklus (Großvater und Enkel gleichen Namens); eine Person wäre
zugleich Partner und Elternteil; Tod vor Geburt durch die Wahl.

Ausgeführt wird in **einer Transaktion**; geänderte Daten seit der Vorschau
ergeben einen Hinweis statt einer Überraschung, doppeltes Absenden das
gespeicherte Ergebnis. Der `AuditLog`-Eintrag (`action` „MERGE“, Person =
bleibende) enthält beide IDs, die Wahl je Feld, die vorherigen Werte der
bleibenden Person und die vollständigen Spalten der aufgegangenen samt IDs
ihrer Namen, Ereignisse, Belege, Beziehungen, Rohdaten und Herkunftsangaben.
Rückgängig per Knopf gibt es nicht; **von Hand** hieße das: die Person aus
`diff.merged.person` neu anlegen (gleiche ID), die vorherigen Werte aus
`diff.keepBefore` zurückschreiben, Herkunftsangaben mit `mergedFromId` =
aufgegangene ID, ihre Rohdaten (`rawRecordIds`) und Fremdkennungen
zurückhängen und Beziehungen, Ereignisse, Namen und Belege anhand der IDs im
Eintrag wieder zuordnen — einfacher ist meist die Sicherung vom Vortag.

### Importe verbinden

Mehrere Importe (z.B. zwei MyHeritage-Exporte verschiedener Verwandter)
enthalten oft dieselben Menschen. **Recherche → „Importe verbinden“**
(`/research/connect`, nur Administratoren) findet diese
Verbindungspersonen und führt sie nach Bestätigung zusammen — aus den
Importen wird ein gemeinsamer Stammbaum.

Schneller Weg: Seite öffnen (Auswahl „alle Importe“ steht schon), **Abgleichen**
(läuft im Hintergrund), oben steht „Jetzt N Familienverbände — mit den
sicheren Verbindungen M Familienverbände“ und je Import-Paar die Zahl der
Verbindungspersonen;
**Gemeinsame Vorschau** (was umzieht, zusammenfällt, Zweitangabe wird, was
blockiert ist, wie viele Personen danach zu weiteren Familien gehören und
damit für deren Mitglieder sichtbar werden), **Jetzt zusammenführen**,
bestätigen. Danach startet von selbst ein neuer Abgleich — durch die
Verbindungen haben Verwandte jetzt gemeinsame Eltern, Partner und Kinder.

Abgleich ([lib/import-linking.ts](lib/import-linking.ts)): Kandidaten nur
zwischen verschiedenen Importen (bzw. innerhalb eines Imports, wenn gewählt),
geblockt nach Vor- und Nachnamen; dann Ausbreitung über Eltern, Partner und
Kinder schon verbundener Paare; je Person und Import höchstens ein Partner;
Gruppen über mehrere Importe nur, wenn alle Mitglieder zueinander passen.

| Klasse | Bedeutung | vorausgewählt |
|---|---|---|
| **sicher** | wie bei den Dubletten (gleicher ganzer Name, gleiche tagesgenaue Geburts- und Sterbedaten bzw. gemeinsame Eltern, kein Widerspruch) oder über einen *sicheren* Verwandten mit gleichem ganzen Vornamen und vereinbarem Geburtsdatum | ja |
| **sehr wahrscheinlich** | zwei übereinstimmende Verwandte, oder gleiches tagesgenaues Geburtsdatum plus ein Verwandter; nie einseitig fehlendes Geburtsdatum | nein |
| **wahrscheinlich** | Name und vereinbare Daten plus ein weiterer Beleg (tagesgenaue Geburt, passender Tod oder Verwandte) | nein |
| **unklar** | nur Name und ungefähres Jahr, Widerspruch, mehrere gleich gute Kandidaten | nein |

Eine Verbindung, die als **einzige** zwei sonst getrennte Familien
zusammenführt und sich auf keinen übereinstimmenden Verwandten stützt, ist
nie „sicher“ — ein Irrtum dort verbände fremde Familien. Jede Brücke zeigt,
wie viele Personen sie verbindet. Auf erfundenen Testbäumen mit Fallen
(gleichnamige Geschwister, Vater und Sohn gleichen Namens, Zwillinge,
Wiederverheiratung, falsche Einzelbrücke, Widerspruch im dritten Import):
„sicher“ und „sehr wahrscheinlich“ ohne Fehler, „wahrscheinlich“ 99,4–99,9 %
richtig (Vorsicht bei gleichnamigen Verwandten mit fehlenden Daten);
`tests/import-linking.test.ts`. Laufzeit: zwei Importe à ~5000 Personen
unter einer Sekunde, fünf Importe mit zusammen ~12 000 Personen etwa 5 s.

Ausführen im Hintergrund; jede Personengruppe ist eine eigene Transaktion
(danach ist der Stammbaum stimmig). Der Lauf liegt als Datei unter
`MEDIA_DIR/connect/`; wird die App mitten im Lauf neu gestartet, zeigt die
Seite „unterbrochen — X von Y erledigt“ und **Fortsetzen** macht weiter
(schon Zusammengeführtes wird erkannt, nichts doppelt). Abgelehnte Paare
lassen sich dauerhaft als „kein Duplikat“ markieren; ein späterer Abgleich
zeigt nur Neues. Ein Audit-Eintrag `CONNECT` je Lauf listet alle Gruppen,
dazu je Zusammenführung der übliche `MERGE`-Eintrag. Kein KI-Werkzeug.

### Herkunft und spätere Importe

Jeder Datensatz kann mehrere Herkunftsangaben (`ImportLink`) haben — eine je
Datensatz einer Importdatei. Beim Zusammenführen ziehen die der aufgegangenen
Person (und ihrer Untereinträge) mit um (`mergedFromId`, `mergedAt`). So
erkennt ein späterer Import **jeder** beteiligten Datei die Person wieder:
nichts wird neu angelegt, nichts als „fehlt in der Datei“ gemeldet. Steht
eine Person in **einer** Datei doppelt, trägt sie danach zwei Links dieser
Datei; der zweite Eintrag wird ihr zugeordnet, überschreibt sie aber nie.

Weicht der App-Stand eines zusammengeführten Eintrags vom letzten Stand
einer Datei ab, weil beim Zusammenführen der andere Wert gewählt wurde, und
bringt die Datei seitdem nichts Neues, meldet die Importvorschau ihn still
als **unverändert** (der App-Stand bleibt) statt als „in der App geändert“.
Hat die Datei dagegen seither etwas geändert, erscheint er wie gewohnt zur
Entscheidung.

**GEDCOM-Export einer zusammengeführten Person:** eine Person, eine `_UID` —
die des ursprünglichen Datensatzes der bleibenden Person (Herkunftsangabe
ohne `mergedFromId`, sonst die älteste) samt dessen Zusatz-Tags. Die
Kennungen der anderen Importe bleiben in der App und im JSON-Export.

Kein KI-Werkzeug: Zusammenführen geht nur in der Web-App;
`find_possible_duplicates` zeigt Klasse, Gründe und Widersprüche.

Dienste: [lib/services/merge.ts](lib/services/merge.ts) (Vorschau,
Zusammenführen), [lib/merge-rules.ts](lib/merge-rules.ts) (Regeln),
[lib/services/merge-bulk.ts](lib/services/merge-bulk.ts) (sichere Paare in
einem Rutsch), [lib/duplicates.ts](lib/duplicates.ts) und
[lib/services/duplicates.ts](lib/services/duplicates.ts) (Erkennung, „kein
Duplikat“). API: `POST /api/persons/merge/preview`, `POST /api/persons/merge`,
`POST /api/persons/merge/bulk` (mit `dryRun`), `GET /api/duplicates`,
`POST`/`DELETE /api/duplicates/dismiss`.

## Änderungsgeschichte

Jede Änderung — in der Oberfläche, beim Import, beim Zusammenführen und über
den KI-Zugang — steht im `AuditLog`: wer, wann, was, über welchen Kanal
(App oder KI über MCP mit dem Namen des Schlüssels; ein inzwischen
gelöschter Schlüssel erscheint als „Schlüssel „…“ (gelöscht)“, siehe
[KI-Zugang](#schlüssel-richtig-verwenden)). Seit der Migration
`20261122000000_changelog` speichert ein Eintrag bei Änderungen je Feld den
Wert **vorher und nachher** (`diff.changes`; ungenaue Daten in Anzeigeform,
„um 1850“ → „12.03.1850“), dazu eine **Momentaufnahme der betroffenen
Personen und Familien** (`personIds`, `familyIds`) — eine Änderung an einem
Ereignis, Namen, Beleg, Bild oder einer Beziehung gehört so zu allen
beteiligten Personen, und auch nach dem Löschen bleibt erkennbar, welche
Familie betroffen war.

**Pakete (`ChangeSet`).** Zusammengehörige Änderungen bilden ein Paket mit
Titel ([lib/change-sets.ts](lib/change-sets.ts)):

| Herkunft | Paket |
|---|---|
| Oberfläche | eine API-Anfrage = ein Paket; Titel aus dem ersten Eintrag („Person geändert“, „Beleg angelegt“) |
| GEDCOM-Import / Daten einspielen | ein Paket „GEDCOM-Import „Datei““ bzw. „Daten eingespielt („Datei“)“; je betroffener Person ein Eintrag (angelegt bzw. aktualisiert mit vorher → nachher, dazu die Zahl der angelegten Ereignisse, Namen, Beziehungen, Belege) |
| Zusammenführen | „Personen zusammengeführt“; Sammel-Zusammenführen und „Importe verbinden“ je ein Paket für alle Paare |
| KI-Zugang | `begin_change_set(title)` öffnet ein Paket, die Schreibwerkzeuge nehmen optional `change_set_id`. Ohne Kennung hängt der Server an das zuletzt benutzte Paket desselben Benutzers und Schlüssels an, wenn dessen letzte Änderung höchstens 30 Minuten zurückliegt, sonst beginnt ein neues („KI-Änderungen über „Schlüssel““). Ein mit `begin_change_set` geöffnetes Paket nimmt 24 Stunden Änderungen an; eine fremde oder abgelaufene Kennung lehnt das Werkzeug ab, bevor etwas geändert wird. Der MCP-Endpunkt ist zustandslos, deshalb gibt es keine Bündelung „je Sitzung“ |

Angelegt wird ein Paket erst mit dem ersten Eintrag; lesende Anfragen
hinterlassen nichts. Ein „Paket rückgängig machen“ gibt es bewusst nicht.

**Anzeige.**

- **Personenseite**, Abschnitt „Änderungen“ (nur für Bearbeiter der Person,
  wie `canEditPerson`): neueste zuerst, je Eintrag Datum, Benutzer, Kanal,
  Paket und Feld vorher → nachher; lädt beim Aufklappen, je 20 Einträge.
  API: `GET /api/persons/<id>/changes?cursor=…` (Betrachter 403, unsichtbare
  Person 404).
- **`/admin/changes`** (nur Administratoren, Menüpunkt „Änderungen“): eine
  Zeile je Paket mit Zusammenfassung („2 Personen, 5 Belege angelegt · 1
  Person geändert“), aufklappbar bis zum einzelnen Feld; Filter Familie,
  Benutzer, Kanal und Zeitraum (ohne Angabe die letzten 30 Tage). Mit
  Familienfilter erscheinen nur die Einträge, die diese Familie betreffen.
  API: `GET /api/changes?family=&user=&channel=APP|MCP&from=&to=&page=` und
  `GET /api/changes/<paket>?cursor=…` (sonst 403).
- **Datenschutz:** Verweise auf Personen und Familien, die der Betrachter
  nicht sehen darf (z.B. der Partner aus einer fremden Familie), erscheinen
  als „nicht freigegeben“; Einträge über eine andere, nicht sichtbare Person
  (z.B. eine zusammengeführte Person aus fremder Familie) ohne Feldwerte.
- **Ältere Einträge** (vor der Migration) haben weder Paket noch
  Momentaufnahme: Der Personenverlauf findet sie über die Kennungen der
  Person und ihrer heutigen Ereignisse, Namen, Belege, Beziehungen und Bilder
  und zeigt nur die neuen Werte („vorheriger Wert nicht erfasst“); in der
  Übersicht stehen sie als Einzeländerung, beim Familienfilter fehlen sie.

Gemessen (Mock-Datenbank mit 250 000 zusätzlichen Einträgen): Verlauf einer
Person rund 2 ms (GIN-Index auf `personIds`, ältere Einträge über
`entityType`/`entityId`), Übersicht einer Familie für einen Tag rund 70 ms;
die Übersicht über alle Einträge ohne Zeitraum braucht bei dieser Menge
mehrere Sekunden — deshalb der Standardzeitraum.

## Neuigkeiten

Der Versions-Changelog für Anwender — nicht zu verwechseln mit der
[Änderungsgeschichte](#änderungsgeschichte) der Daten. Einzige Quelle ist
[CHANGELOG.md](CHANGELOG.md) im Wurzelverzeichnis:

```markdown
## 2026-11-22.2 — Kurztitel

- Was kann ich jetzt, was hat sich geändert — in Anwendersprache,
  Folgezeilen eingerückt.
```

- **Kennung** `JJJJ-MM-TT.N`: Tag des Ausrollens und laufende Nummer an
  diesem Tag — keine Commit-Kennung. Neueste zuerst. Jedes Release nach
  `main` bekommt einen Eintrag (AGENTS.md, Abschnitt 3).
- **Eingebaut zur Build-Zeit** (`lib/release-notes-data.ts`, Webpack-Regel
  `?raw` in `next.config.mjs`): das Image braucht die Datei zur Laufzeit
  nicht. Den Aufbau prüft `tests/release-notes.test.ts` (fehlerfrei, keine
  Commit-Kennungen, keine Technikbegriffe).
- **Fenster „Was ist neu?“**: Angemeldete sehen nach einer neuen Version auf
  der ersten aufgerufenen Seite einmal die Releases seit dem zuletzt
  gesehenen (höchstens drei, für den Rest ein Hinweis auf die Seite). Jedes
  Schließen — „Gelesen“, Escape, Hintergrund, „Alle Neuigkeiten“ — merkt
  das neueste Release am Benutzer (`User.lastSeenReleaseId`, Migration
  `20261124000000_neuigkeiten`; `PUT /api/me/release-seen`, nur für sich
  selbst). Wer noch nichts gesehen hat (bestehende Benutzer beim ersten
  Ausrollen), sieht nur das neueste Release; neu eingeladene Benutzer
  starten beim neuesten, das Fenster kommt für sie erst mit dem nächsten.
  Nie auf der Anmeldeseite, nie ohne Anmeldung.
- **Seite `/neuigkeiten`**: alle Releases; nur für Angemeldete, Link in der
  Fußzeile neben der Build-Angabe.
- **Tests**: Die Mock-Benutzer haben nach dem Seed das neueste Release schon
  gesehen, kein Test begegnet also einem unerwarteten Fenster.
  `e2e/write/whats-new.spec.ts` prüft das Fenster mit einem eigenen,
  eingeladenen Benutzer.

## Datenmodell

Beziehungen liegen in einer eigenen Tabelle statt als `parentId` auf `Person`.
Ein Stammbaum ist kein Baum, sondern ein Graph — nur so sind zwei Elternteile,
Adoption, Stiefverhältnisse, Mehrfachehen und Beziehungszeiträume abbildbar,
ohne das Schema zu ändern.

```
Person ──< Relationship >── Person     type: PARENT_OF | PARTNER_OF
Person ──< PersonMedia >── MediaAsset
Source ──< Citation >── Person | Relationship (| Event)   fact: NAME | BIRTH | DEATH | PARTNERSHIP | PARENTAGE | OTHER | EVENT
Person | Relationship ──< Event      Taufe, Beruf, Wohnort, Beerdigung, … (EventType, frei: CUSTOM + label)
Person ──< PersonName                weitere Namen (Ehename, Schreibvariante, auch bekannt als …)
ImportBatch ──< ImportLink | ExternalId | ImportRawRecord   Herkunft importierter Daten (nur Admin)
User (= Allowlist) ──< AuditLog     über den KI-Zugang: channel = MCP, apiTokenId
User >── Person (personId, optional)  „das bin ich“ (Bezugsperson)
User ──< ApiToken                    KI-Schlüssel (nur der Hash), aiAccess am User
```

Regeln für Beziehungen (geprüft in [lib/validation.ts](lib/validation.ts) und
[lib/services/relationships.ts](lib/services/relationships.ts)):

- Die Art muss zum Typ passen — Eltern: leiblich, adoptiert, Stief, Pflege;
  Partner: verheiratet, unverheiratet, geschieden, Ehestand unbekannt
  (`PARTNER_UNKNOWN`, z.B. aus einem Import ohne Heiratsangabe; zählt nicht
  als Ehe, heißt in Verwandtschaftsbegriffen „Partner/Partnerin“).
- Höchstens **zwei leibliche** Eltern; Adoptiv-, Stief- und Pflegeeltern
  kommen beliebig hinzu.
- Keine Zyklen (niemand ist sein eigener Vorfahre), keine Partnerschaft
  zwischen Elternteil und Kind, keine doppelten Beziehungen.
- Daten müssen plausibel sein: kein Jahr vor 1000, Geburt und Tod nicht in der
  Zukunft, Tod nicht vor der Geburt, Ende einer Beziehung nicht vor ihrem
  Beginn — bei ungenauen Daten nur, wenn es für jede Lesart gilt (siehe
  [Ungenaue Daten](#ungenaue-daten)).

### Lebensereignisse, Namen und Import

Jede Angabe steht an genau einer Stelle (Regeln in
[lib/events.ts](lib/events.ts)):

| Angabe | Ort |
|---|---|
| Geburt, Tod (Datum, Ort, Wortlaut, Todesursache) | Spalten an `Person` |
| Heirat bzw. Beginn einer Partnerschaft, Scheidung bzw. Ende | `Relationship.startDate/startPlace`, `endDate/endPlace` |
| Hauptname | `givenName`, `familyName` (heutiger, z.B. Ehename), `birthName`, `nickname`, `namePrefix`, `nameSuffix` |
| weitere Namen | `PersonName` |
| alles andere — Taufe, Konfirmation, Beruf, Wohnort, Auswanderung, Militärdienst, Beerdigung, Verlobung, Aufgebot, … | `Event` an der Person bzw. Beziehung |

Eine zweite, abweichende Angabe zu Geburt, Tod, Heirat oder Scheidung (in
GEDCOM-Dateien häufig) überschreibt nichts, sondern wird ein Ereignis mit
`isAlternative`; die Arten BIRTH, DEATH, MARRIAGE und DIVORCE gibt es nur
so. Alternativen erscheinen nicht in Zeitleisten und Plausibilitätsprüfung.
Unbekannte Ereignisarten sind `CUSTOM` mit freier Bezeichnung. Ereignisse
sind sichtbar und änderbar wie ihr Träger. Sie erscheinen in Personendetail,
Zeitleisten, Personensuche nach Ort (jeder Ort einer Person, auch Heirats-
und Ereignisorte) und Plausibilitätsprüfung (Beerdigung vor dem Tod,
Ereignis vor der Geburt bzw. nach dem Tod); „Ehe ohne Ort“ und „Ehestand
unbekannt“ sind Datenlücken an Beziehungen.

**In der Oberfläche:** Die Personenseite hat den Abschnitt
„Lebensereignisse“ — Ereignisse der Person und ihrer Partnerschaften
(Verlobung, Aufgebot …, mit „mit <Partner>“ gekennzeichnet) in einer
chronologischen Liste, undatierte am Ende; Bearbeiter legen dort an, ändern,
löschen und hängen über „Beleg“ eine Quelle an ein Ereignis. Abweichende
Hauptangaben stehen als „abweichende Angabe“ neben Geburt bzw. Tod im Kopf
und neben der Heirat auf der Partnerkarte, bearbeitet werden sie in der
Ereignisliste (eigene Gruppe). Rufname, Namenszusätze und Todesursache
stehen im Kopf und im Personenformular unter „Weitere Angaben“, weitere
Namen in einer eigenen Karte. Heirats-/Scheidungsorte und „Ehestand
unbekannt“ (im Baum gepunktete Linie mit „?“) pflegt der Beziehungseditor.
Datumsfelder verstehen Bereiche; ein Text, der kein Datum ist, lässt sich
per Häkchen bewusst als Wortlaut speichern und bleibt im Feld bearbeitbar.
Die Personenliste sucht zusätzlich nach Ort und nennt bei Treffern über
Rufname, weiteren Namen oder Ereignisort den Grund.

**Import** (Dienste in [lib/services/imports.ts](lib/services/imports.ts) und
[lib/services/import-apply.ts](lib/services/import-apply.ts), nur
Administratoren): Jeder Lauf (`ImportBatch`) bewahrt die Originaldatei unter
`MEDIA_DIR/imports/` auf (also in der normalen Bildersicherung). Jeder
importierte Datensatz hat eine Herkunft (`ImportLink`: Lauf, Schlüssel in der
Quelle, Fingerabdruck der importierten Werte, Änderungsstempel der Quelle) und
optional Fremdkennungen (`ExternalId`, z.B. `_UID`). So erkennt ein
erneuter Import desselben Baums seine Datensätze wieder und sieht, was seither
in der App geändert wurde — das wird nicht still überschrieben. Was der Import
nicht deuten kann, landet als JSON-Teilbaum im Rohdatenspeicher
(`ImportRawRecord`), sichtbar wie die Person bzw. Beziehung. Gelöscht wird
durch einen Import nur, was der Administrator in der Vorschau ausdrücklich
ankreuzt und bestätigt ([GEDCOM](#gedcom-import-und-export)).

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
| Benutzer einladen, sperren und löschen | | | ✓ |
| Daten importieren | | | ✓ |
| Personen ohne Familienzuordnung sehen | | | ✓ |
| KI-Zugang vergeben, fremde KI-Schlüssel widerrufen | | | ✓ |

Der **KI-Zugang** liegt quer dazu: Der Administrator gibt ihn je Benutzer
(kein Zugang, lesen, lesen und schreiben), auch sich selbst ausdrücklich. Mit
eigenen Schlüsseln (Seite *KI-Zugang*) darf ein KI-Assistent dann höchstens,
was der Benutzer laut Tabelle ohnehin darf — „lesen“ verbietet ihm auch dort
das Ändern, wo der Benutzer bearbeiten darf. Einzelheiten:
[KI-Zugang](#ki-zugang-mcp).

Die Prüfung läuft serverseitig in [lib/api.ts](lib/api.ts) (Route-Handler) und
[lib/session.ts](lib/session.ts) (Seiten). Die UI blendet zusätzlich aus, das
ist reiner Komfort.

### Benutzerverwaltung

Auf `/admin/users` lädt der Administrator Benutzer per E-Mail ein (das ist
zugleich die Freigabeliste für die Anmeldung), ändert Rolle und
Familienrechte, sperrt und **löscht** sie. Gelöscht wird nur der Zugang
selbst (samt Anmeldekonten, Sitzungen und KI-Schlüsseln); was der Benutzer
angelegt hat, bleibt; seine Einträge im Änderungsprotokoll bleiben ebenfalls,
verlieren aber den Bezug zu ihm. Den eigenen Zugang kann niemand löschen,
herabstufen oder sperren, ebenso wenig den letzten aktiven Administrator.
Unter der E-Mail-Adresse ordnet er jedem Benutzer seine eigene Person zu
(„Person: zuordnen“, siehe [Bezugsperson](#bezugsperson)).

Eine **vertippte E-Mail-Adresse** lässt sich korrigieren, solange sich der
Benutzer noch nie angemeldet hat. Danach hängt an der Adresse ein
verknüpftes Google-/GitHub-Konto — eine Änderung würde die Anmeldung still
auf eine andere Person umlenken; dann den Benutzer löschen und neu
einladen.

## Grenzen

Die [Fokus-Ansicht](#fokus-ansicht) schickt nur einen Ausschnitt in den
Browser (Mock-Daten: 13 KB Baumdaten statt 93 KB); ihre Größe hängt von der
Tiefe und der Familiengröße ab, nicht vom Bestand. Der Server liest dafür aber
weiterhin den ganzen Graphen aus der Datenbank (eine Abfrage für Personen,
eine für Beziehungen) — bei sehr großen Beständen wäre hier auf eine
schrittweise Abfrage ab der Fokusperson umzustellen.

Die beiden Gesamtansichten (Generationen, Zeitstrahl) laden weiterhin den
kompletten Graphen in den Browser und legen ihn dort aus. Das bleibt bis rund
1000 Personen benutzbar, ergibt aber eine sehr große Fläche; darüber hinaus
ist die Fokus-Ansicht der vorgesehene Weg.
