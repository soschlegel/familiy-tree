# Stammbaum

Webanwendung zur Pflege und Visualisierung eines Familienstammbaums mit
Bildarchiv, Quellen und Belegen, GEDCOM-Import/-Export und rollenbasierter
Benutzerverwaltung — gedacht für eine Familie auf dem eigenen Server (NAS mit
Portainer). KI-Assistenten können über eine MCP-Schnittstelle mitarbeiten.

Diese Datei ist Einstieg und Wegweiser. Alles Weitere steht unter
[docs/](docs/README.md).

## Was die App kann

- **Rollen und Rechte je Familie** — Administrator, Bearbeiter, Betrachter;
  Zugang nur auf Einladung (ein Google-/GitHub-Konto allein genügt nicht);
  gesperrte Personen erscheinen als Platzhalter
  ([Berechtigungen](docs/fachlich/berechtigungen.md))
- **Stammbaum in drei Ansichten** — Fokus-Ansicht (eine Person im
  Mittelpunkt, Wandern per Klick) als Einstieg, dazu der ganze Baum nach
  Generationen oder als Zeitstrahl; Adoptiv-, Stief- und Pflegeverhältnisse,
  Beziehungen mit Zeitraum ([Fokus-Ansicht](docs/fachlich/fokus-ansicht.md))
- **Bezugsperson** — „Das bin ich“ oder vorübergehend eine andere Person;
  Verwandtschaftsgrad an jeder Karte, die vier Großeltern-Linien farbig
  ([Bezugsperson](docs/fachlich/bezugsperson.md))
- **Karte „Wurzeln nach Jahr“ und Orte** — wo die Vorfahren in einem Jahr
  lebten; Ortstexte bekommen Koordinaten aus einem mitgelieferten
  Ortsverzeichnis, Ortsseiten ([Karte und Orte](docs/fachlich/karte-und-orte.md))
- **Ungenaue Daten** — „1850“, „März 1850“, „um 1850“, „vor 1900“,
  „zwischen … und …“ statt eines erfundenen 1. Januar
  ([Ungenaue Daten](docs/fachlich/ungenaue-daten.md))
- **Lebensereignisse und weitere Namen** — Taufe, Beruf, Wohnort,
  Auswanderung, Beerdigung …, Ehenamen und Schreibvarianten
  ([Beziehungen, Ereignisse, Namen](docs/fachlich/beziehungen-und-ereignisse.md))
- **Quellen und Belege** — je Angabe mit Fundstelle und Verlässlichkeit
  ([Quellen und Belege](docs/fachlich/quellen-und-belege.md))
- **Bilder** — Porträts, Hochzeitsbilder, Scans an Quellen, Ereignissen und
  Belegen; als WebP-Dateien im Medienordner, nur für Angemeldete
  ([Bilder an Einträgen](docs/fachlich/bilder-an-eintraegen.md))
- **Export und Import** — eigenes Format als JSON oder ZIP mit Bildern
  ([Austauschformat](docs/fachlich/austauschformat.md)); **GEDCOM** aus
  MyHeritage, Ancestry, Gramps & Co. mit Vorschau, Wiedererkennen und
  verlustfreier Aufbewahrung des Originals, Export als GEDCOM 5.5.1
  ([GEDCOM](docs/fachlich/gedcom.md))
- **Dubletten zusammenführen und Importe verbinden** — ohne dass etwas
  verloren geht; die KI prüft nur vor
  ([Dubletten](docs/fachlich/dubletten.md))
- **Änderungsgeschichte** — jede Änderung mit vorher → nachher, gebündelt zu
  Paketen ([Änderungsgeschichte](docs/fachlich/aenderungsgeschichte.md))
- **Neuigkeiten und Hilfe** — „Was ist neu?“ nach einer neuen Version
  ([Neuigkeiten](docs/entwicklung/neuigkeiten.md)); Anwender-Hilfe unter
  `/hilfe` ([docs/anwender/](docs/anwender/README.md))
- **KI-Zugang** — Claude Code, Claude Desktop oder die Claude-App
  recherchieren über `/api/mcp` mit und tragen auf Wunsch ein — mit
  persönlichem Schlüssel und den Rechten des Benutzers
  ([KI-Zugang](#ki-zugang))
- **Build-Angabe** in der Fußzeile jeder Seite („Build 2026.11.19 · 68c8471“)

## Technik

| Ebene | Wahl |
|---|---|
| Frontend + API | Next.js 15 (App Router), React 19, TypeScript, Tailwind |
| Datenbank | PostgreSQL 17 + Prisma |
| Anmeldung | Auth.js v5 (GitHub, Google, E-Mail-Link per SMTP, Dev-Login) |
| Bilder | Dateien im Medienordner (`MEDIA_DIR`), sharp |
| Visualisierung | React Flow (Layout selbst geschrieben) |
| KI-Schnittstelle | MCP (`@modelcontextprotocol/sdk`), Streamable HTTP unter `/api/mcp` |
| Betrieb | Docker Compose (Portainer), ein App-Image aus GitHub Actions über ghcr.io |

Aufbau (Seiten → API → Dienste → Prisma): [docs/komponenten/](docs/komponenten/README.md).

## Schnellstart lokal

Voraussetzungen: Node.js 22 oder neuer, Docker (für Postgres), Git.

```bash
cp .env.example .env
npm install
npx prisma generate                               # npm blockiert Install-Skripte
docker compose -f docker-compose.dev.yml up -d    # nur Postgres
```

**Mit Mock-Daten** (empfohlen; eigene Datenbank `familytree_mock`, rund 195
erfundene Personen, feste Testbenutzer):

```bash
npm run mock:setup    # Mock-Datenbank anlegen, Schema anwenden, befüllen, Bilder erzeugen
npm run dev:mock      # Dev-Server: http://localhost:3100
```

Anmelden per Dev-Login nur mit der E-Mail: `admin@example.test` (weitere
Rollen: `editor@…`, `viewer@…`). Statt des Dev-Servers geht auch der
Produktions-Build der Mock-Umgebung: `npm run mock:build`, dann
`npm run mock:start` (ebenfalls Port 3100). Inhalt und Benutzer:
[docs/entwicklung/mock-daten.md](docs/entwicklung/mock-daten.md).

**Mit eigener Entwicklungsdatenbank** (`familytree`, Port 3000):

```bash
npm run db:push       # Schema anlegen — die Datenbank ist danach leer
npm run db:seed       # legt INITIAL_ADMIN_EMAIL als Administrator an (+ Demofamilie bei SEED_DEMO=true)
npm run dev           # http://localhost:3000
```

Wichtig: Nach `db:push` gibt es noch keinen Benutzer, und der Dev-Login
(`ENABLE_DEV_LOGIN=true`, E-Mail ohne Passwort) lässt nur E-Mails herein,
die in der Benutzerliste stehen. Also vorher in der `.env`
`INITIAL_ADMIN_EMAIL` auf die eigene Adresse setzen und `npm run db:seed`
laufen lassen — oder gleich die Mock-Umgebung mit `admin@example.test`
nutzen. Der Dev-Login funktioniert nur außerhalb von `NODE_ENV=production`
(einzige Ausnahme: der Produktions-Build der Mock-Umgebung, eng begrenzt in
`lib/dev-login.ts`). Echte Anmeldung lokal:
[OAuth lokal einrichten](docs/betrieb/oauth.md#oauth-lokal-einrichten).

Bilder liegen unter `MEDIA_DIR` (lokal `./data/media`, per `.gitignore`
ausgenommen); `GET /api/health` meldet `error`, wenn der Ordner nicht
beschreibbar ist.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Dev-Server gegen die normale Datenbank (Port 3000) |
| `npm run dev:mock` | Dev-Server gegen die Mock-Daten (Port 3100, parallel zu 3000) |
| `npm run mock:setup` / `npm run db:mock` | Mock-Datenbank anlegen und befüllen / nur neu befüllen |
| `npm run mock:build` / `npm run mock:start` | Produktions-Build der Mock-Umgebung bauen / starten |
| `npm run db:push` / `npm run db:seed` | Schema in die normale Datenbank schieben / Admin (+ Demofamilie) anlegen |
| `npm run db:migrate` | neue Migration anlegen (einziger Weg für Schemaänderungen) |
| `npm run typecheck` / `npm run lint` | TypeScript-Prüfung / ESLint |
| `npm test` | Vitest — Unit- und Dienst-Tests |
| `npm run test:e2e` | Playwright mit einem Befehl (Build, Server, setup → read → write) |
| `npm run gedcom:check -- datei.ged` | GEDCOM-Datei vorab prüfen, ohne Datenbank ([GEDCOM](docs/fachlich/gedcom.md#eine-datei-vorab-prüfen)) |
| `npm run -s mcp:key [name]` | festen KI-Testschlüssel der Mock-Daten ausgeben |

Alle npm-Skripte mit Erklärung:
[betrieb-und-tests.md](docs/komponenten/betrieb-und-tests.md#1-npm-skripte-packagejson).

## Tests

- **Unit- und Dienst-Tests:** `npm test`. Die `*.db.test.ts` laufen gegen
  die Mock-Datenbank und überspringen sich ohne sie mit Hinweis (so auch in
  der CI); sie berühren nie die normale Datenbank.
- **End-to-End-Tests:** einmalig `npx playwright install chromium`, dann
  `npm run test:e2e` — baut die Mock-Umgebung als Produktions-Build (nur bei
  geänderten Quellen), startet einen eigenen Server, führt setup → read →
  write aus und beendet ihn wieder. Einzelne Dateien:
  `npm run test:e2e -- e2e/read/export.spec.ts`.

Teilläufe, Optionen, Sharding, Fehlersuche:
[docs/entwicklung/tests.md](docs/entwicklung/tests.md).

## Ausrollen

`main` ist Produktion: Jeder Push/Merge nach `main` prüft und baut das Image
(GitHub Actions), setzt den Branch `deploy` nach, und Portainer startet den
Stack mit dem neuen Image — Sicherung, dann Migrationen, dann Server.
Gearbeitet wird auf `optimierung`. Was vor einem Merge nach `main` geprüft
sein muss und dass jedes Release einen Eintrag in [CHANGELOG.md](CHANGELOG.md)
braucht: [AGENTS.md](AGENTS.md), Abschnitt 3.

Erste Installation in Kurzform:

1. Image bauen lassen (Push auf `main`) und das Paket auf ghcr.io
   öffentlich machen.
2. In Portainer einen Stack aus dem Repository anlegen (Branch `deploy`,
   [docker-compose.yml](docker-compose.yml)).
3. Variablen aus [stack.env.example](stack.env.example) eintragen — Pflicht:
   `DATA_ROOT`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `PUBLIC_URL`,
   `INITIAL_ADMIN_EMAIL` und mindestens ein OAuth-Paar (GitHub/Google).
   Optional `SMTP_*` für die Anmeldung per E-Mail-Link (Eingeladene ohne
   GitHub-/Google-Konto).
4. Reverse-Proxy auf die App zeigen lassen, mit dem Konto von
   `INITIAL_ADMIN_EMAIL` anmelden, weitere Benutzer unter *Benutzer*
   einladen, Sicherung planen.

Ausführlich: [Betrieb auf der NAS](docs/betrieb/nas-portainer.md),
[Anmeldung (OAuth)](docs/betrieb/oauth.md),
[Anmeldung per E-Mail-Link](docs/betrieb/email-anmeldung.md),
[Reverse-Proxy](docs/betrieb/reverse-proxy.md),
[Sicherung](docs/betrieb/sicherung.md),
[Migrationen im Betrieb](docs/betrieb/migrationen.md),
[Fehlersuche](docs/betrieb/fehlersuche.md).

## KI-Zugang

Als Administrator unter *Benutzer* das KI-Recht vergeben (*lesen* oder
*lesen und schreiben*); dann auf *KI-Zugang* (`/ai-access`) einen
persönlichen Schlüssel anlegen. Die Seite zeigt die Adresse
(`<PUBLIC_URL>/api/mcp`) und Anleitungen für Claude Code, Claude
Desktop/Browser und das Telefon. Claude Code verbindet sich mit:

```bash
claude mcp add --transport http --scope user stammbaum https://stammbaum.example.de/api/mcp --header "Authorization: Bearer ftk_…"
```

Einrichten Schritt für Schritt, Rechte, Schlüssel richtig verwenden,
Fehlersuche, Entwicklung gegen die Mock-Daten:
[docs/betrieb/ki-zugang.md](docs/betrieb/ki-zugang.md). Werkzeuge und
Schnittstelle im Einzelnen: [docs/komponenten/mcp.md](docs/komponenten/mcp.md).

## Dokumentation

| Wo | Was |
|---|---|
| [docs/README.md](docs/README.md) | Übersicht über alle Dokumente |
| [docs/fachlich/](docs/README.md#fachliches-und-bedienung) | Fachliche Regeln und Bedienung je Thema |
| [docs/betrieb/](docs/README.md#betrieb) | Installation, Updates, Proxy, Sicherung, KI-Zugang, Fehlersuche |
| [docs/entwicklung/](docs/README.md#entwicklung) | Tests, Mock-Daten, Neuigkeiten |
| [docs/komponenten/](docs/komponenten/README.md) | Technische Beschreibung jeder Komponente, Datenmodell, Migrationen |
| [docs/anwender/](docs/anwender/README.md) | Hilfe für Anwender (in der App unter `/hilfe`) |
| [docs/sicherheit.md](docs/sicherheit.md) | Sicherheitsprüfung |
| [docs/dev-history.md](docs/dev-history.md) | Frühere Stände, Umstiege für alte Installationen |
| [AGENTS.md](AGENTS.md) · [UEBERGABE.md](UEBERGABE.md) | Arbeitsweise und laufender Stand für KI-Sitzungen |
| [CHANGELOG.md](CHANGELOG.md) | Neuigkeiten für Anwender |

### Wo steht was? (frühere Abschnitte dieser README)

Kommentare im Code und in alten Migrationen verweisen noch auf Abschnitte
dieser README („README, „Bezugsperson““). Sie stehen jetzt hier:

| Früherer Abschnitt | Heute |
|---|---|
| Lokal starten, Quickstart | [Schnellstart lokal](#schnellstart-lokal) |
| Entwicklung: Prüfen und Testen, Tests | [docs/entwicklung/tests.md](docs/entwicklung/tests.md) |
| Mock-Daten | [docs/entwicklung/mock-daten.md](docs/entwicklung/mock-daten.md) |
| Fokus-Ansicht, Grenzen | [docs/fachlich/fokus-ansicht.md](docs/fachlich/fokus-ansicht.md) |
| Bezugsperson | [docs/fachlich/bezugsperson.md](docs/fachlich/bezugsperson.md) |
| Karte und Orte | [docs/fachlich/karte-und-orte.md](docs/fachlich/karte-und-orte.md) |
| Ungenaue Daten | [docs/fachlich/ungenaue-daten.md](docs/fachlich/ungenaue-daten.md) |
| Quellen und Belege | [docs/fachlich/quellen-und-belege.md](docs/fachlich/quellen-und-belege.md) |
| Bilder an Quellen, Ereignissen und Belegen | [docs/fachlich/bilder-an-eintraegen.md](docs/fachlich/bilder-an-eintraegen.md) |
| Austauschformat | [docs/fachlich/austauschformat.md](docs/fachlich/austauschformat.md) |
| GEDCOM (Import und Export) | [docs/fachlich/gedcom.md](docs/fachlich/gedcom.md) |
| Dubletten zusammenführen, Importe verbinden | [docs/fachlich/dubletten.md](docs/fachlich/dubletten.md) |
| Änderungsgeschichte | [docs/fachlich/aenderungsgeschichte.md](docs/fachlich/aenderungsgeschichte.md) |
| Neuigkeiten | [docs/entwicklung/neuigkeiten.md](docs/entwicklung/neuigkeiten.md) |
| Datenmodell, Lebensereignisse | [docs/fachlich/beziehungen-und-ereignisse.md](docs/fachlich/beziehungen-und-ereignisse.md), Tabellen: [docs/komponenten/datenmodell.md](docs/komponenten/datenmodell.md) |
| Berechtigungen, Benutzerverwaltung, Einstellungen | [docs/fachlich/berechtigungen.md](docs/fachlich/berechtigungen.md) |
| Dienstschicht | [docs/komponenten/dienste.md](docs/komponenten/dienste.md) |
| KI-Zugang (MCP) | [docs/betrieb/ki-zugang.md](docs/betrieb/ki-zugang.md), Werkzeuge: [docs/komponenten/mcp.md](docs/komponenten/mcp.md) |
| Betrieb auf der NAS, Erste Installation, Updates | [docs/betrieb/nas-portainer.md](docs/betrieb/nas-portainer.md) |
| Anmeldung (OAuth) im Heimnetz, OAuth lokal einrichten | [docs/betrieb/oauth.md](docs/betrieb/oauth.md) |
| Reverse-Proxy | [docs/betrieb/reverse-proxy.md](docs/betrieb/reverse-proxy.md) |
| Fehlersuche (Betrieb) | [docs/betrieb/fehlersuche.md](docs/betrieb/fehlersuche.md) |
| Schema und Migrationen | [docs/betrieb/migrationen.md](docs/betrieb/migrationen.md), Liste: [docs/komponenten/datenmodell.md](docs/komponenten/datenmodell.md#migrationen-prismamigrations) |
| Sicherung, Wiederherstellung | [docs/betrieb/sicherung.md](docs/betrieb/sicherung.md) |
