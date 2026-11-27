# Dienstschicht (`lib/services/`)

Fachlich-technische Beschreibung jedes Moduls der Dienstschicht. Code bleibt
die Wahrheit: Weicht er von dieser Beschreibung ab, gilt der Code, und diese
Datei wird berichtigt (siehe `AGENTS.md`, Abschnitt 1).

Verwandte Beschreibungen: [datenmodell.md](datenmodell.md) (Tabellen),
[bibliotheken.md](bibliotheken.md) (reine Regeln in `lib/*.ts`, z.B.
`lib/scope.ts`, `lib/audit.ts`, `lib/merge-rules.ts`, `lib/duplicates.ts`),
[seiten-und-api.md](seiten-und-api.md) (Seiten und Route-Handler),
[mcp.md](mcp.md) (KI-Zugang), [betrieb-und-tests.md](betrieb-und-tests.md).

## Zweck

Die Dienstschicht enthält die gemeinsame Geschäftslogik der App. Dieselben
Funktionen bedienen

- die **Route-Handler** unter `app/api/**` (über `route()` in `lib/api.ts`),
- die **Server-Komponenten** der Seiten (`app/**/page.tsx`, einzelne
  Server-Komponenten in `components/`),
- den **MCP-Server** (`mcp/tools.ts`, `mcp/http.ts`, `mcp/server.ts`),
- Tests und Skripte in einem einfachen Node-Prozess.

Validierung, Rechteprüfung und Protokoll liegen deshalb an genau einer Stelle.
Kein Dienst importiert `next/*` oder `lib/auth.ts`; außerhalb von Next.js
liefert `scopeForEmail()` (`context.ts`) bzw. `authorizeAiCall()`
(`ai-access.ts`) den Scope.

**Rechte über den Scope.** Jede Funktion bekommt einen `Scope`
(`lib/scope.ts`): Benutzer-ID, Administrator ja/nein, Rolle je Familie
(lesen/bearbeiten) und optional `via` (Kanal MCP, Schlüssel, Stufe) sowie das
Changelog-Paket. Die Grundregeln: Eine Person ist sichtbar, wenn der Benutzer
eine ihrer Familien kennt (Personen ohne Familie nur für Administratoren),
bearbeitbar, wenn er in einer davon Bearbeitungsrecht hat. Eine Beziehung ist
sichtbar, sobald eine Seite sichtbar ist, und änderbar nach
`canEditRelationshipBetween` (Bearbeitungsrecht an einer Seite, Sicht auf
beide). Ereignisse, Belege, Namen und Rohdaten folgen ihrem Träger.

## Konventionen

- **Eingaben als `unknown`.** Schreibende Dienste nehmen die Rohdaten der
  Anfrage entgegen und validieren selbst mit Zod-Schemata aus
  `lib/validation.ts` (bzw. lokalen Schemata); `parseOrThrow` wandelt
  Fehlschläge in `VALIDATION`.
- **Fehlerklassen** (`errors.ts`): `ServiceError` mit Code `NOT_FOUND`,
  `FORBIDDEN`, `CONFLICT`, `VALIDATION`; `lib/api.ts` bildet sie auf 404, 403,
  409, 400 ab, `mcp/tools.ts` auf eigene Fehlerantworten.
  **Unsichtbar = nicht vorhanden:** Eine Person, Beziehung, Quelle usw., die
  der Benutzer nicht sehen darf, ergibt `NOT_FOUND` (nie `FORBIDDEN`), damit
  ihre Existenz nicht bestätigt wird. Lesende Einzelabfragen liefern statt
  eines Fehlers `null`.
- **Datumswerte** gehen als ISO-String hinaus, daneben Genauigkeit
  (`…Precision`), Zusatz (`…Qualifier`), Bereichsende (`…To`) und Wortlaut
  (`…Phrase`); siehe `dto.ts` und `lib/dates.ts`. Bei Teil-Updates wird der
  Wortlaut verworfen, wenn sich das Datum ohne neuen Wortlaut ändert
  (`phraseColumns` in `persons.ts`).
- **Protokoll (Audit).** Jede Änderung schreibt einen `AuditLog`-Eintrag über
  `audit({ ...auditActor(scope), action, entityType, entityId, diff })` aus
  `lib/audit.ts`. `auditActor` trägt Benutzer, Kanal (App oder MCP) und
  Schlüssel ein. Bei Änderungen steht im `diff` je Feld vorher → nachher
  (`fieldChanges`, ungenaue Daten in Anzeigeform); ein Eintrag ohne echte
  Änderung wird nicht geschrieben. `audit()` ist fehlertolerant (ein
  kaputtes Audit rollt die Änderung nicht zurück). Dienste, die selbst in
  einer Transaktion schreiben (Zusammenführen, Massenimport, Orte), bauen die
  Zeile mit `auditData` und schreiben sie in derselben Transaktion — dort
  scheitert die Änderung, wenn das Audit scheitert.
- **Changelog-Pakete (`ChangeSet`, `lib/change-sets.ts`).** Eine API-Anfrage
  ist ein Paket; größere Aktionen geben ihm mit `nameChangeSet` einen Titel
  und eine Art (z.B. „Personen zusammengeführt“/MERGE, „GEDCOM-Import …“/
  IMPORT, „Importe verbinden …“/CONNECT, „Orte automatisch zugeordnet“).
  Der erste Aufruf gewinnt, deshalb benennt das Sammel-Zusammenführen sein
  Paket, bevor die einzelnen Zusammenführungen es versuchen. Ohne Titel ergibt
  er sich aus dem ersten Eintrag. Über MCP bündelt `mcpChangeSet` (in
  `mcp/tools.ts` aufgerufen) die Änderungen.
- **Transaktionen.** Einfache CRUD-Dienste schreiben ohne explizite
  Transaktion (eine Anweisung, dann Audit). Explizit transaktional sind:
  Zusammenführen (`mergePersons`, je Paar eine Transaktion mit
  Advisory-Lock je Person), Massenimport (`applyGenealogyImport`, bis
  5 Minuten), GEDCOM-Import (`applyGedcomImport`, bis 10 Minuten, Lock je
  Lauf), Bilder (`addMedia`, `linkMedia`, `unlinkMedia`), Familienzuordnung
  (`setPersonFamilies`), Orte (Aktualisierungen stückweise).
- **Bilder aufräumen.** Wer Personen, Beziehungen, Ereignisse, Belege oder
  Quellen löscht, merkt sich vorher die angehängten Bilder und entfernt danach
  mit `removeOrphanedMedia` (`media.ts`) die, die an nichts mehr hängen.

## Übersicht

| Modul | Zweck |
|---|---|
| `index.ts` | Sammel-Export der meisten Dienste (`@/lib/services`) |
| `errors.ts` | `ServiceError` und Hilfen für die vier Fehlerklassen |
| `dto.ts` | Serialisierbare Darstellungen (Person, Beziehung) und Umwandler |
| `context.ts` | Scope zu einem Benutzer (E-Mail bzw. ID) außerhalb von Next.js |
| `graph-data.ts` | Ganzen Graphen samt Sichtbarkeit je Person laden |
| `tree.ts` | Baumdaten mit Platzhaltern, Fokus-Ausschnitt |
| `persons.ts` | Personensuche, Personendetail, Personen anlegen/ändern/löschen, Familienzuordnung |
| `relationships.ts` | Beziehungen anlegen/ändern/löschen mit allen Strukturregeln |
| `events.ts` | Lebensereignisse an Person bzw. Beziehung |
| `names.ts` | Weitere Namen einer Person |
| `sources.ts` | Quellen und Belege |
| `attached-media.ts` | Bilder an Ereignissen, Belegen, Quellen lesen; „Belegbild“-Regel |
| `media.ts` | Verwaiste Bilder löschen, angehängte Bilder ermitteln |
| `media-links.ts` | Bilder anlegen (Upload, base64, Adresse), verknüpfen, lösen |
| `families.ts` | Familienliste des Benutzers |
| `research.ts` | Vorfahren, Nachfahren, Verbindungsweg, Statistik, Datenlücken |
| `kinship.ts` | Verwandtschaftsbezeichnung zweier Personen |
| `kinship-view.ts` | Seite „Wie sind wir verwandt?“: Bezeichnung in beide Richtungen, Verbindungen als Ketten, nur über sichtbare Personen |
| `timeline.ts` | Zeitleiste einer Person bzw. Familie |
| `consistency.ts` | Plausibilitätsprüfung über sichtbare Daten |
| `duplicates.ts` | Mögliche Dubletten (Liste, je Person), „kein Duplikat“ |
| `merge.ts` | Zwei Personen zusammenführen (Vorschau, Ausführen) |
| `merge-bulk.ts` | Sichere Dubletten in einem Rutsch zusammenführen |
| `merge-followups.ts` | Folgedubletten nach einem Zusammenführen (Eltern, Partner, Kinder der bleibenden Person) |
| `redirects.ts` | Alte Kennung als Umleitung: anlegen, auflösen, Rückfüllung aus dem Audit |
| `reference.ts` | Bezugsperson („das bin ich“), Verwandtschaft und Linien |
| `map.ts` | Daten der Karte „Wurzeln nach Jahr“ |
| `places.ts` | Ortstexte → Koordinaten (Ortszuordnung, nur Admin) |
| `place-areas.ts` | Ortstexte → Land bzw. Region (eine Abfrage, für Auswertungen) |
| `roots.ts` | „Wurzeln“ einer Person: Anteile der Länder/Regionen ihrer Vorfahren |
| `ancestor-rings.ts` | Ansicht „Ringe“: Vorfahren einer Person auf festen Plätzen, generationsweise geladen; gemeinsame Personenangaben und Legende „nach Wurzeln“ für beide Richtungen |
| `descendant-rings.ts` | Ansicht „Ringe“, Richtung „Nachfahren“: Nachkommen einer Person, Vollkreis nach Teilbaumgröße, generationsweise geladen |
| `statistics.ts` | Seite „Statistik“: sichtbaren Teil des Stammbaums schlank laden und auswerten, Familienfilter (`familyFilter`, auch für die Rekorde) |
| `records.ts` | Seite „Rekorde“: sichtbaren Teil des Stammbaums schlank laden, Bestwerte mit Namen berechnen, Familienfilter |
| `research-progress.ts` | Seite „Forschungs-Fortschritt“: Vorfahren der Ausgangsperson generationsweise laden, Belege in einer Abfrage, Vollständigkeit, Qualität und Vorschläge |
| `today.ts` | Startseite „Heute in der Familie“: Jahrestage, Geburtstage und runde Jahrestage aus sichtbaren, tagesgenauen Daten |
| `changes.ts` | Änderungsgeschichte lesen (Personenverlauf, Paketübersicht) |
| `ai-access.ts` | KI-Recht, persönliche Schlüssel, Prüfung je MCP-Aufruf |
| `imports.ts` | Importläufe, Herkunft, Fremdkennungen, Rohdaten |
| `origin.ts` | Herkunft sichtbar machen: Buchstabe/Farbe/Name je Import, Herkunft im Baum, auf der Personenseite, Übersicht, Importe benennen |
| `import-apply.ts` | Massenimport in einer Transaktion |
| `gedcom-import.ts` | GEDCOM-Import mit Vorschau und Abgleich |
| `import-suggestions.ts` | Vorschläge beim GEDCOM-Import: neue Personen der Datei gegen den Bestand (Abgleich wie „Importe verbinden“) |
| `gedcom-photos.ts` | Fotos aus einer GEDCOM-Datei herunterladen |
| `import-jobs.ts` | GEDCOM-Import im Hintergrund ausführen |
| `import-linking.ts` | „Importe verbinden“ (Abgleich und Zusammenführen im Hintergrund) |
| `exchange-export.ts` | Export (JSON/ZIP) des sichtbaren Bestands |
| `gedcom-export.ts` | GEDCOM-Export (Datei bzw. ZIP mit Bildern) |
| `export-selection.ts` | Familienauswahl für den GEDCOM-Export |
| `release-notes.ts` | Neuigkeiten: zuletzt gesehenes Release je Benutzer merken |
| `settings.ts` | Einstellungen der Installation: wirksamen Wert lesen (App vor Umgebung), pflegen (nur Admin) |

---

## Grundbausteine

### lib/services/index.ts

**Zweck:** Sammel-Einstieg `@/lib/services`. Beschreibt im Kopfkommentar die
Grundsätze der Schicht (reine async-Funktionen, Scope, kein `next/*`,
`ServiceError`, lesende Einzelabfragen liefern `null`).

**Wichtige Funktionen:** keine eigenen; reicht `errors`, `dto`, `context`,
`tree`, `persons`, `relationships`, `research`, `duplicates`, `merge`,
`merge-bulk`, `families`, `kinship`, `kinship-view`, `reference`, `timeline`, `consistency`,
`sources`, `ai-access`, `events`, `names`, `imports`, `import-apply`,
`changes`, `media-links`, `attached-media`, `release-notes`, `origin` weiter, aus `graph-data` nur
`loadGraph` und die Graph-Typen.

**Regeln und Entscheidungen:** Nicht über den Sammel-Export erreichbar sind
`map`, `life-path`, `places`, `export-selection`, `exchange-export`, `gedcom-export`,
`gedcom-import`, `gedcom-photos`, `import-jobs`, `import-linking`,
`import-suggestions` und `media`;
sie werden mit ihrem Pfad importiert (z.B. `@/lib/services/map`). Warum
gerade diese, ist im Code nicht begründet (unklar; vermutlich, um schwere
Abhängigkeiten wie JSZip, GEDCOM-Parser und Ortsverzeichnis nicht überall
mitzuladen).

**Rechte/Datenschutz, Protokoll:** —

**Benutzt von:** fast allen Route-Handlern und Seiten, `mcp/tools.ts`,
`mcp/http.ts`, `mcp/server.ts`, Tests.

**Tests:** indirekt über alle Dienst-Tests.

### lib/services/errors.ts

**Zweck:** Fehler der Dienstschicht ohne Bezug zu HTTP.

**Wichtige Funktionen:**
- `ServiceError` — Fehler mit `code` (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`,
  `VALIDATION`), optional `issues` (Pfad + Meldung je Feld) und `details`
  (z.B. Blocker beim Zusammenführen, Grund bei Bildfehlern).
- `notFoundError(was)`, `forbiddenError(was)`, `conflictError(meldung,
  details)` — fertige Fehler mit deutscher Meldung („… nicht gefunden“,
  „Keine Berechtigung für: …“).
- `validationError(issues)` — normalisiert Pfade (Text oder Liste) und nimmt
  die erste Meldung in den Fehlertext.
- `parseOrThrow(zodErgebnis)` — liefert die Daten oder wirft `VALIDATION`.

**Regeln und Entscheidungen:** `NOT_FOUND` gilt ausdrücklich auch für
Personen, die der Benutzer nicht sehen darf — ein eigener Code würde ihre
Existenz bestätigen.

**Rechte/Datenschutz:** siehe oben. **Protokoll:** —

**Benutzt von:** allen Diensten; `lib/api.ts` (Statuscodes), `mcp/tools.ts`,
`app/api/import/gedcom/route.ts`, `app/api/import/batches/prune/route.ts`.

**Tests:** indirekt in fast allen `tests/*.db.test.ts` (Erwartung der Codes,
z.B. `tests/services.db.test.ts`, `tests/sources.db.test.ts`).

### lib/services/dto.ts

**Zweck:** Serialisierbare Darstellungen, die die Dienste zurückgeben, und
ihre Umwandler. Datumswerte stehen als ISO-String darin; angezeigt werden
sollen sie immer über `formatFuzzyDate`/`lifeSpan` (sonst wird „1850“ zu
„01.01.1850“).

**Wichtige Funktionen:**
- `toPersonSummary(scope, person, {familyIds, primaryMediaId})` — volle
  Angaben einer sichtbaren Person.
- `toPersonBrief(p)` — Kurzform für Listen (Name, Geschlecht, Lebensdaten,
  Bereichsende nur bei Bereichen).
- `toPersonRef(sichtbar, p)` — Kurzform oder anonymer Platzhalter
  (`maskPerson`).
- `toRelationshipDto(r)` — Beziehung samt allen Datumsfeldern und Orten.
- `lifeDatePrecision(p)` — fehlende Genauigkeit/Zusatz = tagesgenau/exakt.
- `iso(d)`, `fullName(p)`, `MANUAL_ORIGIN_LABEL` („von Hand erfasst“).
  Wie ein Import genannt wird (Buchstabe, Anzeigename, Dateiname nur für
  Administratoren), sagt seit dem Paket „Herkunft“ allein
  `loadImportDirectory` in `origin.ts`; das frühere `importLabel` ist
  entfallen.

**Regeln und Entscheidungen:** `restricted: false` kennzeichnet sichtbare
Personen; Platzhalter tragen `restricted: true` (aus `lib/scope.ts`).

**Rechte/Datenschutz:** `toPersonSummary` gibt nur die Familien heraus, die
der Benutzer selbst kennt (`visibleFamilyIds`).

**Protokoll:** —

**Benutzt von:** den meisten Diensten; `fullName` und `iso` auch in Seiten,
Komponenten, `mcp/format.ts`, `mcp/tools.ts` und mehreren `lib/*`-Modulen.

**Tests:** keine eigenen; indirekt über alle Dienst-Tests.

### lib/services/context.ts

**Zweck:** Scope für Aufrufer außerhalb von Next.js.

**Wichtige Funktionen:**
- `scopeForEmail(email)` — sucht den Benutzer (E-Mail getrimmt, klein) und
  lädt seinen Scope.

**Regeln und Entscheidungen:** Unbekannte und gesperrte (`BLOCKED`) Benutzer
ergeben `null` — dieselbe Regel wie bei der Anmeldung.

**Rechte/Datenschutz:** Der Scope enthält kein `via`; Aufrufe damit laufen im
Protokoll als Kanal „App“.

**Protokoll:** —

**Benutzt von:** ausschließlich Tests (`scopeForEmail` in fast allen
`tests/*.db.test.ts`). Der MCP-Server
nutzt stattdessen `authorizeAiCall` (`ai-access.ts`).

**Tests:** Hilfsfunktion der Tests, nicht selbst getestet.

### lib/services/graph-data.ts

**Zweck:** Lädt den kompletten Stammbaumgraphen in zwei Abfragen (alle
Personen mit Lebensdaten, Hauptbild, Familien; alle Beziehungen mit Daten,
Orten, Hauptbild) und berechnet je Person `visible`.

**Wichtige Funktionen:**
- `loadGraph(scope)` — liefert `persons` (Map), `relationships` und einen
  Index (`buildGraphIndex` aus `lib/graph.ts`) für Eltern/Kinder/Partner.

**Regeln und Entscheidungen:** Bewusst ein einziger Ladevorgang statt vieler
Einzelabfragen — bei Familienstammbäumen (bis rund 1000 Personen) schneller
und einfacher korrekt zu halten. Die Grenze dieses Ansatzes beschreibt das
`docs/fachlich/fokus-ansicht.md` („Grenzen“).

**Rechte/Datenschutz:** Die Struktur (wer mit wem verbunden ist) bleibt
vollständig; die Angaben einer Person dürfen das Ergebnis nur verlassen, wenn
`visible` gesetzt ist — dafür sorgen die aufrufenden Dienste. Notizen werden
nur als „hat Notizen“ (`hasNotes`) geladen.

**Protokoll:** —

**Benutzt von:** `tree.ts`, `research.ts`, `kinship.ts`, `timeline.ts`,
`consistency.ts`, `duplicates.ts`, `reference.ts`, `map.ts`; direkt in
`app/tree/page.tsx` (ein Ladevorgang für Baum und Bezugsperson).

**Tests:** `tests/reference.db.test.ts`; indirekt über alle Graph-Dienste.

---

## Baum, Personen, Beziehungen

### lib/services/tree.ts

**Zweck:** Daten für die Baumansicht — der ganze Graph mit Platzhaltern bzw.
ein Ausschnitt um eine Fokusperson.

**Wichtige Funktionen:**
- `loadTree(scope, graph?)` — alle Personen (sichtbare mit Angaben,
  unsichtbare als Platzhalter) und alle Beziehungen.
- `loadFocusTree(scope, {focusId, up, down, fallback, graph})` — Ausschnitt
  für die Fokus-Ansicht (`focusSubgraph` aus `lib/focus-tree.ts`) samt
  Zählern (sichtbar, verborgen, Beziehungen). Ohne `focusId` die Startperson
  (`defaultFocusId`); unbekannte oder gesperrte `focusId` ergibt `notFound`,
  außer `fallback` ist gesetzt (z.B. gemerkte Person aus einem Cookie), dann
  die Startperson.

**Regeln und Entscheidungen:** Gesperrte Personen bleiben als Platzhalter
stehen, damit der Baum zusammenhängt und Kinder nicht ohne Eltern dastehen.
Unbekannt und gesperrt sehen bei `loadFocusTree` gleich aus. Der Ausschnitt
baut auf demselben maskierten Graphen auf wie `loadTree`, kann also nichts
zeigen, was dort nicht steht.

**Rechte/Datenschutz:** Art, Datum und Bild einer Beziehung erscheinen nur,
wenn wenigstens eine Seite sichtbar ist; sonst ein neutraler Platzhalter
(„leiblich“ bzw. „unverheiratet“, keine Daten). Familien je Person nur, soweit
der Benutzer sie kennt.

**Protokoll:** —

**Benutzt von:** `app/tree/page.tsx`, `app/api/tree/route.ts`
(`lib/focus-tree.ts` nennt `loadTree` als Grundlage).

**Tests:** `tests/focus.db.test.ts`, `tests/focus.test.ts`,
`tests/services.db.test.ts`, `tests/import-linking.db.test.ts`;
`e2e/read/tree-focus.spec.ts`, `e2e/read/tree-whole.spec.ts`,
`e2e/read/permissions.spec.ts`.

### lib/services/persons.ts

**Zweck:** Personensuche, Personendetail und alle Mutationen an Personen
einschließlich Familienzuordnung.

**Wichtige Funktionen:**
- `searchPersons(scope, {q, familyId, bornFrom, bornTo, place, gender,
  deceased, sort, limit, offset})` — sichtbare Personen; jedes Wort (höchstens
  8) muss in Vor-, Nach-, Geburts- oder Rufname bzw. einem weiteren Namen
  vorkommen; Ort sucht in Geburts-/Sterbeort, Ereignisorten, Heirats-/
  Scheidungsorten und Ereignisorten der Beziehungen. Sortierung nach Name,
  Geburt auf-/absteigend oder zuletzt geändert; höchstens 1000 je Seite
  (`MAX_PAGE_SIZE`). Ergebnis: Liste mit Beziehungszahl und Gesamtzahl.
- `getPersonDetail(scope, id)` — Person mit Familien, Bildern, Beziehungen
  (Eltern, Kinder, Partner, auch als Gesamtliste), Geschwistern (voll/halb,
  über die Eltern ermittelt, ohne den ganzen Graphen), Belegen
  (`listPersonCitations`), Ereignissen der Person und ihrer Beziehungen samt
  Bildern, weiteren Namen und `canEdit`. `null`, wenn es sie nicht gibt oder
  sie unsichtbar ist.
- `listPickablePersons(scope, {excludeId})` — sichtbare Personen als
  Auswahlliste (Suchfeld beim Zuordnen).
- `createPerson(scope, input)` — legt eine Person an.
- `updatePerson(scope, id, patch)` — Teil-Update.
- `deletePerson(scope, id, {force})` — löscht eine Person.
- `setPersonFamilies(scope, id, familyIds)` — setzt die
  Familienzugehörigkeit.
- `phraseColumns(vorher, daten, schlüssel)` — Wortlaut-Regel für
  Teil-Updates, auch von `relationships.ts` und `sources.ts` benutzt.

**Regeln und Entscheidungen:**
- **Anlegen:** Nicht-Admins müssen die Person einer Familie zuordnen, in der
  sie Bearbeitungsrecht haben; ohne Angabe landet sie in der ersten
  bearbeitbaren Familie (sonst wäre sie für den Anlegenden sofort unsichtbar).
  Ohne jede bearbeitbare Familie: `FORBIDDEN`. Unbekannte Familie:
  `VALIDATION`.
- **Ändern:** Die Datumsregeln (`personDateIssues`, z.B. Tod nicht vor Geburt)
  werden auf dem zusammengeführten Stand geprüft — sonst ließe sich ein
  Sterbedatum vor dem Geburtsdatum in zwei Schritten eintragen.
- **Löschen:** Hat die Person Beziehungen, ist `force` nötig (sonst
  `CONFLICT` mit der Zahl der Beziehungen), weil das Löschen per Cascade alle
  Beziehungen mitnähme. Bilder der Person, ihrer Beziehungen, Ereignisse und
  Belege werden danach als Waisen entfernt.
- **Familien setzen — Selbstaussperren:** Nicht-Admins dürfen nur Familien
  hinzufügen bzw. entfernen, in denen sie Bearbeitungsrecht haben. Familien,
  die sie gar nicht kennen, bleiben in jedem Fall erhalten (sie bekommen sie
  nicht angezeigt und können sie nicht mitschicken). Mindestens eine Familie
  mit eigenem Bearbeitungsrecht muss bleiben, sonst `VALIDATION` — der Benutzer
  könnte die Person sonst weder ändern noch löschen. Für Administratoren gilt
  das nicht.

**Rechte/Datenschutz:** Suche und Auswahlliste liefern nur sichtbare
Personen; eine fremde Familie als Filter ergibt eine leere Liste, keinen
Fehler (sonst ließe sich ihre Existenz abfragen). Im Detail erscheinen
Verwandte, die der Benutzer nicht sehen darf, als Platzhalter; Familien nur,
soweit er sie kennt. Ereignisse an Beziehungen sind änderbar nach
`canEditRelationshipBetween`. Mutationen: unsichtbar → `NOT_FOUND`, nicht
bearbeitbar → `FORBIDDEN`. `setPersonFamilies` gibt nur die bekannten
Familien zurück.

**Protokoll:** `CREATE Person` (Spalten und Familien), `UPDATE Person` mit
Feldänderungen (nur bei echter Änderung), `DELETE Person` (Name als
`subject`, Zahl der Beziehungen, entfernte Bilder; die früheren Familien
werden mitgegeben, damit die Familienübersicht den Eintrag findet),
`UPDATE Person` beim Familienwechsel mit alten und neuen Familien (auch die
verlassenen sehen die Änderung).

**Benutzt von:** `app/api/persons/route.ts`, `app/api/persons/[id]/route.ts`,
`app/api/persons/[id]/families/route.ts`, `app/people/page.tsx`,
`app/people/[id]/page.tsx`, `app/admin/users/page.tsx`
(`listPickablePersons`); `events.ts` (Typen), `gedcom-import.ts` und
`imports.ts` (Löschen); MCP: `search_persons`, `get_person`, `create_person`,
`update_person`, `set_person_families`, `link_media` (Detail zur Ausgabe).

**Tests:** `tests/services.db.test.ts`, `tests/genealogy.db.test.ts`,
`tests/research.db.test.ts`, `tests/sources.db.test.ts`,
`tests/media-cleanup.db.test.ts`, `tests/changelog.db.test.ts`,
`tests/ai-access.db.test.ts`, MCP-Tests (`tests/mcp.db.test.ts`,
`tests/mcp-http.db.test.ts`); `e2e/write/person-lifecycle.spec.ts`,
`e2e/read/people-list.spec.ts`, `e2e/read/person-families.spec.ts`.

### lib/services/relationships.ts

**Zweck:** Beziehungen (Eltern-Kind, Partnerschaft) anlegen, ändern und
löschen — mit allen Strukturregeln.

**Wichtige Funktionen:**
- `createRelationship(scope, input)` — neue Beziehung. Eine Person, die der
  Benutzer nicht sehen darf, gilt wie eine nicht vorhandene (`NOT_FOUND`,
  nicht `FORBIDDEN` — sonst verriete die Antwort, dass es sie gibt).
- `updateRelationship(scope, id, patch)` — Art, Zeitraum, Orte, Notiz ändern.
- `deleteRelationship(scope, id)` — Beziehung löschen; mit ihr gehen
  (Cascade) ihre Ereignisse und Belege, deren danach verwaiste Bilder
  werden ebenfalls entfernt. Über den KI-Zugang abgelehnt (`CONFLICT`,
  `WOULD_DELETE_MEDIA`), wenn dabei ein Bild verloren ginge.
- `wouldCreateCycle(elternId, kindId)` — prüft ebenenweise in der Datenbank,
  ob der Elternteil schon Nachfahre des Kindes ist. (Nicht zu verwechseln mit
  der gleichnamigen Funktion in `lib/graph.ts`, die im Speicher arbeitet.)

**Regeln und Entscheidungen:**
- Art muss zum Typ passen, Daten plausibel (`lib/validation.ts`).
- Höchstens zwei **leibliche** Eltern (`MAX_BIOLOGICAL_PARENTS`), sonst
  `CONFLICT` mit dem Hinweis auf Adoptiv-, Stief- oder Pflegeeltern; auch
  beim Ändern einer Art auf „leiblich“ geprüft.
- Keine Zyklen, keine Partnerschaft zwischen Elternteil und Kind, kein
  Elternteil, der schon Partner ist, keine doppelte Beziehung (auch nicht in
  umgekehrter Richtung) — jeweils `CONFLICT`.
- Partnerschaften werden kanonisch gespeichert (kleinere ID zuerst), damit
  die Eindeutigkeitsregel der Tabelle beide Richtungen abdeckt.
- Die verknüpften Personen sind beim Ändern fest: eine falsche Zuordnung wird
  gelöscht und neu angelegt, nicht umgebogen. Datumsregeln laufen auf dem
  zusammengeführten Stand.
- Beim Löschen werden die Bilder der Beziehung (Hochzeitsfotos) als Waisen
  entfernt.

**Rechte/Datenschutz:** Administratoren dürfen alles. Sonst gilt: Ist keine
der beiden Personen sichtbar, gilt die Beziehung als nicht vorhanden
(`NOT_FOUND`); ändern darf, wer `canEditRelationshipBetween` erfüllt.

**Protokoll:** `CREATE Relationship` (alle Felder), `UPDATE Relationship`
mit Feldänderungen, `DELETE Relationship` (vorheriger Stand, entfernte
Bilder).

**Benutzt von:** `app/api/relationships/route.ts`,
`app/api/relationships/[id]/route.ts`; `gedcom-import.ts` (Löschen auf
Wunsch); MCP: `create_relationship`, `update_relationship`,
`delete_relationship`.

**Tests:** `tests/services.db.test.ts`, `tests/genealogy.db.test.ts`,
`tests/media-cleanup.db.test.ts`, `tests/merge.db.test.ts`,
`tests/reference.db.test.ts`, `tests/changelog.db.test.ts`, MCP-Tests;
`e2e/write/genealogy.spec.ts`, `e2e/write/person-lifecycle.spec.ts`.
`wouldCreateCycle` dieses Moduls hat keinen eigenen Test
(`tests/graph.test.ts` prüft die Variante aus `lib/graph.ts`).

### lib/services/events.ts

**Zweck:** Lebensereignisse (Taufe, Beruf, Wohnort, Beerdigung, Verlobung …)
an einer Person oder Beziehung. Welche Angabe wo steht, regelt
`lib/events.ts`.

**Wichtige Funktionen:**
- `listPersonEvents(scope, personId)`, `listRelationshipEvents(scope,
  relationshipId)` — Ereignisse samt Bildern, sortiert; `null` bei
  unsichtbarem Träger.
- `getEvent(scope, id)` — ein Ereignis (ohne Bilder); `null`, wenn es fehlt
  oder der Träger unsichtbar ist.
- `createEvent`, `updateEvent`, `deleteEvent` — Mutationen; Datum als Text
  wie überall („um 1850“, „zwischen 1850 und 1855“), Unlesbares als Wortlaut.
  `deleteEvent` über den KI-Zugang (`scope.via`) wird mit `CONFLICT`
  (`WOULD_DELETE_MEDIA`) abgelehnt, wenn danach ein Bild des Ereignisses
  oder seiner Belege an nichts mehr hinge (`assertNoMediaLossViaAi`).
- `loadEventsFor({personIds, relationshipIds}, {includeAlternatives})` —
  Ereignisse vieler Träger in einem Rutsch, **ohne** Rechteprüfung (nur für
  Dienste, die die Sichtbarkeit selbst geprüft haben).
- `toEventDto(row, canEdit)`, `compareEvents(a, b)` — Darstellung (mit
  deutschem Titel und Datumstext) und Reihenfolge (datierte nach Anker, dann
  `sortOrder`, undatierte zuletzt).

**Regeln und Entscheidungen:** Die Fachregeln aus `lib/events.ts`
(`eventIssues`) gelten bei Anlegen und Ändern — u.a. dass Geburt, Tod, Heirat
und Scheidung nur als abweichende Zweitangabe (`isAlternative`) erlaubt sind
und `CUSTOM` eine Bezeichnung braucht. Der Träger eines Ereignisses bleibt
beim Ändern fest. Löschen nimmt die Belege des Ereignisses (Cascade) mit;
Bilder, die danach an nichts mehr hängen, werden entfernt.

**Rechte/Datenschutz:** Wie bei Belegen: An einer Person gelten deren
Familienrechte; an einer Beziehung sichtbar, sobald eine Seite sichtbar ist,
änderbar nach `canEditRelationshipBetween`. Unsichtbar = `NOT_FOUND`.

**Protokoll:** `CREATE Event` (vollständige Darstellung), `UPDATE Event` mit
Titel und Feldänderungen, `DELETE Event` (vorheriger Stand).

**Benutzt von:** `app/api/persons/[id]/events/route.ts`,
`app/api/relationships/[id]/events/route.ts`, `app/api/events/[id]/route.ts`,
`app/people/[id]/page.tsx` (`compareEvents`); `persons.ts`, `timeline.ts`,
`gedcom-import.ts`; MCP: `add_event`, `update_event`, `delete_event`,
`list_events`.

**Tests:** `tests/genealogy.db.test.ts`, `tests/changelog.db.test.ts`,
`tests/media-links.db.test.ts`, MCP-Tests; `e2e/write/genealogy.spec.ts`.

### lib/services/names.ts

**Zweck:** Weitere Namen einer Person (Ehename, Schreibvariante, „auch bekannt
als“ …). Der Hauptname bleibt an der Person.

**Wichtige Funktionen:**
- `listPersonNames(scope, personId)` — sortiert; `null` bei unsichtbarer
  Person.
- `createPersonName`, `updatePersonName`, `deletePersonName` — Mutationen.
- `toPersonNameDto(row)` — mit deutscher Namensart (bei „sonstige“ die eigene
  Bezeichnung) und Anzeigeform (Titel, Vorname, Rufname in Anführungszeichen,
  Nachname, Zusatz).

**Regeln und Entscheidungen:** Nach einer Änderung muss mindestens Vorname,
Nachname oder Rufname übrig bleiben (`VALIDATION`).

**Rechte/Datenschutz:** Rechte = Rechte an der Person; unsichtbar →
`NOT_FOUND`, nur lesbar → `FORBIDDEN`.

**Protokoll:** `CREATE PersonName`, `UPDATE PersonName` (Anzeigename als
`subject`, Feldänderungen), `DELETE PersonName` (vorheriger Stand).

**Benutzt von:** `app/api/persons/[id]/names/route.ts`,
`app/api/names/[id]/route.ts`; `persons.ts` (Detail), `gedcom-import.ts`
(Löschen auf Wunsch); MCP: `add_name_variant`.

**Tests:** `tests/genealogy.db.test.ts`, MCP-Tests.

### lib/services/families.ts

**Zweck:** Familien, die der Benutzer kennt, mit Personen- und Mitgliederzahl
und eigener Rolle.

**Wichtige Funktionen:**
- `listFamilies(scope)` — Liste nach Name; Rolle `EDITOR`/`VIEWER`, für
  Administratoren ohne Zuordnung `ADMIN`.

**Regeln und Entscheidungen:** —

**Rechte/Datenschutz:** Nicht-Admins sehen nur ihre zugeordneten Familien —
schon die Namen fremder Familien sind eine Information über andere.

**Protokoll:** — (nur lesend)

**Benutzt von:** `app/api/families/route.ts`, `app/people/page.tsx`,
`app/people/[id]/page.tsx`, `app/tree/page.tsx`, `app/admin/data/page.tsx`;
MCP: `list_families`.

**Tests:** nur über die MCP-Tests (`list_families`) und
`e2e/read/mcp-http.spec.ts`; kein eigener Dienst-Test.

---

## Quellen, Belege und Bilder

### lib/services/sources.ts

**Zweck:** Quellen (Kirchenbuch, Standesamt, Online-Stammbaum …) und Belege
(Quelle für eine Angabe einer Person, Beziehung oder eines Ereignisses).

**Wichtige Funktionen:**
- `listSources(scope, {q, kind, limit, offset})` — sichtbare Quellen nach
  Titel, mit Zahl der *sichtbaren* Belege; jedes Wort muss in Titel,
  Verfasser, Archiv oder Signatur vorkommen.
- `listSourceOptions(scope)` — Kurzliste (höchstens 1000) für die Auswahl
  beim Belegen.
- `getSource(scope, id)` — Quelle mit sichtbaren Belegen (Bezug, Bilder),
  Bildern der Quelle (Hauptscan zuerst), Zahl der verborgenen Belege,
  `canEdit`, `canDelete`; `null` bei unsichtbarer Quelle.
- `listScanCandidates(scope, sourceId)` — Bilder der Personen und
  Beziehungen, für die die Quelle sichtbar zitiert wird (Auswahl eines Scans).
- `listPersonCitations(scope, personId)` — Belege einer Person und ihrer
  Beziehungen mit Rolle der anderen Seite, eigenen Bildern und
  „Belegbildern“ der Quelle. Setzt voraus, dass der Aufrufer die Sichtbarkeit
  der Person geprüft hat.
- `canCreateSources(scope)` — Administrator oder Bearbeitungsrecht in einer
  Familie.
- `createSource`, `updateSource`, `deleteSource` — Quellen ändern.
- `createCitation`, `updateCitation`, `deleteCitation` — Belege ändern.

**Regeln und Entscheidungen:**
- **Beleg an einem Ereignis:** Person bzw. Beziehung des Ereignisses werden
  übernommen; die Angabe heißt dann immer „Ereignis“ (`EVENT`, der Standard
  „Sonstiges“ wird umgedeutet, alles andere ist `VALIDATION`).
- Sonst muss die Angabe zum Bezug passen (`PERSON_FACTS` bzw.
  `relationshipFacts` je Beziehungstyp), mit Meldung der möglichen Angaben.
- Ohne Träger — keine Person, keine Beziehung bzw. ein Ereignis, das an
  nichts hängt — ist das ein `VALIDATION`-Fehler mit passender Meldung (nicht
  „Ereignis nicht gefunden“).
- Ein Bild als Scan (`mediaId`) muss existieren und für den Benutzer sichtbar
  sein.
- Zur Anzeige werden ältere Importe aufbereitet (Adresse aus der Fundstelle,
  HTML im Text, Art der Quelle aus den Fundstellen geschätzt —
  `lib/source-classify.ts`); gespeichert bleibt der Originalwert.
- Quell-Adressen werden nur als http/https ausgegeben (`safeHttpUrl`).
- Löschen einer Quelle nimmt alle Belege mit; Bilder, die nur an der Quelle
  bzw. ihren Belegen hingen, werden entfernt.

**Rechte/Datenschutz:**
- Beleg: sichtbar, wenn Person bzw. Beziehung sichtbar ist (Beziehung: eine
  Seite genügt); ändern darf, wer den Träger bearbeiten darf.
- Quelle: sichtbar für Administratoren, für den Anleger und für jeden, der
  mindestens einen ihrer Belege sieht. Ändern: Anleger, wer einen ihrer Belege
  bearbeiten darf, Administrator. **Löschen nur, wer jeden ihrer Belege
  bearbeiten darf** (sonst `FORBIDDEN` mit dem Rat, die eigenen Belege zu
  entfernen).
- Belege an Personen, die der Benutzer nicht sieht, erscheinen nie mit Namen —
  nur ihre Anzahl. Bei unsichtbaren Beziehungsseiten wird die Art
  neutralisiert, Namen in Scan-Kandidaten als „Nicht freigegeben“.
- Unsichtbar = `NOT_FOUND`.

**Protokoll:** `CREATE/UPDATE/DELETE Source` (Löschen mit Titel, Art, Zahl der
Belege und — vor dem Löschen ermittelt — den belegten Personen über
`auditRefs`), `CREATE/UPDATE/DELETE Citation` (Quelle, Träger, Angabe,
Fundstelle).

**Benutzt von:** `app/api/sources/route.ts`, `app/api/sources/[id]/route.ts`,
`app/api/citations/route.ts`, `app/api/citations/[id]/route.ts`,
`app/sources/page.tsx`, `app/sources/new/page.tsx`,
`app/sources/[id]/page.tsx`, `app/sources/[id]/edit/page.tsx`,
`app/people/[id]/page.tsx`; `persons.ts`, `imports.ts`, `gedcom-import.ts`;
MCP: `search_sources`, `get_source`, `create_source`, `cite_source`.

**Tests:** `tests/sources.db.test.ts`, `tests/genealogy.db.test.ts`,
`tests/media-links.db.test.ts`, MCP-Tests; `e2e/write/sources.spec.ts`,
`e2e/write/attached-media.spec.ts`.

### lib/services/attached-media.ts

**Zweck:** Bilder an Ereignissen, Belegen und Quellen lesen — und die Regel,
wo ein Bild erscheint.

**Wichtige Funktionen:**
- `imagesOfEvents(ids)`, `imagesOfCitations(ids)` — Bilder je Ereignis bzw.
  Beleg in fester Reihenfolge.
- `imagesOfSources(ids)` — Bilder je Quelle: Hauptscan zuerst, dann weitere,
  ohne Doppel.
- `inheritedSourceImages(belege, quellbilder, zugeordnet, eigene)` — die
  Belegbild-Regel als reine Funktion.
- `imagesForCitations(belege)` — eigene Bilder und geerbte Quellbilder für
  eine Liste sichtbarer Belege.

**Regeln und Entscheidungen (Belegbild-Regel):**
- Bild an einem Ereignis → beim Ereignis (auch auf beiden Personenseiten bei
  Ereignissen einer Beziehung).
- Bild an einem Beleg → beim Beleg (also beim belegten Eintrag) und auf der
  Quellenseite.
- Bild an einer Quelle → auf der Quellenseite und als „Belegbild“ bei **jedem**
  Beleg dieser Quelle — **außer** es ist zugleich mindestens einem Beleg
  derselben Quelle zugeordnet. Dann gehört es erkennbar zu diesem Beleg (z.B.
  dem Eintrag auf einer bestimmten Seite) und erscheint nur dort. Das gilt
  auch, wenn der zugeordnete Beleg für den Betrachter unsichtbar ist. Bilder,
  die schon direkt am Beleg hängen, erscheinen dort nicht ein zweites Mal.

**Rechte/Datenschutz:** Keine eigene Prüfung — die Aufrufer übergeben nur
Sichtbares; was an etwas Sichtbarem hängt, ist sichtbar
(`lib/media-scope.ts`).

**Protokoll:** — (nur lesend)

**Benutzt von:** `events.ts`, `persons.ts`, `sources.ts`.

**Tests:** `tests/media-links.test.ts` (reine Regel),
`tests/media-links.db.test.ts`; `e2e/write/attached-media.spec.ts`.

### lib/services/media.ts

**Zweck:** Aufräumen verwaister Bilder.

**Wichtige Funktionen:**
- `removeOrphanedMedia(kandidaten)` — löscht von den Kandidaten die Bilder,
  die weder an einer Person, Beziehung, einem Ereignis, Beleg noch an einer
  Quelle (Hauptscan oder weitere Bilder) hängen, samt Datei und Vorschaubild;
  liefert die gelöschten IDs.
- `mediaAttachedTo({eventIds, citationIds, sourceIds})` — Bilder an diesen
  Einträgen und an deren Belegen; Kandidaten, bevor die Einträge gelöscht
  werden.
- `mediaOrphanedWithout(kandidaten, {relationshipIds, eventIds,
  citationIds})` — Vorab-Prüfung: welche Bilder hingen an nichts mehr, wenn
  diese Einträge gelöscht würden.
- `assertNoMediaLossViaAi(scope, kandidaten, weg)` — über den KI-Zugang
  (`scope.via`) `CONFLICT` mit Grund `WOULD_DELETE_MEDIA` und den
  betroffenen Bild-IDs, falls dabei ein Bild verloren ginge; in der App
  ohne Wirkung. Benutzt von `deleteEvent` und `deleteRelationship`.

**Regeln und Entscheidungen:** Erst Datenbank, dann Dateien; scheitert das
Löschen einer Datei, bleibt nur eine verwaiste Datei (Fehler im Log). Ein noch
anderweitig zugeordnetes Bild bleibt.

**Rechte/Datenschutz:** keine eigene Prüfung — wird nur von Diensten
aufgerufen, die das Löschen des Trägers schon geprüft haben.

**Protokoll:** keines eigenes; die aufrufenden Dienste nennen die entfernten
Bilder in ihrem Eintrag (z.B. `removedMedia`).

**Benutzt von:** `persons.ts`, `relationships.ts`, `events.ts`, `sources.ts`,
`media-links.ts`.

**Tests:** `tests/media-cleanup.db.test.ts`, `tests/media-links.db.test.ts`.

### lib/services/media-links.ts

**Zweck:** Bilder anlegen und an Einträge hängen bzw. davon lösen —
gemeinsam für den Upload der App, die Verknüpfungen und die MCP-Werkzeuge.
Ziele: Personen, Beziehungen, Ereignisse, Belege, Quellen.

**Wichtige Funktionen:**
- `addMedia(scope, {bytes, fileName, caption, declaredMime, targets,
  requireTarget, via, url})` — Ziele prüfen, Größe und Format prüfen, nach
  WebP umrechnen (`lib/media-processing.ts`), Bild und Verknüpfungen in einer
  Transaktion anlegen.
- `linkMedia(scope, mediaId, targets)` — vorhandenes Bild an weitere Einträge
  hängen; vorhandene Verknüpfungen bleiben unverändert.
- `unlinkMedia(scope, mediaId, targets, {deleteOrphan})` — Bild lösen.
- `decodeBase64Image(text)` — base64 bzw. data:-URL in Bytes; Größe wird vor
  dem Dekodieren geschätzt; base64url wird angenommen.
- `fetchImageFromUrl(url)` — Bild über `lib/safe-fetch.ts` holen (nur https
  auf Port 443, nur öffentliche Adressen, höchstens 3 Weiterleitungen,
  Größenlimit, 20 s).
- `resolveTargets`, `targetCount`, `mediaLinkCount`, `maxUploadBytes`
  (`MAX_UPLOAD_BYTES`, Standard 15 MB), `MAX_MEDIA_TARGETS` (50),
  `mediaErrorReason(err)` (Grund für 413/415 in der Route).

**Regeln und Entscheidungen:**
- Alle Ziele werden geprüft, **bevor** etwas gespeichert wird; beim ersten
  Problem bricht der Aufruf ab — es wird nie nur ein Teil verknüpft.
- Das Format entscheiden die Bytes; eine angegebene Inhaltsart muss dazu
  passen (AVIF/HEIF gelten als dieselbe Familie), sonst
  `VALIDATION` mit Grund `TYPE_MISMATCH`.
- Das erste Bild einer Person bzw. Beziehung wird ihr Hauptbild; wird das
  Hauptbild gelöst, übernimmt das nächste.
- Ohne Ziel: über MCP (`requireTarget`) abgelehnt; in der App nur
  Administratoren erlaubt.
- `unlinkMedia`: Jede genannte Zuordnung muss bestehen (sonst `NOT_FOUND`).
  Hinge das Bild danach an nichts mehr, wird es mit `deleteOrphan` gelöscht
  (App, nach Rückfrage), sonst `CONFLICT` (`LAST_LINK`) — die KI löscht keine
  Bilder. Mit `deleteOrphan` gilt dann das Löschrecht des Bildes
  (`canDeleteMedia`, sonst `FORBIDDEN`) — sonst ließe sich ein Quellen-Scan
  über „lösen“ entfernen, obwohl „löschen“ verboten ist.
- Schlägt die Transaktion fehl, werden die schon gespeicherten Dateien wieder
  entfernt.

**Rechte/Datenschutz:** Jedes Ziel muss sichtbar (sonst `NOT_FOUND`) und
**bearbeitbar** (sonst `FORBIDDEN`) sein; Rechte an Ereignissen, Belegen und
Quellen kommen aus `lib/media-scope.ts`. Ein vorhandenes Bild lässt sich nur
verknüpfen bzw. lösen, wenn der Benutzer es sehen darf.

**Protokoll:** `CREATE MediaAsset` (Name, Größe, Herkunft upload/url/data,
Adresse, Ziele; erste Person bzw. Beziehung rückwärtsverträglich),
`UPDATE MediaAsset` beim Verknüpfen (nur wenn neue Verknüpfungen
entstanden), `UPDATE` bzw. `DELETE MediaAsset` beim Lösen. Betroffene
Personen werden mitgegeben — bei Quellen alle Personen, die die Quelle belegt
(höchstens 1000).

**Benutzt von:** `app/api/media/route.ts`, `app/api/media/[id]/links/route.ts`;
MCP: `add_media`, `link_media`.

**Tests:** `tests/media-links.db.test.ts`, `tests/media-links.test.ts`, MCP-Tests;
`e2e/write/media.spec.ts`, `e2e/write/attached-media.spec.ts`.

---

## Recherche und Auswertung

### lib/services/research.ts

**Zweck:** Recherche-Werkzeuge: Vorfahren, Nachfahren, Verbindungsweg,
Statistik, Datenlücken, mögliche Dubletten.

**Wichtige Funktionen:**
- `getAncestors(scope, id, generationen)`, `getDescendants(...)` — ebenenweise
  (Standard 4, höchstens 25 = `MAX_GENERATIONS`), je Eintrag Generation,
  Vermittler und Art der Abstammung; `null` bei unsichtbarer Ausgangsperson.
- `findRelationshipPath(scope, a, b)` bzw. `relationshipPathInGraph(graph, a,
  b)` — kürzester Weg über Eltern- und Partnerkanten.
- `getStatistics(scope)` — Personen (lebend/verstorben, Geschlecht, ohne
  Familie), Beziehungen (nur mit beiden Seiten sichtbar), Familien mit
  Personenzahl, Bilder, fehlende Angaben, frühestes/spätestes Geburtsjahr.
- `findDataGaps(scope, {limit})` — Lücken je Art (fehlendes Geburtsdatum,
  -ort, Eltern, Geschlecht; vermutlich verstorben ohne Sterbedatum; Sterbeort
  ohne Sterbedatum; unplausibles Elternalter; isoliert; ohne Familie; Geburt
  bzw. Tod ohne Beleg) und an Beziehungen („Ehe ohne Ort“, „Ehestand
  unbekannt“, `RELATIONSHIP_GAP_KINDS`).
- `findPossibleDuplicates(scope, {maxYearDiff, limit})` — dünne Hülle um
  `listDuplicateCandidates` (`duplicates.ts`), höchstens 500.

**Regeln und Entscheidungen:**
- „Vermutlich verstorben“: ohne Sterbedatum und sicher älter als 100 Jahre;
  bei ungenauem Geburtsdatum zählt der späteste mögliche Zeitpunkt („nach
  1900“ also nie).
- Unplausibles Elternalter: leiblicher Elternteil bei der Geburt unter 14 oder
  über 70; bei ungenauen Daten nur, wenn es für jede Lesart gilt.
- „Ohne Beleg“: Geburt bzw. Tod erfasst (Datum oder Ort), aber kein Beleg mit
  genau dieser Angabe.
- `DataGapKind` ist Schlüssel fester Tabellen (Recherche-Seite, MCP) und
  bleibt deshalb unverändert; Beziehungslücken stehen in einem eigenen
  Abschnitt.

**Rechte/Datenschutz:** Ausgangspersonen müssen sichtbar sein, sonst `null`;
unterwegs erreichte unsichtbare Personen erscheinen als Platzhalter, die Art
ihrer Kanten wird neutralisiert, wenn keine Seite sichtbar ist. Auswertungen
betrachten nur sichtbare Personen; „ohne Familie“ ist nur für
Administratoren befüllt; Statistik zählt nur Beziehungen mit beiden Seiten
sichtbar. Beziehungslücken: sichtbar, sobald eine Seite sichtbar ist (wie im
Baum).

**Protokoll:** — (nur lesend)

**Benutzt von:** `app/research/page.tsx` (`getStatistics`, `findDataGaps`,
`RELATIONSHIP_GAP_KINDS`); `kinship.ts` (Weg), `lib/consistency.ts`
(Bezug im Kommentar); MCP: `get_ancestors`, `get_descendants`,
`get_statistics`, `find_data_gaps`, `find_possible_duplicates`.

**Tests:** `tests/services.db.test.ts`, `tests/research.db.test.ts`,
`tests/genealogy.db.test.ts`, `tests/sources.db.test.ts`,
`tests/import-linking.db.test.ts`, MCP-Tests; `e2e/read/research.spec.ts`.

### lib/services/kinship.ts

**Zweck:** Verwandtschaft zweier Personen mit deutscher Bezeichnung
(Begriffe in `lib/kinship.ts`). Beschrieben wird, was `to` für `from` ist.

**Wichtige Funktionen:**
- `getKinship(scope, fromId, toId)` — lädt den Graphen und ruft
  `kinshipInGraph`.
- `kinshipInGraph(graph, fromId, toId)` — Blutsverwandtschaft (Generationen
  hinauf/hinab, halb, adoptiv, Seite, gemeinsame Vorfahren), Verbindungsweg
  mit Schrittkette und Begriff, beste Kurzbezeichnung.

**Regeln und Entscheidungen:** Die Kurzbezeichnung nimmt die
Blutsverwandtschaft vor dem Weg. Besteht der Weg nur aus leiblichen bzw.
Adoptiv-Abstammungen, gilt ebenfalls der genauere Begriff der
Blutsverwandtschaft (ein Weg kennt keine Halbverwandtschaft).

**Rechte/Datenschutz:** Beide Personen müssen sichtbar sein (sonst `null`).
Das Geschlecht unsichtbarer Personen fließt nicht in die Begriffe ein — sonst
verriete etwa „väterlicherseits“ das Geschlecht eines verborgenen
Elternteils.

**Protokoll:** —

**Benutzt von:** MCP `get_kinship` (ganzer Graph); `lib/services/kinship-view.ts` (Seite
„Wie sind wir verwandt?“, nur auf dem sichtbaren Teilgraphen); `lib/reference.ts` (Abgleich im
Kommentar: die Bezugsperson-Berechnung stimmt mit `kinshipInGraph` überein).

**Tests:** `tests/reference.test.ts` (Vergleich mit `lib/reference.ts` für
jedes Paar), `tests/research.db.test.ts`, `tests/import-linking.db.test.ts`,
MCP-Tests.

### lib/services/kinship-view.ts

**Zweck:** Daten der Seite „Wie sind wir verwandt?“ (`/kinship`): beide
Auswahlfelder, die eigene Person, die Bezeichnung aus beiden Blickrichtungen
und die Verbindungen als Personenketten für die Zeichnung.

**Wichtige Funktionen:**
- `loadKinshipPage(scope, aRaw, bRaw)` — lädt den Graphen **einmal**
  (`loadGraph`) und die gespeicherte eigene Person (`storedSelfPersonId`),
  bildet je Feld den Zustand `empty`/`notFound`/`ok` und das Ergebnis.
- `visibleGraph(graph)` — der Graph nur aus sichtbaren Personen und
  Beziehungen zwischen ihnen (Index über `visibleIndex` aus
  `lib/services/reference.ts`).
- `kinshipViewInGraph(graph, aId, bId)` — Ergebnis auf dem sichtbaren Teil
  eines geladenen Graphen (`visibleGraph`): `same` (dieselbe Person), `none`
  (kein Weg über Eltern- und Partnerkanten zwischen sichtbaren Personen)
  oder `found` mit `aForB`/`bForA` (die Kurzbezeichnungen
  von `kinshipInGraph` in beide Richtungen, null ohne gängigen Begriff),
  den Schrittketten beider Richtungen, der Art (`blood`, `inLaw` = Weg über
  eine Partnerschaft, `other` = nur über Stief-/Pflegeeltern), bis zu
  `MAX_CONNECTIONS` (4) Blutsverwandtschaften aus `bloodConnections`
  (`lib/kinship-chain.ts`) samt Bezeichnungen je Verbindung und
  Beschriftungen je Linienschritt, dem kürzesten Weg (`path`) und
  `pathTerm`, wenn der kürzeste Weg neben einer Blutsverwandtschaft etwas
  anderes sagt (Ehe unter Verwandten).
- `parsePersonParam` — Kennung aus der Adresse wie `focus` im Baum
  (`[A-Za-z0-9_-]`, höchstens 64 Zeichen), sonst „nicht gefunden“.

**Regeln und Entscheidungen:** **Streng wie der Stammbaum** (Entscheidung
des Eigentümers): gerechnet wird nur über sichtbare Personen. Die
Überschrift nimmt die Begriffe von `kinshipInGraph` auf dem sichtbaren
Graphen — damit stimmt sie für jedes Paar mit der Angabe an den Baumkarten
und auf der Personenseite überein (`relationsFromReference` auf
`visibleIndex`; geprüft in `tests/kinship-chain.test.ts` und
`tests/kinship-view.db.test.ts`). Gibt es keinen Weg über sichtbare
Personen, ist das Ergebnis `none`; die Seite zeigt dann wortgleich mit der
Personenseite „keine Verwandtschaft über freigegebene Personen bekannt“ und
zeichnet nichts — gleich, ob es gar keine Verbindung gibt oder nur eine über
gesperrte Personen (der Unterschied verriete gesperrte Personen). Die
Zeichnung zeigt bei Blutsverwandten die nächste Verbindung aus
`bloodConnections`, sonst den kürzesten Weg. Eine Kennung einer
aufgegangenen Person wird nicht umgeleitet (gilt als nicht gefunden).

**Unterschied zu `get_kinship` (MCP):** Das Werkzeug bleibt unverändert und
rechnet über den ganzen Graphen (Weg auch über gesperrte Personen, die dort
als „Nicht freigegeben“ erscheinen). Für ein Paar, das nur über gesperrte
Personen verbunden ist, nennt die KI also eine Verwandtschaft, die Seite
nicht; bei Verbindungen über sichtbare Personen kann die KI eine nähere
(über gesperrte Personen) nennen.

**Rechte/Datenschutz:** Beide gewählten Personen müssen sichtbar sein, sonst
gilt das Feld als „nicht gefunden“ (unbekannt und gesperrt sehen gleich aus).
Gesperrte Personen kommen in keinem Ergebnis vor — weder als Karte noch als
Kennung, Geschlecht oder Art einer Beziehung; alle Karten sind sichtbare
Personen (`KinshipCard` ohne Platzhalter). Kennungen von Beziehungen gibt
die Sicht nicht heraus.

**Leistung:** ein Ladevorgang; dazu der sichtbare Teilgraph (ein Durchgang
über die Beziehungen), zwei `kinshipInGraph` und ein `bloodConnections` — für 12 000 erzeugte Personen mit 30 000 Kanten
unter 100 ms (`tests/kinship-chain.test.ts`); die Ladezeit des Graphen
kommt hinzu.

**Protokoll:** —

**Benutzt von:** `app/kinship/page.tsx`. Kein MCP-Werkzeug.

**Tests:** `tests/kinship-chain.test.ts` (Sicht auf erzeugten Graphen:
beide Blickrichtungen, angeheiratet, Ehe unter Verwandten, keine
Verbindung, Verbindung nur über gesperrte Personen = keine, sichtbarer
Umweg, Übereinstimmung mit der Bezugsperson für jedes Paar, Abgleich mit
`findBloodRelation` über die Mock-Daten, Leistung),
`tests/kinship-view.db.test.ts`, `e2e/read/kinship.spec.ts`.

### lib/services/timeline.ts

**Zweck:** Zeitleisten einer Person bzw. einer Familie.

**Wichtige Funktionen:**
- `getPersonTimeline(scope, personId)` — eigene Geburt/Tod und Ereignisse,
  Partnerschaften (Beginn/Ende) mit ihren Ereignissen, Adoption/Pflege/
  Stiefverhältnis, Geburt und Tod der Kinder, Tod von Eltern, Partnern und
  Geschwistern; je Eintrag Rolle und Alter der Person; dazu eine Liste
  fehlender Angaben (z.B. genaues Geburtsdatum, Heiratsdatum, Ehestand,
  Scheidungsdatum, Geburtsdatum eines Kindes).
- `getFamilyTimeline(scope, familyId, {fromYear, toYear, limit, offset})` —
  Geburten und Todesfälle der sichtbaren Mitglieder, ihre Ereignisse,
  Beziehungen und Beziehungsereignisse; seitenweise (Standard 100, höchstens
  1000).

**Regeln und Entscheidungen:** Abweichende Zweitangaben und undatierte
Ereignisse erscheinen nicht. Alter: bei ungenauen Daten als Näherungswert
markiert, bei offenen Angaben („vor“/„nach“) keines; Ereignisse nach dem
eigenen Tod (z.B. Tod eines Kindes) bleiben, aber ohne Alter. Doppelte
Beziehungsereignisse werden entfernt.

**Rechte/Datenschutz:** Geburt und Tod nur für sichtbare Personen;
Beziehungsereignisse, sobald eine Seite sichtbar ist (andere Seite als
Platzhalter, im Text „(nicht freigegeben)“). Eine unsichtbare Person bzw.
fremde Familie ergibt `null` — auch eine nicht existierende Familie sieht
gleich aus.

**Protokoll:** —

**Benutzt von:** MCP `get_timeline`. Keine Seite der Web-App.

**Tests:** `tests/genealogy.db.test.ts`, `tests/research.db.test.ts`,
`tests/sources.db.test.ts`, MCP-Tests.

### lib/services/consistency.ts

**Zweck:** Widersprüche in Lebens- und Beziehungsdaten (Regeln in
`lib/consistency.ts`), z.B. Tod vor Geburt, Ereignis vor der Geburt bzw. nach
dem Tod, Beerdigung vor dem Tod.

**Wichtige Funktionen:**
- `findInconsistencies(scope, {kinds, personId, limit})` — Zählung je Art,
  Gesamtzahl und höchstens `limit` Meldungen (Standard 50, höchstens 1000;
  Fehler vor Warnungen) mit betroffenen Personen, Beziehungen und
  Ereignissen; filterbar nach Art und Person.

**Regeln und Entscheidungen:** Abweichende Zweitangaben und undatierte
Ereignisse werden nicht geprüft.

**Rechte/Datenschutz:** Ausschließlich sichtbare Personen und Beziehungen
zwischen zwei sichtbaren Personen — eine Meldung über eine verborgene Person
würde deren Daten preisgeben.

**Protokoll:** —

**Benutzt von:** `app/research/page.tsx`; MCP `check_consistency`.

**Tests:** `tests/research.db.test.ts`, `tests/genealogy.db.test.ts`,
MCP-Tests (reine Regeln: `tests/consistency.test.ts`).

---

## Dubletten und Zusammenführen

### lib/services/duplicates.ts

**Zweck:** Mögliche Dubletten (Recherche-Seite, Hinweis auf der Personenseite,
MCP) und die Markierung „kein Duplikat“. Bewertung und Klassen
(„sicher“/`high`, „wahrscheinlich“/`medium`, „unklar“/`low`) liegen in
`lib/duplicates.ts`.

**Wichtige Funktionen:**
- `loadDuplicatePeople(scope, graph?)` — Vergleichsdaten aller sichtbaren
  Personen (Namen samt Varianten, Daten, Geburtsort, Eltern/Partner/Kinder,
  Namen der Eltern und Partner in Vergleichsform, Quell-Bäume aus der
  Herkunft).
- `listDuplicateCandidates(scope, {offset, limit, confidence, minScore,
  maxYearDiff, review})` — Paare nach Klasse und Punkten, seitenweise (Standard 25,
  höchstens 500), mit Zählung je Klasse, Zahl der ausgeblendeten Paare und
  `canMerge` je Paar. Dazu je Paar die KI-Einschätzung (`review`, siehe
  unten) und `reviewCounts` (vorgeprüft, nicht vorgeprüft, veraltet, je
  Urteil — innerhalb der gewählten Klasse); `review` filtert (`any`,
  `none`, `open` = keine oder veraltete, oder ein Urteil).
- `listDuplicatesOfPerson(scope, personId, {limit, includeUnclear})` — Kandidaten einer
  Person (Standard 3, höchstens 50) mit Herkunft („von Hand erfasst“ bzw.
  Import als „Buchstabe · Name“ aus `loadImportDirectory` in `origin.ts`).
  Je Kandidat auch der Begründungssatz (`sentence`, `evidenceSentence`).
  `includeUnclear` nimmt die Klasse „unklar“ dazu — nur für den Dialog
  „Zusammenführen …“, den jemand ausdrücklich öffnet.
- `dismissDuplicate(scope, a, b)`, `undismissDuplicate(scope, a, b)` — Paar
  dauerhaft als „kein Duplikat“ markieren bzw. die Markierung aufheben.
- `reviewDuplicate(scope, {personAId, personBId, verdict, reason,
  suggestedKeepId})` — KI-Vorprüfung: speichert die Einschätzung eines
  Paares (MCP `review_duplicate`) samt Fingerabdruck beider Personen; eine
  neue ersetzt die alte (`replacedVerdict` im Ergebnis). Begründung 10 bis
  2000 Zeichen; `suggestedKeepId` nur bei `MERGE` und nur eine der beiden.
- Bausteine in `lib/services/duplicate-reviews.ts`: `personStates`
  (Fingerabdruck je Person aus Stammdaten-`updatedAt`, Namensvarianten,
  Ereignissen, Familien und Beziehungen — Belege und Bilder zählen bewusst
  nicht), `loadDuplicateReviews` (Einschätzungen mit `stale`, Name des
  Benutzers und des Schlüssels), `matchesReviewFilter`, `canonicalPair`,
  `reviewKey`. Urteile und Bezeichnungen rein in `lib/duplicate-verdicts.ts`
  (auch für Client-Komponenten).

**KI-Vorprüfung — Regeln (Leitlinie: vorprüfen und vorschlagen, nicht
selbst zusammenführen):**
- Eine Einschätzung ist nur ein Hinweis. `reviewDuplicate` ändert keine
  Person, führt nichts zusammen und legt kein „kein Duplikat“ an; Klasse,
  Punkte und Reihenfolge kommen allein aus `lib/duplicates.ts`. Es gibt
  keinen Dienstweg, über den ein Urteil etwas zusammenführt.
- Ein Paar, das ein Mensch als „kein Duplikat“ markiert hat, lässt sich
  nicht mehr einschätzen (`CONFLICT`) — die Entscheidung des Menschen gilt.
- „Veraltet“: Weicht der heutige Fingerabdruck einer der beiden Personen vom
  gespeicherten ab, gilt die Einschätzung als `stale`; der Filter `open`
  zählt sie wieder zu den offenen.
- Rechte: Schreiben nur mit Bearbeitungsrecht an beiden Personen (wie
  „Kein Duplikat“). Sehen: nur wer beide bearbeiten darf — die Begründung
  kann Einzelheiten beider Personen nennen; Betrachter sehen das Paar ohne
  Einschätzung. Im Hinweis auf der Personenseite nur Urteil und „veraltet“.
- Protokoll: `UPDATE Person` mit `duplicateReview` (`with`, `verdict`,
  `reason`, `suggestedKeepId`, `replacedVerdict`), beide Personen
  betroffen; im Changelog als „Mögliche Dublette vorgeprüft“, die Begründung
  nur, wenn beide Personen sichtbar sind (`lib/services/changes.ts`).

**Regeln und Entscheidungen:**
- Als „kein Duplikat“ markierte Paare erscheinen nicht mehr; die Markierung
  gilt für alle Benutzer.
- Der Hinweis auf der Personenseite nennt nur „sicher“ und „wahrscheinlich“
  (strenger als die Liste, nie lockerer) und lädt bewusst nicht den ganzen
  Graphen: erst Namen und Geschlecht aller bearbeitbaren Personen, dann
  vollständig nur die wenigen mit gleichem erstem Vornamen; eingetragene
  Vorfahren und Nachkommen über beliebig viele Generationen werden per
  rekursiver SQL-Abfrage ausgeschlossen (`UNION` beendet die Rekursion auch
  bei fehlerhaften Kreisen).
- Liste und Hinweis verwenden dieselbe Bewertung, Schwelle und Abstammungsregel
  und liefern so dieselben Paare.

**Rechte/Datenschutz:**
- Die Liste betrachtet nur sichtbare Personen; die Abstammungskette läuft nur
  über sichtbare Personen, damit das Fehlen eines Paares nichts über
  verborgene Personen verrät.
- Der Hinweis erscheint nur, wenn der Benutzer die Person **und** den
  Kandidaten bearbeiten darf; alle anderen erfahren nichts, auch keine Anzahl.
  Namen von Eltern und Partnern dienen nur dem Vergleich und verlassen den
  Dienst nicht.
- Markieren bzw. Aufheben: Bearbeitungsrecht an beiden Personen nötig
  (unsichtbar → `NOT_FOUND`, sonst `FORBIDDEN`; gleiche Person →
  `VALIDATION`).

**Protokoll:** `UPDATE Person` mit `notDuplicateOf` bzw.
`notDuplicateOfRemoved`, beide Personen als betroffen.

**Benutzt von:** `app/api/duplicates/route.ts`,
`app/api/duplicates/dismiss/route.ts`, `app/research/page.tsx`,
`app/research/duplicates/page.tsx`, `app/people/[id]/page.tsx` (Hinweis),
`app/api/persons/[id]/duplicates/route.ts` (Dialog „Zusammenführen …“);
`research.ts`, `merge-bulk.ts`, `merge-followups.ts`, `import-linking.ts`; MCP indirekt über
`find_possible_duplicates`, direkt über `list_duplicate_candidates` und
`review_duplicate`.

**Tests:** `tests/person-duplicates.db.test.ts`, `tests/services.db.test.ts`
(über `findPossibleDuplicates`), MCP-Tests (Regeln: `tests/duplicates.test.ts`);
KI-Vorprüfung `tests/duplicate-review.db.test.ts`;
`e2e/read/duplicate-banner.spec.ts`, `e2e/write/duplicate-banner.spec.ts`,
`e2e/write/merge.spec.ts`, `e2e/write/duplicate-review.spec.ts`.

### lib/services/merge.ts

**Zweck:** Zwei Personen zusammenführen: Die Person `mergeId` geht in `keepId`
auf. Vorschau ohne Schreiben und Ausführen in einer Transaktion. Regeln der
Hauptangaben in `lib/merge-rules.ts`.

**Wichtige Funktionen:**
- `previewPersonMerge(scope, keepId, mergeId, {choices,
  relationshipSubtypes})` — beide Seiten (Felder, Familien, Lebensdaten,
  Eltern, Partner, Kinderzahl, Importe als „Buchstabe · Name“ über
  `loadImportDirectory`, Herkunft), Feldvergleich mit Wahl,
  wählbare Art zusammenfallender Beziehungen, Zusammenfassung in ganzen
  Sätzen, Blocker, `canMerge` und ein Stand-Kennzeichen (`token`).
- `mergePersons(scope, input, {tx, now, parentEdges})` — führt aus; mit
  `parentsFirst` zuerst die doppelt erfassten Eltern (siehe unten); mit
  `expectedToken` aus der Vorschau.
- `loadMergeSnapshot`, `planMerge`, `summarizePlan` — Bausteine, auch für
  Sammel-Zusammenführen und „Importe verbinden“.
- `lockPersons(db, ids)` — Advisory-Lock je Person (sortiert), damit zwei
  Zusammenführungen derselben Person aufeinander warten.
- `entryTag`, `mergeInputSchema` — Hilfen.

**Regeln und Entscheidungen (Zusammenführen-Regeln):**
- **Anreichern statt streiten:** Leeres wird ergänzt, das genauere Datum
  gewinnt, bei echtem Widerspruch gilt der Wert des bleibenden Eintrags; der
  andere bleibt als Zweitangabe (Ereignis mit `isAlternative`) bzw. als
  Namensvariante erhalten; Notizen werden aneinandergehängt. Nicht
  aufbewahrbar (z.B. abweichendes Geschlecht) steht ausdrücklich in der
  Zusammenfassung.
- **Umzug:** Ereignisse, Namensvarianten, Belege (auch an Ereignissen),
  Bilder (ein Hauptbild, kein doppelter Verweis), Familien (Vereinigung),
  Fremdkennungen, Rohdaten, Herkunft (`ImportLink` mit `mergedFromId`/
  `mergedAt`), „kein Duplikat“-Markierungen und „das bin ich“
  (`User.personId`). Gleiches fällt zusammen (Ereignisse, Namen, Belege nach
  Schlüssel aus `lib/merge-rules.ts`; Bilder gleich­fallender Belege bzw.
  Ereignisse ziehen mit).
- **Beziehungen** werden umgehängt; zwei gleiche (dieselben zwei Personen,
  gleicher Typ) fallen zu einer zusammen — mit der genaueren bzw. gewählten
  Art, ergänzten Daten und Orten, abweichender Heirat/Scheidung als
  Zweitangabe und Ereignissen, Belegen, Bildern und Herkunft beider.
- **Fingerabdruck der Herkunft:** Beim Umhängen wird er auf die neuen IDs
  umgerechnet, aber nur, wenn der Eintrag seit dem Import unverändert war;
  sonst bleibt er „in der App geändert“. So erkennt ein späterer Import jeder
  beteiligten Datei die Person wieder.
- **Blocker** (schon in der Vorschau, mit Erklärung): dieselbe Person
  (`SAME`); die beiden sind miteinander verbunden (`RELATED`); zusammen mehr
  als zwei leibliche Eltern (`BIO_PARENTS`, mit Vorschlag, welche
  Elternpaare vermutlich selbst doppelt sind und zuerst zusammengeführt werden
  sollten); Zyklus (`CYCLE`, Vorfahre der einen und Nachfahre der anderen bzw.
  über Dritte); jemand wäre zugleich Partner und Elternteil
  (`PARTNER_AND_PARENT`); Tod vor Geburt durch die Wahl (`DATES`). Zyklen
  werden über **alle** Eltern-Kind-Kanten geprüft, auch über unsichtbare
  Personen.
- **Doppeltes Absenden:** Gibt es `mergeId` nicht mehr, aber ein
  Zusammenführen genau dieses Paars im Audit, kommt dessen Ergebnis zurück
  (`alreadyMerged`). Geänderter Stand seit der Vorschau → `CONFLICT` statt
  Überraschung. Blocker → `CONFLICT` mit den Blockern in `details`.
- Vor dem Löschen der aufgehenden Person wird geprüft, dass nichts mehr an ihr
  hängt; sonst bricht die Transaktion ab.
- **Alte Kennung:** Vor dem Löschen der aufgehenden Person vermerkt
  `recordPersonRedirect` (`redirects.ts`) in derselben Transaktion die
  Umleitung aufgegangen → bleibend und biegt Umleitungen, die bisher auf die
  aufgehende Person zeigten, auf die bleibende um.
- **„Erst die Eltern, dann dieses Paar“** (`parentsFirst`): Ist ein Paar
  nur wegen doppelt erfasster Eltern gesperrt, kennzeichnet die Sperre
  `BIO_PARENTS` das mit `resolvable` — wenn alle vorgeschlagenen
  Elternpaare sichtbar sind, jedes mindestens „wahrscheinlich“ dieselbe
  Person ist (nie ein schwacher Treffer wie „nur der erste Vorname gleich“)
  und danach höchstens zwei leibliche Elternteile bleiben. Dann führt ein
  Aufruf in EINER Transaktion zuerst die Elternpaare (Vorgaben der Regeln,
  bleibend ist der Elternteil des bleibenden Eintrags) und danach das Paar
  zusammen. Der Server nimmt nur genau die Paare, die die Sperre in diesem
  Augenblick vorschlägt; jedes Elternpaar durchläuft dieselben Prüfungen wie
  ein einzelnes Zusammenführen (Rechte an beiden, Stand aus seiner Vorschau,
  Sperren). Scheitert irgendetwas oder bleibt das Paar danach gesperrt, wird
  nichts geändert. Ergebnis: `parentMerges` nennt die Elternpaare.
- Kein KI-Werkzeug: Zusammenführen geht nur in der Web-App (Leitlinie des
  Eigentümers).

**Rechte/Datenschutz:** Bearbeitungsrecht an **beiden** Personen; unsichtbar
→ `NOT_FOUND`, sonst `FORBIDDEN`. In Meldungen und Vorschau erscheinen nicht
sichtbare Personen als „eine nicht freigegebene Person“; Vorschläge im
`BIO_PARENTS`-Blocker nur, wenn beide Personen sichtbar sind. Neue Familien
nennt die Zusammenfassung nur, soweit der Benutzer sie kennt — mit dem
Hinweis, dass deren Mitglieder die Person danach sehen. Herkunftsdetails
(Baum, Datei, Schlüssel) nur für Administratoren.

**Protokoll:** Ein `MERGE`-Eintrag (`entityType` Person, Person = bleibende)
in derselben Transaktion; enthält beide IDs, die Wahl je Feld, die gewählten
Beziehungsarten, die vorherigen Werte der bleibenden Person, die
Feldänderungen, die vollständigen Spalten der aufgegangenen Person samt IDs
ihrer Namen, Ereignisse, Belege, Bilder, Beziehungen, Rohdaten,
Herkunftsangaben und Fremdkennungen sowie das Ergebnis — genug für einen
Rückbau von Hand. Betroffen: beide Personen und die Verwandten mit
umgehängter Beziehung; Familien der aufgegangenen Person. Paket „Personen
zusammengeführt“ (Art MERGE).
Mit `parentsFirst` heißt das Paket „Personen
zusammengeführt (erst die Eltern)“ und enthält je Paar einen `MERGE`-Eintrag.

**Benutzt von:** `app/api/persons/merge/preview/route.ts`,
`app/api/persons/merge/route.ts`; `merge-bulk.ts`, `import-linking.ts`;
Typen in `components/MergeView.tsx`.

**Tests:** `tests/merge.db.test.ts`, `tests/changelog.db.test.ts`,
`tests/reference.db.test.ts` (Regeln: `tests/merge-rules.test.ts`), `tests/merge-followups.db.test.ts`
(Eltern zuerst), `tests/person-redirect.db.test.ts` (Umleitung);
`e2e/write/merge.spec.ts`, `e2e/write/merge-comfort.spec.ts`.

### lib/services/merge-bulk.ts

**Zweck:** Mehrere „sichere“ Dubletten in einem Rutsch zusammenführen
(Recherche → Mögliche Dubletten).

**Wichtige Funktionen:**
- `previewBulkMerge(scope, {pairs})` — gemeinsame Vorschau: je Paar bleibende
  und aufgehende Person, Status (`ready`, `blocked`, `skipped`,
  `afterParents`), Blocker und Sätze; Summen über alle ausführbaren Paare;
  übersprungene Paare mit Grund. Schreibt nichts.
- `bulkMerge(scope, {pairs})` — führt Paar für Paar aus; Ergebnis:
  zusammengeführt, fehlgeschlagen (mit Grund), übersprungen.

**Regeln und Entscheidungen:**
- **„sicher“-Klasse:** Nur Paare der Klasse „sicher“ — beim Ausführen erneut
  bewertet (`scoreDuplicate` mit derselben Abstammungsregel wie die Liste),
  nicht der Liste des Browsers geglaubt. Die Klasse wird nie gelockert.
- Jede Person in höchstens einem Paar; höchstens 200 Paare
  (`MAX_BULK_PAIRS`).
- Keine Feldwahl, nur die Vorgaben der Regeln. Bleibend ist die Person mit
  mehr Angaben (Summe aus Ereignissen, Belegen, Namen, Bildern, Beziehungen),
  bei Gleichstand die ältere.
- „Eltern vor Kindern“ ist als Sortierung nach dem Geburtsdatum der ersten
  Person eines Paars umgesetzt (nicht über den Graphen). Ein Paar, das nur
  wegen doppelt erfasster Eltern blockiert ist, die im selben Lauf
  zusammengeführt werden, gilt in der Vorschau als `afterParents`.
- Jedes Paar in einer eigenen Transaktion (`mergePersons`): Ein blockiertes
  Paar hält die anderen nicht auf; nach jedem Paar ist der Baum stimmig.

**Rechte/Datenschutz:** Ohne jede Familie (und kein Administrator):
`FORBIDDEN`. Je Paar: unsichtbar → „Person nicht gefunden“, ohne
Bearbeitungsrecht an beiden → übersprungen.

**Protokoll:** Ein Paket „Sammel-Zusammenführen (N Paare)“ (Art MERGE) mit
je einem `MERGE`-Eintrag pro Paar.

**Benutzt von:** `app/api/persons/merge/bulk/route.ts` (mit `dryRun` für die
Vorschau); Typen in `components/DuplicateList.tsx` und
`components/FollowUpDuplicates.tsx` (sichere Folgedubletten).

**Tests:** `tests/reference.db.test.ts` (`bulkMerge`);
`e2e/write/merge.spec.ts` („sichere Paare in einem Rutsch“). Für
`previewBulkMerge` prüft `tests/merge-followups.db.test.ts` mit (ein
„wahrscheinliches“ Paar wird übersprungen).

### lib/services/merge-followups.ts

**Zweck:** Folgedubletten nach einem Zusammenführen: An der bleibenden
Person hängen danach oft Eltern, Partner und Kinder doppelt — je einmal aus
jedem der beiden Einträge. Die Ergebnisseite nennt diese Paare.

**Wichtige Funktionen:**
- `listFollowUpDuplicates(scope, personIds)` — für eine bis 20 Personen
  (`MAX_FOLLOW_UP_PERSONS`) die Paare Eltern × Eltern, Partner × Partner,
  Kinder × Kinder: beide Personen, über wen gefunden (`via`), Klasse,
  Punkte, Gründe, Widersprüche, Begründungssatz; dazu die Zahl der
  „sicheren“. Höchstens 50 Paare, „sicher“ zuerst.

**Regeln und Entscheidungen:**
- Die Klasse ist genau die der Dublettenliste (`scoreDuplicate` mit
  derselben Abstammungsregel) — hier wird nichts hochgestuft. Der gemeinsame
  Verwandte zählt dort ohnehin („dasselbe Kind eingetragen“).
- `relaxedMatch` (`lib/import-linking.ts`) entscheidet nur, ob ein Paar
  überhaupt genannt wird. Paare, die nur danach passen (z.B. abweichender
  Nachname), sind „unklar“.
- Passt jemand zu mehreren (gleichnamige Geschwister), sind alle diese Paare
  „unklar“ — strenger als die Liste.
- Miteinander verbundene Personen und eingetragene Vorfahren/Nachkommen sind
  nie ein Paar; als „kein Duplikat“ markierte Paare fehlen.
- Der Dienst führt nichts zusammen. „Alle sicheren Folgedubletten“ gehen
  über `previewBulkMerge`/`bulkMerge`, die jedes Paar selbst noch einmal
  bewerten; „wahrscheinlich“ und „unklar“ gehen nie mit.
- Lädt wie die Dublettenliste den ganzen sichtbaren Graphen
  (`loadDuplicatePeople`) — einmal je Ergebnisseite.

**Rechte/Datenschutz:** Nur Paare, deren beide Personen der Benutzer
bearbeiten darf. Unbekannte oder nicht sichtbare Ausgangspersonen ergeben
schlicht nichts. Die Abstammung läuft nur über sichtbare Personen.

**Benutzt von:** `app/api/persons/merge/followups/route.ts`; Typen in
`components/FollowUpDuplicates.tsx`.

**Tests:** `tests/merge-followups.db.test.ts`;
`e2e/write/merge-comfort.spec.ts`.

### lib/services/redirects.ts

**Zweck:** Alte Kennung als Umleitung. Nach einem Zusammenführen zeigt die
Kennung der aufgegangenen Person auf die bleibende (Tabelle
`PersonRedirect`), damit Links, Lesezeichen und Kennungen, die sich eine
KI gemerkt hat, weiter zum richtigen Eintrag führen.

**Wichtige Funktionen:**
- `recordPersonRedirect(db, fromId, toId, now)` — im Zusammenführen, in
  dessen Transaktion und vor dem Löschen der aufgehenden Person: trägt
  aufgegangen → bleibend ein und biegt alles, was bisher auf die aufgehende
  Person zeigte, auf die bleibende um.
- `resolvePersonRedirects(scope, ids)`, `resolvePersonRedirect(scope, id)`
  — alte → heutige Kennung. Der Scope darf als Funktion kommen und wird dann
  nur geladen, wenn es überhaupt eine Umleitung gibt.
- `mergedIntoError(scope, id)` — für schreibende Aufrufe: Konflikt mit
  `mergedInto` in den Details, oder `null`.
- `backfillPersonRedirects()` — Rückfüllung aus dem Audit;
  `ensurePersonRedirectBackfill()` stößt sie je Serverprozess einmal an.

**Regeln und Entscheidungen:**
- **Keine Ketten:** Geht die bleibende Person später selbst auf, zeigen alle
  ihre alten Kennungen danach direkt auf die neue bleibende Person. Ein
  Nachschlagen genügt.
- **Nur Personen.** Aufgegangene Beziehungen und Ereignisse bekommen keine
  Umleitung.
- Eine Kennung, zu der es eine Person gibt, wird nie umgeleitet.
- Wird die bleibende Person gelöscht, verschwinden ihre alten Kennungen mit
  (Cascade) — die alte Adresse ist dann wieder „nicht gefunden“.
- **Lesen leitet um, Schreiben nicht:** Seiten und `GET` antworten mit 308;
  `PATCH`/`DELETE` auf eine alte Kennung mit 409 und `mergedInto`, damit
  der Aufrufer bewusst den bleibenden Eintrag nimmt. Der KI-Zugang löst
  dagegen still auf und meldet `resolvedFrom` ([mcp.md](mcp.md)).
- **Rückfüllung im Code statt in der Migration:** Die Migration legt nur die
  Tabelle an — sie kann so an keinen Daten scheitern, und das Prüfskript für
  rein ergänzende Migrationen lässt ohnehin kein `INSERT` zu. Zusammenführungen
  aus der Zeit davor trägt `backfillPersonRedirects` nach: je `MERGE`-Eintrag
  des Audits `diff.mergeId` → `entityId`, dazu die Gruppen abgeschlossener
  Läufe von „Importe verbinden“ (`CONNECT`, `diff.clusters`, ohne die dort
  als fehlgeschlagen vermerkten; ein `MERGE`-Eintrag hat Vorrang). Gelesen
  werden nur Zeilen mit den erwarteten Schlüsseln (`jsonb_typeof`, keine
  Umwandlungen, die werfen könnten); Ketten werden bis zum Ende verfolgt,
  Kreise übersprungen; eingetragen wird nur, wenn es die alte Person nicht
  mehr und das Ziel noch gibt; vorhandene Einträge bleiben
  (`ON CONFLICT DO NOTHING`). Beliebig oft wiederholbar.
- Die Rückfüllung läuft je Serverprozess einmal, beim ersten Nachschlagen
  ohne Treffer; ein Fehler landet im Server-Log, hält keinen Aufruf auf und
  wird frühestens nach einer Minute erneut versucht.

**Rechte/Datenschutz:** Aufgelöst wird nur, wenn der Benutzer die
**bleibende** Person sehen darf. Sonst gibt es keine Antwort — genau wie bei
einer unbekannten Kennung (404 bzw. „nicht gefunden“); eine Umleitung verriete
sonst, dass es eine verborgene Person gibt.

**Benutzt von:** `merge.ts`; `changes.ts` (Vorgänger im Personenverlauf);
`app/people/[id]/page.tsx`,
`app/people/[id]/edit/page.tsx`, `app/tree/page.tsx`,
`app/api/persons/[id]/route.ts`; `mcp/person-redirects.ts`, `mcp/tools.ts`.

**Tests:** `tests/person-redirect.db.test.ts` (Anlegen, Kette, Sichtbarkeit,
gelöschtes Ziel, Rückfüllung gegen einzelne, gesammelte, verkettete und
verbundene Zusammenführungen, unbrauchbare Audit-Einträge, KI-Zugang);
`e2e/write/merge-comfort.spec.ts` (308, 409, 404).

---

## Bezugsperson und Karte

### lib/services/reference.ts

**Zweck:** Bezugsperson eines Benutzers („das bin ich“ bzw. vorübergehend eine
andere Person) und die Verwandtschaft und Linien aller Personen von ihr aus.

**Wichtige Funktionen:**
- `resolveReference(scope, {param, cookie}, visible?)` — wirksame
  Bezugsperson: Adresse vor Cookie vor eigener Person; „ich“ in der Adresse
  übergeht ein gemerktes Cookie.
- `referenceView(graph, choice, onlyIds?)` — Bezeichnungen und Linien für die
  Anzeige, Großeltern je Linie; `onlyIds` liefert nur diese Personen aus
  (berechnet wird trotzdem in einem Durchgang).
- `loadReferenceFor(scope, input, personId)` — für die Personenseite: Graph
  laden, Bezugsperson auflösen, eine Person beschreiben.
- `setSelfPerson(scope, personId|null)` — „das bin ich“ setzen bzw. aufheben.
- `visibleIndex(graph)` — Graph nur aus sichtbaren Personen und Kanten
  zwischen ihnen. `storedSelfPersonId(scope)` — gespeicherte eigene Person,
  ungeprüft.

**Regeln und Entscheidungen:** Unbekannte und gesperrte Kennungen fallen still
weg (unbekannt und gesperrt sehen gleich aus). Kennungen müssen dem Muster
`REFERENCE_ID_PATTERN` entsprechen.

**Rechte/Datenschutz:** Verwandtschaft und Linien werden nur über sichtbare
Personen berechnet. Eine gesperrte Person ist nie Bezugsperson, bekommt keine
Bezeichnung und keine Linie, und kein Weg führt über sie; zusätzlich verlässt
nur Sichtbares den Server. `setSelfPerson` nimmt nur sichtbare Personen
(sonst `NOT_FOUND`). Das Setzen für andere Benutzer durch Administratoren
liegt nicht in diesem Dienst (unklar, wo genau — vermutlich in der
Benutzerverwaltung unter `app/api/users`).

**Protokoll:** `UPDATE User` mit der neuen `personId`.

**Benutzt von:** `app/tree/page.tsx`, `app/api/me/person/route.ts`,
`components/ReferencePanel.tsx` (Server-Komponente); `map.ts`;
`research-progress.ts` (Ausgangsperson des Forschungs-Fortschritts);
`lib/reference.ts` (`visibleIndex`).

**Tests:** `tests/reference.db.test.ts`, `tests/reference.test.ts`;
`e2e/read/reference.spec.ts`, `e2e/write/reference.spec.ts`.

### lib/services/map.ts

**Zweck:** Daten der Karte „Wurzeln nach Jahr“ für eine Ausgangsperson,
einmal auf dem Server gerechnet (`buildMapData` in `lib/map/build.ts`).

**Wichtige Funktionen:**
- `loadMapView(scope, {person, cookie, mode, currentYear})` — Ausgangsperson
  (wie die Bezugsperson aufgelöst), Modus `ancestors` (Vorfahren samt
  Ausgangsperson) oder `all` (alle sichtbaren Personen; Standard ohne
  Ausgangsperson), Großeltern je Linie, Kartendaten, Zahl der ausgewählten
  Personen, Laufzeit.

**Regeln und Entscheidungen:** Orte kommen aus Geburt, Tod, Heirat und
Scheidung (Ort an der Beziehung, für beide Partner der Auswahl) und aus
Ereignissen mit Ort (keine Zweitangaben); Beerdigung und Einäscherung sind
gekennzeichnet. Koordinaten kommen aus der Tabelle `Place` (nur zugeordnete,
nicht „nicht zuordenbar“). Für die Zeitreise zusätzlich eine Abfrage der
Taufen (Taufe, Kindstaufe, Erwachsenentaufe; mit Datum, auch ohne Ort, keine
Zweitangaben; je Person die früheste) und die Hochzeiten aus dem schon
geladenen Graphen (`pickMarriages`).

**Rechte/Datenschutz:** Grundlage sind nur sichtbare Personen; Vorfahren und
Linien auf dem Graphen der sichtbaren Personen (`visibleIndex`). Gesperrte
Personen tauchen weder auf der Karte noch in einer Zahl auf; Großeltern nur,
wenn sichtbar. Taufen nur von Personen der Auswahl; eine Hochzeit nur, wenn
beide Partner sichtbar sind (wie beim Lebensweg). Die Ortstexte und die Zuordnungsliste selbst sieht nur ein
Administrator (`places.ts`).

**Protokoll:** —

**Benutzt von:** `app/map/page.tsx`, `app/api/map/route.ts`.

**Tests:** `tests/map.db.test.ts` (Regeln: `tests/map.test.ts`);
`e2e/read/map.spec.ts`.

### lib/services/life-path.ts

**Zweck:** Betriebsart „Lebensweg“ der Karte: die Orte eines Lebens bzw. die
Geburtsorte einer Vater- oder Mutterlinie als fertiger Weg für
`LifePathMap` (Regeln der Reihenfolge, des Zusammenfassens und der
Linienwahl in `lib/map/life-path.ts`).

**Wichtige Funktionen:**
- `loadLifePathView(scope, {person, cookie, kind})` — Ausgangsperson wie die
  Karte (`resolveReference`: Adresse, Cookie, „das bin ich“; gesperrte
  Kennung fällt still zurück), Art `person`/`father`/`mother`, Weg, Grund
  des Linienendes, Laufzeit. Ohne sichtbare Person `person: null`, `path: null`.
- `loadLifePath(scope, personId, kind)` — nur der Weg; null, wenn die
  Person nicht sichtbar ist.
- `lifePathEntry(scope, personId)` — für die Personenseite: `person`, wenn
  der eigene Weg mindestens zwei Punkte auf der Karte hat, sonst `father`
  bzw. `mother` (beide Linien in einem Durchgang), sonst null.

**Regeln und Entscheidungen:**
- Person: Stationen sind Geburts- und Sterbeort, Ort von Heirat/Scheidung
  bzw. Beginn/Ende einer Partnerschaft und alle Ereignisse mit Ort der
  Person und ihrer Partnerschaften (ohne Zweitangaben). Geburt hat die
  Rolle „start“, Tod „end“ (Rang 0), Beerdigung/Einäscherung/
  Testamentseröffnung (`POSTHUMOUS_EVENT_TYPES`) „end“ (Rang 1), alles
  andere „middle“. Titel: Ereignisart (bzw. Bezeichnung), bei Ereignissen
  einer Partnerschaft „(mit <Partner>)“; Zusatz ist der Wert (Beruf …).
- Linien: Generation für Generation über `walkLines` (eine Abfrage der
  leiblichen Eltern je Generation für beide Linien), höchstens 12
  Generationen plus eine Abfrage, um „Grenze erreicht“ von „nicht erfasst“
  zu unterscheiden. Station je Vorfahr: Geburtsort, sonst Taufort
  (Taufe/Kindstaufe, früheste zuerst, wie „Wurzeln“); Datum der Geburt,
  sonst der Taufe („geboren …“ bzw. „getauft …“); Zusatz ist die
  Verwandtschaftsstufe (`ringRelationTerm`, „Ausgangsperson“ für die Person
  selbst) und ggf. „Ort der Taufe“. Älteste Generation zuerst.
- Orte: eine Abfrage der Tabelle `Place` für alle Ortstexte (`placeKey`);
  „nicht zuordenbar“ bzw. ohne Koordinaten nicht auf der Karte, „unsicher“
  gilt wie auf der Karte.
- Leistung: nie eine Abfrage je Station, nie der ganze Graph, nie die
  Kartendaten „alle“ (Person: drei Abfragen; Linie: höchstens 13 plus zwei).

**Rechte/Datenschutz:** Ausgangsperson nur, wenn sichtbar. Heirat, Scheidung
und Ereignisse einer Partnerschaft nur mit sichtbarem Partner (strenger als
die Ereignisliste der Personenseite, die Ereignisse einer Ehe mit gesperrtem
Partner zeigt; Ort und Datum der Ehe zeigt die Personenseite nur an der
Karte eines sichtbaren Partners). Von nicht sichtbaren Eltern werden Daten
nicht behalten; ihr Geschlecht fließt nicht in die Linienwahl ein. Ein nicht
sichtbarer Vorfahr beendet die Linie mit `lineEnd: "restricted"` — ohne
Kennung, Name, Ort oder Jahr in der Antwort.

**Protokoll:** —

**Benutzt von:** `app/map/page.tsx`, `app/api/map/route.ts`,
`app/people/[id]/page.tsx` (`lifePathEntry`).

**Tests:** `tests/life-path.db.test.ts` (Regeln: `tests/life-path.test.ts`);
`e2e/read/lifepath.spec.ts`.

### lib/services/places.ts

**Zweck:** Ortszuordnung: vorkommende Ortstexte → Koordinaten (Ortsverzeichnis
aus `lib/places/`), Pflege durch Administratoren.

**Wichtige Funktionen:**
- `collectPlaceTexts()` — alle Ortstexte aus Geburt, Tod, Heirat, Scheidung
  und Ereignissen, nach Vergleichsschlüssel (`placeKey`) gruppiert, mit
  häufigster Schreibweise, Anzahl und Zahl der Schreibweisen.
- `listPlaces(scope, {status, q, page})` — Liste mit Status (offen,
  automatisch, bestätigt, nicht zuordenbar), Zählungen und Vorschlag aus dem
  Verzeichnis (nur für die angezeigte Seite, 50 je Seite).
- `searchPlaceDirectory(scope, text)` — höchstens 20 Treffer im Verzeichnis.
- `assignPlace(scope, input)` — von Hand: Verzeichniseintrag übernehmen,
  Koordinaten eingeben, automatische Zuordnung bestätigen, „nicht
  zuordenbar“ markieren oder zurücksetzen (`placeAssignSchema`).
- `autoAssignPlaces(scope)` — Knopf „Automatisch zuordnen“ (Altbestand):
  ordnet alle Ortstexte neu zu, die weder von Hand bestätigt noch von der KI
  gesetzt sind (Ergebnis zählt beide getrennt: `manual`, `ai`).
- `assignNewPlaceTexts(actor, texts?)` / `queuePlaceAutoAssign(scope,
  texts?)` / `placeAutoAssignIdle()` — **Zuordnung ohne Knopfdruck:** nach dem
  Speichern einer Person (Geburts-/Sterbeort), Beziehung (Orte von
  Beginn/Ende) oder eines Ereignisses (Ort) mit den gespeicherten Texten,
  nach dem GEDCOM-Import (`applyGedcomImport`) und dem Austausch-Import
  (`POST /api/import`) ohne Textliste (alle offenen). Nur Texte **ohne**
  Zuordnung, ohne Treffer bleiben sie offen. Läuft im Hintergrund des
  Node-Prozesses in einer Warteschlange (nacheinander); das Speichern wartet
  nicht und scheitert nie daran — Fehler nur im Server-Log („[places]“).
  Zusammenführen und „Importe verbinden“ erzeugen keine neuen Ortstexte und
  stoßen deshalb nichts an. Abschaltbar mit `PLACE_AUTO_ASSIGN=off` (so in
  `vitest.config.ts`).
  **Warten beim Speichern (seit 22.11.):** Mit `texts` (Speichern einer Person, Beziehung, eines Ereignisses) liefert `queuePlaceAutoAssign` ein Versprechen, das mit dem Ende dieses Laufs erfüllt ist, spätestens nach 1,5 s (`SAVE_WAIT_MS`), und nie abgelehnt wird; die Dienste warten darauf, damit die Seite nach dem Speichern den Ort gleich als Verweis zeigt. Ohne `texts` (nach Importen) kehrt es sofort zurück.
- `placeHint(scope, text)` — Vorschlag am Eingabefeld: dieselbe Regel wie die
  Automatik (`matchPlace`), dazu eigene Orte; Status gefunden / mehrdeutig /
  nicht gefunden, Anzeigename, Genauigkeit, `formerName` (früherer bzw.
  deutscher Name, über den erkannt wurde), `otherName`. Für Admins und
  Bearbeiter einer Familie (sonst `FORBIDDEN`). `warmPlaceDirectory` lädt das
  Verzeichnis vorab.
- `suggestPlaces(scope, text)` — Kandidaten für die KI (`suggest_place`):
  empfohlene Wahl der Automatik, die übrigen gleichnamigen Kandidaten mit
  Art, Einwohnerzahl, Land, Namensart (`nameKindOf`) und Entfernung, eigene
  Orte (`source: "own"`), ohne Treffer die Präfixsuche; die vorhandene
  Zuordnung des Texts (`current`) nur für Admins.
- `placeTextContext(scope, keys)` — nur Admins: je Ortstext Feldarten
  (birth, death, marriage, divorce, `event:<Art>`) mit Anzahl und
  Jahresspanne, ohne Personen (Kontext für `list_places`).
- `choosePlaceForEntry(scope, input)` — **Auswahl im Ortsfeld**
  (`POST /api/places/choose`): ordnet genau den Freitext eines Eintrags
  (Person, Ereignis oder Beziehung, `placeChoiceSchema`) einem
  Verzeichniseintrag oder eigenen Ort zu, Herkunft „von Hand“. Rechte: wer
  den Eintrag bearbeiten darf; der Text muss an ihm stehen. Bewusst nicht
  über die Admin-Route `/api/places` (die alle Ortstexte zeigt) — der enge
  Fall ändert nur die Zuordnung dieses einen Texts. Eine von Hand bestätigte
  Zuordnung desselben Texts mit anderem Ziel ändert nur ein Admin
  (`CONFLICT`), weil sie auch für Angaben anderer Personen gilt; andere
  Texte bleiben unberührt. Paket „Ort ausgewählt: …“.
- `assignPlacesByAi(scope, items)` — `assign_place`: bis `AI_ASSIGN_MAX` (50)
  Zuordnungen je Aufruf (`aiPlaceAssignSchema`: Verzeichniseintrag, eigener
  Ort mit Koordinaten und Bezeichnung, oder „nicht zuordenbar“; optional
  `uncertain`, `note`). Quelle `AI`; überschreibt `AUTO`/`AI`, nie `MANUAL`;
  der Text muss in den Daten vorkommen. Ergebnis je Eintrag mit `ok`/`error`
  — ein abgelehnter Eintrag hält die übrigen nicht auf.

**Eigene Orte:** Zuordnungen mit eigenen Koordinaten (ohne `gazetteerId`,
von Hand oder von der KI). Sie erscheinen in `placeHint` und `suggestPlaces`
als Kandidat, wenn ihr Text bzw. ihre Bezeichnung (erster Teil, ohne Klammer)
zum ersten Teil eines neuen Texts passt; sie gehen dem Verzeichnis vor, wenn
dieses nur einen allgemeineren Teil getroffen hat („Hof Lindenau, Amt
Peine“ → der eigene Hof, nicht Peine). Die automatische Zuordnung nutzt sie
nicht (offene Frage: Weiler gleichen Namens).

**Regeln und Entscheidungen:** Von Hand Bestätigtes (`MANUAL`) und
KI-Zuordnungen (`AI`) werden von der Automatik nie überschrieben oder
gelöscht. Bestätigen (`confirm`) macht aus `AUTO` bzw. `AI` (bei der KI auch
„nicht zuordenbar“) `MANUAL`, behält die Notiz und hebt „unsicher“ auf;
eine Wahl von Hand (Verzeichnis, Koordinaten) löscht Notiz und „unsicher“. Die Automatik legt neue
Zuordnungen an, aktualisiert geänderte Treffer und entfernt automatische
Zuordnungen ohne Treffer bzw. zu Texten, die nirgends mehr vorkommen.
Bestätigen ohne vorhandene Zuordnung → `CONFLICT`. Koordinaten werden auf 5
Nachkommastellen gerundet.

**Rechte/Datenschutz:** Liste, Kontext, Suche, Zuordnen nur
Administratoren — jede Funktion prüft selbst `isAdmin`, zusätzlich zur
Route, weil die Liste die Ortstexte **aller** Personen enthält, auch
gesperrter. Ausnahmen: `placeHint` (Bearbeiter) und `suggestPlaces` (jeder
Lesezugang) liefern nur Verzeichnisdaten und Bezeichnung/Koordinaten eigener
Orte (Entscheidung des Eigentümers: eigene Orte sollen wiederverwendet
werden), nie Personen oder Zählungen; die automatische Zuordnung prüft keine
Rechte (Systemvorgang nach eigenem Speichern).

**Protokoll:** Einträge mit `entityType` „Place“ (`CREATE`, `UPDATE` mit
Feldänderungen, `DELETE` mit vorherigem Stand), direkt über `auditData`
geschrieben. Paket „Ort zugeordnet: …“ bzw. ein Paket „Orte automatisch
zugeordnet“ für alle Einträge der Automatik — auch für die Zuordnung nach dem
Speichern (eigenes Paket im Namen dessen, der gespeichert hat, mit Kanal und
Schlüssel bei MCP). KI: Paket „Ort zugeordnet (KI): …“ bzw. „Orte zugeordnet
(KI)“, oder das mit `change_set_id` angegebene; Kanal `MCP` und
Schlüssel-ID. Im Changelog heißt die Herkunft `AI` „KI-Vorschlag“.

**Benutzt von:** `app/admin/places/page.tsx`, `app/api/places/route.ts`,
`app/api/places/search/route.ts`, `app/api/places/auto/route.ts`,
`app/api/places/suggest/route.ts`, `app/api/import/route.ts`; Dienste
`persons`, `relationships`, `events`, `gedcom-import` (Anstoß nach dem
Speichern); `mcp/tools.ts` (`suggest_place`, `list_places`, `assign_place`);
Typen in `components/PlaceAdmin.tsx`, `components/PlaceHint.tsx`.

**Tests:** `tests/map.db.test.ts`, `tests/places-ai.db.test.ts` (Vorschlag
samt Route und Rechten, Automatik nach Speichern/Import ohne MANUAL/KI zu
überschreiben, Fehler ohne Folgen, MCP-Werkzeuge, Bestätigen) (Regeln:
`tests/places.test.ts`); `e2e/write/places.spec.ts`.

---

### lib/services/place-pages.ts

**Zweck:** Ortsseiten (`/places/<ref>`) und Ortsverweise für die
Personenseite und den KI-Zugang.

**Wichtige Funktionen:**
- `placeRefOf(row)` — Kennung eines Orts: `g-<gazetteerId>` bzw. bei eigenen
  Orten `c-<Breite>_<Länge>` (5 Nachkommastellen); keine Kennung für „nicht
  zuordenbar“ oder ohne Koordinaten. `placeRefForText(text)`.
- `placeLinksFor(texts)` — EINE Abfrage je Seite: Schlüssel (`placeKey`) →
  Kennung, Anzeigename, Kurzform ohne Klammer, Koordinaten und `same` (der
  Freitext nennt den Ort schon so, dann kein Zusatz „→ …“).
- `placeRowsOf(ref)`, `getPlacePage(scope, ref, {page})` — Ort mit heutigem
  Namen, Region, Land (aus dem Verzeichnis), Koordinaten, Art, Einwohnerzahl,
  Herkunft der Zuordnung(en), Begründungen (nur Admins), weiteren Namen aus
  dem Verzeichnis (darunter der frühere/deutsche), den vorkommenden
  Freitexten mit Anzahl und den Angaben sichtbarer Personen (Geburt, Tod,
  Heirat/Partnerschaft, Scheidung, Ereignisse mit Art und Jahr), 50 je Seite.

**Regel „ein Ort“ (Entscheidung):** Alle Zuordnungen mit demselben
Verzeichniseintrag bilden einen Ort, eigene Orte ohne Verzeichniseintrag
mit denselben Koordinaten (wie gespeichert, 5 Nachkommastellen). So zeigen
„Breslau“, „Breslau, Schlesien“ und „Wrocław“ auf eine Seite.

**Kein Fremdschlüssel:** Personen, Beziehungen und Ereignisse tragen nur den
Freitext; die Verbindung zum Ort läuft über den normalisierten Text
(`Place.key`).

**Rechte/Datenschutz:** Jeder Angemeldete sieht Ortsseiten — aber nur
Angaben sichtbarer Personen (`personVisibilityFilter`; Ehen je sichtbarem
Partner, Ereignisse an Beziehungen je sichtbarem Partner). Gesperrte
erscheinen weder als Eintrag noch in einer Zahl; Freitexte, die nur bei
ihnen vorkommen, fehlen. Ohne jede sichtbare Angabe gilt der Ort für
Nicht-Admins als nicht vorhanden (404), damit die Seite nichts über
verborgene Personen verrät. Admins sehen alles samt Begründungen.

**Benutzt von:** `app/places/[ref]/page.tsx`, `app/people/[id]/page.tsx`,
`mcp/tools.ts` (`get_place`, `places` in `get_person`/`list_events`).

**Tests:** `tests/place-pages.db.test.ts`; `e2e/write/places.spec.ts`.

### lib/services/place-export.ts

**Zweck:** Orte im Export.

**Wichtige Funktionen:** `gedcomPlaceResolver(texts)` (Ortstext → GEDCOM-PLAC,
eine Abfrage), `presentDayName` („Ort, Region, Land“ aus dem Verzeichnis,
heutiger Name ohne Klammer), `ORIGINAL_TEXT_PREFIX`, `exchangePlacesFor`.

**Regeln (Entscheidung des Eigentümers, immer, ohne Schalter):** Für einen
zugeordneten Ortstext schreibt der GEDCOM-Export die heutige Form „Ort,
Region, Land“ (Bestandteile wie im Verzeichnis, also in der Landessprache:
„Wrocław, Województwo dolnośląskie, Polen“; eigene Orte: ihre Bezeichnung
ohne Klammer), darunter `MAP`/`LATI`/`LONG` (N/S/E/W) und — wenn er
abweicht — `NOTE Originaltext: …`. Nicht zugeordnete und „nicht
zuordenbare“ Orte bleiben Freitext. Gilt für alle PLAC-Stellen (Geburt,
Tod, Ereignisse, Heirat, Scheidung). Der eigene Import liest den
Originaltext zurück (`originalPlaceText`). Das Austauschformat behält den
Freitext und nimmt die Zuordnungen der exportierten Texte zusätzlich mit
(`places`, Version 5; Begründungen nur, wenn ein Admin exportiert); beim
Einspielen werden nur Texte ohne vorhandene Zuordnung übernommen
(`app/api/import/route.ts`, protokolliert als „Place“).

**Benutzt von:** `lib/services/gedcom-export.ts`,
`lib/services/exchange-export.ts`.

**Tests:** `tests/place-pages.db.test.ts`.

### lib/services/place-areas.ts

**Zweck:** Ortstexte auf Länder bzw. Regionen abbilden — gemeinsamer
Baustein für Auswertungen („Wurzeln“ und Seite „Statistik“).

**Wichtige Funktionen:** `placeAreasFor(texts, level)` — Ergebnis
`placeKey` → Gebiet (`lib/places/area.ts`, `placeArea`). Eine Abfrage der
Tabelle `Place` für alle Texte; das Ortsverzeichnis (`getGazetteer`) nur
bei Stufe „Region“ und nur, wenn eine Zuordnung eine Verzeichniskennung
hat (erster Aufruf rund 1 s, danach zwischengespeichert).

**Rechte/Datenschutz:** Keine eigene Prüfung — der Aufrufer reicht nur
Ortstexte von Angaben, die der Benutzer sehen darf. Heraus kommen nur
Länder- bzw. Regionsnamen, keine Koordinaten, keine Notizen der Zuordnung.

**Benutzt von:** `lib/services/roots.ts`, `lib/services/statistics.ts`.

**Tests:** über `tests/roots.db.test.ts` und `tests/statistics.db.test.ts`; Regeln in `tests/roots.test.ts`.

### lib/services/roots.ts

**Zweck:** Abschnitt „Wurzeln“ der Personenseite: aus welchen Ländern bzw.
Regionen die Vorfahren einer Person stammen, als Anteile (Rechnung:
`lib/roots.ts`).

**Wichtige Funktionen/Typen:** `getPersonRoots(scope, personId,
{generations, level})` → `PersonRootsDto` (Generation, Stufe, Stücke mit
Anteil, ganzen Prozent und Farbe, Plätze in Generation N und davon besetzte,
Zahl der leiblichen Eltern) oder `null`; `parseRootsOptions` (Generation
2…8, Standard 4; Stufe `country`/`region`, Standard `country`; sonst
VALIDATION).

**Regeln:**
- **Eltern:** nur `PARENT_OF` mit Untertyp `BIOLOGICAL` — keine Adoptiv-,
  Stief- oder Pflegeeltern. `getAncestors` (`research.ts`) wird bewusst
  nicht benutzt: es lädt den ganzen Graphen, nimmt alle Elternarten und
  besucht jede Person nur einmal (kein Ahnenschwund).
- **Laden:** Generation für Generation eine Abfrage der Eltern der zuletzt
  gefundenen sichtbaren Personen (höchstens N Abfragen mit je höchstens
  2^g Kennungen; Ahnenschwund und Zyklen fragen nichts doppelt), dann eine
  Abfrage der Taufen und eine der Ortszuordnungen. Nie eine Abfrage je
  Vorfahr, nie der ganze Graph — gemessen auf den Mock-Daten 10–50 ms
  (Stufe „Region“ beim ersten Aufruf zusätzlich das Laden des
  Ortsverzeichnisses).
- **Ort eines Vorfahren:** Geburtsort; fehlt er, der Ort der frühesten
  Taufe (`BAPTISM`, `CHRISTENING`; Erwachsenentaufe zählt nicht), nie eine
  Zweitangabe (`isAlternative`). Kein Ort → „Unbekannt“; Ort ohne
  verwertbare Zuordnung → „Ort nicht zugeordnet“ (`lib/places/area.ts`).

**Rechte/Datenschutz:** Ausgangsperson nicht sichtbar oder nicht vorhanden →
`null` (API: 404). Von nicht sichtbaren Vorfahren wird der Geburtsort nicht
behalten, keine Taufe gelesen und keine Eltern gesucht; ihr Anteil heißt
„Nicht freigegeben“. Die Antwort enthält keine Personen, Namen oder
Ortstexte — nur Gebietsnamen, Anteile und Zählungen. Die gezählten
„Linien“ umfassen nur sichtbare Vorfahren. Dass es an einer Stelle einen
nicht freigegebenen Vorfahren gibt, ist wie im Stammbaum (Platzhalter)
erkennbar — mehr nicht.

**Protokoll:** — (nur lesend).

**Benutzt von:** `app/people/[id]/page.tsx` (Standard gleich mitgeliefert),
`app/api/persons/[id]/roots/route.ts`.

**Tests:** `tests/roots.db.test.ts` (Regeln: `tests/roots.test.ts`);
`e2e/read/roots.spec.ts`.

### lib/services/biography.ts

**Zweck:** Abschnitt „Lebenslauf“ der Personenseite: der Text aus den
erfassten Daten (Satzbildung: `lib/biography.ts`, Eingabe:
`lib/biography-input.ts`).

**Wichtige Funktionen/Typen:** `getPersonBiography(detail, now?)` →
`Biography` oder `null` (zu wenig Daten).

**Regeln:**
- **Laden:** nimmt das `PersonDetail`, das die Seite ohnehin lädt; dazu
  höchstens EINE Abfrage `PARENT_OF` (Kinder der beiden sichtbaren
  leiblichen Eltern — für die Geschwisterstellung — und Eltern der
  sichtbaren Kinder — für die Zuordnung zur Partnerschaft; nur Kennungen
  und Untertyp). Keine Abfrage je Geschwister oder Kind. „Heute“ nach
  `calendarDayIn` (Europe/Berlin) für „lebt noch“.

**Rechte/Datenschutz:** Die Rechte stecken in `getPersonDetail` (nicht
sichtbare Person → die Seite ruft gar nicht erst auf; nicht sichtbare
Verwandte sind Platzhalter). Die Eingabe verwirft Platzhalter; die Kanten
enthalten Kennungen auch nicht sichtbarer Personen, die aber nie in den
Text gelangen. Antwort und Seitenquelltext nennen nur Sichtbares.

**Protokoll:** — (nur lesend).

**Benutzt von:** `app/people/[id]/page.tsx`.

**Tests:** `tests/biography.db.test.ts` (Regeln: `tests/biography.test.ts`);
`e2e/read/biography.spec.ts`.

### lib/services/ancestor-rings.ts

**Zweck:** Daten der Ansicht „Ringe“ der Baumseite: die Vorfahren einer
Person auf festen Plätzen eines Vollkreises (Platzvergabe, Begriffe:
`lib/ancestor-rings.ts`; Darstellung: `components/AncestorRings.tsx`).

**Wichtige Funktionen/Typen:** `loadAncestorRings(scope, rootId,
generations)` → `AncestorRingsDto` oder `null` — Mitte, sichtbare Personen
der Plätze (Name, Geschlecht, Lebensjahre kurz, Geburt und Tod
ausführlich), belegte Plätze (Generation, Platz, Art „person“ bzw.
„restricted“, Verwandtschaftsstufe, Gebietsschlüssel für „nach Wurzeln“),
Zahl der belegten und der nicht freigegebenen Plätze, Legende nach Land
(Schlüssel, Bezeichnung, Farbe, Zahl der Plätze). Die Tiefe kommt roh aus
der Adresse und wird mit `parseRingsGeneration` auf 3…7 begrenzt.
`defaultRingsRootId(scope)` — Mitte, wenn nichts anderes passt: die
jüngste sichtbare Person mit leiblichen Eltern (sonst irgendeine sichtbare),
eine Abfrage; ohne sichtbare Person `null`. Für beide Richtungen
exportiert: `RING_PERSON_SELECT`, `RingPersonRow`, `toRingPersonDto`
(Personenangaben der Flächen) und `ringPlaceLegend(rows, appearances)` —
Ort je Person, Land, Legende und Gebietsschlüssel je Person für „nach
Wurzeln“ (zwei Abfragen; wer mehrfach erscheint, zählt mehrfach).

**Regeln:**
- **Eltern:** nur `PARENT_OF` mit Untertyp `BIOLOGICAL` (wie „Wurzeln“),
  Reihenfolge nach Anlage — sie entscheidet bei gleichem bzw. unbekanntem
  Geschlecht über den Platz.
- **Laden:** Generation für Generation eine Abfrage der Eltern der zuletzt
  gefundenen sichtbaren Personen samt deren Angaben (höchstens N
  Abfragen; Ahnenschwund und Zyklen fragen nichts doppelt), dann eine der
  Taufen (nur für Vorfahren ohne Geburtsort) und eine der Ortszuordnungen
  (`placeAreasFor`, Stufe Land). Nie eine Abfrage je Vorfahr, nie der ganze
  Graph.
- **Seite im Begriff:** „väterlicherseits“/„mütterlicherseits“ nur, wenn der
  Elternplatz der Mitte nachweislich vom Vater bzw. von der Mutter belegt
  ist; sonst der Begriff ohne Seite.
- **Färbung nach Land:** Ort wie bei „Wurzeln“ (Geburtsort, sonst früheste
  Taufe ohne Zweitangabe). Legende über `groupAreaSlices` mit der Zahl der
  Plätze als Wert (Ahnenschwund zählt mehrfach); Gebiete jenseits der acht
  Farben werden „Sonstige“, dazu „Ort nicht zugeordnet“, „Unbekannt“,
  „Nicht freigegeben“.

**Rechte/Datenschutz:** Mitte nicht sichtbar oder nicht vorhanden → `null`
(Seite: „Person nicht gefunden“). Ein nicht sichtbarer Vorfahr erscheint
nur als Platz „restricted“ — ohne Kennung, Name, Daten, Ort; sein
Geschlecht wird für die Platzvergabe als unbekannt behandelt (und der
Begriff neutral: „Großelternteil“), seine Eltern werden nicht gesucht.
`persons` enthält genau die Mitte und die sichtbaren Personen der Plätze.

**Protokoll:** — (nur lesend).

**Benutzt von:** `app/tree/page.tsx` (`view=rings`).

**Tests:** `tests/ancestor-rings.db.test.ts` (Plätze, Begriffe, Rechte,
Tiefe, Startperson; Regeln: `tests/ancestor-rings.test.ts`);
`e2e/read/rings.spec.ts`.

### lib/services/descendant-rings.ts

**Zweck:** Daten der Ansicht „Ringe“ in der Richtung „Nachfahren“: die
Nachkommen einer Person als Vollkreis, aufgeteilt nach der Größe der
Teilbäume (Aufteilung, Gruppen, Obergrenze, Begriffe:
`lib/descendant-rings.ts`; Darstellung: `components/AncestorRings.tsx`).

**Wichtige Funktionen/Typen:** `loadDescendantRings(scope, rootId,
generations, maxSegments?)` → `DescendantRingsDto` oder `null` — Mitte,
gewählte und gezeigte Tiefe, tiefste Generation, ob die Obergrenze griff,
sichtbare Personen der Flächen, sichtbare Partner (Namen) je Person,
Flächen (Schlüssel, Generation, Winkel, Linie, Elternfläche,
Verwandtschaftsstufe; sichtbar zusätzlich Kennung, Adoption,
Gebietsschlüssel), Zahl der Nachkommen und der nicht freigegebenen
Flächen, Linien (je Kind der Mitte Farbe und Zahl der Flächen), Legende
nach Land. Die Tiefe kommt roh aus der Adresse (3…7, Standard 4).
`defaultDescendantRingsRootId(scope)` — Mitte, wenn nichts anderes passt:
die älteste sichtbare Person mit Kindern (sonst irgendeine sichtbare); eine
Abfrage, ohne sichtbare Person `null`.

**Regeln:**
- **Kinder:** `PARENT_OF` mit Untertyp `BIOLOGICAL` oder `ADOPTIVE` — so
  zählt auch die Seite „Statistik“; Stief- und Pflegekinder nicht. Doppelt
  erfasst (leiblich und adoptiert): leiblich gewinnt. Reihenfolge: nach
  Geburtsdatum, ohne Datum danach, gleich nach Anlage der Person.
- **Partnerschaftsgruppen:** Schlüssel je Kind sind seine übrigen Eltern
  (leiblich/adoptiert), aus einer Abfrage über alle geladenen Kinder.
- **Partner in den Angaben:** `PARTNER_OF` der gezeigten Personen und der
  Mitte (eine Abfrage) sowie die Mit-Eltern ihrer gezeigten Kinder — nur
  sichtbare, als Name.
- **Laden:** Generation für Generation eine Abfrage der Kinder samt
  Angaben (höchstens N; Mehrfach-Nachkommen und Zyklen fragen nichts
  doppelt). Übersteigt die Zahl der Flächen die Obergrenze, wird nicht
  tiefer geladen. Danach je eine Abfrage für die übrigen Eltern, die
  Partnerschaften, die Taufen und die Ortszuordnungen (`ringPlaceLegend`).
  Nie eine Abfrage je Person, nie der ganze Graph.
- **Zählung:** jede sichtbare Person einmal, jede Fläche „nicht
  freigegeben“ als eine Person (ihre Kennung verlässt den Server nicht).

**Rechte/Datenschutz:** Mitte nicht sichtbar oder nicht vorhanden → `null`
(Seite: „Person nicht gefunden“). Ein nicht sichtbares Kind erscheint nur
als Fläche „restricted“ — ohne Kennung, Name, Daten, Ort, Geschlecht
(Begriff neutral: „Kind“, „Enkelkind“), ohne Adoptionsvermerk; nach seinem
Geburtsdatum wird nicht sortiert (es steht wie ein Kind ohne Datum), seine
Kinder werden nicht gesucht, im Gewicht zählt es als eine Person.
Begründung: Die Ansichten Fokus und Generationen zeigen nicht sichtbare
Kinder als anonymen Platzhalter (`maskPerson` in `lib/services/tree.ts`) —
dass dort jemand steht, ist also ohnehin ablesbar; die Ringe zeigen genau
das, aber nicht mehr. Hinter einem Gesperrten wird nicht weitergesucht
(wie bei den Vorfahren-Ringen), auch wenn dort wieder sichtbare Personen
stünden: Der Weg dorthin führte nur über Angaben, die der Benutzer nicht
sehen darf. `persons` enthält genau die Mitte und die sichtbaren Personen
der Flächen; Partner nur, wenn sichtbar.

**Protokoll:** — (nur lesend).

**Benutzt von:** `app/tree/page.tsx` (`view=rings&richtung=nachfahren`).

**Tests:** `tests/descendant-rings.db.test.ts` (Flächen, Begriffe,
Adoption, keine Stief-/Pflegekinder, Partner, Rechte, Tiefe, Obergrenze,
Startperson; Regeln: `tests/descendant-rings.test.ts`);
`e2e/read/rings.spec.ts`.

### lib/services/statistics.ts

**Zweck:** Daten der Seite „Statistik“ (`/statistics`): den sichtbaren Teil
des Stammbaums schlank laden, wahlweise auf eine Familie beschränken und mit
`computeStatistics` (`lib/statistics.ts`) auswerten.

**Wichtige Funktionen/Typen:** `getFamilyStatistics(scope, {familyId,
level})` → `FamilyStatisticsDto` (alle Auswertungen aus `StatisticsResult`,
dazu die wählbaren Familien und die gewählte Familie oder `null`);
`familyFilter(scope, familyIdRaw)` → wählbare Familien, wirksame Auswahl und
Prisma-Bedingung für die Personen (gemeinsam mit `lib/services/records.ts`).

**Regeln:**
- **Laden:** eine Abfrage der Personen — schon in der Datenbank auf sichtbare
  (`personVisibilityFilter`) und ggf. die gewählte Familie beschränkt, nur
  die Felder der Auswertung (keine Notizen, keine Bilder); eine Abfrage aller
  Beziehungen mit Kennungen, Art und Beginn (gefiltert im Speicher — eine
  `in`-Liste mit tausenden Kennungen wäre langsamer und begrenzt); eine der
  Taufen mit Ort (nur für Personen ohne Geburtsort verwendet); eine der
  Ortszuordnungen (`placeAreasFor`). Nie eine Abfrage je Person. Gemessen
  auf den Mock-Daten (195 Personen) 13 ms, Stufe „Region“ 20 ms (ohne das
  einmalige Laden des Ortsverzeichnisses); die reine Rechnung braucht für
  12 000 Personen und 18 000 Beziehungen rund 50 ms. `loadGraph` wird bewusst
  nicht benutzt: es lädt Notizen und Bilder mit.
- **Ort:** Geburtsort, sonst Ort der frühesten Taufe (`BAPTISM`,
  `CHRISTENING`, keine Zweitangabe) — wie „Wurzeln“.
- **Verstorben ohne Datum:** Sterbeort oder Wortlaut ohne Datum zählt als
  verstorben.
- **Stufe:** `region` oder sonst `country` (unbekannte Werte aus der Adresse
  gelten als Land, kein Fehler).

**Rechte/Datenschutz:** Gezählt wird nur, wer sichtbar ist — Datenbankfilter
und zusätzlich `canViewPerson` je Person. Beziehungen zählen nur zwischen
gezählten Personen (beim Familienfilter: nur innerhalb der Familie). Der
Familienfilter nimmt nur Familien aus `listFamilies` (Admin: alle, sonst die
eigenen); eine fremde oder unbekannte Kennung gilt als „Alle“, ohne Fehler
und ohne zu verraten, ob es sie gibt. Die Antwort enthält keine
Personenkennungen und keine einzelnen Personen — nur Summen, Namen und
Gebiete. Für lebende Personen kennt die App keine eigene Sichtbarkeitsregel
(Sichtbarkeit hängt nur an den Familien); die Seite nennt ohnehin niemanden
einzeln.

**Protokoll:** — (nur lesend).

**Benutzt von:** `app/statistics/page.tsx`. Kein MCP-Werkzeug (`get_statistics`
nutzt weiter `getStatistics` aus `research.ts`).

**Tests:** `tests/statistics.db.test.ts` (Regeln: `tests/statistics.test.ts`);
`e2e/read/statistics.spec.ts`.

### lib/services/records.ts

**Zweck:** Daten der Seite „Rekorde“ (`/records`): den sichtbaren Teil des
Stammbaums schlank laden, wahlweise auf eine Familie beschränken und mit
`computeRecords` (`lib/records.ts`) die Bestwerte mit Namen berechnen.

**Wichtige Funktionen/Typen:** `getFamilyRecords(scope, {familyId, now})` →
`FamilyRecordsDto` (`RecordsResult` plus wählbare Familien und gewählte
Familie oder `null`).

**Regeln:**
- **Laden:** eine Abfrage der Personen — in der Datenbank auf sichtbare und
  ggf. die gewählte Familie beschränkt (`familyFilter` aus
  `lib/services/statistics.ts`), nur die Felder der Auswertung und der
  Lebensjahre; eine Abfrage aller Beziehungen mit Kennungen, Art, Beginn und
  Ende (gefiltert im Speicher). Nie eine Abfrage je Person; `loadGraph` wird
  nicht benutzt (lädt Notizen und Bilder).
- **Anzeigename** „Vorname Nachname“, Lebensjahre über `lifeSpan`
  (wie „Wie sind wir verwandt?“).
- **Verstorben ohne Datum:** Sterbeort oder Wortlaut ohne Datum zählt als
  verstorben (nicht lebend, aber ohne Alter).

**Rechte/Datenschutz:** Genannt und gezählt wird nur, wer sichtbar ist —
Datenbankfilter und zusätzlich `canViewPerson` je Person. Beziehungen nur
zwischen gezählten Personen (beim Familienfilter: nur innerhalb der
Familie), Ehen also nur mit beiden Partnern sichtbar; Kinder, Nachkommen und
Linien nur über sichtbare Personen. Lebende Personen dürfen genannt werden
(Entscheidung des Eigentümers); es gelten allein die Sichtbarkeitsregeln. Der
Familienfilter nimmt nur Familien aus `listFamilies`; eine fremde oder
unbekannte Kennung gilt als „Alle“, ohne Fehler.

**Protokoll:** — (nur lesend).

**Benutzt von:** `app/records/page.tsx`. Kein MCP-Werkzeug.

**Tests:** `tests/records.db.test.ts` (Regeln: `tests/records.test.ts`);
`e2e/read/records.spec.ts`.

### lib/services/research-progress.ts

**Zweck:** Daten der Seite „Forschungs-Fortschritt“ (`/progress`): die
Vorfahren der Ausgangsperson bis zur gewählten Tiefe laden, die Belege von
Geburt und Tod dazu, und mit `computeProgress`
(`lib/research-progress.ts`) Vollständigkeit je Generation und Linie,
Qualität und Vorschläge berechnen.

**Wichtige Funktionen/Typen:** `getResearchProgress(scope, {person,
cookie, generations, now})` → `ResearchProgressPage` (Tiefe, Ausgangsperson
mit Name, Lebensjahren, „ich“ und Herkunft der Wahl oder `null`,
`notFound`, `hasSelf`, `ProgressResult` oder `null`). Die Tiefe kommt roh
aus der Adresse (`parseProgressGeneration`: 4…10, Standard 6).

**Regeln:**
- **Ausgangsperson:** `resolveReference` (`reference.ts`) — Adresse vor
  Cookie „Baum aus dieser Sicht“ vor „Das bin ich“; unbekannte und
  gesperrte Kennungen fallen still weg und setzen nur `notFound`.
- **Eltern:** nur `PARENT_OF` mit Untertyp `BIOLOGICAL` (wie „Ringe“ und
  „Wurzeln“), Reihenfolge nach Anlage.
- **Laden:** Generation für Generation eine Abfrage der Eltern der zuletzt
  gefundenen sichtbaren Personen samt ihren Angaben — bis zur Tiefe plus
  eins; die letzte Runde dient nur der Frage „beide Eltern erfasst?“ für die
  äußerste Generation, ihre Personen werden weder gezeigt noch weiter
  verfolgt. Ahnenschwund und Zyklen fragen nichts doppelt. Danach eine
  Abfrage aller Belege (`Citation`, Angabe `BIRTH`/`DEATH`) der gezeigten
  Personen samt Quellenart. Nie eine Abfrage je Vorfahr, nie der ganze
  Graph (bei Tiefe 10 höchstens 11 + 1 Abfragen plus die zwei der
  Bezugsperson).
- **Beleg:** mindestens ein Zitat einer Quelle, deren Art nicht
  `ONLINE_TREE` ist → „unabhängig“; nur Zitate fremder Stammbäume → „nur
  Hinweis“; sonst „kein Beleg“. Belege an Taufe/Beerdigung (Ereignisse)
  zählen nicht — wie `findDataGaps` („Angaben ohne Beleg“).

**Rechte/Datenschutz:** Ausgangsperson muss sichtbar sein (sonst keine).
Ein nicht sichtbarer Vorfahr geht nur als Platz „nicht freigegeben“ in die
Rechnung — mit Geschlecht „unbekannt“, damit weder Platzvergabe noch der
Satz „Vater/Mutter fehlt“ etwas verraten; seine Angaben werden nicht
behalten, seine Eltern nicht gesucht, seine Belege nicht gelesen. Ein
gesperrter Elternteil gilt beim Kind als „erfasst“ (der Stammbaum zeigt ihn
ohnehin als Platzhalter), damit kein falscher Vorschlag „Eltern fehlen“
entsteht. Die Antwort enthält Kennungen, Namen und Angaben nur sichtbarer
Personen.

**Protokoll:** — (nur lesend).

**Benutzt von:** `app/progress/page.tsx`. Kein MCP-Werkzeug
(`find_data_gaps` bleibt unverändert).

**Tests:** `tests/research-progress.db.test.ts` (Regeln:
`tests/research-progress.test.ts`); `e2e/read/progress.spec.ts`.

### lib/services/today.ts

**Zweck:** Daten der Startseite „Heute in der Familie“ (`/`): Kandidaten
für Jahrestage schlank laden und mit `computeToday` (`lib/today.ts`)
auswerten.

**Wichtige Funktionen:** `getToday(scope, { day?, now? })` → `TodayResult`.
Ohne `day` gilt der heutige Tag nach Europe/Berlin (`calendarDayIn(now)`);
`now` ist für Tests einspeisbar.

**Laden:** drei Abfragen gleichzeitig, nie eine je Person, schon in der
Datenbank auf sichtbare Personen (`personVisibilityFilter`) und
tagesgenaue, sichere Daten (Genauigkeit Tag, Zusatz „genau“) eingegrenzt:
Personen mit solchem Geburts- oder Sterbedatum (nur Name, Daten,
Sterbeangabe, Familien); Partnerschaften der gezählten Unterarten mit
solchem Beginn, beide Partner sichtbar, samt Name und Familien beider
Partner; Lebensereignisse der gezählten Arten mit solchem Datum, ohne
Zweitangaben, samt Name und Familien der Person. Bei rund 12 000 Personen
bleibt das eine Handvoll schlanker Abfragen; die Auswertung läuft in einem
Durchgang im Speicher.

**Rechte:** zusätzlich je Person `canViewPerson` (zweite Sicherung neben dem
Datenbankfilter); eine Partnerschaft nur, wenn beide Partner sichtbar sind.
Nicht sichtbare Personen erscheinen nirgends, auch nicht als Zahl. Ohne
Familie ist alles leer.

**Protokoll:** — (nur lesend).

**Benutzt von:** `app/page.tsx`. Kein MCP-Werkzeug.

**Tests:** `tests/today.db.test.ts` (Regeln: `tests/today.test.ts`);
`e2e/read/today.spec.ts`.

---

## Änderungsgeschichte und KI-Zugang

### lib/services/changes.ts

**Zweck:** Changelog lesen: Verlauf einer Person für ihre Bearbeiter und
Übersicht der Pakete für Administratoren. Grundlage ist das `AuditLog` mit
Paket und Momentaufnahme der betroffenen Personen und Familien.

**Wichtige Funktionen:**
- `listPersonChanges(scope, personId, {cursor, limit})` — Einträge zu einer
  Person, neueste zuerst, seitenweise (Standard 20, höchstens 100; Cursor =
  Kennung des letzten Eintrags); dazu die Einträge der Personen, die in ihr
  aufgegangen sind (siehe unten, „Einträge aufgegangener Personen“).
- `listChangeSets(scope, filter, {page, limit})` — Pakete (bzw. ältere
  Einzeländerungen als `e:<Eintrag>`) mit Titel, Zeitraum, Zahl, Benutzer,
  Kanal, Schlüsselname und Zusammenfassung („2 Personen, 5 Belege angelegt ·
  1 Person geändert“).
- `listChangeSetEntries(scope, key, filter, {cursor, limit})` — Einträge eines
  Pakets.
- `changeFilterOptions(scope)` — Auswahllisten (Familien, Benutzer).
- `changeFilterFrom(params)` — Filter aus Suchparametern (`family`, `user`,
  `channel`, `from`, `to`).

**Regeln und Entscheidungen:**
- Je Eintrag: Kurzbeschreibung („Ereignis „Taufe“ geändert“, „Zusammengeführt:
  … in …“, „Beim Import angelegt: …“, „Ort zugeordnet: …“, „Einstellung „…“
  geändert“), Benutzer, Kanal,
  Schlüsselname, Paket und je Feld vorher → nachher mit deutschen Feldnamen;
  Kennungen werden nie als Feld angezeigt, lange Texte gekürzt.
- Ältere Einträge (vor dem Changelog) ohne Paket und Momentaufnahme: Der
  Personenverlauf findet sie über die heutigen Kennungen der Person, ihrer
  Ereignisse, Namen, Belege, Beziehungen und Bilder und zeigt nur den neuen
  Wert (`onlyNew`); in der Übersicht erscheinen sie als Einzeländerung, beim
  Familienfilter fehlen sie.
- Beim Import zählt die Zusammenfassung aus dem Import-Eintrag, nicht aus den
  Einträgen je Person (die würden doppelt zählen).
- Der Standardzeitraum der Übersicht (30 Tage) wird nicht hier, sondern in
  `app/admin/changes/page.tsx` gesetzt.

**Rechte/Datenschutz:** Personenverlauf nur für Bearbeiter der Person
(unsichtbar → `NOT_FOUND`, nur lesend → `FORBIDDEN`). Übersicht und
Paketeinträge nur für Administratoren. Verweise auf Personen und Familien,
die der Betrachter nicht sehen darf, erscheinen als „nicht freigegeben“;
Einträge über eine andere, nicht sichtbare Person (z.B. Zusammenführen eines
Verwandten aus fremder Familie) ohne Feldwerte. Ob die Person des Eintrags
sichtbar ist, entscheidet `subjectVisible` (siehe unten, „Personen, die es
nicht mehr gibt“).

**Protokoll:** — (nur lesend)

**Benutzt von:** `app/api/persons/[id]/changes/route.ts`,
`app/api/changes/route.ts`, `app/api/changes/[key]/route.ts`,
`app/admin/changes/page.tsx`; Typen in `components/ChangeEntryList.tsx`,
`components/ChangeSetList.tsx`, `components/PersonChanges.tsx`.

**Tests:** `tests/changelog.db.test.ts` (Regeln der Pakete:
`tests/changelog.test.ts`), `tests/changelog-subject.db.test.ts` (Personen,
die es nicht mehr gibt), `tests/changelog-merged.db.test.ts` (Einträge
aufgegangener Personen), `tests/changelog-untereintraege.db.test.ts`
(Familien in Einträgen zu Namen, Ereignissen, Belegen, Bildern,
Beziehungen); `e2e/write/changelog.spec.ts`.

**Gelöschte Schlüssel im Verlauf (seit 22.11.):** `tokenLabels(ids)` löst `apiTokenId` zu Namen auf. Fehlt der Schlüssel (endgültig gelöscht oder mit seinem Benutzer entfernt), kommt der Name aus dem letzten `CREATE`/`DELETE`-Protokolleintrag des Schlüssels, dazu `tokenDeleted: true`; ohne solchen Eintrag `tokenName: null`. Gilt für `listPersonChanges`/`listChangeSetEntries` und `listChangeSets`; Anzeige „KI über MCP · Schlüssel „Name“ (gelöscht)“ bzw. „· Schlüssel (gelöscht)“.

**Was Nicht-Admins im Verlauf sehen** (`toEntry`): Den **Namen eines
KI-Schlüssels** sehen nur sein Besitzer und Admins. Den **Titel eines
Pakets** sehen Admins und wer das Paket angelegt hat; alle anderen
bekommen `neutralChangeSetTitle` — „Import“ bzw. „KI-Änderungen“ oder den
Titel nur bis zum ersten Anführungszeichen (Titel können Dateinamen eines
Imports, frei gewählte Texte der KI, fremde Schlüsselnamen oder Ortstexte
enthalten). Tests: `tests/ai-token-delete.db.test.ts`.

**Personen, die es nicht mehr gibt (seit 26.11.):** Ob ein Personeneintrag
Feldwerte und Ergänzung zeigt, entscheidet `subjectVisible` — immer mit
`canViewPerson` aus `lib/scope.ts`, keine eigene Rechte-Logik:
- Gibt es die Person noch: ihre **heutigen** Familien (wie überall in der
  App).
- Gibt es sie nicht mehr (gelöscht oder aufgegangen): die im Eintrag
  gespeicherten Familien **zum Zeitpunkt des Eintrags**
  (`AuditLog.subjectFamilyIds`, geschrieben von `auditRefs` in
  `lib/audit.ts`; beim Löschen der letzte Stand davor). Wer die Person damals
  sehen durfte und die Familie heute noch hat, sieht die Werte wieder.
  „Ohne Familie“ bleibt wie bei lebenden Personen nur für Admins.
- Ältere Einträge ohne gespeicherte Familien (`subjectFamiliesKnown =
  false`): für Nicht-Admins verborgen, ohne Feldwerte — im Zweifel verbergen.
- Eine später gelöschte Familie gibt nichts frei: Ihre Mitgliedschaften
  verschwinden mit ihr, die gespeicherte Kennung passt zu niemandem mehr.
  Spätere Familien (der Person oder, nach dem Zusammenführen, der bleibenden
  Person) zählen nicht.
- „Person gelöscht: …“ zeigt den Namen nach derselben Regel (ältere
  Einträge: `familyIds` des Eintrags, beim Löschen ebenfalls die Familien
  der Person).

**Keine Rückfüllung** älterer Einträge: `familyIds` ist eine Vereinigung über
alle betroffenen Personen (beim Zusammenführen bleibende und aufgehende
Person samt Verwandten, bei „keine Dublette“ beide Personen, beim Ändern der
Familien alte und neue) und lässt sich nicht sicher der Person des Eintrags
zuordnen. Die Umleitung zur bleibenden Person (`redirects.ts`) bedeutet nicht
dieselbe Sichtbarkeit: Die bleibende Person hatte eigene Familien, übernimmt
die der aufgehenden und kann später weitere bekommen — ihre heutigen
Familien würden Bearbeitern Werte zeigen, die sie vorher nicht sahen.
Tests: `tests/changelog-subject.db.test.ts`; `e2e/write/changelog.spec.ts`
(„gelöschte Person: Feldwerte nur, wenn …“).

**Einträge aufgegangener Personen (seit 26.11.):** Der Verlauf der
bleibenden Person K zeigt auch die Einträge aller Personen, die in ihr
aufgegangen sind — über alle Stufen (X in Y, Y in K) —, zeitlich
einsortiert und mit `fromMerged: true` (Anzeige „aus zusammengeführtem
Eintrag“).
- **Quelle der Vorgänger:** die Umleitungen alter Kennungen
  (`PersonRedirect`, [redirects.ts](#libservicesredirectsts)), ein Zugriff
  `toId = K` (`mergedPredecessors`). Gewählt statt der `MERGE`-Einträge des
  Audits, weil die Umleitungen in der Transaktion des Zusammenführens
  entstehen, flach gehalten werden (keine Ketten, also keine Kreise und
  kein schrittweises Nachverfolgen), auch „Importe verbinden“ abdecken und
  für die Zeit davor aus dem Audit rückgefüllt werden (die Rückfüllung wird
  hier einmal je Prozess angestoßen). Kennungen, zu denen es noch eine
  Person gibt, zählen nie.
- **Abfrage:** dieselbe wie bisher, erweitert um `personIds && Vorgänger`
  bzw. bei ganz alten Einträgen ohne Momentaufnahme `Person` mit der alten
  Kennung; die Abfrage liefert je Eintrag, ob er K selbst betrifft. Ohne
  Vorgänger bleibt sie unverändert. Cursor und Seitengröße wie bisher.
  Einträge, die K und X betreffen (z.B. der Zusammenführen-Eintrag), gelten
  als eigene Einträge von K.
- **Leserecht:** für jeden übernommenen Eintrag `subjectVisible` — also die
  im Eintrag gespeicherten Familien, nie die heutigen Familien von K. Seit
  dem 26.11. speichern auch Namen, Ereignisse, Belege, Bilder und
  Beziehungen die Familien ihrer Person(en) (siehe `lib/audit.ts` in
  [bibliotheken.md](bibliotheken.md#libauditts)); bei mehreren Personen die
  Vereinigung — das entspricht der Regel für vorhandene Datensätze
  („sichtbar, sobald eine Seite sichtbar ist“, `carrierRights` in
  `lib/media-scope.ts`, `citationAccess`, `relationshipAccess`): Wer nur
  die andere Seite einer Beziehung sehen durfte, sieht die Werte, wer keine
  Seite sehen durfte, nicht. Altbestand und nicht eindeutige Einträge
  (`subjectFamiliesKnown = false`, z.B. Bild an einer Quelle) zeigen ihre
  Einzelheiten weiterhin nur Administratoren; keine Rückfüllung. Verborgene
  übernommene Einträge zeigen auch keine Beschreibung (sie nennt Namen,
  Ereignis- oder Quellentitel), nur Art und Aktion („Ereignis angelegt“),
  keine Feldwerte und keine Ergänzung.
- **Namen:** In übernommenen Einträgen steht für eine alte Kennung der Name
  der heutigen Person K (statt „gelöschte Person“); das betrifft nur die
  Anzeige (`Ctx.aliases`), nie das Leserecht.
- Wer K nicht bearbeiten darf, sieht wie bisher gar nichts.
Tests: `tests/changelog-merged.db.test.ts`,
`tests/changelog-untereintraege.db.test.ts` (je Eintragsart, Mehr-Personen-Fall,
Altbestand); `e2e/write/changelog.spec.ts` („bleibende Person zeigt die
Einträge aufgegangener Personen …“).

### lib/services/ai-access.ts

**Zweck:** KI-Zugang (MCP): Benutzerrecht, persönliche Schlüssel und die
Prüfung bei jedem Werkzeugaufruf.

**Wichtige Funktionen:**
- `getAiAccessInfo(scope)` — eigenes KI-Recht, Zahl der aktiven Schlüssel und
  Grenzen (höchstens 10 aktive, Standard 90 Tage, höchstens 365 Tage; aus
  `lib/validation.ts`).
- `createApiToken(scope, input)` — neuer Schlüssel; das Geheimnis steht nur in
  diesem Ergebnis.
- `listApiTokens(scope)` — eigene Schlüssel ohne Geheimnis und Hash, mit
  Status (aktiv, widerrufen, abgelaufen).
- `revokeApiToken(scope, tokenId)` — widerrufen (eigene; fremde nur als
  Administrator); wiederholtes Widerrufen ändert nichts.
- `setUserAiAccess(scope, userId, input)` — KI-Recht eines Benutzers setzen
  (`NONE`/`READ`/`WRITE`), nur Administratoren.
- `listAllApiTokens(scope, {userId})` — alle Schlüssel mit Besitzer, nur
  Administratoren.
- `verifyApiToken(secret)` — vorgelegten Schlüssel prüfen.
- `authorizeAiCall(credential, need)` — Wächter für jeden Werkzeugaufruf
  (Schlüssel aus dem HTTP-Header oder lokaler Entwicklungsmodus per E-Mail mit
  `allowWrite`); liefert Scope mit `via`, wirksame Stufe und Schlüssel-ID.
- `effectiveAiLevel`, `aiLevelSatisfies`, `AI_AUTH_FAILURE_MESSAGE`,
  `requireAiCall`.

**Regeln und Entscheidungen:**
- Zwei Ebenen, die beide gelten: die **KI-Stufe** (Minimum aus
  Schlüsselstufe und aktuellem Benutzerrecht, bei jeder Prüfung neu
  berechnet — Herabsetzen oder Entziehen wirkt sofort auf alle Schlüssel) und
  die **Familienrechte** aus dem Scope. Ein Schlüssel mit Schreibrecht erlaubt
  nie das Schreiben in einer Familie, in der der Benutzer nur liest. Auch die
  Rolle Administrator schließt das KI-Recht nicht ein; ein Administrator muss
  es sich ausdrücklich selbst geben.
- Ein neuer Schlüssel darf das eigene KI-Recht nicht übersteigen.
- Prüfreihenfolge: Format → unbekannt (auch falsches Geheimnis zu
  existierendem Präfix, Vergleich in konstanter Zeit) → widerrufen →
  abgelaufen → Benutzer gesperrt → kein KI-Recht → Stufe reicht nicht.
- `lastUsedAt` wird höchstens alle 5 Minuten geschrieben (bedingt, damit
  parallele Aufrufe nicht mehrfach schreiben; Fehler dabei brechen den Aufruf
  nicht ab).

**Rechte/Datenschutz:** Schlüssel verwalten (anlegen, widerrufen, Rechte
setzen, fremde einsehen) geht nur über die Web-App, nie über den KI-Kanal
selbst (`FORBIDDEN`, wenn der Scope `via` trägt). Fremde Schlüssel erscheinen
für Nicht-Admins als `NOT_FOUND`. Gespeichert wird nur der Hash des
Geheimnisses.

**Protokoll:** `CREATE ApiToken` (Name, Präfix, Stufe, Ablauf),
`UPDATE ApiToken` beim Widerruf (mit Besitzer, wenn fremd), `UPDATE User`
beim KI-Recht (vorher → nachher).

**Benutzt von:** `app/ai-access/page.tsx`, `app/api/ai-tokens/route.ts`,
`app/api/ai-tokens/[id]/route.ts`, `app/api/users/[id]/ai-access/route.ts`;
`mcp/http.ts`, `mcp/server.ts`, `mcp/tools.ts` (`authorizeAiCall`, Typen).

**Tests:** `tests/ai-access.db.test.ts`, `tests/ai-access.test.ts`,
`tests/media-links.db.test.ts`, MCP-Tests; `e2e/write/ai-access.spec.ts`,
`e2e/read/mcp-http.spec.ts`. `requireAiCall` wird nirgends benutzt.

---

## Neuigkeiten

### lib/services/release-notes.ts

**Zweck:** Lesemarke für die Neuigkeiten (Versions-Changelog aus
`CHANGELOG.md`, `docs/entwicklung/neuigkeiten.md`) — nicht zu verwechseln mit der
Änderungsgeschichte der Daten oben.

**Wichtige Funktionen:** `markReleaseSeen(scope, releaseId, known)` setzt
`User.lastSeenReleaseId` des Benutzers `scope.userId` auf `releaseId`.

**Regeln und Entscheidungen:**
- Nur Kennungen aus `known` (der Aufrufer übergibt `releaseNotes()` aus
  `lib/release-notes-data.ts`), sonst `VALIDATION`. Die Liste kommt als
  Parameter, damit der Dienst ohne den Build-Zeit-Import der Datei auskommt
  (MCP über stdio, Skripte).
- Auch ein älteres Release ist erlaubt (es ist nur eine Lesemarke; die
  E2E-Tests setzen sie so zurück). Die Oberfläche schickt immer das neueste.
- Welche Releases das Fenster zeigt, entscheidet `releasesSince` in
  `lib/release-notes.ts` (im Layout).

**Rechte/Datenschutz:** Immer nur der angemeldete Benutzer selbst; eine
fremde Benutzerkennung nimmt weder Dienst noch Route an.

**Protokoll:** keins — eine Lesemarke wie „zuletzt angemeldet“, kein
Datenstand.

**Benutzt von:** `app/api/me/release-seen/route.ts`.

**Tests:** `tests/release-notes.db.test.ts`; `e2e/read/neuigkeiten.spec.ts`,
`e2e/write/whats-new.spec.ts`.

---

## Einstellungen

### lib/services/settings.ts

**Zweck:** Einstellungen der Installation, die Administratoren auf
`/admin/settings` statt in der Server-Konfiguration pflegen (Tabelle
`AppSetting`, Schlüssel → Text). Welche Schlüssel es gibt, mit Bezeichnung,
Erklärung, Art des Werts und zugehöriger Umgebungsvariable, steht allein im
Verzeichnis `lib/settings/registry.ts` (bibliotheken.md).

**Wichtige Funktionen:**
- `getSetting(key)` — wirksamer Wert für den Server (ohne Scope, nur
  serverseitig dort aufrufen, wo er gebraucht wird): Eintrag aus der
  Datenbank, sonst die Umgebungsvariable des Schlüssels, sonst `null`.
- `listSettings(scope)` — je Schlüssel des Verzeichnisses `SettingStateDto`:
  Bezeichnung, Erklärung, Art, Umgebungsvariable, Beispiel, `appValue`,
  `envValue`, `effective`, `source` (`app`/`env`/`none`), `updatedAt`.
- `createSetting(scope, key, value)`, `updateSetting(scope, key, value)`,
  `deleteSetting(scope, key)` — anlegen, ändern, entfernen; Ergebnis ist der
  neue Zustand des Schlüssels.

**Regeln und Entscheidungen:**
- **Vorrang:** Wert aus der App vor Umgebungsvariable; ohne Eintrag gilt die
  Umgebungsvariable — bestehende Installationen ändern sich durch das
  Einführen eines Schlüssels nicht. Entfernen stellt den Rückfall her.
- **Nie ungeprüft:** Jeder Wert läuft beim Speichern durch
  `checkSettingValue` nach der Art des Schlüssels (heute: http(s)-Adresse,
  ohne Benutzername/Passwort, höchstens 2000 Zeichen; vereinheitlicht über
  `URL`). Unbekannte Schlüssel → `VALIDATION` (Pfad `key`), ungültige Werte →
  `VALIDATION` (Pfad `value`). Auch beim Lesen werden gespeicherte und
  Umgebungswerte erneut geprüft; ein ungültiger gilt als nicht gesetzt.
- Anlegen eines schon gesetzten Schlüssels → `CONFLICT`; Ändern/Entfernen
  eines nicht gesetzten → `NOT_FOUND`. Ändern auf denselben Wert schreibt
  nichts (auch kein Protokoll).
- **Keine Geheimnisse:** Das Verzeichnis nimmt nur Werte auf, die jeder
  Administrator im Klartext sehen darf; die Seite zeigt sie, das Protokoll
  hält vorher → nachher fest. Zugangsdaten bleiben Umgebungsvariablen.
- Kein Zwischenspeicher: `getSetting` liest bei jedem Aufruf (eine Abfrage
  nach Primärschlüssel); Änderungen wirken sofort ohne Neustart.

**Rechte/Datenschutz:** Lesen der Übersicht und Pflegen nur Administratoren
(`FORBIDDEN`); die Routen prüfen zusätzlich `setting:manage`. `getSetting`
selbst prüft keine Rechte — es liefert nur Werte, die keine Geheimnisse sind.

**Protokoll:** Audit-Art `Setting`, `entityId` = Schlüssel: `CREATE` (`label`,
`value`), `UPDATE` (`label`, `changes.value` vorher → nachher), `DELETE`
(`label`, bisheriger `value`). In der Änderungsübersicht (`changes.ts`) als
„Einstellung „…“ gesetzt / geändert / entfernt“ mit dem Feld „Wert“; ohne
Personen- und Familienbezug, daher nur für Administratoren sichtbar.

**Benutzt von:** `app/admin/settings/page.tsx`, `app/api/settings/route.ts`,
`app/api/settings/[key]/route.ts`; `getSetting` in `app/ai-access/page.tsx`
(Adresse des Connectors).

**Tests:** `tests/settings.db.test.ts` (Vorrang, Rückfall, Prüfung, Rechte,
Protokoll, Routen), `tests/settings.test.ts` (Verzeichnis und Prüfung);
`e2e/write/settings.spec.ts`.

---

## Import

**Schlüssel löschen (seit 22.11.):**
- `apiTokenDeletable(t, now)`: endgültig löschbar sind widerrufene, abgelaufene und nie benutzte Schlüssel (`lastUsedAt` leer); aktiv und schon benutzt: nein (erst widerrufen). Dieselbe Regel spiegelt `canDeleteToken` in `components/ai-access-labels.ts`; ein Unit-Test hält beide gleich.
- `deleteApiToken(scope, id)`: nur Web-Kanal (über MCP FORBIDDEN); eigene Schlüssel immer, fremde nur Admins (sonst NOT_FOUND). Nicht löschbar → CONFLICT (`details.reason = "ACTIVE_AND_USED"`). Löscht atomar mit der Regel als Bedingung (eine gleichzeitige erste Benutzung lässt den Schlüssel stehen). Ein aktiver, unbenutzter Schlüssel wird damit zugleich widerrufen.
- Protokoll: `DELETE` `ApiToken` mit name, prefix, level, status, Zeitpunkten, `revokedByDelete`, bei fremden `ownerId`; eigenes Changelog-Paket „KI-Schlüssel „…“ gelöscht“. AuditLog/ChangeSet verweisen ohne Fremdschlüssel per `apiTokenId` und bleiben unverändert.
- `listApiTokens`/`listAllApiTokens` liefern weiter alle Schlüssel samt Status; das Ausblenden des Verlaufs macht die Oberfläche.
- Tests: `tests/ai-token-delete.db.test.ts`, `tests/ai-access.test.ts`.

### lib/services/imports.ts

**Zweck:** Verwaltung rund um Importe: Importläufe (`ImportBatch`) samt
Originaldatei, Herkunft importierter Datensätze (`ImportLink`),
Fremdkennungen (`ExternalId`) und Rohdatenspeicher (`ImportRawRecord`). Das
eigentliche Schreiben der Daten liegt in `import-apply.ts`.

**Wichtige Funktionen:**
- `createImportBatch(scope, input, inhalt)` — legt einen Lauf (Status
  `PENDING`) an und bewahrt die Originaldatei unverändert unter
  `MEDIA_DIR/imports/<id>.<endung>` auf (abschaltbar mit `keepFile`);
  speichert SHA-256 und Größe.
- `finishImportBatch(scope, id, {status, counts, warnings, notes})` — Lauf
  abschließen.
- `listImportBatches`, `getImportBatch`, `readImportBatchFile` — Läufe
  bzw. die Originaldatei lesen.
- `listImportLinks(scope, {sourceTreeId, batchId, entityTypes})` — Herkunft
  mit heutigem Fingerabdruck und `editedSinceImport`.
- `markMissingInSource(scope, batchId, linkIds)` — vermerkt, dass Datensätze
  im neuen Stand der Quelle fehlen (gelöscht wird nie automatisch).
- `findExternalIds(scope, {system, values, batchId})` — Datensätze zu
  Fremdkennungen (z.B. `_UID`).
- `listRawRecords(scope, träger, {includeSuperseded})` — nicht zugeordnete
  Importdaten eines Trägers.
- `pruneRawRecords(scope, {batchId, supersededOnly, supersededBefore})` —
  Rohdaten bewusst entfernen.
- `newId()` (vorab erzeugte, cuid-ähnliche ID), `loadRowsForFingerprint`,
  `importLinkColumn`, Konstanten (`IMPORT_FILES_DIR`, `MAX_RAW_RECORD_BYTES`
  256 KB, `MAX_IMPORT_FILE_BYTES` 200 MB).

**Regeln und Entscheidungen:** Mehrere Stände desselben Baums liegen
nebeneinander. Scheitert das Anlegen des Laufs, wird die gespeicherte Datei
wieder entfernt. `pruneRawRecords` verlangt immer eine Einschränkung (Lauf
oder „überholt“); ohne → `FORBIDDEN`. Eine zu große Datei ist ein Eingabefehler
(`VALIDATION`, Feld `file`), keine Rechtefrage.

**Rechte/Datenschutz:** Alles nur für Administratoren — mit einer Ausnahme:
`listRawRecords` liefert die Rohdaten eines Trägers jedem, der ihn sehen darf
(Person: ihre Familienrechte; Beziehung: eine Seite sichtbar; Quelle: wer die
Quelle sieht); Rohdaten eines ganzen Laufs nur Administratoren; unsichtbar →
`null`.

**Protokoll:** `CREATE ImportBatch` (Format, Datei, Hash, Baum),
`UPDATE ImportBatch` beim Abschluss (Status vorher → nachher) und beim
Löschen der Datei, `DELETE ImportRawRecord` beim Bereinigen (Anzahl,
Einschränkung).

**Benutzt von:** `app/api/import/batches/[id]/file/route.ts`,
`app/api/import/batches/prune/route.ts`; `gedcom-import.ts`,
`import-apply.ts`, `merge.ts` (`newId`); `lib/gedcom/interpret.ts` (`newId`).

**Tests:** `tests/genealogy.db.test.ts`, `tests/import-sources.db.test.ts`,
`tests/gedcom-writer.test.ts` (`newId`); `e2e/write/import.spec.ts`.
`listImportBatches`, `listImportLinks`, `markMissingInSource`,
`findExternalIds` und `listRawRecords` werden außerhalb der Tests nicht
benutzt (bleiben bewusst: fachlich sinnvolle Lesezugriffe, die die Tests
zur Prüfung der Herkunft brauchen).

### lib/services/import-apply.ts

**Zweck:** Massenimport für GEDCOM- und andere Importe: Personen, Namen,
Beziehungen, Ereignisse, Quellen, Belege, Fremdkennungen und Rohdaten in
**einem** Aufruf und einer Transaktion, mit Sammel-Einfügungen je Tabelle.

**Wichtige Funktionen:**
- `applyGenealogyImport(scope, input, {tx, onInvalid, now, dryRun})` —
  validiert die Eingabe (`genealogyImportSchema`), löst Verweise auf, prüft
  alle Regeln und schreibt; Ergebnis: neue IDs je `ref`, Ergebnis je Eintrag
  (`created`, `updated`, `unchanged`, `skippedEdited`, `skipped`, `linked`,
  `invalid`), Zählungen, ungültige Einträge mit Grund, Feldänderungen.
- `resolveBulkDate(datum)`, `bulkDateSchema` — strukturiertes Datum
  (`"1850"`, `"1850-03"`, `"1850-03-12"` oder ISO, Genauigkeit, Zusatz,
  Bereichsende, Wortlaut) → ungenaues Datum.
- `REJECTED_RAW_SUFFIX` (`:ABGELEHNT`) — Kennzeichen für Rohdaten einer beim
  Import abgelehnten Beziehung; der GEDCOM-Export schreibt sie als Familie
  zurück.

**Regeln und Entscheidungen:**
- **Verweise:** Jeder Eintrag hat eine `ref`; andere Einträge verweisen über
  `…Ref` darauf oder über `…Id` auf vorhandene Datensätze.
- **Aktion je Eintrag:** `create` (Standard, mit Herkunft und
  Fingerabdruck), `update` (überschreiben), `updateIfUnchanged` (nur, wenn
  seit dem letzten Import nicht in der App geändert; sonst `skippedEdited`),
  `skip` (nichts schreiben, `ref` zeigt auf `id`), `link` (App-Version
  behalten, Herkunft auf die neuen Dateiwerte setzen), `enrich` (nur
  Personen: mit der vorhandenen Person verknüpfen, siehe unten). Gleiche
  Werte → `unchanged`, nur die Herkunft wird fortgeschrieben. **Gelöscht
  wird nie.**
- **Verknüpfen (`enrich`)** — vom Administrator in der Importvorschau
  einzeln gewählt: anreichern nach den Vorgaben des Zusammenführens
  (`resolvePersonMerge` aus `lib/merge-rules.ts` mit vorhandener Person als
  „keep“ und Dateiwerten als „other“): Leeres füllen, genaueres Datum
  gewinnt, sonst App-Wert; nicht gedeckte Geburts-/Todesangaben werden
  Ereignisse mit `isAlternative`, andere Namen Namensvarianten (beides ohne
  Herkunftsvermerk und ohne Doppel: gegen vorhandene und in diesem Lauf
  angelegte Ereignisse/Namen der Person geprüft), Notizen angehängt. Dazu
  ein Herkunftsvermerk dieses Baums mit `mergedAt` (erneuter Import ohne
  Neues bleibt still). Ergebnis `linked`.
- **Rohdaten ersetzen** (`replace`) überholt nur Rohdaten desselben
  Quell-Baums (bzw. ohne Lauf): Trägt eine Person auch Rohdaten eines
  anderen Imports (verknüpft oder zusammengeführt), bleiben diese gültig —
  der GEDCOM-Export braucht sie für den Originaldatensatz.
- Ein Datensatz kann mehrere Herkunftsangaben haben; maßgeblich ist die des
  gleichen Quell-Baums und Quell-Schlüssels; sonst entsteht eine neue, ohne
  die anderer Bäume zu verlieren.
- **Ungültige Einträge:** `onInvalid: "throw"` bricht vor dem Schreiben mit
  allen Fehlern ab; `"skip"` lässt ungültige Einträge und alles Abhängige aus.
  Lebensdaten, Beziehungsdaten und Ereignisse werden mit denselben Regeln wie
  in der App geprüft (`personDateIssues`, `relationshipIssues`,
  `eventIssues`); Personen und Typ einer vorhandenen Beziehung sind fest.
- **Beziehungsregeln über Bestand und Import:** keine Dubletten (auch
  umgekehrt), nicht zugleich Partner und Elternteil, höchstens zwei leibliche
  Eltern, keine Zyklen (über alle Eltern-Kind-Kanten). Eltern-Kind-Kanten
  werden zuerst geprüft: Widerspricht eine Partnerschaft einer Abstammung,
  fällt die Partnerschaft weg.
- **Nichts geht verloren:** Rohdaten einer abgelehnten Beziehung bleiben bei
  einer beteiligten Person (mit Grund) erhalten. Rohdaten über 256 KB sind
  ungültig (die Originaldatei enthält sie). Mit `replace` werden ältere
  Rohdaten desselben Trägers als überholt markiert, nicht gelöscht.
- **Probelauf** (`dryRun`): alle Prüfungen und Ergebnisse, aber kein
  Schreiben (die GEDCOM-Vorschau nutzt ihn in einer zurückgerollten
  Transaktion).
- Ohne `tx` eigene Transaktion bis 5 Minuten; mit `tx` in der des Aufrufers.

**Rechte/Datenschutz:** Nur Administratoren. Unbekannte Familien →
`VALIDATION`.

**Protokoll:** In derselben Transaktion ein `CREATE ImportBatch`-Eintrag mit
den Zählungen und je betroffener Person ein Eintrag (`CREATE` bzw. `UPDATE
Person`, Kennzeichen `import`, Feldänderungen, Zahl der angelegten bzw.
geänderten Untereinträge) im Paket des Aufrufs (Titel-Vorgabe „Import“).
Verknüpfte Personen bekommen immer einen Eintrag `UPDATE Person` mit
`person: "linked"`, `changes` (vorher → nachher, auch leer), `linked`
(Quell-Baum, Schlüssel, ggf. verworfene Angaben) und den angelegten
Zweitangaben/Namen; der Changelog zeigt „Beim Import mit einer Person aus
der Datei verknüpft“.

**Benutzt von:** `gedcom-import.ts`; `lib/gedcom-import/mapping.ts` (Typbezug).
Der Austausch-Import (`app/api/import/route.ts`, „Daten einspielen“) benutzt
diesen Dienst **nicht**, sondern schreibt selbst.

**Tests:** `tests/genealogy.db.test.ts`, `tests/genealogy.test.ts`
(`resolveBulkDate`), `tests/changelog.db.test.ts`, `tests/merge.db.test.ts`,
indirekt alle GEDCOM-Import-Tests.

### lib/services/gedcom-import.ts

**Zweck:** GEDCOM-Import mit Vorschau und Abgleich bei erneutem Import. Nur
Administratoren.

**Wichtige Funktionen:**
- `startGedcomImport(scope, {fileName, bytes}, wahl?)` — Datei lesen (auch
  `.zip` mit einer `.ged`), prüfen, dass es GEDCOM ist, Lauf anlegen
  (Originaldatei aufbewahrt), Quell-Baum erkennen, ältere nie ausgeführte
  Vorschauen derselben Datei verwerfen, Vorschau berechnen und als
  `MEDIA_DIR/imports/<lauf>.plan.json` speichern.
- `recomputeGedcomPreview(scope, batchId, wahl)` — Vorschau mit anderer Wahl
  des Quell-Baums (automatisch, vorhandener, neu). Die vorhandenen Bäume
  zur Wahl tragen Buchstabe und, falls vergeben, Anzeigenamen des Imports
  (`loadImportDirectory`) vor Datei und Programm.
- `rereadGedcomBatch(scope, batchId)` — ausgeführte Datei aus dem Original
  erneut einlesen (neuer Lauf, übliche Vorschau).
- `getGedcomPlan`, `listGedcomPlanItems(scope, batchId, {kind, group, q,
  offset, limit, suggest})` — Zusammenfassung bzw. Einträge seitenweise
  (Gruppen: neu, geändert, unverändert, in der App geändert, fehlt in der
  Datei, vorhanden, ungültig); `suggest` = neue Personen, deren bester
  Vorschlag in dieser Klasse liegt.
- `applyGedcomImport(scope, batchId, entscheidungen)` — Import mit den
  Entscheidungen des Administrators (`applyDecisionsSchema`: Umgang mit „in
  der App geändert“ je Eintrag, zu löschende fehlende Einträge,
  Verknüpfungen `suggestions` (ref → vorhandene Person), Familie (keine,
  vorhandene, neue), Privatsphäre-markierte Personen ohne Familie, Fotos
  herunterladen).
- `checkGedcomDecisions(scope, batchId, entscheidungen)` — prüft gewählte
  Verknüpfungen vorab (für den Start im Hintergrund, `import-jobs.ts`).
- `verifyImportLinks(…)` — die Nachprüfung selbst (exportiert für Tests).
- `listImportHistory(scope, limit)` — Importverlauf mit Zusammenfassung.
- `discardGedcomPreview(scope, batchId)`, `discardStalePreviews(scope,
  {...})` — nie ausgeführte Vorschauen verwerfen (nach 7 Tagen automatisch,
  `PREVIEW_MAX_AGE_DAYS`).
- `extractGedcom`, `detectSourceTreeId`, `stableStringify`, `PLAN_KINDS`,
  `PLAN_GROUPS`.

**Regeln und Entscheidungen:**
- **Vorschau schreibt nichts:** Sie lässt den echten Massenimport in einer
  Transaktion laufen, die am Ende zurückgerollt wird — die Ergebnisse sind
  genau die, die der Import hätte.
- **Abgleich** (je Datensatzart, nur innerhalb desselben Quell-Baums):
  Quell-Schlüssel der Herkunft → Fremdkennung `_UID` (nur, wenn der Treffer
  keinem anderen Quell-Baum gehört) → bei Beziehungen dieselbe Beziehung
  zwischen zwei zugeordneten Personen (in der App angelegte bleiben
  unangetastet) → Quellen ohne Kennung über Xref + Titel, Titel + Autor, nur
  Xref. Ähnliche vorhandene Personen (von Hand erfasst oder aus anderen
  Importen) sind nur Vorschläge (`import-suggestions.ts`).
- „In der App geändert“: Standard „App behalten“ (`link`), je Eintrag
  umschaltbar auf „Datei übernehmen“ (`update`).
- **Vorschläge** (Plan-Version 2, `PLAN_VERSION`): je neuer Person bis zu
  drei (`PlanItem.suggestions`), Zusammenfassung `links` (Personen je
  Klasse, verglichene Personen, Dauer, ggf. `skipped`). Standard „neu
  anlegen“; eine gewählte Verknüpfung wird beim Import zur Aktion `enrich`
  (import-apply.ts).
- **Nachprüfung** (`verifyImportLinks`, vor der Transaktion, in
  `checkGedcomDecisions` schon beim Start): angeboten in der Vorschau, Person
  der Datei weiter neu, kein Ziel doppelt, Ziel sichtbar und bearbeitbar,
  neuer Abgleich (`suggestImportLinks` ohne Begrenzung je Person) findet das
  Paar mindestens so gut eingestuft. Sonst `CONFLICT` mit
  `details.linkIssues` (je Abweichung Datei-Person, vorhandene Person —
  bei Unsichtbarem nur „eine vorhandene Person“ —, Grund); nichts wird
  geschrieben, der Lauf bleibt offen. In der Transaktion zusätzlich: alle
  Ziele gibt es noch. Ältere Vorschauen (Version 1) mit Verknüpfungen →
  `CONFLICT` „neu laden“.
- **Gleiche Untereinträge** (`linkEqualSubRecords`): Ereignisse und Namen
  einer verknüpften Person (und Ereignisse an einer schon vorhandenen
  Beziehung zweier zugeordneter Personen), die es dort nach `eventKey` bzw.
  `personNameKey` schon gibt, werden zugeordnet (`link`) statt doppelt
  angelegt.
- Rohdaten-Vergleich („nur Geänderte schicken“) berücksichtigt nur Rohdaten
  desselben Quell-Baums.
- Eine neue Familie darf nicht schon existieren.
- Fremdkennungen werden nur ergänzt, wo sie fehlen; Rohdaten nur, wo sie sich
  geändert haben.
- **Doppeltes Absenden** ändert nichts: Lock je Lauf, abgeschlossener Lauf
  liefert das gespeicherte Ergebnis. Ein fehlgeschlagener Lauf ist nicht
  erneut ausführbar.
- **Löschen nur auf ausdrücklichen Wunsch**, nach dem Import und über die
  normalen Dienste (`deleteCitation`, `deletePersonName`, `deleteEvent`,
  `deleteRelationship`, `deleteSource`, `deletePerson` mit `force`), in dieser
  Reihenfolge; schon per Cascade Gelöschtes zählt nicht als Fehler. Nicht
  gewählte fehlende Einträge werden nur als fehlend vermerkt.
- Fotos werden nach dem Import außerhalb der Transaktion geladen
  (`gedcom-photos.ts`).
- Eine Vorschau lässt sich nur verwerfen, solange sie keine Spuren in den
  Daten hat und nicht gerade läuft; ausgeführte Läufe nie.

**Rechte/Datenschutz:** Nur Administratoren (alle Funktionen prüfen selbst).
Die aufbewahrte Datei einer verworfenen Vorschau wird gelöscht, weil sie
personenbezogene Daten enthält.

**Protokoll:** Paket „GEDCOM-Import „Datei““ (Art IMPORT); darin die
Einträge aus `import-apply.ts`, die der Lösch-Dienste, `CREATE Family` bei
neuer Familie, ein abschließendes `CREATE ImportBatch` (`gedcom`, Zahl
ungültiger und gelöschter Einträge); `UPDATE ImportBatch` beim Abschluss
(`finishImportBatch`); `DELETE ImportBatch` beim Verwerfen einer Vorschau.

**Benutzt von:** `app/api/import/gedcom/route.ts`,
`app/api/import/gedcom/[id]/route.ts`,
`app/api/import/gedcom/[id]/items/route.ts`,
`app/api/import/gedcom/[id]/reread/route.ts`,
`app/api/import/batches/route.ts`; `import-jobs.ts` (Ausführen im
Hintergrund).

**Tests:** `tests/gedcom-import.db.test.ts`, `tests/import-sources.db.test.ts`,
`tests/import-linking.db.test.ts`, `tests/import-suggestions.db.test.ts`
(Vorschläge, Verknüpfen, Nachprüfung, Rollback), `tests/merge.db.test.ts`
(Parser und Zuordnung: `tests/gedcom-*.test.ts`);
`e2e/write/gedcom-import.spec.ts`, `e2e/write/import-suggestions.spec.ts`,
`e2e/write/import-sources.spec.ts`.

### lib/services/import-suggestions.ts

**Zweck:** Vorschläge schon beim GEDCOM-Import: neue Personen der Datei
gegen alle vorhandenen Personen (von Hand erfasste und aus allen anderen
Importen) abgleichen — mit demselben Abgleich wie „Importe verbinden“, keine
zweite Heuristik. Entscheidet nichts.

**Wichtige Funktionen/Typen:**
- `suggestImportLinks(scope, {mapped, newRefs, matched, sourceTreeId,
  limit})` — Vorschläge je ref (`ImportSuggestion`: vorhandene Person,
  Bezeichnung mit Lebensjahren, Herkunft „von Hand erfasst“ bzw. „Import
  A · Name“, Klasse, Teilklasse, Punkte, Begründungssatz
  `evidenceSentence`, Widersprüche, Abweichungen, über Verwandte gefunden,
  einzige Brücke) und Zusammenfassung (`ImportLinkSummary`: Personen je
  bester Klasse, verglichene Personen, Dauer, ggf. `skipped`).
- `pairDifferences` (worin Datei und vorhandene Person abweichen:
  Nachname, Vorname, Geburt, Tod, Geburtsort, auch einseitig),
  `suggestionClass`, `SUGGESTION_CLASS_RANK`, `MAX_LINK_PERSONS`,
  `MAX_SUGGESTIONS_PER_PERSON`, `fileLinkId`.

**Regeln und Entscheidungen:**
- Bestand aus `loadDuplicatePeople` (nur sichtbare Personen), Gruppen wie
  bei „Importe verbinden“ (Quell-Bäume bzw. `manual`); neue Personen der
  Datei als eigene Gruppe mit Verwandten, Namensvarianten und Daten aus der
  Datei. Schon wiedererkannte Personen der Datei gehören zur Gruppe der
  Datei: Sie verbinden als Verwandte, sind aber nie Kandidat.
- `linkImports` mit `focus` auf die neuen Personen: nur Paare Datei ×
  Bestand; Klassen, Eindeutigkeit, Ausbreitung, Cluster, Brückenregel,
  Vorfahren/Nachkommen und „kein Duplikat“ (zwischen vorhandenen Personen)
  wie dort. Vorgeschlagen werden nur Personen, die der Importierende sehen
  **und** bearbeiten darf; die Zahlen zählen nur diese.
- Je Person höchstens drei Vorschläge (beste Klasse, dann Punkte); die
  Nachprüfung beim Ausführen nimmt alle.
- Über `MAX_LINK_PERSONS` (100 000 Personen zusammen) wird nicht
  abgeglichen; `skipped` nennt den Grund, die Vorschau zeigt ihn.

**Rechte/Datenschutz:** Dienst ohne eigene Rollenprüfung (die Aufrufer in
`gedcom-import.ts` sind nur für Administratoren); Sichtbarkeit und
Bearbeitungsrecht über den Scope.

**Leistung:** 2 000 neue gegen gut 12 000 vorhandene Personen (erzeugte
Testbäume in der Mock-Datenbank, 17 500 Beziehungen): Bestand laden
(`loadDuplicatePeople`) gut 1,1 s, Abgleich 0,5–0,7 s — zusätzlich zur
übrigen Vorschau. Beim Ausführen mit gewählten Verknüpfungen läuft der
Abgleich zur Nachprüfung noch einmal (beim Start und im Hintergrund). Mit
echten Datenmengen noch nicht gemessen.

**Benutzt von:** `gedcom-import.ts` (Vorschau und Nachprüfung),
`app/api/import/gedcom/[id]/items/route.ts` (Klassen).

**Tests:** `tests/import-suggestions.test.ts` (Trefferquote je Klasse auf
erzeugten Testbäumen, `focus`, Laufzeit, Abweichungen),
`tests/import-suggestions.db.test.ts`.

### lib/services/gedcom-photos.ts

**Zweck:** Fotos eines GEDCOM-Imports herunterladen (nur auf ausdrücklichen
Wunsch, nie in der Vorschau) und wie einen Upload verarbeiten.

**Wichtige Funktionen:**
- `downloadImportPhotos(scope, {batchId, sourceTreeId, photos, personIds,
  fetchOptions})` — lädt die Fotos der importierten Personen (4 gleichzeitig,
  `PHOTO_CONCURRENCY`) über `lib/safe-fetch.ts`, prüft und rechnet sie um
  (`processAndStoreImage`), legt Bild, Personenverknüpfung, Herkunft (`MEDIA`)
  und Fremdkennungen (Adresse, ggf. Foto-RIN) in einer Transaktion an;
  Bericht mit gespeicherten, übersprungenen und fehlgeschlagenen Fotos und
  einem Protokoll je Adresse.

**Regeln und Entscheidungen:** Schon geholte Fotos (Herkunft `MEDIA` mit
demselben Schlüssel im Quell-Baum) werden übersprungen. Ein Foto wird nur
Hauptbild, wenn es in der Datei so markiert ist und die Person noch keines
hat. Fehler einzelner Fotos brechen nichts ab; schon gespeicherte Dateien
werden dann entfernt.

**Rechte/Datenschutz:** Nur Administratoren. Abrufe nur über die sicheren
Abrufregeln (öffentliche https-Adressen).

**Protokoll:** je gespeichertem Foto `CREATE MediaAsset` mit Person,
Dateiname, Lauf und Größe.

**Benutzt von:** `gedcom-import.ts` (`applyGedcomImport`).

**Tests:** `tests/gedcom-import.db.test.ts` (Abruf mit ersetzter
Namensauflösung); Abrufregeln: `tests/safe-fetch.test.ts`.

### lib/services/import-jobs.ts

**Zweck:** Ein großer GEDCOM-Import dauert länger, als ein Reverse-Proxy auf
eine Antwort wartet. Das Ausführen läuft deshalb im Hintergrund des
Node-Prozesses; die Oberfläche fragt den Stand ab.

**Wichtige Funktionen:**
- `startImportJob(scope, batchId, entscheidungen)` — prüft gewählte
  Verknüpfungen vorab (`checkGedcomDecisions`; Abweichung → `CONFLICT` mit
  `linkIssues` sofort als Antwort) und startet dann `applyGedcomImport` im
  Hintergrund; Zustand `running`. Scheitert die erneute Nachprüfung im
  Hintergrund, trägt der Zustand `error` die `linkIssues` mit.
- `importJobState(scope, batchId)` — `idle`, `running`, `done` (Ergebnis)
  oder `error` (Meldung); ohne laufenden Auftrag aus dem Lauf in der
  Datenbank (abgeschlossen → `done` mit `alreadyApplied`).

**Regeln und Entscheidungen:** Der Zustand liegt in einer prozessweiten Map
(`globalThis`), übersteht also Hot-Reload, aber keinen Neustart. Doppelte
Starts landen beim selben Lauf. Startet der Server mitten im Import neu,
rollt die Transaktion zurück und der Lauf bleibt offen (erneut ausführbar).
Interne Fehler (ohne Code) werden im Log festgehalten und nur allgemein
gemeldet.

**Rechte/Datenschutz:** Nur Administratoren.

**Protokoll:** über `gedcom-import.ts`.

**Benutzt von:** `app/api/import/gedcom/[id]/apply/route.ts`.
`gedcom-import.ts` liest die Map, um das Verwerfen eines laufenden Imports zu
verhindern.

**Tests:** kein Dienst-Test; `e2e/write/gedcom-import.spec.ts` über die
Oberfläche.

### lib/services/import-linking.ts

**Zweck:** „Importe verbinden“ (Recherche → Importe verbinden, nur
Administratoren): Personen, die in mehreren Importen vorkommen, finden
(`linkImports` in `lib/import-linking.ts`) und nach Bestätigung
zusammenführen.

**Wichtige Funktionen:**
- `listConnectGroups(scope)` — Importe (Quell-Bäume mit abgeschlossenem Lauf
  und noch vorhandenen Personen; benannt als „Import A · Name“ über
  `loadImportDirectory`) und „von Hand erfasst“ zur Auswahl.
- `listConnectRuns(scope)` — die letzten 20 Läufe (ohne Paare).
- `startConnectRun(scope, {groups, withinGroup})` — Abgleich im Hintergrund.
- `getConnectRun(scope, id, {confidence, bridgesOnly, veryLikely, offset,
  limit})` — Lauf mit gefilterten Paaren, Zählungen je Klasse, Brücken und
  Zahl der angenommenen Paare.
- `decideConnectPairs(scope, id, {accept, reject, dismiss})` — Entscheidungen;
  „dismiss“ markiert dauerhaft „kein Duplikat“. Eine neue Vorschau wird
  danach nötig.
- `startConnectPreview(scope, id)` — gemeinsame Vorschau im Hintergrund (was
  umzieht, zusammenfällt, Zweitangabe wird, was blockiert, wie viele Personen
  danach zu weiteren Familien gehören, Zahl der getrennten Teile danach).
- `startConnectApply(scope, id)` — Zusammenführen starten bzw. nach
  Unterbrechung fortsetzen.
- `waitForConnectRun(scope, id, timeout)` — für Tests.

**Regeln und Entscheidungen:**
- Ein Lauf liegt als JSON unter `MEDIA_DIR/connect/<id>.json` (Auswahl,
  Abgleich, Entscheidungen, Vorschau, Fortschritt), ein Index der letzten 20
  daneben. Startet der Server mitten im Lauf neu, gilt er als „unterbrochen“;
  **Fortsetzen** macht beim nächsten Cluster weiter, schon Zusammengeführtes
  erkennt `mergePersons` am Audit.
- Paare der Klasse „sicher“ sind vorausgewählt. Die Klassen und die Regel,
  dass eine einzelne Brücke zwischen sonst getrennten Familien nie „sicher“
  ist, liegen in `lib/import-linking.ts`.
- Angenommene Paare werden zu Clustern vereinigt; bleibend ist der
  vollständigste Eintrag (bei Gleichstand der ältere); Cluster nach frühestem
  Geburtsdatum sortiert (Vorfahren zuerst).
- Je Cluster eine Transaktion; in der Vorschau blockierte Paare werden
  ausgelassen. Ein Blocker nur wegen Eltern, die im selben Lauf
  zusammengeführt werden, gilt nicht als Blocker.
- Nach dem Zusammenführen startet von selbst ein neuer Abgleich (durch die
  Verbindungen gibt es jetzt gemeinsame Verwandte).
- Kein KI-Werkzeug.

**Rechte/Datenschutz:** Nur Administratoren. Lauf-Kennungen werden gegen ein
festes Muster geprüft, bevor eine Datei gelesen wird.

**Protokoll:** ein Paket „Importe verbinden (N Gruppen)“ (Art CONNECT) mit je
Zusammenführung einem `MERGE`-Eintrag und am Ende einem `CONNECT`-Eintrag
(`entityType` Person, Kennung = Lauf) mit allen Clustern, Zahl der
Zusammenführungen und Fehlschlägen; „kein Duplikat“ als `UPDATE Person`
(`notDuplicateOf`).

**Benutzt von:** `app/api/connect/route.ts`, `app/api/connect/[id]/route.ts`;
Typen in `components/ConnectImports.tsx`.

**Tests:** `tests/import-linking.db.test.ts` (Abgleich-Regeln:
`tests/import-linking.test.ts`); `e2e/write/connect.spec.ts`.

### lib/services/origin.ts

**Zweck:** Herkunft sichtbar machen — welche Importe eine Person bzw. einen
Eintrag geliefert haben. Leitlinie: Die App ist die Wahrheit, Importe sind
Quellen; Herkunft ist Zusatzinformation. Der Dienst liest deshalb nur
(`ImportLink`, `ImportBatch`, Protokoll); einzige Schreibstelle ist der
Anzeigename eines Imports. Reine Regeln ohne Datenbank (Buchstaben,
Farben, Texte, Typen für Server und Browser) liegen in `lib/origin.ts`.

**Wichtige Funktionen:**
- `loadImportDirectory(treeIds?)` — Verzeichnis aller Importe (Quell-Bäume)
  mit Buchstabe, Farbe, Anzeigename, Datei und Zahl der Läufe; liefert
  `name`, `label` („A · Name“) und `entry` (Chip/Legende) je Kennung. Die
  einzige Stelle, die sagt, wie ein Import heißt — Dubletten-Hinweis,
  Zusammenführen, „Importe verbinden“ und die GEDCOM-Vorschau („Baum
  wählen“) benutzen sie.
- `canSeeOrigin(scope)` — Administratoren und Bearbeiter mindestens einer
  Familie.
- `loadTreeOrigin(scope, graph, personIds?)` — Herkunft der Personen einer
  Baumansicht: Kennungen je Person, Legende (nur vorkommende Importe, mit
  Zahl der Personen; Importe zuerst, „von Hand erfasst“ zuletzt), Zahl der
  Verbindungspersonen. Nur aufgerufen, wenn der Schalter `?herkunft=1`
  gesetzt ist; `null` für Betrachter.
- `getPersonOrigin(scope, personId)` — Importe der Person (erster/letzter
  Import, Zahl der aufgegangenen Einträge, ob nur durch Zusammenführen
  dazugekommen), Zusammenführungs-Geschichte und Chips je Ereignis,
  weiterem Namen, Beziehung und Beleg. `null`, wenn die Person nicht
  bearbeitbar ist.
- `originOverview(scope)` — Personen je Import und je Import-Paar die
  Verbindungspersonen (Personen in beiden), dazu Gesamtzahlen.
- `listImportSources(scope)`, `renameImportSource(scope, {sourceTreeId,
  displayName})` — Importverwaltung (nur Administratoren).

**Regeln und Entscheidungen:**
- **Buchstaben** in der Reihenfolge des ersten abgeschlossenen Laufs eines
  Quell-Baums: A, B, C … ohne „H“ (steht für „von Hand erfasst“), nach Z
  zweistellig. Neue Stände desselben Baums oder spätere Importe ändern
  einen vergebenen Buchstaben nicht. Quell-Bäume ohne abgeschlossenen Lauf
  (nur noch Herkunftsvermerke) folgen dahinter — diese teurere Abfrage
  läuft nur, wenn eine gesuchte Kennung sonst unbekannt wäre. Vermerke ohne
  Quell-Baum-Kennung erscheinen als „?“.
- **Farben** aus der Okabe-Ito-Palette ohne Schwarz (für die häufigen
  Farbsehschwächen unterscheidbar), Schriftfarbe mit Kontrast ≥ 4,5:1; ab
  dem achten Import wiederholen sie sich — eindeutig bleibt der Buchstabe,
  Farbe steht nie allein.
- **Name** eines Imports: vergebener Anzeigename; sonst für Administratoren
  Datei und Datum des letzten Laufs, für alle anderen „Import vom <Datum
  des ersten Laufs>“.
- Eine Person ohne Herkunftsvermerk ist „von Hand erfasst“ (H). Einträge
  (Ereignis, Name, Beziehung, Beleg) ohne Vermerk bekommen **keinen** Chip
  — sie sind in der App entstanden.
- **Zusammengeführt:** gezählt über die `MERGE`-Einträge des Protokolls,
  auch Ketten früherer Zusammenführungen (begrenzte Tiefe), ergänzt um
  `ImportLink.mergedFromId` für Zusammenführungen vor dem Protokoll.
- Für Name, Geburt und Tod gibt es bewusst **keine Herkunft je Feld**
  (Import schreibt, App ändert; eine Geschichte je Feld gibt es erst seit
  dem Changelog) — die Personenseite sagt das ausdrücklich.
- Anzeigenamen: höchstens 60 Zeichen, Leerraum zusammengefasst, je Import
  eindeutig (ohne Groß-/Kleinschreibung); leer entfernt den Namen.
  Buchstabe und Farbe bleiben beim Umbenennen gleich.

**Rechte/Datenschutz:**
- Herkunft gibt es überall (Baum, Personenseite, Übersicht, KI-Zugang) nur
  für Personen, die der Benutzer **bearbeiten** darf; alle Zahlen zählen
  nur diese. Betrachter bekommen nichts (Übersicht: `FORBIDDEN`).
- Chips an Beziehungen nur, wenn die andere Person sichtbar ist.
- Dateinamen und die Kennung des Quell-Baums nur für Administratoren
  (Importverwaltung); sonst steht der Buchstabe dafür.
- Der Anzeigename ist für alle Bearbeiter sichtbar — er sollte nichts
  enthalten, was nur Administratoren wissen dürfen.

**Protokoll:** Umbenennen als eigenes Paket („Import A benannt: …“ bzw.
„Name des Imports A entfernt“, Art APP) mit `UPDATE ImportBatch`
(`renamed`, Buchstabe, Name vorher → nachher); der Changelog
(`changes.ts`) beschreibt es in diesen Worten. Lesen wird nicht
protokolliert.

**Benutzt von:** `app/tree/page.tsx` (Schalter), `app/people/[id]/page.tsx`
(Block „Herkunft“, Chips), `app/research/connect/page.tsx` (Übersicht),
`app/api/origin/overview/route.ts`, `app/api/import/sources/route.ts`,
`mcp/tools.ts` (`get_person.origin`); `duplicates.ts`, `merge.ts`,
`import-linking.ts`, `gedcom-import.ts` (Bezeichnung der Importe).

**Tests:** `tests/origin.test.ts` (Buchstaben, Farben, Kontrast),
`tests/origin.db.test.ts` (Verzeichnis, Rechte, Baum, Personenseite samt
Zusammenführungs-Kette, Übersicht, Umbenennen), `tests/mcp.db.test.ts`
(`get_person.origin`); `e2e/read/origin.spec.ts`,
`e2e/write/origin.spec.ts`.

---

## Export

### lib/services/exchange-export.ts

**Zweck:** Baut den Export im Austauschformat (`lib/exchange.ts`) aus dem für
den Benutzer sichtbaren Bestand; Grundlage auch des GEDCOM-Exports.
Nimmt die Ortszuordnungen der exportierten Ortstexte mit (`places`,
`exchangePlacesFor`; Begründungen nur bei Admin-Export).

**Wichtige Funktionen:**
- `buildExport(scope, auswahl?)` — Personen, Beziehungen, Ereignisse, weitere
  Namen, Belege, Quellen, Fremdkennungen, Rohdaten und Bilder; dazu die
  Zuordnung Bilddateiname → Speicherschlüssel für das ZIP.

**Regeln und Entscheidungen:**
- Nur Beziehungen, deren **beide** Seiten exportiert werden — eine halbe
  Beziehung verwiese beim Empfänger ins Leere und verriete die andere Seite.
  (Strenger als der Baum, der eine sichtbare Seite genügen lässt.)
- Ereignisse, Namen, Belege, Fremdkennungen und Rohdaten nur an exportierten
  Personen, Beziehungen bzw. Quellen. Rohdaten reisen mit ihrem Träger (auch
  überholte, es gibt keinen Filter darauf); Rohdaten ohne Träger bleiben in
  der Instanz.
- Quellen: die zitierten; ohne Auswahl zusätzlich für Administratoren alle,
  für andere die eigenen noch unbelegten. Mit Familienauswahl nur die
  zitierten.
- Bilder an exportierten Personen, Beziehungen, Ereignissen, Belegen und
  Quellen reisen mit; ein Hauptscan nur, wenn der Benutzer ihn sehen darf.

**Rechte/Datenschutz:** Beschränkt auf sichtbare Personen — sonst wäre der
Export ein Weg, das Rechtekonzept mit einem Klick zu umgehen. Die
Familienauswahl verengt nur zusätzlich.

**Protokoll:** — (nur lesend)

**Benutzt von:** `app/api/export/route.ts`; `gedcom-export.ts`.

**Tests:** `tests/gedcom-export-selection.db.test.ts`,
`tests/media-links.db.test.ts`; `e2e/read/export.spec.ts`.

### lib/services/gedcom-export.ts

**Zweck:** GEDCOM-Export (5.5.1, UTF-8) aus dem sichtbaren Bestand, als Datei
oder ZIP mit Bildern.

**Wichtige Funktionen:**
- `buildGedcomExport(scope, {mediaPrefix, selection})` — GEDCOM-Text und
  Bytes, Dateiname, Bilddateien und Statistik (Personen, Familien, Quellen,
  Ereignisse, Bilder, aus Rohdaten übernommene Zusätze, entfernte Zeiger,
  zurückgeschriebene abgelehnte Familien).
- `buildGedcomZip(scope, selection)` — ZIP mit `stammbaum.ged` und
  `media/<Datei>`; fehlende Bilddateien werden gezählt und in einer
  `HINWEIS.txt` genannt.
- `appDateToGedcom(zeile, schlüssel)` — App-Datum → GEDCOM-Datum.

**Regeln und Entscheidungen:**
- Zugeordnete Orte: PLAC in der heutigen Form „Ort, Region, Land“ mit MAP
  und dem Originaltext als NOTE (`lib/services/place-export.ts`); ein
  ursprünglicher PLAC aus den Rohdaten wird dann nicht darübergelegt.
- Dieselbe Grenze wie `buildExport`; die App-Werte sind maßgeblich. Aus dem
  beim Import aufbewahrten Originaldatensatz kommt zurück, was die App nicht
  abbildet (fremde Tags, Koordinaten, strukturierte Anschriften,
  Fotoverweise, Privatsphäre-Angaben, genaue Verlässlichkeitswerte).
- Verweise in solchen Rohdaten auf nicht exportierte Datensätze werden
  entfernt (sonst zeigten sie ins Leere bzw. verrieten sie).
- Notizen als Text; HTML des Originals nur, wenn der Text in der App
  unverändert ist.
- Zusammengeführte Datensätze: eine Person, eine `_UID` — maßgeblich ist der
  ursprüngliche Herkunftseintrag (ohne `mergedFromId`), sonst der älteste;
  die Kennungen anderer Bäume bleiben in der App und im JSON-Export.
- Beim Import abgelehnte Beziehungen (Rohdaten mit `:ABGELEHNT`) werden als
  Familie zurückgeschrieben.
- Teil-Export: Verweise nur auf mitexportierte Datensätze.

**Rechte/Datenschutz:** wie `buildExport` (sichtbarer Bestand).

**Protokoll:** —

**Benutzt von:** `app/api/export/route.ts`.

**Tests:** `tests/gedcom-export-selection.db.test.ts`,
`tests/gedcom-import.db.test.ts` (Rundreise), `tests/media-links.db.test.ts`,
`tests/merge.db.test.ts`; Schreiber: `tests/gedcom-writer.test.ts`;
`e2e/read/export.spec.ts`, `e2e/read/gedcom-export-dialog.spec.ts`.

### lib/services/export-selection.ts

**Zweck:** Familienauswahl für den GEDCOM-Export: Anfrage prüfen,
Personenfilter bilden, Übersicht für den Dialog liefern (Regeln in
`lib/export-selection.ts`).

**Wichtige Funktionen:**
- `parseExportSelection(scope, params)` — liest `families=<id>,<id>` und
  `withoutFamily=1`; ohne beide `null` (alles Sichtbare).
- `selectionPersonFilter(auswahl)` — Datenbankfilter: Personen der gewählten
  Familien und/oder ohne Familie.
- `exportFamilyOverview(scope)` — Familien des Benutzers, Personenzahlen je
  Kombination von Familien (für die Zählung im Dialog), Zahl der Personen
  ohne Familie (nur für Administratoren).

**Regeln und Entscheidungen:** Höchstens 1000 Familien je Anfrage; mindestens
eine Familie oder „ohne Familie“ muss gewählt sein.

**Rechte/Datenschutz:** „Ohne Familie“ nur für Administratoren. Fremde **und**
unbekannte Familien lehnen wir für Nicht-Administratoren einheitlich mit
`FORBIDDEN` ab, ohne zu unterscheiden — sonst ließe sich die Existenz fremder
Familien abfragen. Administratoren bekommen für unbekannte Kennungen
`VALIDATION`.

**Protokoll:** —

**Benutzt von:** `app/api/export/route.ts`, `app/admin/data/page.tsx`;
`exchange-export.ts`.

**Tests:** `tests/gedcom-export-selection.db.test.ts`;
`e2e/read/gedcom-export-dialog.spec.ts`.
