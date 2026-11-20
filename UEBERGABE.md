# Übergabe (Stand 20.11.2026)

Arbeitsnotiz für die Fortsetzung auf einem anderen Rechner. Liegt nur auf dem
Branch `optimierung`; vor einem Zusammenführen nach `main` entfernen oder
aktualisieren.

## Stand

- `main` = ausgerollter Stand. Jeder Merge nach `main` baut das Image
  (GitHub Actions, Workflow „Images“) und zieht den Branch `deploy` nach;
  Portainer aktualisiert den Stack von dort. **Ein Merge ist ein
  Produktiv-Deployment auf echte Daten.**
- `optimierung` = Arbeitsbranch, inhaltlich gleich `main` plus diese Datei.
- Zuletzt ausgerollt: Importe verbinden, Korrekturen beim Zusammenführen und
  an der Quellenanzeige, Favicon. Keine offene Migration; letzter
  Migrationsordner `20261121000000_quellen_einordnen`.
- Prüfstand des letzten Pakets: Typecheck, Lint, Vitest 666/666; Playwright
  mit einem Worker auf frischem Server: setup 6/6, read 116/116,
  write 71/72 (ein Kaltstart-Timeout in `dates.spec`, einzeln grün).

## Lokal einrichten

```bash
cp .env.example .env
npm install
docker compose -f docker-compose.dev.yml up -d   # nur Postgres
npm run mock:setup                                # Mock-Datenbank + Bilder
npm run dev:mock                                  # http://localhost:3100
```

Anmeldung im Mock per Dev-Login, z.B. `admin@example.test`. Tests siehe
README, Abschnitt „Tests“.

## Leitlinien des Eigentümers

- **Die App ist die Wahrheit, Importe sind Quellen.** Zusammenführen heißt
  anreichern: Leeres füllen, der genauere Wert bleibt, Widersprüchliches wird
  Zweitangabe. Keine Verwaltung nach „Bäumen“, keine Frage „welcher Baum
  gewinnt“. Herkunft ist Zusatzinformation.
- **Falsche Zusammenführungen sind der schlimmste Fehler.** Die Klasse
  „sicher“ wird nie gelockert; eine einzelne Brücke zwischen sonst getrennten
  Familien ist nie „sicher“.
- **KI über MCP: vorprüfen und vorschlagen, nicht selbst zusammenführen.**
- Lange Arbeiten in kleine Schritte teilen und nach jedem Schritt berichten.
- Nach `main` nur abgeschlossene, geprüfte Stände.

## Offene Pakete, in dieser Reihenfolge

### 1. Zusammenführen: Komfort und KI-Vorprüfung (Entwurf freigegeben)

- **Banner auf der Personenseite** für Bearbeiter beider Einträge:
  „N mögliche Dubletten: Name (Lebensdaten, Import) — Vergleichen“. Billig
  berechnen: Personen mit gleichem erstem Vornamen laden, dann
  `scoreDuplicate` (`lib/duplicates.ts`); als „kein Duplikat“ markierte Paare
  ausschließen; Seitenzeit messen.
- **Knopf „Zusammenführen …“** neben „Im Stammbaum zeigen“ mit Dialog:
  zuerst die Kandidaten dieser Person (Klasse, Begründungssatz über
  `evidenceSentence` in `lib/import-linking.ts`), darunter die freie
  Personensuche. Den Eintrag unter „Verwaltung“
  (`components/MergeWithPicker.tsx`) entfernen.
- **Folgedubletten** auf der Ergebnisseite: Eltern×Eltern, Partner×Partner,
  Kinder×Kinder der bleibenden Person (`relaxedMatch` in
  `lib/import-linking.ts`, noch nicht exportiert, plus `scoreDuplicate`);
  „alle sicheren Folgedubletten zusammenführen“ über
  `previewBulkMerge`/`bulkMerge` (`lib/services/merge-bulk.ts`).
- **Alte Kennung als Umleitung**, neue Migration: Tabelle
  `PersonRedirect(fromId PK, toId FK Person ON DELETE CASCADE, createdAt)`.
  Im Merge-Schritt `X→K` anlegen und bestehende `…→X` auf `K` umbiegen.
  Rückfüllung aus `AuditLog` (`MERGE`-Einträge: `diff->>'mergeId'` →
  `entityId`; dazu `CONNECT`-Einträge mit `diff.clusters`).
  **Bedingung:** Die Rückfüllung darf an keinen Daten scheitern können (nur
  Zeilen mit den erwarteten Schlüsseln, keine werfenden Casts, Ziel existiert,
  `ON CONFLICT DO NOTHING`) und ist nachzuweisen auf einer Datenbank mit
  Zusammenführungen des veröffentlichten Codes: einzeln, gesammelt, Kette
  A→B→C, bleibende Person später gelöscht. Geht das nicht beweisbar in SQL:
  nur die Tabelle anlegen, Rückfüllung idempotent im Code.
  Verhalten: `/people/<alt>` und `/tree?focus=<alt>` → 308, nur wenn die
  Person sichtbar ist; `GET /api/persons/<alt>` → 308; PATCH/DELETE auf eine
  alte Kennung → 409 mit `mergedInto`. MCP löst Personen-Kennungen still auf
  und meldet `resolvedFrom`. Keine Umleitung für aufgegangene Beziehungen und
  Ereignisse.
- **KI-Vorprüfung**: Tabelle `DuplicateReview` (Paar als Schlüssel, `verdict`
  MERGE | DISPUTED | NOT_DUPLICATE, `reason`, `suggestedKeepId`, Benutzer,
  Schlüssel, Zeitpunkt, Stand beider Personen zur Erkennung „veraltet“).
  MCP-Werkzeuge `list_duplicate_candidates`, `preview_person_merge`
  (Trockenlauf, genau die Vorschau der Oberfläche), `review_duplicate`
  (Schreibstufe; speichert nur die Einschätzung). Prompt `review_duplicates`.
  In den Server-Hinweis ausdrücklich: Es gibt kein `merge_persons`.
  Oberfläche: Einschätzung je Paar anzeigen, Filter „von der KI vorgeprüft“
  je Urteil, Sammelaktionen nur über die normale Vorschau; nie vorausgewählt,
  die Klasse bleibt unverändert.
- Dazu klein: **„Erst die Eltern, dann dieses Paar zusammenführen“** in
  einem Schritt auf der Vergleichsseite (Vorschläge liefert bereits
  `MergeBlocker.suggestions` in `lib/services/merge.ts`).

### 2. Herkunft sichtbar machen und visualisieren (Entwurf freigegeben)

- Je Import ein Buchstabe (A, B, C … nach Reihenfolge des ersten Imports) und
  eine Farbe aus der Okabe-Ito-Palette; „von Hand erfasst“ = gestrichelter
  Chip „H“. Nie nur Farbe.
- **Lesbare Namen für Importe**: Anzeigename je Import, überall verwendet.
  Falls dafür eine Spalte nötig ist: kleine ergänzende Migration, vorher
  abstimmen.
- **Stammbaum**: Schalter `?herkunft=1`, standardmäßig aus, nur Bearbeiter
  und Administratoren. Zuordnung Person → Importe nur bei eingeschaltetem
  Schalter laden; höchstens drei Chips je Karte, dann „+n“;
  Verbindungspersonen mit dezentem Ring; Legende mit Hervorheben per Klick.
- **Personenseite**: Block „Herkunft“ (Importe, „zusammengeführt am … aus N
  Einträgen“ aus dem `MERGE`-Eintrag); kleine Chips an Ereignissen, Namen,
  Beziehungen, Belegen. Bei den Hauptangaben nur ehrliche Aussagen — es gibt
  keine Änderungsgeschichte je Feld.
- **Übersicht** auf `/research/connect`: Importe als Kreise, Kanten mit der
  Zahl der Verbindungspersonen, dazu dieselben Angaben als Liste.
- MCP: `get_person.origin` nur, wenn der Benutzer die Person bearbeiten darf.
- Ausgangspunkte: `ImportLink` (`sourceTreeId`, `mergedFromId`, `mergedAt`),
  `components/PersonNode.tsx`, `components/FamilyTree.tsx`,
  `app/tree/page.tsx`, `lib/services/tree.ts`.

### 3. Vorschläge schon beim Import

- Neue Personen der Datei gegen vorhandene Personen aller anderen Importe
  abgleichen (`lib/import-linking.ts`), Wahl „Mit vorhandener Person
  verknüpfen“, Standard bleibt „neu anlegen“. In der Vorschau prominent:
  „Dieser Import hängt über N Personen mit vorhandenen Daten zusammen“.
- Heute verknüpft `applyGedcomImport` Vorschläge nur mit von Hand erfassten
  Personen (`lib/services/gedcom-import.ts`, Prüfung
  `importLinks: { none: {} }` bei `decisions.suggestions`) — für importierte
  Personen öffnen. `import-apply` legt beim Verknüpfen bereits einen
  zusätzlichen Herkunftsvermerk an.

### 4. Weitere offene Punkte

- **Admin-Aktion „Quellen neu einordnen“** für gespeicherte Daten. Die
  Anzeige ist bereits robust; gespeicherte Art, Anbieter und Belegadressen
  älterer Importe sind es noch nicht. Regeln: von Hand Geändertes nicht
  anfassen, Fingerabdrücke der Herkunftsvermerke nachziehen, doppelte Belege
  nur auf ausdrückliches Ankreuzen entfernen.
- **Seltener Fehler auf `/people`**: zweimal ein Hydration-Fehler, einmal ein
  verlorener Klick auf eine Seitenzahl (die Adresse blieb stehen). Vermutung:
  Klick bzw. Auswahl vor der Hydration. Beim nächsten Auftreten die
  Aufzeichnung aus `test-results` sichern, bevor sie überschrieben wird.
- **GEDCOM-Export**: eine abgelehnte Eltern-Kind-Verbindung (z.B. dritter
  leiblicher Elternteil) bleibt als Original erhalten, wird aber nicht
  zurückgeschrieben.
- **Sicherheitsprüfung** des ausgerollten Stands (die App ist aus dem
  Internet erreichbar): systematische Durchsicht der Schnittstellen,
  Schutz-Kopfzeilen, Abhängigkeiten, Drosselung; besonders der optionale
  Foto-Download beim Import (`lib/safe-fetch.ts`).
- Später, vom Eigentümer zurückgestellt: Anmeldung per E-Mail-Link für
  Verwandte ohne GitHub-Konto; OAuth-Zugang für claude.ai-Connectoren;
  Anbindung an das Gateway (eigenes Repository).

## Messwerte zum Abgleich „Importe verbinden“

An erzeugten Testbäumen mit bekannter Lösung und eingebauten Fallen
(`tests/fixtures/linking-generator.ts`):

| Klasse | Trefferquote | Anteil der echten Paare |
|---|---|---|
| sicher | 100 % | 23–26 % |
| sehr wahrscheinlich | 100,00 % (5781 Paare) | 27 % |
| wahrscheinlich | 99,4–99,9 % | 66–69 % |

Laufzeit: 2 Importe mit je rund 4800 Personen 0,56 s; 5 Importe mit zusammen
11 847 Personen 4,5 s. Mit echten Datenmengen über die Oberfläche ist
`/research/connect` noch nicht erprobt.

## Stolperfallen dieser Umgebung

- **Entwicklungsserver**: verwirft übersetzte Seiten, wächst auf 3–4 GB, die
  erste Übersetzung einer Seite dauert mehrere Sekunden und reißt die
  Zeitgrenzen der Tests. Vor einem Gesamtlauf den Server neu starten; auf
  schwacher oder belasteter Maschine mit `--workers=1` in Teilen laufen
  lassen und zwischen read und write neu starten. `onDemandEntries` in
  `next.config.mjs` hat nicht geholfen.
- **Während eines Gesamtlaufs nichts ändern** (keine Dateien, kein `tsc`):
  Der Server übersetzt sonst neu, und es entstehen Ausfälle in `auth` und
  `permissions`, die nur Last sind.
- **Windows**: `prisma generate` scheitert mit EPERM, solange ein
  Entwicklungsserver die Engine-Datei geladen hat. Vorher stoppen.
- **Mock**: Seed und Setup verweigern Datenbanknamen ohne Endung
  `_mock`/`_test` und Medienordner ohne `-mock`/`-test`.
- **Playwright**: schreibende Tests mit 2 Workern; Dateien im Modus `serial`
  überspringen nach einem Fehler den Rest der Datei.
- **Migrationen**: eine veröffentlichte Migration nie nachträglich ändern.
  `node docker/schema-diff-check.mjs < migration.sql` prüft, ob eine neue
  rein ergänzend ist; Abweichungen in der Release-Beschreibung begründen.
- **Öffentliches Repository**: nichts Persönliches committen (keine
  Hostnamen, keine Namen oder Daten aus echten Stammbäumen). Echte
  GEDCOM-Dateien liegen nur lokal unter `data/import/` (von Git ausgenommen).
