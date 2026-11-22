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
| `timeline.ts` | Zeitleiste einer Person bzw. Familie |
| `consistency.ts` | Plausibilitätsprüfung über sichtbare Daten |
| `duplicates.ts` | Mögliche Dubletten (Liste, je Person), „kein Duplikat“ |
| `merge.ts` | Zwei Personen zusammenführen (Vorschau, Ausführen) |
| `merge-bulk.ts` | Sichere Dubletten in einem Rutsch zusammenführen |
| `reference.ts` | Bezugsperson („das bin ich“), Verwandtschaft und Linien |
| `map.ts` | Daten der Karte „Wurzeln nach Jahr“ |
| `places.ts` | Ortstexte → Koordinaten (Ortszuordnung, nur Admin) |
| `changes.ts` | Änderungsgeschichte lesen (Personenverlauf, Paketübersicht) |
| `ai-access.ts` | KI-Recht, persönliche Schlüssel, Prüfung je MCP-Aufruf |
| `imports.ts` | Importläufe, Herkunft, Fremdkennungen, Rohdaten |
| `import-apply.ts` | Massenimport in einer Transaktion |
| `gedcom-import.ts` | GEDCOM-Import mit Vorschau und Abgleich |
| `gedcom-photos.ts` | Fotos aus einer GEDCOM-Datei herunterladen |
| `import-jobs.ts` | GEDCOM-Import im Hintergrund ausführen |
| `import-linking.ts` | „Importe verbinden“ (Abgleich und Zusammenführen im Hintergrund) |
| `exchange-export.ts` | Export (JSON/ZIP) des sichtbaren Bestands |
| `gedcom-export.ts` | GEDCOM-Export (Datei bzw. ZIP mit Bildern) |
| `export-selection.ts` | Familienauswahl für den GEDCOM-Export |

---

## Grundbausteine

### lib/services/index.ts

**Zweck:** Sammel-Einstieg `@/lib/services`. Beschreibt im Kopfkommentar die
Grundsätze der Schicht (reine async-Funktionen, Scope, kein `next/*`,
`ServiceError`, lesende Einzelabfragen liefern `null`).

**Wichtige Funktionen:** keine eigenen; reicht `errors`, `dto`, `context`,
`tree`, `persons`, `relationships`, `research`, `duplicates`, `merge`,
`merge-bulk`, `families`, `kinship`, `reference`, `timeline`, `consistency`,
`sources`, `ai-access`, `events`, `names`, `imports`, `import-apply`,
`changes`, `media-links`, `attached-media` weiter, aus `graph-data` nur
`loadGraph` und die Graph-Typen.

**Regeln und Entscheidungen:** Nicht über den Sammel-Export erreichbar sind
`map`, `places`, `export-selection`, `exchange-export`, `gedcom-export`,
`gedcom-import`, `gedcom-photos`, `import-jobs`, `import-linking` und `media`;
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
- `iso(d)`, `fullName(p)`, `importLabel(scope, lauf)`,
  `MANUAL_ORIGIN_LABEL` („von Hand erfasst“).

**Regeln und Entscheidungen:** `restricted: false` kennzeichnet sichtbare
Personen; Platzhalter tragen `restricted: true` (aus `lib/scope.ts`).

**Rechte/Datenschutz:** `toPersonSummary` gibt nur die Familien heraus, die
der Benutzer selbst kennt (`visibleFamilyIds`). `importLabel` nennt Dateiname
und Datum eines Imports nur Administratoren, sonst nur „importiert“.

**Protokoll:** —

**Benutzt von:** den meisten Diensten; `fullName` und `iso` auch in Seiten,
Komponenten, `mcp/format.ts`, `mcp/tools.ts` und mehreren `lib/*`-Modulen.

**Tests:** keine eigenen; indirekt über alle Dienst-Tests.

### lib/services/context.ts

**Zweck:** Scope für Aufrufer außerhalb von Next.js.

**Wichtige Funktionen:**
- `scopeForEmail(email)` — sucht den Benutzer (E-Mail getrimmt, klein) und
  lädt seinen Scope.
- `scopeForUserId(id)` — dasselbe über die Benutzer-ID.

**Regeln und Entscheidungen:** Unbekannte und gesperrte (`BLOCKED`) Benutzer
ergeben `null` — dieselbe Regel wie bei der Anmeldung.

**Rechte/Datenschutz:** Der Scope enthält kein `via`; Aufrufe damit laufen im
Protokoll als Kanal „App“.

**Protokoll:** —

**Benutzt von:** ausschließlich Tests (`scopeForEmail` in fast allen
`tests/*.db.test.ts`). `scopeForUserId` wird nirgends benutzt. Der MCP-Server
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
README („Grenzen“).

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
- `createRelationship(scope, input)` — neue Beziehung.
- `updateRelationship(scope, id, patch)` — Art, Zeitraum, Orte, Notiz ändern.
- `deleteRelationship(scope, id)` — Beziehung löschen.
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
  Bilder.
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

**Auffällig:** `normalizeName` wird nirgends benutzt (die Namensvergleiche
laufen über `lib/name-keys.ts` bzw. eine eigene Funktion in
`lib/gedcom-import/suggest.ts`); `RELATIONSHIP_GAP_LABEL` ebenso.

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

**Benutzt von:** MCP `get_kinship`; `lib/reference.ts` (Abgleich im
Kommentar: die Bezugsperson-Berechnung stimmt mit `kinshipInGraph` überein).

**Tests:** `tests/reference.test.ts` (Vergleich mit `lib/reference.ts` für
jedes Paar), `tests/research.db.test.ts`, `tests/import-linking.db.test.ts`,
MCP-Tests.

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
  maxYearDiff})` — Paare nach Klasse und Punkten, seitenweise (Standard 25,
  höchstens 500), mit Zählung je Klasse, Zahl der ausgeblendeten Paare und
  `canMerge` je Paar.
- `listDuplicatesOfPerson(scope, personId, {limit})` — Kandidaten einer
  Person (Standard 3, höchstens 50) mit Herkunft („von Hand erfasst“ bzw.
  Import).
- `dismissDuplicate(scope, a, b)`, `undismissDuplicate(scope, a, b)` — Paar
  dauerhaft als „kein Duplikat“ markieren bzw. die Markierung aufheben.

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
`app/research/duplicates/page.tsx`, `app/people/[id]/page.tsx` (Hinweis);
`research.ts`, `merge-bulk.ts`, `import-linking.ts`; MCP indirekt über
`find_possible_duplicates`.

**Tests:** `tests/person-duplicates.db.test.ts`, `tests/services.db.test.ts`
(über `findPossibleDuplicates`), MCP-Tests (Regeln: `tests/duplicates.test.ts`);
`e2e/read/duplicate-banner.spec.ts`, `e2e/write/duplicate-banner.spec.ts`,
`e2e/write/merge.spec.ts`.

### lib/services/merge.ts

**Zweck:** Zwei Personen zusammenführen: Die Person `mergeId` geht in `keepId`
auf. Vorschau ohne Schreiben und Ausführen in einer Transaktion. Regeln der
Hauptangaben in `lib/merge-rules.ts`.

**Wichtige Funktionen:**
- `previewPersonMerge(scope, keepId, mergeId, {choices,
  relationshipSubtypes})` — beide Seiten (Felder, Familien, Lebensdaten,
  Eltern, Partner, Kinderzahl, Importe, Herkunft), Feldvergleich mit Wahl,
  wählbare Art zusammenfallender Beziehungen, Zusammenfassung in ganzen
  Sätzen, Blocker, `canMerge` und ein Stand-Kennzeichen (`token`).
- `mergePersons(scope, input, {tx, now, parentEdges})` — führt aus; mit
  `expectedToken` aus der Vorschau.
- `loadMergeSnapshot`, `planMerge`, `summarizePlan` — Bausteine, auch für
  Sammel-Zusammenführen und „Importe verbinden“.
- `lockPersons(db, ids)` — Advisory-Lock je Person (sortiert), damit zwei
  Zusammenführungen derselben Person aufeinander warten.
- `entryTag`, `mergeInputSchema`, `MERGE_SUBTYPE_LABEL` — Hilfen.

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

**Benutzt von:** `app/api/persons/merge/preview/route.ts`,
`app/api/persons/merge/route.ts`; `merge-bulk.ts`, `import-linking.ts`;
Typen in `components/MergeView.tsx`.

**Tests:** `tests/merge.db.test.ts`, `tests/changelog.db.test.ts`,
`tests/reference.db.test.ts` (Regeln: `tests/merge-rules.test.ts`);
`e2e/write/merge.spec.ts`.

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
Vorschau); Typen in `components/DuplicateList.tsx`.

**Tests:** `tests/reference.db.test.ts` (`bulkMerge`);
`e2e/write/merge.spec.ts` („sichere Paare in einem Rutsch“). Für
`previewBulkMerge` gibt es keinen Dienst-Test.

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
nicht „nicht zuordenbar“).

**Rechte/Datenschutz:** Grundlage sind nur sichtbare Personen; Vorfahren und
Linien auf dem Graphen der sichtbaren Personen (`visibleIndex`). Gesperrte
Personen tauchen weder auf der Karte noch in einer Zahl auf; Großeltern nur,
wenn sichtbar. Die Ortstexte und die Zuordnungsliste selbst sieht nur ein
Administrator (`places.ts`).

**Protokoll:** —

**Benutzt von:** `app/map/page.tsx`, `app/api/map/route.ts`.

**Tests:** `tests/map.db.test.ts` (Regeln: `tests/map.test.ts`);
`e2e/read/map.spec.ts`.

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
- `autoAssignPlaces(scope)` — ordnet alle nicht von Hand bestätigten
  Ortstexte neu zu.

**Regeln und Entscheidungen:** Von Hand Bestätigtes (`MANUAL`) wird von der
Automatik nie überschrieben oder gelöscht. Die Automatik legt neue
Zuordnungen an, aktualisiert geänderte Treffer und entfernt automatische
Zuordnungen ohne Treffer bzw. zu Texten, die nirgends mehr vorkommen.
Bestätigen ohne vorhandene Zuordnung → `CONFLICT`. Koordinaten werden auf 5
Nachkommastellen gerundet.

**Rechte/Datenschutz:** Nur Administratoren — jede Funktion prüft selbst
`isAdmin`, zusätzlich zur Route, weil die Liste die Ortstexte **aller**
Personen enthält, auch gesperrter.

**Protokoll:** Einträge mit `entityType` „Place“ (`CREATE`, `UPDATE` mit
Feldänderungen, `DELETE` mit vorherigem Stand), direkt über `auditData`
geschrieben. Paket „Ort zugeordnet: …“ bzw. ein Paket „Orte automatisch
zugeordnet“ für alle Einträge der Automatik.

**Benutzt von:** `app/admin/places/page.tsx`, `app/api/places/route.ts`,
`app/api/places/search/route.ts`, `app/api/places/auto/route.ts`; Typen in
`components/PlaceAdmin.tsx`.

**Tests:** `tests/map.db.test.ts` (Regeln: `tests/places.test.ts`);
`e2e/write/places.spec.ts`.

---

## Änderungsgeschichte und KI-Zugang

### lib/services/changes.ts

**Zweck:** Changelog lesen: Verlauf einer Person für ihre Bearbeiter und
Übersicht der Pakete für Administratoren. Grundlage ist das `AuditLog` mit
Paket und Momentaufnahme der betroffenen Personen und Familien.

**Wichtige Funktionen:**
- `listPersonChanges(scope, personId, {cursor, limit})` — Einträge zu einer
  Person, neueste zuerst, seitenweise (Standard 20, höchstens 100; Cursor =
  Kennung des letzten Eintrags).
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
  … in …“, „Beim Import angelegt: …“, „Ort zugeordnet: …“), Benutzer, Kanal,
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
Verwandten aus fremder Familie) ohne Feldwerte.

**Protokoll:** — (nur lesend)

**Benutzt von:** `app/api/persons/[id]/changes/route.ts`,
`app/api/changes/route.ts`, `app/api/changes/[key]/route.ts`,
`app/admin/changes/page.tsx`; Typen in `components/ChangeEntryList.tsx`,
`components/ChangeSetList.tsx`, `components/PersonChanges.tsx`.

**Tests:** `tests/changelog.db.test.ts` (Regeln der Pakete:
`tests/changelog.test.ts`); `e2e/write/changelog.spec.ts`.

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

## Import

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
- `listImportBatches`, `getImportBatch`, `readImportBatchFile`,
  `deleteImportBatchFile` — Läufe lesen, Originaldatei lesen bzw. bewusst
  löschen (Lauf und Herkunft bleiben).
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
oder „überholt“); ohne → `FORBIDDEN`. Eine zu große Datei wird ebenfalls mit
`FORBIDDEN` abgelehnt (nicht `VALIDATION`).

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
benutzt; `deleteImportBatchFile` gar nicht.

### lib/services/import-apply.ts

**Zweck:** Massenimport für GEDCOM- und andere Importe: Personen, Namen,
Beziehungen, Ereignisse, Quellen, Belege, Fremdkennungen und Rohdaten in
**einem** Aufruf und einer Transaktion, mit Sammel-Einfügungen je Tabelle.

**Wichtige Funktionen:**
- `applyGenealogyImport(scope, input, {tx, onInvalid, now, dryRun})` —
  validiert die Eingabe (`genealogyImportSchema`), löst Verweise auf, prüft
  alle Regeln und schreibt; Ergebnis: neue IDs je `ref`, Ergebnis je Eintrag
  (`created`, `updated`, `unchanged`, `skippedEdited`, `skipped`, `invalid`),
  Zählungen, ungültige Einträge mit Grund, Feldänderungen.
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
  behalten, Herkunft auf die neuen Dateiwerte setzen). Gleiche Werte →
  `unchanged`, nur die Herkunft wird fortgeschrieben. **Gelöscht wird nie.**
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
  des Quell-Baums (automatisch, vorhandener, neu).
- `rereadGedcomBatch(scope, batchId)` — ausgeführte Datei aus dem Original
  erneut einlesen (neuer Lauf, übliche Vorschau).
- `getGedcomPlan`, `listGedcomPlanItems(scope, batchId, {kind, group, q,
  offset, limit})` — Zusammenfassung bzw. Einträge seitenweise (Gruppen: neu,
  geändert, unverändert, in der App geändert, fehlt in der Datei, vorhanden,
  ungültig).
- `applyGedcomImport(scope, batchId, entscheidungen)` — Import mit den
  Entscheidungen des Administrators (`applyDecisionsSchema`: Umgang mit „in
  der App geändert“ je Eintrag, zu löschende fehlende Einträge, Zuordnung zu
  von Hand angelegten Personen, Familie (keine, vorhandene, neue),
  Privatsphäre-markierte Personen ohne Familie, Fotos herunterladen).
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
  Xref. Ähnliche, von Hand angelegte Personen sind nur Vorschläge.
- „In der App geändert“: Standard „App behalten“ (`link`), je Eintrag
  umschaltbar auf „Datei übernehmen“ (`update`).
- Vorschläge: jede App-Person höchstens einmal und nur von Hand angelegte.
  Eine neue Familie darf nicht schon existieren.
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
`tests/import-linking.db.test.ts`, `tests/merge.db.test.ts` (Parser und
Zuordnung: `tests/gedcom-*.test.ts`); `e2e/write/gedcom-import.spec.ts`,
`e2e/write/import-sources.spec.ts`.

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
- `startImportJob(scope, batchId, entscheidungen)` — startet
  `applyGedcomImport` im Hintergrund; Zustand `running`.
- `importJobState(scope, batchId)` — `idle`, `running`, `done` (Ergebnis)
  oder `error` (Meldung); ohne laufenden Auftrag aus dem Lauf in der
  Datenbank (abgeschlossen → `done` mit `alreadyApplied`).
- `waitForImportJob(scope, batchId, timeout)` — auf das Ende warten (für Tests
  und Skripte gedacht).

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
Oberfläche. `waitForImportJob` wird nirgends benutzt.

### lib/services/import-linking.ts

**Zweck:** „Importe verbinden“ (Recherche → Importe verbinden, nur
Administratoren): Personen, die in mehreren Importen vorkommen, finden
(`linkImports` in `lib/import-linking.ts`) und nach Bestätigung
zusammenführen.

**Wichtige Funktionen:**
- `listConnectGroups(scope)` — Importe (Quell-Bäume mit abgeschlossenem Lauf
  und noch vorhandenen Personen) und „von Hand erfasst“ zur Auswahl.
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

---

## Export

### lib/services/exchange-export.ts

**Zweck:** Baut den Export im Austauschformat (`lib/exchange.ts`) aus dem für
den Benutzer sichtbaren Bestand; Grundlage auch des GEDCOM-Exports.

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
