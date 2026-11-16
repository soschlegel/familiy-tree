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
| Betrieb | Docker Compose (Portainer), Images aus GitHub Actions über ghcr.io |

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

Liegt die Datenbank auf der NAS, ist sie standardmäßig von außen nicht
erreichbar — wie man sie bei Bedarf freischaltet, steht unter
[Datenbank vom PC aus (MCP)](#datenbank-vom-pc-aus-mcp).

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
        │    ghcr.io/soschlegel/familiy-tree-minio    (Objektspeicher, nur bei neuer Version)
        └─ setzt Branch "deploy" auf diesen Commit
Portainer (beobachtet "deploy") ─ lädt die Images ─ startet den Stack neu
```

Auf der NAS wird nichts gebaut, und der Stack braucht keine Dateien aus dem
Repository außer `docker-compose.yml` selbst.

**Dienste** ([docker-compose.yml](docker-compose.yml)):

| Dienst | Aufgabe |
|---|---|
| `db` | PostgreSQL 17, kein Port nach außen |
| `storage` | MinIO (Bilder), kein Port nach außen |
| `storage-init` | legt beim Start den Bucket an, beendet sich |
| `backup-db` | Datenbank-Dump nach `backups/` — bei jedem Start **vor** der Migration, und auf Abruf |
| `backup-media` | spiegelt die Bilder lesbar nach `backups/media` — bei jedem Start und auf Abruf |
| `migrate` | wendet Migrationen an, legt `INITIAL_ADMIN_EMAIL` als Admin an, beendet sich |
| `app` | die Anwendung; startet erst nach erfolgreichem `migrate`; Port `127.0.0.1:3080` für den Proxy |
| `proxy` | *optional* (Profil `caddy`): eigener Reverse-Proxy, falls keiner vorhanden ist |
| `db-access` | *optional* (Profil `db-access`): Datenbank für den MCP-Server am PC |

Alle Daten liegen als Bind-Mounts unter **einem** Pfad — genau dieses
Verzeichnis muss die NAS-Sicherung erfassen:

```
${DATA_ROOT}/              z.B. /volume1/docker/familytree
├── postgres/     Datenbank (gehört UID 70, Rechte 0700 — nicht ändern)
├── minio/        Originalbilder + Vorschauen (MinIO-internes Format)
├── backups/      db_<Datum>.sql.gz + media/ (lesbare Kopie der Bilder)
└── caddy/        nur mit Profil caddy: Zertifikate
```

Die Unterordner legt Docker beim ersten Start selbst an; vorher muss nur der
gemeinsame Ordner (bei Synology meist `docker`) existieren. Der
Postgres-Container stellt Besitzer und Rechte von `postgres/` selbst ein —
danach in der File Station **keine** Berechtigungen auf Unterordner anwenden,
sonst startet die Datenbank nicht mehr (Fehler „data directory has invalid
permissions“). Alle anderen Container laufen als root und brauchen nichts.
Auf einer Synology ist das nicht ausprobiert; siehe
[Fehlersuche](#fehlersuche).

### Erste Installation

Voraussetzungen: Portainer CE 2.19 oder neuer (Git-Stacks mit
Umgebungsvariablen und Docker Compose v2), ausgehender Internetzugang der NAS
(Images laden, OAuth-Anmeldung).

1. **Images bauen lassen.** Auf `main` pushen (oder unter *Actions → Images →
   Run workflow* von Hand starten) und warten, bis der Lauf grün ist. Der
   erste Lauf dauert länger, weil MinIO aus dem Quelltext gebaut wird. Danach
   gibt es den Branch `deploy`.
2. **Pakete freigeben.** Neue Pakete auf ghcr.io sind privat, auch bei einem
   öffentlichen Repository. Für jedes der drei Pakete (`familiy-tree`,
   `familiy-tree-migrate`, `familiy-tree-minio`): GitHub → Profil →
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
     Pflicht: `DATA_ROOT`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`,
     `S3_SECRET_KEY`, `AUTH_SECRET`, `PUBLIC_URL`, `INITIAL_ADMIN_EMAIL` und
     mindestens ein OAuth-Paar. Zufallswerte mit `openssl rand -hex 32` (für
     `AUTH_SECRET`: `openssl rand -base64 32`) — Passwörter nur aus
     Hex-Zeichen, weil `POSTGRES_PASSWORD` in einer URL steht.
     `ENABLE_DEV_LOGIN` **nicht** setzen (der Stack schaltet ihn ohnehin ab).
   - *Deploy the stack.*
6. **Start prüfen.** *Stacks → familytree*: `migrate` ist „exited“ mit
   Code 0 und zeigt im Log `[migrate] Fertig.`; `app` steht auf
   „healthy“. Auf der NAS: `curl http://127.0.0.1:3080/api/health` →
   `{"status":"ok"}`.
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
| Header | `Host` unverändert durchreichen; `X-Forwarded-For`/`-Proto` schaden nicht |
| WebSocket | nicht nötig |

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

### Datenbank vom PC aus (MCP)

Der [MCP-Server](#ki-recherche-über-mcp) braucht direkten Zugriff auf die
Datenbank. Standardmäßig ist sie von außen **nicht** erreichbar. Bei Bedarf:

1. Stack-Variablen `COMPOSE_PROFILES=db-access` und `DB_ACCESS_BIND=<LAN-IP
   der NAS>` (Port: `DB_ACCESS_PORT`, Standard `15432`) setzen, *Update the
   stack*. Der Dienst `db-access` leitet diesen Port an die Datenbank weiter;
   `db` selbst veröffentlicht weiterhin nichts.
2. Am PC: `DATABASE_URL=postgresql://familytree:<POSTGRES_PASSWORD>@<LAN-IP>:15432/familytree`
   in der MCP-Konfiguration (`env`) eintragen.
3. Danach Variablen wieder entfernen und *Update the stack* — `db-access`
   verschwindet.

Sicherheit: Das ist der Eigentümer-Zugang zur Datenbank — wer ihn hat, kann
alles lesen und ändern, an Rechteprüfung und Audit-Log vorbei. Nur auf die
LAN-IP binden, nie im Router freigeben, nur so lange wie nötig. Über VPN
verbundene Geräte erreichen ihn ebenfalls. Vorsichtiger: `DB_ACCESS_BIND`
auf `127.0.0.1` lassen und per SSH-Tunnel zugreifen
(`ssh -N -L 15432:127.0.0.1:15432 <benutzer>@<nas>`, dann
`@localhost:15432` in der URL) — setzt SSH auf der NAS mit erlaubter
Portweiterleitung voraus (bei DSM nicht geprüft).

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
| `app` „unhealthy“ | `docker logs familytree-app-1`; `/api/health` meldet nur, ob die Datenbank antwortet |
| Anmeldung: GitHub „redirect_uri is not associated“ / Google „redirect_uri_mismatch“ | Callback-URL beim Anbieter ≠ `<PUBLIC_URL>/api/auth/callback/…` (Schema, Port, Schreibweise) |
| Klick auf „Anmelden mit …“ tut nichts, Log „Invalid Server Actions request“ | Proxy reicht `Host` nicht durch |
| Nach der Anmeldung wieder auf `/login` | Seite über eine andere Adresse als `PUBLIC_URL` aufgerufen, oder `https://`-`PUBLIC_URL` über `http://` geöffnet |
| „Anmeldung fehlgeschlagen … nicht freigeschaltet“ | E-Mail des Kontos steht nicht in der Benutzerliste (oder gesperrt); bei falscher OAuth-Konfiguration erscheint dieselbe Meldung — dann das Log von `app` lesen |
| Upload bricht ab, 413 | Upload-Limit des Proxys (siehe Tabelle oben) |
| Port 3080 belegt | `APP_PORT` ändern und im Proxy anpassen |

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

**Update auf ungenaue Daten und Quellen:** Es ist nichts von Hand zu tun.
Eine per `db push` angelegte Installation bekommt die neuen Spalten (mit
Standardwerten, die den bisherigen Daten entsprechen) und die beiden neuen
Tabellen beim nächsten Start des `migrate`-Containers über `db push` (rein
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

Zwei Dienste im Stack erledigen die Sicherung nach `${DATA_ROOT}/backups`:

- `backup-db` — `pg_dump` der Datenbank als `db_<Datum>_<Zeit>.sql.gz`
  (mit `--clean --if-exists`, also direkt wieder einspielbar). Löscht Dumps,
  die älter als `BACKUP_KEEP_DAYS` (Standard 30) Tage sind.
- `backup-media` — spiegelt den Bucket nach `backups/media` (lesbare
  Dateien statt MinIO-internem Format; im Bucket gelöschte Bilder
  verschwinden auch aus dem Spiegel).

Beide laufen **bei jedem Stack-Start** — `backup-db` vor der Migration, damit
es zu jedem Update eine Sicherung vom Stand davor gibt. Mehrere Updates am
Tag ergeben entsprechend mehrere Dumps.

**Täglich planen (Synology):** Systemsteuerung → Aufgabenplaner → Erstellen →
Geplante Aufgabe → Benutzerdefiniertes Script; Benutzer `root`; Zeitplan
z.B. täglich 03:00; Script:

```sh
docker start -a familytree-backup-db-1 && docker start -a familytree-backup-media-1
```

Das startet nur die vorhandenen Container erneut — es braucht weder eine
Repo-Kopie noch `docker compose` auf der NAS. `-a` hängt die Ausgabe ans
Aufgabenprotokoll; ein Fehlschlag lässt die Aufgabe fehlschlagen (Mail-
Benachrichtigung im Aufgabenplaner einschalten). Mit Repo-Kopie geht
dasselbe über `./scripts/backup.sh [Stackname]`.

**NAS-Sicherung (Hyper Backup o.ä.):** `${DATA_ROOT}` vollständig sichern.
Maßgeblich sind die Dumps in `backups/` — die Rohdateien unter `postgres/`
sind im laufenden Betrieb nur zusammen mit einem Snapshot (Btrfs) konsistent.
Zusätzlich ist der ZIP-Export unter `/admin/data` ein vollständiges,
instanzunabhängiges Backup ([Austauschformat](#austauschformat)).

### Wiederherstellung

Beispiel für Stack `familytree` und `DATA_ROOT=/volume1/docker/familytree`,
per SSH als root auf der NAS. Funktioniert genauso auf einer frisch
installierten NAS (erst den Stack wie oben deployen).

```sh
# 1. App anhalten
docker stop familytree-app-1

# 2. Datenbank: Schema leeren, Dump einspielen
docker exec -i familytree-db-1 psql -U familytree -d familytree -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c /volume1/docker/familytree/backups/db_2026-11-16_030000.sql.gz \
  | docker exec -i familytree-db-1 psql -U familytree -d familytree -v ON_ERROR_STOP=1 -q

# 3. Bilder zurück in den Bucket (Schlüssel wie in den Stack-Variablen)
docker run --rm --network familytree_default \
  -v /volume1/docker/familytree/backups/media:/restore:ro \
  -e S3_ACCESS_KEY=… -e S3_SECRET_KEY=… \
  --entrypoint sh ghcr.io/soschlegel/familiy-tree-minio:RELEASE.2025-10-15T17-29-55Z -c \
  'mc alias set local http://storage:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null &&
   mc mirror --overwrite /restore local/familytree'

# 4. Wieder starten — Portainer: Stacks → familytree → "Update the stack"
#    (sichert den eingespielten Stand, wendet ggf. neuere Migrationen an,
#    startet die App). Stammt der Dump vom selben Programmstand, genügt
#    auch: docker start familytree-app-1
```

Ist der Dump älter als der aktuelle Programmstand, holt `migrate` beim
nächsten Stack-Start die fehlenden Migrationen nach.

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
