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
- **Bilder** — Upload pro Person, frei wählbares Primärbild (erscheint im
  Stammbaum), eigene Bilder an Hochzeiten, automatische Vorschaubilder;
  abgelegt als WebP-Dateien in einem Ordner (`MEDIA_DIR`), ausgeliefert nur
  durch die App an angemeldete Nutzer
- **Export und Import** — JSON oder ZIP inklusive Bilddateien, Import mit
  Vorschau und Zusammenführung
- **KI-Zugang** — KI-Assistenten (Claude Code, Claude Desktop) recherchieren
  über die MCP-Schnittstelle der App mit und tragen auf Wunsch Ergebnisse samt
  Belegen ein; nur mit vom Administrator freigegebenem Recht, persönlichem
  Schlüssel und den Familienrechten des Benutzers ([KI-Zugang](#ki-zugang-mcp))
- **Änderungsprotokoll** — jede Mutation landet im `AuditLog`, Änderungen
  durch die KI mit dem verwendeten Schlüssel

## Technik

| Ebene | Wahl |
|---|---|
| Frontend + API | Next.js 15 (App Router), TypeScript, Tailwind |
| Datenbank | PostgreSQL 17 + Prisma |
| Anmeldung | Auth.js v5 (GitHub, Google, Dev-Login) |
| Bilder | Dateien im Medienordner (`MEDIA_DIR`), sharp |
| Visualisierung | React Flow (Layout selbst geschrieben, `lib/layout-generations.ts`) |
| KI-Schnittstelle | MCP (`@modelcontextprotocol/sdk`), Streamable HTTP unter `/api/mcp`, Anmeldung mit persönlichem Schlüssel |
| Betrieb | Docker Compose (Portainer), ein App-Image aus GitHub Actions über ghcr.io (privat) |

## Lokal starten

```bash
cp .env.example .env      # AUTH_SECRET und INITIAL_ADMIN_EMAIL anpassen
npm install

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

### Umstieg von MinIO (ältere Installationen)

Frühere Versionen legten die Bilder in einem MinIO-Bucket ab. Die Schlüssel
sind unverändert, die Dateien müssen nur einmal aus dem Bucket in den
Medienordner kopiert werden. MinIOs Datenordner (z.B. `data/dev-minio`)
enthält keine normalen Dateien — kopiert wird deshalb über den noch laufenden
MinIO-Container (Namen mit `docker ps` ermitteln; Zugangsdaten und Bucket wie
bisher in der `.env`, lokal `minioadmin`/`familytree`):

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

Ohne konfiguriertes OAuth greift der **Dev-Login** (`ENABLE_DEV_LOGIN=true`):
E-Mail eingeben, kein Passwort. Er funktioniert nur mit `NODE_ENV=development`
und nur für E-Mails, die bereits in der Benutzerliste stehen.

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
(Chromium) gegen die Mock-Umgebung.

Voraussetzungen: Docker Desktop läuft (`docker compose -f
docker-compose.dev.yml up -d` — Postgres), die Mock-Datenbank ist
einmal angelegt (`npm run mock:setup`), und einmalig `npx playwright install
chromium`.

| Befehl | Zweck | Dauer (Dev-Server warm) |
|---|---|---|
| `npm run test:e2e` | alles: setup → read → write | ca. 7–8 min |
| `npm run test:e2e:setup` | nur Ausgangszustand: Mock-Daten neu, Anmeldungen, Vorwärmen | ca. 1:15 min |
| `npm run test:e2e:read` | setup + lesende Tests (`e2e/read/`, 106 Tests, 4 parallel) | ca. 3 min ohne Setup (frisch kompiliert gut 4 min) |
| `npm run test:e2e:write` | setup + ändernde Tests (`e2e/write/`, 42 Tests, 2 Dateien parallel) — ohne die lesenden | ca. 3 min ohne Setup |
| `npm run test:e2e:headed` | alles mit sichtbarem Browser, ein Test nach dem anderen | |
| `npm run test:e2e:ui` | Playwright-Oberfläche: Tests einzeln starten, Schritte ansehen | |
| `npm run test:e2e:report` | HTML-Bericht des letzten Laufs öffnen | |

Alle `test:e2e*`-Befehle reichen weitere Argumente an `playwright test`
durch (nach `--`), z.B. eine einzelne Datei oder einen Testnamen:

```bash
npm run test:e2e:write -- e2e/write/sources.spec.ts
npm run test:e2e:read -- e2e/read/permissions.spec.ts -g "Betrachter"
npm run test:e2e -- e2e/read/export.spec.ts e2e/write/media.spec.ts
```

Mit Filter (Datei oder `-g`) läuft `npm run test:e2e` in drei Schritten
nacheinander: Setup, die passenden lesenden, dann die passenden ändernden
Tests. Sonst zöge ein Filter auf eine `write`-Datei alle lesenden Tests als
Abhängigkeit mit. Der HTML-Bericht enthält danach nur den letzten Schritt.

**Setup überspringen:** Ist der Ausgangszustand schon vorbereitet (gerade
`npm run test:e2e:setup` gelaufen, Dev-Server läuft noch), spart
`--skip-setup` (oder Umgebungsvariable `E2E_SKIP_SETUP=1`) die gut eine
Minute Setup: `npm run test:e2e:write -- --skip-setup e2e/write/sources.spec.ts`.
Die ändernden Tests räumen ihre Datensätze selbst ab und lassen sich daher
mehrfach hintereinander ohne neues Setup laufen; die lesenden zählen gegen den
frisch befüllten Stand und brauchen ein Setup, nachdem ändernde Tests liefen.

Tipp für schnelles Arbeiten: `npm run dev:mock` in einem eigenen Terminal
starten — Playwright benutzt ihn mit, und nicht jeder Lauf zahlt den Kaltstart.

**Auf mehrere Terminals verteilen (Sharding):** einmal `npm run
test:e2e:setup`, dann in jedem Terminal einen Teil mit `--skip-setup` — etwa
`npm run test:e2e:read -- --skip-setup --shard=1/2` und
`npm run test:e2e:read -- --skip-setup --shard=2/2`. Ohne `--skip-setup`
würde jeder Teil die Mock-Daten neu aufbauen, während die anderen noch laufen.
Die ändernden Tests erst nach den lesenden starten (sie verändern Zählungen).
Mehr Parallelität bringt gegen den Dev-Server wenig: 4 statt 2 Worker für die
ändernden Tests waren langsamer und liefen in Zeitüberschreitungen.

Ablauf: Playwright startet `npm run dev:mock` auf Port 3100 (läuft dort schon
ein Server, wird er mitbenutzt und hinterher nicht beendet — bewusst der
Dev-Server, weil der Dev-Login in Produktion abgeschaltet ist). Das Projekt
`setup` baut die Mock-Daten neu auf (`npm run db:mock`), meldet jede Rolle
einmal an (`e2e/.auth/`) und ruft die Seiten einmal auf, damit Next.js sie
vorab kompiliert. Danach laufen die lesenden Tests (`e2e/read/`) parallel, erst
dann die ändernden (`e2e/write/`); diese legen eigene, „E2E …“ benannte
Datensätze an und räumen sie wieder ab. Jeder Test schlägt außerdem fehl, wenn
im Browser ein unerwarteter Konsolenfehler oder eine nicht abgefangene
Ausnahme auftritt (`e2e/support/fixtures.ts`). Die Tests sprechen nur mit der
App (Browser und HTTP-API), nie direkt mit Datenbank oder Medienordner. Den
KI-Zugang prüfen `e2e/write/ai-access.spec.ts` (Recht vergeben, Schlüssel
anlegen und widerrufen) und `e2e/read/mcp-http.spec.ts` (`/api/mcp` mit den
festen Mock-Schlüsseln; abgelehnte Anfragen mit zufälliger
`X-Forwarded-For`-Adresse, damit wiederholte Läufe gegen denselben
Dev-Server nicht in die Sperre nach Fehlversuchen laufen).

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
`mock-family-a`, …).

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
Die IDs dieser Sonderfälle liefert `generateMockData().landmarks`.

**Benutzer** (Anmeldung per Dev-Login, nur E-Mail):

| E-Mail | Rolle | Familien | KI-Zugang |
|---|---|---|---|
| `admin@example.test` | Administrator | alle | lesen und schreiben |
| `editor@example.test` | Bearbeiter | A bearbeiten, B lesen | lesen und schreiben |
| `viewer@example.test` | Betrachter | A lesen | lesen |
| `nofamily@example.test` | Betrachter | keine | kein Zugang |
| `blocked@example.test` | gesperrt | (A lesen) — Anmeldung schlägt fehl | (lesen) |

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
  meisten sichtbaren Verwandten zeigt. Eine Verknüpfung „dieser Benutzer ist
  diese Person“ gibt es im Datenmodell nicht.
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

Zusätze lassen sich mit jeder Genauigkeit kombinieren („um 03.1850“, „vor
12.03.1900“). Für KI-Eingaben werden auch die GEDCOM-Kürzel `ABT`, `BEF`,
`AFT` verstanden, außerdem volle ISO-Zeitstempel (ältere API-Aufrufe).

**Speicherung:** Die bisherige `DateTime`-Spalte bleibt der sortierbare
Ankerpunkt (bei Monat der Monatserste, bei Jahr der 1. Januar). Daneben
stehen je Datum Genauigkeit (`…Precision`: `DAY`, `MONTH`, `YEAR`) und
Zusatz (`…Qualifier`: `EXACT`, `ABOUT`, `BEFORE`, `AFTER`). Die
Standardwerte (Tag, genau) beschreiben alle früher erfassten Daten — es war
keine Datenumstellung nötig. Eingelesen, angezeigt und verglichen wird an
einer Stelle: [lib/dates.ts](lib/dates.ts).

**Prüfungen:** Validierung, Plausibilitätsprüfung, Datenlücken, Dubletten,
Alter in Zeitleisten und die Statistik vergleichen den Zeitraum, den eine
Angabe abdeckt. Gemeldet bzw. abgelehnt wird nur, was für *jede* mögliche
Lesart widersprüchlich ist — „1900 gestorben“ und „1900 geboren“ ist kein
Fehler, nur weil beides intern auf den 1. Januar fällt; „vor 1840 gestorben,
1850 geboren“ schon. Ein ungefähres Geburtsdatum gilt nicht als fehlend; die
Zeitleiste einer Person führt es aber als „genaues Geburtsdatum (bisher: um
1850)“ unter den offenen Punkten. Suche und Sortierung nach Geburtsjahr
nutzen den Ankerpunkt („vor 1900“ zählt als 1900).

## Quellen und Belege

Eine **Quelle** ist ein Dokument — ein Kirchenbuch, ein Standesamtsregister,
eine Volkszählungsliste, ein Grabstein, die Familienbibel, ein Gespräch mit
der Großmutter, eine Webseite. Sie hat Titel, Art, Verfasser/Herkunft,
Archiv und Signatur, Internetadresse, Datum (ungenau erlaubt), eine Abschrift
bzw. Notizen und optional einen Scan (ein bereits hochgeladenes Bild einer
belegten Person oder Ehe).

Ein **Beleg** verbindet eine Quelle mit genau einer Angabe: an einer Person
`Name`, `Geburt`, `Tod` oder `Sonstiges`, an einer Beziehung `Heirat &
Partnerschaft` bzw. `Abstammung` (oder `Sonstiges`). Dazu kommen
Fundstelle (Seite, Eintragsnummer) und Verlässlichkeit (gesichert,
wahrscheinlich, unsicher). Eine Quelle kann beliebig viele Angaben vieler
Personen belegen.

**Oberfläche:**

- Personenseite, Abschnitt **„Quellen“**: Belege nach Angabe gruppiert;
  Bearbeiter können Belege hinzufügen (auch mit gleich neu angelegter
  Quelle), ändern und entfernen — auch für die Ehen und Eltern-Kind-
  Beziehungen der Person. In der Beziehungsliste („Verwaltung“) führt
  „Belege“ direkt dorthin.
- **„Quellen“** in der Navigation: Liste mit Suche und Filter nach Art,
  Detailseite mit allem, wofür die Quelle zitiert wird, Anlegen, Bearbeiten,
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
| `search_persons` | Suche nach Namenswörtern, Familie, Geburtsjahr (von/bis), Ort, Geschlecht, verstorben; seitenweise (Standard 20) |
| `get_person` | Vollständiger Datensatz mit Notizen, Familien, Eltern, Partnern (mit Heirats-/Scheidungsdaten), Kindern, Geschwistern (voll/halb), Bild-Metadaten und Belegen |
| `get_ancestors` / `get_descendants` | Vorfahren bzw. Nachfahren nach Generationen (Standard 4, höchstens 12) |
| `get_kinship` | Verwandtschaft zweier Personen mit deutscher Bezeichnung („Großmutter väterlicherseits“, „Cousin 1. Grades“, „Schwager“), gemeinsamen Vorfahren und Verbindungsweg |
| `list_families` | Sichtbare Familien mit Personenzahl und eigener Rolle |
| `get_statistics` | Überblick: Personen, Beziehungen, Familien, fehlende Angaben, Geburtsjahre |
| `find_data_gaps` | Fehlende Angaben (Geburtsdatum, Eltern, Geschlecht, vermutlich verstorben ohne Sterbedatum, …) und `unsourced` (Geburt/Tod ohne Beleg) |
| `find_possible_duplicates` | Vermutlich doppelt erfasste Personen mit Begründung und Wert 0–1 |
| `check_consistency` | Widersprüche: Tod vor Geburt, Elternteil jünger als 12 bzw. älter als 70 (Mutter 50), Geburt nach dem Tod eines Elternteils, Lebensdauer über 110, Heirat vor 14 oder nach dem Tod, überschneidende Ehen |
| `get_timeline` | Zeitleiste einer Person (mit Alter und fehlenden Daten) oder einer Familie |
| `search_sources` | Quellen suchen (Titel, Verfasser, Archiv, Signatur; Art) mit Zahl der sichtbaren Belege |
| `get_source` | Quelle mit Abschrift und allem, wofür sie zitiert wird (verborgene Belege nur gezählt) |

Nur mit der Stufe „lesen und schreiben“ (siehe unten) kommen hinzu:

| Werkzeug | Zweck |
|---|---|
| `create_person` | Person anlegen, optional mit datierter Recherchenotiz |
| `update_person` | Felder ergänzen/korrigieren; Notizen werden nie überschrieben, `append_note` hängt eine datierte Notiz (`[JJJJ-MM-TT, KI-Recherche] … (Quelle: …)`) an — der Quellenhinweis dort ist nur Freitext |
| `create_source` | Quelle anlegen (Titel, Art, Verfasser, Archiv, Signatur, URL, Datum, Abschrift) |
| `cite_source` | Quelle für eine Angabe einer Person (NAME/BIRTH/DEATH/OTHER) oder Beziehung (PARTNERSHIP/PARENTAGE/OTHER) zitieren, mit Fundstelle und Verlässlichkeit |
| `create_relationship` / `update_relationship` | Eltern-Kind- oder Partnerbeziehung anlegen bzw. Art, Zeitraum, Notiz korrigieren |
| `delete_relationship` | eine falsche Verknüpfung entfernen (die verknüpften Personen lassen sich nicht umhängen, nur löschen und neu anlegen) |
| `set_person_families` | Familienzuordnung setzen |

Personen, Quellen oder Bilder löschen kann die KI bewusst nicht. Dazu kommen
zwei Prompt-Vorlagen (`research_person`, `review_data_quality`) und die
Ressource `familytree://person/{id}`. Die Ergebnisse sind kompaktes JSON;
Daten stehen in ihrer echten Genauigkeit (`1850`, `um 1850`, `vor 1900` —
siehe [Ungenaue Daten](#ungenaue-daten)), und Eingaben akzeptieren dieselben
Formen wie die Oberfläche. Die Anweisungen an das Modell verlangen, Erkenntnisse
als Beleg (`create_source` + `cite_source`) festzuhalten statt nur als Notiz.

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
  Widerrufen und Rechte vergeben gehen über die MCP-Schnittstelle nicht.
- **Alles wird protokolliert.** Jede Änderung durch die KI steht im
  Audit-Log unter dem Benutzer, mit Kanal `MCP` und dem verwendeten
  Schlüssel; KI-Notizen tragen zusätzlich „KI-Recherche“ und Datum. Die
  letzten Änderungen über die KI (auf der NAS, per SSH):

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
   *Anlegen*. Der Schlüssel (`ftk_…`) wird **genau einmal** angezeigt —
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
5. **claude.ai im Browser und die Claude-App auf dem Telefon** können sich
   **nicht** verbinden, solange der Stammbaum nur im Heimnetz erreichbar ist:
   Ihre „Connectors“ werden von Anthropics Servern aus aufgerufen, nicht vom
   eigenen Gerät, und erreichen die NAS deshalb nicht. Außerdem melden sie
   sich per OAuth an, nicht mit einem festen Schlüssel. Ein Zugang dafür
   (OAuth) ist als eigener Schritt geplant.

### Schlüssel richtig verwenden

- **Ein Schlüssel je Gerät und Zweck** — dann lässt sich einer gezielt
  widerrufen, und die Liste auf `/ai-access` zeigt je Schlüssel, wann er
  zuletzt benutzt wurde. Höchstens 10 aktive Schlüssel je Benutzer.
- **Standardmäßig „lesen“.** Einen Schlüssel „lesen und schreiben“ nur
  anlegen, wenn die KI wirklich eintragen soll.
- **Ablauf:** Schlüssel laufen nach der gewählten Zeit ab (Standard 90 Tage)
  und antworten dann mit 401; dann einen neuen anlegen und im Client
  austauschen (`claude mcp remove …` und neu `add`).
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
| Origin | Anfragen ohne `Origin`-Header (Claude Code, `mcp-remote`) sind erlaubt; mit `Origin` nur die eigene Adresse (`PUBLIC_URL`) oder Einträge in `MCP_ALLOWED_ORIGINS` (kommagetrennt). Das braucht nur ein MCP-Client, der im Browser läuft (z.B. der MCP Inspector) — die Variable reicht der Stack nicht durch |
| Größe | Anfrage höchstens 1 MiB |

| Status | Bedeutung |
|---|---|
| 200 | in Ordnung |
| 401 | Schlüssel fehlt, ist falsch, widerrufen oder abgelaufen, oder der Benutzer ist gesperrt — bewusst ohne Angabe des Grundes |
| 403 | Schlüssel gültig, aber der Benutzer hat kein KI-Recht (mehr); oder fremder `Origin` |
| 405 | andere Methode als `POST` |
| 413 | Anfrage größer als 1 MiB |
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
`tests/mcp.db.test.ts` den stdio-Server (alle Werkzeuge, Maskierung,
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
        ├─ baut EIN Image und lädt es nach ghcr.io (privates Paket):
        │    ghcr.io/soschlegel/familiy-tree   (App samt Migrationen)
        └─ setzt Branch "deploy" auf diesen Commit
Portainer (beobachtet "deploy") ─ lädt das Image (mit Token) ─ startet den Stack neu
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
läuft in der App unter `/api/mcp` ([KI-Zugang](#ki-zugang-mcp)). Wer früher
das Profil `db-access` für den MCP-Server am PC eingeschaltet hatte:
`db-access` aus `COMPOSE_PROFILES` und `DB_ACCESS_*` aus den
Stack-Variablen streichen (der Dienst existiert nicht mehr; ein verbliebener
Eintrag schadet nicht, startet aber auch nichts).

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
2. **Zugang zur Registry für Portainer.** Das Paket bleibt **privat**
   (Standard bei ghcr.io, auch bei öffentlichem Repository); Portainer meldet
   sich mit einem Token an.
   - **Token anlegen:** GitHub → *Settings → Developer settings → Personal
     access tokens → Tokens (classic) → Generate new token (classic)*.
     Nur den Scope **`read:packages`** anhaken, sonst nichts. Ablauf
     (*Expiration*): lang, aber nicht unbegrenzt, z.B. 1 Jahr — und das
     Ablaufdatum **in den Kalender** eintragen (zwei Wochen vorher erinnern).
     Ein *fine-grained* Token geht hier **nicht**: laut GitHub-Doku
     unterstützt die Container-Registry nur Tokens (classic) („GitHub
     Packages only supports authentication using a personal access token
     (classic)“, geprüft November 2026).
   - **In Portainer eintragen:** *Registries → Add registry → Custom
     registry*. *Name* `ghcr`, *Registry URL* `ghcr.io`, *Authentication*
     an, *Username* `soschlegel` (GitHub-Benutzername), *Password* = das
     Token → *Add registry*. (Der Anbieter „GitHub“ in der Liste gibt es nur
     in Portainer Business, und er verlangt mehr Rechte; *Custom registry*
     genügt zum Laden.)
   - Portainer verwendet die Zugangsdaten beim Laden eines Images
     automatisch, wenn der Image-Name mit dem Registry-Host (`ghcr.io/…`)
     beginnt — auch beim *Re-pull* der automatischen Git-Updates. Bei einem
     Git-Stack gibt es dafür kein eigenes Auswahlfeld; es genügt, dass die
     Registry in der Umgebung zugänglich ist (als Portainer-Administrator
     angelegt: für alle Stacks). Wer Stacks mit einem Nicht-Admin-Konto
     verwaltet, gibt die Registry diesem Konto frei (*Registries → ghcr →
     Manage access*). Nicht auf der NAS ausprobiert.
   - **Wenn das Token abläuft:** Laufende Container laufen weiter, auch nach
     einem Neustart der NAS (das Image liegt lokal). Erst das nächste Update
     scheitert: Portainer meldet beim Deploy/Re-pull etwa
     `failed to pull images of the stack … ghcr.io/soschlegel/familiy-tree …
     denied` bzw. `unauthorized`, der Stack bleibt auf dem alten Stand.
     Abhilfe: neues Token wie oben, in Portainer *Registries → ghcr* das
     Passwort ersetzen, *Stacks → familytree → Pull and redeploy*.
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

**Umstieg vom Zwei-Image-Stack** (Stand mit eigenem `migrate`-Dienst): Die
Datenbank hat bereits ihre Migrationshistorie; die neue App meldet beim
ersten Start „No pending migrations to apply.“ (lokal nachgeprüft). Der alte,
beendete Container `familytree-migrate-1` bleibt „verwaist“ liegen (Compose
warnt „Found orphan containers“), stört nicht und kann in Portainer unter
*Containers* gelöscht werden.

### Fehlersuche

Logs: Portainer → *Stacks → familytree* → Container → *Logs*, oder auf der
NAS `docker logs familytree-app-1` (bzw. `-backup-db-1`, `-media-init-1`, …).
Die Ausgabe der Migrationen steht im Log von **`app`**, vor dem Serverstart
(Zeilen mit `[start]` und die Meldungen von Prisma).

| Symptom | Ursache / Abhilfe |
|---|---|
| Deploy bricht ab mit „… fehlt“ | Pflichtvariable nicht gesetzt (Meldung nennt sie) |
| „pull access denied“ / „denied“ / „unauthorized“ für `ghcr.io/…` | Registry in Portainer fehlt, Token falsch oder abgelaufen ([Erste Installation](#erste-installation), Schritt 2), oder der Workflow ist noch nie gelaufen |
| Portainer findet `refs/heads/deploy` nicht | Workflow auf `main` noch nie erfolgreich durchgelaufen |
| `app` „restarting“, Log `[start] FEHLER: Eine Migration ist fehlgeschlagen …` | → [Fehlgeschlagene Migration](#fehlgeschlagene-migration) |
| `app` „restarting“, Log `[start] FEHLER: Die Datenbank enthält bereits Tabellen, aber keine Migrationshistorie` | Datenbank stammt aus einer `db push`-Installation → [Schema und Migrationen](#schema-und-migrationen), Baselining |
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

Eine Installation aus der Zeit vor den Migrationen (Datenbank per `db push`)
gibt es im Betrieb nicht; wer trotzdem eine solche Datenbank anschließt,
stellt sie einmalig auf Migrationen um (Baselining) — **vorher sichern**.
Lokal mit Repo-Kopie und `DATABASE_URL`:

```bash
# 1. Prüfen, dass die Datenbank exakt dem Schema entspricht
#    (Ausgabe muss "This is an empty migration." sein — sonst erst
#    "npx prisma db push" für den aktuellen Stand):
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script

# 2. Alle vorhandenen Migrationen als bereits angewendet markieren:
npx prisma migrate resolve --applied 0_init
npx prisma migrate resolve --applied 20261116000000_ungenaue_daten_und_quellen
npx prisma migrate resolve --applied 20261117000000_ki_zugang
```

Auf der NAS (SSH, Stack `familytree`) geht Schritt 2 mit dem App-Image
(Schritt 1 braucht das volle Prisma-CLI mit Repo-Kopie und ist dort nicht
vorgesehen):

```sh
docker run --rm --network familytree_default -e RUN_MIGRATIONS=false \
  -e DATABASE_URL='postgresql://familytree:<POSTGRES_PASSWORD>@db:5432/familytree' \
  ghcr.io/soschlegel/familiy-tree:latest prisma migrate resolve --applied 0_init
# … ebenso für die beiden anderen Migrationen
```

Danach startet die App normal. Lokal (`docker-compose.dev.yml`) bleibt
`npm run db:push` möglich; eine so angelegte Datenbank lässt sich aber nicht
mit dem Produktiv-Image betreiben, ohne sie wie oben zu baselinen.

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

## Datenmodell

Beziehungen liegen in einer eigenen Tabelle statt als `parentId` auf `Person`.
Ein Stammbaum ist kein Baum, sondern ein Graph — nur so sind zwei Elternteile,
Adoption, Stiefverhältnisse, Mehrfachehen und Beziehungszeiträume abbildbar,
ohne das Schema zu ändern.

```
Person ──< Relationship >── Person     type: PARENT_OF | PARTNER_OF
Person ──< PersonMedia >── MediaAsset
Source ──< Citation >── Person | Relationship   fact: NAME | BIRTH | DEATH | PARTNERSHIP | PARENTAGE | OTHER
User (= Allowlist) ──< AuditLog     über den KI-Zugang: channel = MCP, apiTokenId
User ──< ApiToken                    KI-Schlüssel (nur der Hash), aiAccess am User
```

Regeln für Beziehungen (geprüft in [lib/validation.ts](lib/validation.ts) und
[lib/services/relationships.ts](lib/services/relationships.ts)):

- Die Art muss zum Typ passen — Eltern: leiblich, adoptiert, Stief, Pflege;
  Partner: verheiratet, unverheiratet, geschieden.
- Höchstens **zwei leibliche** Eltern; Adoptiv-, Stief- und Pflegeeltern
  kommen beliebig hinzu.
- Keine Zyklen (niemand ist sein eigener Vorfahre), keine Partnerschaft
  zwischen Elternteil und Kind, keine doppelten Beziehungen.
- Daten müssen plausibel sein: kein Jahr vor 1000, Geburt und Tod nicht in der
  Zukunft, Tod nicht vor der Geburt, Ende einer Beziehung nicht vor ihrem
  Beginn — bei ungenauen Daten nur, wenn es für jede Lesart gilt (siehe
  [Ungenaue Daten](#ungenaue-daten)).

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
