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
| Visualisierung | React Flow (Layout selbst geschrieben, `lib/layout-generations.ts`) |
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

MinIO ist lokal unter **Port 9100** (S3-API) und **9101** (Web-Konsole)
erreichbar, nicht unter dem Standardport 9000 — der ist auf manchen Rechnern
belegt (z.B. durch Zscaler). Andere Ports über `MINIO_API_PORT` /
`MINIO_CONSOLE_PORT` beim `docker compose`-Aufruf setzen und `S3_ENDPOINT` in
der `.env` anpassen.

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

## Mock-Daten

Für Entwicklung, Tests und Vorführungen gibt es einen deterministischen
Testdatensatz in einer **eigenen Datenbank** (`familytree_mock`) und einem
**eigenen Bucket** (`familytree-mock`) — die normale Datenbank bleibt
unberührt.

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres + MinIO
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
`_mock` oder `_test` endet. Jeder Lauf leert Mock-Datenbank und Mock-Bucket und
baut alles neu auf; das Ergebnis ist bei jedem Lauf identisch, einschließlich
der IDs (`mock-p-001`, `mock-r-0001`, `mock-family-a`, …). Ist MinIO nicht
erreichbar, wird ohne Bilder befüllt (mit Warnung).

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

| E-Mail | Rolle | Familien |
|---|---|---|
| `admin@example.test` | Administrator | alle |
| `editor@example.test` | Bearbeiter | A bearbeiten, B lesen |
| `viewer@example.test` | Betrachter | A lesen |
| `nofamily@example.test` | Betrachter | keine |
| `blocked@example.test` | gesperrt | (A lesen) — Anmeldung schlägt fehl |

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

## KI-Recherche über MCP

Der Ordner [mcp](mcp) enthält einen [MCP-Server](https://modelcontextprotocol.io)
(Model Context Protocol, stdio). Damit kann ein KI-Assistent wie Claude Code
oder Claude Desktop direkt mit den Stammbaumdaten arbeiten: Fragen zu Personen
und Verwandtschaft beantworten, Lücken und Widersprüche finden und — nur wenn
ausdrücklich freigeschaltet — Rechercheergebnisse eintragen.

Der Server handelt immer **als ein Benutzer der App** und geht vollständig
über die [Dienstschicht](#dienstschicht): Sichtbarkeit nach Familien,
Platzhalter für verborgene Personen („Nicht freigegeben“), Rechteprüfung,
Validierung und Audit-Log gelten genau wie in der Weboberfläche. Der Benutzer
wird bei jedem Aufruf neu geladen — eine Rollenänderung oder Sperre wirkt
sofort, ohne Neustart.

### Werkzeuge

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

Nur mit `MCP_ALLOW_WRITE=true`:

| Werkzeug | Zweck |
|---|---|
| `create_person` | Person anlegen, optional mit datierter Recherchenotiz |
| `update_person` | Felder ergänzen/korrigieren; Notizen werden nie überschrieben, `append_note` hängt eine datierte Notiz (`[JJJJ-MM-TT, KI-Recherche] … (Quelle: …)`) an — der Quellenhinweis dort ist nur Freitext |
| `create_source` | Quelle anlegen (Titel, Art, Verfasser, Archiv, Signatur, URL, Datum, Abschrift) |
| `cite_source` | Quelle für eine Angabe einer Person (NAME/BIRTH/DEATH/OTHER) oder Beziehung (PARTNERSHIP/PARENTAGE/OTHER) zitieren, mit Fundstelle und Verlässlichkeit |
| `create_relationship` / `update_relationship` | Eltern-Kind- oder Partnerbeziehung anlegen bzw. Art, Zeitraum, Notiz korrigieren |
| `delete_relationship` | eine falsche Verknüpfung entfernen (die verknüpften Personen lassen sich nicht umhängen, nur löschen und neu anlegen) |
| `set_person_families` | Familienzuordnung setzen |

Personen löschen kann der Server bewusst nicht. Dazu kommen zwei
Prompt-Vorlagen (`research_person`, `review_data_quality`) und die Ressource
`familytree://person/{id}`. Ergebnisse sind kompaktes JSON (zusätzlich als
`structuredContent` mit Ausgabeschema); Personen erscheinen überall als
`{ id, name, lifespan }`. Daten stehen im ISO-Format in ihrer echten
Genauigkeit (`1850-03-12`, `1850-03`, `1850`), dazu `…Precision`,
`…Qualifier` und ein deutscher `…Text` („um 1850“); die Lebensspanne lautet
z.B. „um 1850 – vor 1920“. Eingaben der Schreibwerkzeuge akzeptieren dieselben
Formen wie die Oberfläche (`1850`, `um 1850`, `vor 1900`, `ABT 1850`, …)
und speichern sie unverändert genau. Die Server-Anweisungen und der Prompt
`research_person` leiten das Modell an, Erkenntnisse als Beleg
(`create_source` + `cite_source`) festzuhalten statt nur als Notiz.

### Umgebungsvariablen

| Variable | Bedeutung |
|---|---|
| `MCP_USER_EMAIL` | **Pflicht.** E-Mail des Benutzers, als der der Server handelt. Unbekannt oder gesperrt → Start wird abgebrochen. |
| `MCP_ALLOW_WRITE` | `true` schaltet die Schreibwerkzeuge frei. Standard: aus (nur lesen). |
| `DATABASE_URL` | Datenbank wie bei der App. Ohne Angabe gilt die `.env` im Projektordner — unabhängig davon, aus welchem Verzeichnis der Client den Server startet. |

### Starten

```bash
npm run -s mcp:mock    # gegen die Mock-Datenbank (wie npm run dev:mock)
npm run -s mcp         # gegen DATABASE_URL laut .env
```

`-s` ist wichtig: ohne schreibt npm seine Kopfzeile auf stdout, das allein dem
Protokoll gehört. Der Server selbst leitet alle übrigen
Ausgaben (auch Prisma) nach stderr um. MCP-Clients startet man am besten ohne
npm direkt mit `node`, wie unten.

**Claude Code:** Die Datei [.mcp.json](.mcp.json) im Projekt registriert den
Server `familytree-mock` — Mock-Datenbank, Benutzer `admin@example.test`,
nur lesend. Claude Code fragt beim ersten Öffnen des Projekts, ob es den Server
zulassen soll. Er wird mit `node scripts/mock.mjs mcp` gestartet (kein `npx`,
das unter Windows nur über `cmd /c` liefe).

**Gegen die echte Datenbank** einen eigenen Eintrag anlegen, am besten
benutzerbezogen statt im Projekt, z.B.:

```bash
claude mcp add stammbaum --scope user -e MCP_USER_EMAIL=deine@mail.de -- node C:/Pfad/zu/familiy-tree/node_modules/tsx/dist/cli.mjs C:/Pfad/zu/familiy-tree/mcp/server.ts
```

**Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json` unter
Windows):

```json
{
  "mcpServers": {
    "stammbaum": {
      "command": "node",
      "args": [
        "C:\\Pfad\\zu\\familiy-tree\\node_modules\\tsx\\dist\\cli.mjs",
        "C:\\Pfad\\zu\\familiy-tree\\mcp\\server.ts"
      ],
      "env": {
        "MCP_USER_EMAIL": "deine@mail.de",
        "MCP_ALLOW_WRITE": "false"
      }
    }
  }
}
```

`DATABASE_URL` kann zusätzlich in `env` stehen; sonst gilt die `.env` des
Projekts. **Schreiben freischalten:** `MCP_ALLOW_WRITE` auf `"true"` setzen und
den Client neu starten — die Schreibwerkzeuge erscheinen erst dann.

### Sicherheit

- Der Server hat **die Rechte des konfigurierten Benutzers** — nicht mehr, aber
  auch nicht weniger. Für reine Recherche einen Betrachter-Zugang verwenden;
  ein Administrator sieht und ändert alles, auch Personen ohne Familie.
- Er braucht **direkten Datenbankzugriff** (`DATABASE_URL` mit Zugangsdaten) und
  läuft deshalb lokal auf einem Rechner, der die Datenbank erreicht. Die
  Zugangsdaten nicht in eingecheckte Dateien schreiben.
- Alles, was der Assistent abruft, geht an den jeweiligen KI-Anbieter — bei
  lebenden Personen bedenken.
- Schreibzugriff ist standardmäßig aus. Jede Änderung landet im Audit-Log unter
  dem konfigurierten Benutzer; KI-Notizen sind mit „KI-Recherche“ und Datum
  gekennzeichnet. Personen löschen ist nicht möglich.

Tests: `tests/mcp.db.test.ts` startet den Server über stdio mit dem SDK-Client
gegen die Mock-Datenbank (alle Lesewerkzeuge als Admin, Maskierung als
Betrachter — auch bei familienübergreifenden Quellen —, Schreibwerkzeuge samt
ungenauer Daten, Quellen, Belegen und Audit-Log als Bearbeiter, Start wie in
`.mcp.json`) und überspringt sich ohne Mock-Datenbank.

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

## Schema und Migrationen

Das Schema liegt in `prisma/schema.prisma`, die Migrationen in
`prisma/migrations`:

| Migration | Inhalt |
|---|---|
| `0_init` | Ausgangsstand |
| `20261116000000_ungenaue_daten_und_quellen` | Genauigkeit/Zusatz für alle Daten (Spalten mit Standardwert), Tabellen `Source` und `Citation` — rein ergänzend, keine Datenumstellung |

Schemaänderungen künftig mit `npm run db:migrate` (`prisma migrate dev`) als
Migration anlegen und mit einchecken.

Der `migrate`-Container ([docker/migrate.sh](docker/migrate.sh)) entscheidet
beim Start anhand der Datenbank:

| Zustand | Vorgehen |
|---|---|
| leere Datenbank (Neuinstallation) | `prisma migrate deploy` |
| Datenbank mit Migrationshistorie | `prisma migrate deploy` |
| bestehende Installation ohne Historie (früher per `db push` angelegt) | wie bisher `prisma db push` |

Bestehende Installationen ändern ihr Verhalten also nicht von selbst.

**Update auf ungenaue Daten und Quellen:** Es ist nichts von Hand zu tun.
Eine per `db push` angelegte Installation bekommt die neuen Spalten (mit
Standardwerten, die den bisherigen Daten entsprechen) und die beiden neuen
Tabellen beim nächsten Start des `migrate`-Containers über `db push`; eine
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
```

Auf der NAS z.B. über `docker compose run --rm migrate sh` im
migrate-Container. Ab dann läuft dort beim Start `migrate deploy`.

Lokal (`docker-compose.dev.yml`) gilt dasselbe: `npm run db:push` bleibt
möglich; wer auf Migrationen umstellen will, baselinet wie oben.

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
User (= Allowlist) ──< AuditLog
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
