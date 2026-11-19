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
| Betrieb | Docker Compose (Portainer), Images aus GitHub Actions über ghcr.io |

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
Dazu kommen Lebensereignisse (`mock-e-001` …: Taufe, Beruf, Beerdigung der
Stammväter, ein Wohnort „von … bis …“, ein Abschluss „zwischen … und …“, eine
Konfirmation nur mit Wortlaut, ein sonstiges Ereignis „Kapitänspatent“, eine
Verlobung an einer Ehe, eine abweichende zweite Geburtsangabe), Heiratsorte
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
bzw. Notizen und optional einen Scan (ein bereits hochgeladenes Bild einer
belegten Person oder Ehe).

Ein **Beleg** verbindet eine Quelle mit genau einer Angabe: an einer Person
`Name`, `Geburt`, `Tod` oder `Sonstiges`, an einer Beziehung `Heirat &
Partnerschaft` bzw. `Abstammung` (oder `Sonstiges`). Dazu kommen
Fundstelle (Seite, Eintragsnummer), Verlässlichkeit (gesichert,
wahrscheinlich, unsicher) und optional eine Abschrift (`text`). Ein Beleg
kann auch ein einzelnes Lebensereignis stützen (`eventId`, Angabe
„Ereignis“); er hängt dann zugleich an dessen Person bzw. Beziehung, Rechte
und Export gelten wie dort. Eine Quelle kann beliebig viele Angaben vieler
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
| `search_persons` | Suche nach Namenswörtern (auch Rufname und weitere Namen), Familie, Geburtsjahr (von/bis), Ort (Geburt, Tod, Ereignisse, Heirat/Scheidung), Geschlecht, verstorben; seitenweise (Standard 20) |
| `get_person` | Vollständiger Datensatz mit Notizen, Familien, Eltern, Partnern (mit Heirats-/Scheidungsdaten und -orten, Ereignissen der Partnerschaft), Kindern, Geschwistern (voll/halb), Lebensereignissen (`events`, abweichende Angaben als `alternative`), weiteren Namen (`otherNames`), Bild-Metadaten und Belegen |
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
| `get_source` | Quelle mit Abschrift und allem, wofür sie zitiert wird (verborgene Belege nur gezählt) |

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

Personen, Quellen oder Bilder löschen kann die KI bewusst nicht. Dazu kommen
zwei Prompt-Vorlagen (`research_person`, `review_data_quality`) und die
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
        ├─ baut und lädt nach ghcr.io:
        │    ghcr.io/soschlegel/familiy-tree          (App)
        │    ghcr.io/soschlegel/familiy-tree-migrate  (Schema + Admin)
        └─ setzt Branch "deploy" auf diesen Commit
Portainer (beobachtet "deploy") ─ lädt die Images ─ startet den Stack neu
```

Auf der NAS wird nichts gebaut, und der Stack braucht keine Dateien aus dem
Repository außer `docker-compose.yml` selbst. Die übrigen Images
(`postgres:17-alpine`, optional `caddy`) kommen unverändert von Docker Hub.

**Dienste** ([docker-compose.yml](docker-compose.yml)):

| Dienst | Aufgabe |
|---|---|
| `db` | PostgreSQL 17, kein Port nach außen |
| `media-init` | legt den Bilderordner `media/` an, übergibt ihn der App (uid 1001) und prüft, dass sie schreiben kann; beendet sich |
| `backup-db` | Datenbank-Dump nach `backups/` — bei jedem Start **vor** der Migration, und auf Abruf |
| `migrate` | wendet Migrationen an, legt `INITIAL_ADMIN_EMAIL` als Admin an, beendet sich |
| `app` | die Anwendung; startet erst nach erfolgreichem `media-init` und `migrate`; Bilder in `media/`; Port `127.0.0.1:3080` für den Proxy |
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

1. **Images bauen lassen.** Auf `main` pushen (oder unter *Actions → Images →
   Run workflow* von Hand starten) und warten, bis der Lauf grün ist (ca.
   5–10 min). Danach gibt es den Branch `deploy`.
2. **Pakete freigeben.** Neue Pakete auf ghcr.io sind privat, auch bei einem
   öffentlichen Repository. Für beide Pakete (`familiy-tree` und
   `familiy-tree-migrate`): GitHub → Profil →
   *Packages* → Paket → *Package settings* → *Danger Zone* → *Change
   visibility* → *Public* → Namen bestätigen. (Lässt sich nicht rückgängig
   machen; die Images enthalten keine Geheimnisse.)
   *Alternative ohne Veröffentlichung:* GitHub → Settings → Developer
   settings → *Personal access tokens (classic)* → Token nur mit
   `read:packages`; in Portainer *Registries → Add registry → Custom
   registry*, URL `ghcr.io`, Benutzername `soschlegel`, Token als Passwort.
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
6. **Start prüfen.** *Stacks → familytree*: `media-init` und `migrate` sind
   „exited“ mit Code 0 (Logs: `[media-init] Bilderordner bereit …` bzw.
   `[migrate] Fertig.`); `app` steht auf „healthy“. Auf der NAS:
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
Images neu (*Re-pull image*) und startet den Stack: `backup-db` →
`migrate` → `app`.

**Warum `deploy` statt `main`:** Würde Portainer `main` beobachten, sähe es
den neuen Commit sofort, der Image-Build läuft dann aber noch. Portainer
würde das alte `latest` erneut laden — und erst beim *nächsten* Commit
nachziehen. Schlimmer: eine neue `docker-compose.yml` könnte auf Images
treffen, die es noch nicht gibt. Der Workflow setzt `deploy` erst, wenn alle
Images fertig sind; Compose-Datei und Images passen so immer zusammen.
*Force redeployment* bleibt aus: es würde den Stack bei jedem Abruf neu
starten — und damit jedes Mal Sicherung und Migration laufen lassen.
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
App-Image geändert, hält Compose die alte App **zuerst** an und startet die
neue erst nach `media-init`, `backup-db` und `migrate` — eine Migration läuft
also nie neben der alten App. Ohne neues Image (*Update the stack* ohne
Änderung) laufen die drei Einmal-Jobs erneut, die App läuft dabei weiter;
das ist harmlos, weil `migrate deploy` dann nichts einzuspielen hat (gleiches
Migrator-Image, gleiche Migrationen). Nur wer eine **nicht
abwärtskompatible** Migration ohne passendes neues App-Image einspielt
(z.B. `IMAGE_TAG` nur teilweise umgestellt), sollte vorher
`docker stop familytree-app-1` ausführen.

### Fehlersuche

Logs: Portainer → *Stacks → familytree* → Container → *Logs*, oder auf der
NAS `docker logs familytree-migrate-1` (bzw. `-app-1`, `-backup-db-1`, …).

| Symptom | Ursache / Abhilfe |
|---|---|
| Deploy bricht ab mit „… fehlt“ | Pflichtvariable nicht gesetzt (Meldung nennt sie) |
| „pull access denied“ / „denied“ für `ghcr.io/…` | Paket noch privat (Schritt 2) oder Workflow noch nicht gelaufen |
| Portainer findet `refs/heads/deploy` nicht | Workflow auf `main` noch nie erfolgreich durchgelaufen |
| `app` startet nicht, `migrate` Exit ≠ 0 | Log von `migrate` lesen; „ABBRUCH: Die Schemaänderung ist nicht rein ergänzend“ → [Schema und Migrationen](#schema-und-migrationen) |
| `migrate` startet nicht, `backup-db` Exit ≠ 0 | Sicherung fehlgeschlagen (Platz, Rechte auf `backups/`) — die Migration läuft absichtlich nicht ohne Sicherung |
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

Schemaänderungen künftig mit `npm run db:migrate` (`prisma migrate dev`) als
Migration anlegen und mit einchecken.

Der `migrate`-Container ([docker/migrate.sh](docker/migrate.sh)) entscheidet
beim Start anhand der Datenbank:

| Zustand | Vorgehen |
|---|---|
| leere Datenbank (Neuinstallation) | `prisma migrate deploy` |
| Datenbank mit Migrationshistorie | `prisma migrate deploy` |
| bestehende Installation ohne Historie (früher per `db push` angelegt) | `prisma db push`, aber **nur bei rein ergänzenden Änderungen** — sonst Abbruch |

Für den letzten Fall prüft der Container vorher den Unterschied zwischen
Datenbank und Schema (`prisma migrate diff`, Prüfung in
[docker/schema-diff-check.mjs](docker/schema-diff-check.mjs)). Rein
ergänzend sind neue Tabellen, Spalten, Indizes, Fremdschlüssel,
Enum-Werte und Standardwerte. Alles andere — Tabelle/Spalte/Typ löschen,
Spaltentyp ändern, Umbenennen, `NOT NULL` erzwingen — bricht mit
„ABBRUCH: Die Schemaänderung ist nicht rein ergänzend“ und der Liste der
betroffenen SQL-Anweisungen ab; die Datenbank bleibt unverändert, die App
startet nicht. Dann entweder auf Migrationen umstellen (Baselining, unten)
oder — wenn der Verlust wirklich gewollt ist — einmalig die Stack-Variable
`MIGRATE_ALLOW_DATA_LOSS=true` setzen, neu deployen und die Variable wieder
entfernen. Die Sicherung, die `backup-db` vor jeder Migration anlegt, liegt
dann in `${DATA_ROOT}/backups`.

**Update auf ungenaue Daten und Quellen bzw. KI-Zugang:** Es ist nichts von
Hand zu tun. Eine per `db push` angelegte Installation bekommt die neuen
Spalten (mit Standardwerten, die den bisherigen Daten entsprechen) und die
neuen Tabellen beim nächsten Start des `migrate`-Containers über `db push` (rein
ergänzend, läuft also ohne Rückfrage durch); eine
Installation mit Migrationshistorie über `migrate deploy`. Vorhandene Daten
bleiben unverändert. Lokal genügt `npm run db:push` (bzw. `npm run
db:migrate` bei Migrationshistorie) und ein Neustart von `npm run dev`.
Sicherung vorher schadet trotzdem nie.

Umstellen auf Migrationen (Baselining) geht einmalig so — **vorher sichern**:

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
npx prisma migrate resolve --applied 20261119000000_genealogie_ereignisse_import
```

Auf der NAS (SSH, Stack `familytree`) in einem Einmal-Container aus dem
Migrator-Image, darin die Befehle oben ausführen:

```sh
docker run --rm -it --network familytree_default \
  -e DATABASE_URL='postgresql://familytree:<POSTGRES_PASSWORD>@db:5432/familytree' \
  ghcr.io/soschlegel/familiy-tree-migrate:latest sh
```

Ab dann läuft dort beim Start `migrate deploy`.

Lokal (`docker-compose.dev.yml`) gilt dasselbe: `npm run db:push` bleibt
möglich; wer auf Migrationen umstellen will, baselinet wie oben.

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

`backup-db` läuft **bei jedem Stack-Start vor der Migration**, damit es zu
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
#    die App), sichert den eingespielten Stand, wendet ggf. neuere
#    Migrationen an und startet die App. Ohne Portainer, bei gleichem
#    Programmstand:
#    docker start -a familytree-media-init-1 && docker start familytree-app-1
```

Danach `curl http://127.0.0.1:3080/api/health` → `{"status":"ok"}` und
einige Personen mit Bildern ansehen. Ist der Dump älter als der aktuelle
Programmstand, holt `migrate` beim nächsten Stack-Start die fehlenden
Migrationen nach.

## Austauschformat

`/admin/data` bietet Export und Import.

- **JSON** — Personen, Beziehungen, Quellen mit Belegen und Bildzuordnungen.
  Bilder erscheinen als Verweis auf einen Dateinamen.
- **ZIP** — dasselbe JSON plus die Bilddateien unter `media/`. Damit ist der
  Export ein vollständiges Backup und ein Umzug auf eine andere Instanz
  funktioniert wirklich.
- **GEDCOM** — Export als GEDCOM 5.5.1 (UTF-8), auf Wunsch als ZIP mit den
  Bildern; Import mit Vorschau und Abgleich, siehe [GEDCOM-Import](#gedcom-import).
  Bibliothek: [lib/gedcom](lib/gedcom/README.md); eine Datei vorab prüfen mit
  `npm run gedcom:check -- datei.ged`.

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

### GEDCOM-Import

Nur für Administratoren, auf `/admin/data`. Ablauf: Datei (`.ged` oder
`.zip` mit einer `.ged`) hochladen → Vorschau → bestätigen → Ergebnis. Die
Vorschau ändert nichts außer dem Importlauf selbst (Originaldatei wird
aufbewahrt); sie lässt den echten Massenimport probeweise laufen, zeigt also
genau, was passieren würde. Ein erneuter Import desselben Baums ist der
Normalfall:

- **Welcher Baum?** Aus dem Dateikopf (MyHeritage `_PROJECT_GUID`, sonst
  Site-ID), sonst über übereinstimmende `_UID`; der Administrator kann
  „Aktualisierung von …“ oder „neuer, unabhängiger Baum“ wählen. Abgeglichen
  wird nur innerhalb dieses Baums.
- **Wiedererkennen**: Herkunft (`ImportLink`: `_UID`, sonst RIN, sonst Xref;
  Ereignisse über eigene `_UID` bzw. Art und Nummer), dann Fremdkennung
  `_UID` (nur, wenn der Datensatz keinem anderen Baum gehört), Beziehungen
  über das Personenpaar, Quellen ohne Kennung über Xref + Titel bzw. Titel +
  Verfasser (umnummerierte Quellen). Ähnliche, von Hand angelegte Personen
  sind nur **Vorschläge** — zugeordnet wird erst nach Bestätigung.
- **Gruppen** je Art: neu · in der Datei geändert (mit Feldern) · in der App
  geändert (Standard: App-Version behalten, einzeln oder für alle umstellbar)
  · fehlt in der Datei (Standard: behalten und markieren; löschen nur
  ausdrücklich, über die normalen Dienste) · nicht übernehmbar (mit Grund,
  z.B. dritter leiblicher Elternteil) · schon vorhanden · unverändert.
- **Familienzuordnung** neuer Personen in der Vorschau wählen (keine, vorhandene
  Familien, neue Familie); als privat markierte Personen bleiben auf Wunsch
  ohne Familie. Vorhandene Personen behalten ihre Zuordnung.
- **Namen**: `familyName` ist der heutige Name — bei MyHeritage `_MARNM`,
  sonst ein NAME mit TYPE married —, `birthName` der Geburtsname. Paare ohne
  Heirat: „Ehestand unbekannt“. Unplausible Daten (vor 1000, Zukunft, Tod vor
  Geburt) kommen nur als Wortlaut, damit die Person nicht ausfällt.
- **Nichts geht verloren**: Jeder Personen-, Familien- und Quellendatensatz
  wird zusätzlich unverändert als Rohdaten am Träger abgelegt; der
  GEDCOM-Export schreibt daraus zurück, was die App nicht abbildet (fremde
  Tags, Koordinaten, Fotoverweise …). Ein zweiter Import desselben Stands
  schreibt keine neuen Rohdaten.
- **Fotos** (Verweise auf Anbieter-Server) nur auf ausdrücklichen Wunsch
  herunterladen — https, nur öffentliche Adressen (auch nach
  Weiterleitungen), Verbindung genau zur geprüften Adresse, Größen-, Art- und
  Zeitgrenzen, Prüfung durch sharp; jede Adresse steht im Lauf. Lokale
  Dateipfade werden nie gelesen.
- Große Dateien: Das Ausführen läuft im Hintergrund (Stand wird abgefragt) —
  5 000 Personen brauchen etwa 25 s, eine Datei mit 500 Personen wenige
  Sekunden.
- **Importe** (Verlauf): Läufe mit Ergebnis, Originaldatei zum Herunterladen,
  überholte Rohdaten entfernen.

Dienste: [lib/services/gedcom-import.ts](lib/services/gedcom-import.ts),
Abbildung: [lib/gedcom-import/mapping.ts](lib/gedcom-import/mapping.ts),
Export: [lib/services/gedcom-export.ts](lib/services/gedcom-export.ts).
Dass MyHeritage, Gramps oder Ancestry den Export vollständig übernehmen, ist
nicht ausprobiert.

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
durch einen Import nie etwas.

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
