# Übergabe (Stand 23.11.2026)

Arbeitsnotiz für die Fortsetzung auf einem anderen Rechner. Beim Weiterarbeiten
aktuell halten oder entfernen, sobald die offenen Pakete erledigt sind.

## Stand

- `main` = ausgerollter Stand. Jeder Merge nach `main` baut das Image
  (GitHub Actions, Workflow „Images“) und zieht den Branch `deploy` nach;
  Portainer aktualisiert den Stack von dort. **Ein Merge ist ein
  Produktiv-Deployment auf echte Daten.**
- `optimierung` = Arbeitsbranch, zum Zeitpunkt der Übergabe gleich `main`.
- Release 2026-11-23.1 (23.11.): Zusammenführen-Komfort mit Umleitung alter
  Kennungen (`20261125000000_person_redirect`), KI-Vorprüfung von Dubletten
  (`20261125000001_duplicate_review`), Herkunft der Importe
  (`20261125000002_import_anzeigename`, letzter Migrationsordner),
  Hydration-Fehler behoben (Rückportierung einer React-Korrektur beim Bauen,
  `lib/next-patches/`), Sicherheitsprüfung (`docs/sicherheit.md`). Davor am
  22.11.: Orte in der Anzeige (2026-11-22.5), Orte ohne Knopfdruck und mit
  KI (2026-11-22.4), Neuigkeiten/Hilfe/E2E gegen Produktions-Build (.3),
  Karte/Orte, Schlüsselverwaltung, Komponenten-Doku (.2), Bilder an
  Einträgen (.1).
- Prüfstand: Migrationen ↔ Schema ohne Abweichung, alle drei neuen
  Migrationen rein ergänzend, Typecheck, Lint, Vitest 956/956.
- Arbeitsweise seit 23.11. (AGENTS.md, Abschnitt 2 und 3): höchstens zwei
  Sub-Agenten gleichzeitig, auf Opus, mit kurzem Auftrag; Agenten testen
  gezielt; der Playwright-Gesamtlauf läuft nur auf Anfrage des Eigentümers
  bzw. nach seiner Bestätigung vor dem Ausrollen.
- Paket **Orte ohne Knopfdruck und mit KI** (ausgerollt 22.11.): Vorschlag am Ortsfeld (`components/PlaceHint.tsx`,
  `GET /api/places/suggest`), automatische Zuordnung neuer Ortstexte nach
  dem Speichern und nach Importen im Hintergrund (`queuePlaceAutoAssign`,
  abschaltbar mit `PLACE_AUTO_ASSIGN=off`, in Vitest aus), MCP-Werkzeuge
  `suggest_place`, `list_places`, `assign_place` (Stapel bis 50, eigene Orte,
  Begründung, „unsicher“) und Prompt `orte_zuordnen`, KI-Zuordnungen auf
  `/admin/places` als „von KI“ mit Bestätigen. Neue, rein ergänzende
  Migration `20261124000001_orte_ki` (`PlaceSource.AI`, `Place.note`,
  `Place.uncertain`). Das Ortsverzeichnis ist jetzt für alle API-Routen im
  Standalone-Build (`next.config.mjs`, `/api/**`, `/places/**`). Dazu
  Ortsseiten `/places/<ref>` (ein Ort = gleicher Verzeichniseintrag bzw.
  gleiche Koordinaten), Ortslinks auf der Personenseite, „Ort wählen …“ in
  den Ortsfeldern (`POST /api/places/choose`, Zuordnung „von Hand“ nur für
  diesen Text), GEDCOM-Export mit heutiger Ortsform + MAP + NOTE
  „Originaltext“ (Rundreise über den eigenen Import), Austauschformat
  Version 5 mit `places`, MCP `get_place` und `places` in
  `get_person`/`list_events`. Prüfstand: Vitest 877/877, Playwright
  (Produktions-Build) 317/317, `gedcom:check` ohne Warnungen.
- Offen: Git-Verlauf umschreiben (echte Namen in alter Demofamilie,
  Autor-E-Mail, Beispielorte) — vom Eigentümer bestätigt, als letzter
  Schritt ohne aktive Worktrees. Aus der Sicherheitsprüfung: eine
  Content-Security-Policy für die Seiten als eigenes Paket; Anfragegrenzen
  für Unangemeldete und HSTS gehören in den Reverse-Proxy.
- Beim Ausrollen beachten: Der Reverse-Proxy muss für `/api/mcp` größere
  Anfragen durchlassen (Bilder als base64 über MCP, bis
  MAX_UPLOAD_BYTES × 4/3 + 1 MiB), sonst antwortet er mit 413.
- Parallel in Worktrees arbeiten: je Worktree eigene `.env` mit
  `MOCK_DATABASE_URL=…/familytree_<name>_mock`; den Port nur in der Shell
  setzen (`$env:MOCK_PORT`, `scripts/mock.mjs` liest ihn vor der `.env`).
  `tests/mcp.db.test.ts` läuft seit dem Aufräumen auch dort. Achtung: `npx prisma db push` ohne
  Mock-Skript nimmt `DATABASE_URL` (die normale Dev-Datenbank).

## Lokal einrichten

```bash
cp .env.example .env
npm install
npx prisma generate                               # npm blockiert Install-Skripte
docker compose -f docker-compose.dev.yml up -d   # nur Postgres
npm run mock:setup                                # Mock-Datenbank + Bilder
npm run dev:mock                                  # http://localhost:3100
npm run test:e2e                                  # Browser-Tests, ein Befehl (Build, Server, setup → read → write)
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

- **Banner auf der Personenseite** — erledigt (`listDuplicatesOfPerson` in
  `lib/services/duplicates.ts`, `components/DuplicateBanner.tsx`). Zeigt nur
  „sicher“ und „wahrscheinlich“, höchstens drei, mit Klassen-Kennzeichen;
  „unklar“ bleibt der Dublettenliste vorbehalten (Entscheidung des
  Eigentümers). Gemessen: rund 4 ms auf den Mock-Daten, rund 120 ms bei
  11 847 erzeugten Personen; mit echten Daten nicht gemessen.
- **Knopf „Zusammenführen …“** — erledigt (`components/MergeDialog.tsx`,
  `GET /api/persons/[id]/duplicates`): neben „Im Stammbaum zeigen“, Dialog
  mit den Kandidaten dieser Person (Klasse, Begründungssatz) und darunter
  der freien Suche; der Eintrag unter „Verwaltung“ ist entfernt. Der Dialog
  zeigt auch „unklar“ (das Banner weiterhin nicht) — bei Bedarf mit dem
  Eigentümer abstimmen.
- **Folgedubletten** — erledigt (`lib/services/merge-followups.ts`,
  `components/FollowUpDuplicates.tsx`): auf der Ergebnisseite, Klassen
  genau wie die Dublettenliste, gleichnamige Geschwister „unklar“; „alle
  sicheren“ nur über `previewBulkMerge`/`bulkMerge`.
- **Alte Kennung als Umleitung** — erledigt (`lib/services/redirects.ts`,
  Migration `20261125000000_person_redirect`, nur die Tabelle). Die
  Rückfüllung aus dem Audit läuft im Code (`backfillPersonRedirects`, je
  Serverprozess einmal beim ersten Nachschlagen ohne Treffer), nicht in der
  Migration: So kann das Ausrollen an keinen Daten scheitern, und
  `docker/schema-diff-check.mjs` lässt ohnehin kein `INSERT` zu.
  Nachgewiesen in `tests/person-redirect.db.test.ts` (einzeln, gesammelt,
  Kette A→B→C, „Importe verbinden“, bleibende Person später gelöscht,
  unbrauchbare Audit-Einträge). Mit echten Daten noch nicht gelaufen — nach
  dem Ausrollen einmal eine alte Adresse aufrufen und im Server-Log die
  Zeile `[umleitungen] … nachgetragen` prüfen. `/tree` hat dafür kein
  `loading.tsx` mehr (die Ladeanzeige kommt aus einem `Suspense` in der
  Seite), sonst ließe sich kein 308 setzen.
- **KI-Vorprüfung** — erledigt (Migration `20261125000001_duplicate_review`,
  Tabelle `DuplicateReview`; `reviewDuplicate` in
  `lib/services/duplicates.ts`, Bausteine in
  `lib/services/duplicate-reviews.ts`). MCP-Werkzeuge
  `list_duplicate_candidates`, `preview_person_merge` (Trockenlauf, genau
  die Vorschau der App), `review_duplicate` (Schreibstufe; speichert nur die
  Einschätzung, Ergebnis immer `merged: false`), Prompt `review_duplicates`;
  der Server-Hinweis sagt ausdrücklich: kein `merge_persons`. Oberfläche:
  Einschätzung je Paar in der Dublettenliste (Urteil, Begründung, wer/wann,
  Vorschlag, „veraltet“), Filter „Von der KI vorgeprüft“ je Urteil, im
  Banner nur das Urteil; nie vorausgewählt, Klasse unverändert. Ein
  KI-„kein Duplikat“ blendet nichts aus — erst „Als „kein Duplikat“
  übernehmen“ durch den Menschen. „Veraltet“ über einen Fingerabdruck
  beider Personen (Stammdaten, Namen, Ereignisse, Familien, Beziehungen;
  Belege und Bilder bewusst nicht). Sehen und Schreiben nur mit
  Bearbeitungsrecht an beiden Personen; ein von Menschen als „kein
  Duplikat“ markiertes Paar lässt sich nicht einschätzen. Beim
  Zusammenführen geht die Einschätzung mit der aufgehenden Person unter
  (Cascade). Im Dialog „Zusammenführen …“ steht die Einschätzung bisher
  nicht.
- **„Erst die Eltern, dann dieses Paar zusammenführen“** — erledigt
  (`parentsFirst` in `mergePersons`, eine Transaktion; nur für Elternpaare,
  die mindestens „wahrscheinlich“ dieselbe Person sind).

### 2. Herkunft sichtbar machen und visualisieren — erledigt (Branch `herkunft`)

Umgesetzt wie im Entwurf; Beschreibung in `docs/komponenten/dienste.md`
(`lib/services/origin.ts`), `bibliotheken.md` (`lib/origin.ts`),
`oberflaeche-komponenten.md` (`OriginChips`, `PersonOrigin`,
`OriginOverview`, `ImportSources`), Anwender-Hilfe in 02, 04, 07 und 08.

- Je Import (Quell-Baum) ein Buchstabe A, B, C … ohne „H“ nach Reihenfolge
  des ersten Laufs und eine Okabe-Ito-Farbe; „von Hand erfasst“ =
  gestrichelter Chip „H“. Nie nur Farbe.
- **Lesbare Namen**: neue, rein ergänzende Migration
  `20261125000002_import_anzeigename` (Tabelle `ImportSource`, ohne
  Rückfüllung). Administratoren benennen Importe unter Verwaltung → Daten;
  der Name ersetzt überall den Dateinamen (Dubletten-Hinweis, Vergleich,
  „Importe verbinden“, GEDCOM-Vorschau). `importLabel` ist entfallen.
- **Stammbaum**: Schalter „Herkunft“ (`?herkunft=1`), Chips (höchstens drei,
  dann „+n“), doppelter Rand für Verbindungspersonen, Legende mit
  Hervorheben. **Personenseite**: Block „Herkunft“ und Chips an Ereignissen,
  Namen, Beziehungen, Belegen. **Übersicht** auf `/research/connect`.
  **MCP**: `get_person.origin`.

**Entscheidungen fürs Protokoll:**
- „Linien“ und „Herkunft“ gehen gleichzeitig und teilen sich die Karte:
  Linien = Tönung, Streifen links, Kürzel oben; Herkunft = Chips unten
  rechts, Ring außen.
- Herkunft gibt es überall (Baum, Personenseite, Übersicht, KI-Zugang) nur
  für Personen, die der Benutzer bearbeiten darf; Zahlen zählen nur diese.
- Der Haken des Schalters folgt der Adresse: Er wechselt erst, wenn die
  Seite mit bzw. ohne `herkunft=1` geladen ist (der Server lädt die
  Zuordnung).

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

### Wünsche des Eigentümers (gesammelt, NICHT umsetzen vor Freigabe)

Der Eigentümer schickt weitere Wünsche nach; umgesetzt wird erst, wenn er
sie freigibt.

- **Bezugsperson („in Scope“)** und **Farbe je Linie** — erledigt auf Branch
  `bezugsperson` (ausgerollt 21.11.). Migration
  `20261122000001_bezugsperson` (`User.personId`, rein ergänzend, `ON DELETE
  SET NULL`, wandert beim Zusammenführen mit). „Das bin ich“ auf der
  Personenseite bzw. durch Admins in der Benutzerverwaltung; vorübergehend
  per `?bezug=<id>` / „Baum aus dieser Sicht“ (Cookie `tree-bezug`, Hinweis
  „Sicht von … · zurück zu mir“). Verwandtschaftsgrad unter jeder Karte (alle
  drei Ansichten) und auf der Personenseite, berechnet in einem Durchgang
  (`lib/reference.ts`, gleiches Ergebnis wie `kinshipInGraph`, ~50 ms für
  10 000 erzeugte Personen). Schalter „Linien“: Tönung, Streifen und
  Kurzzeichen VV/VM/MV/MM, Legende mit den Großeltern. Nur über sichtbare
  Personen gerechnet (strenger als `get_kinship`). Details README,
  „Bezugsperson“. Offen: Gestaltungsfragen siehe Bericht (z.B. Kanten
  einfärben, MCP-Werkzeug für „ich“).
- **GEDCOM-Export mit Familienauswahl**: Beim Export ein Dialog, in dem man
  die Familien für den Export ankreuzt (Ziel: wieder nach MyHeritage
  importieren). GEDCOM-Export gibt es schon (`/api/export?format=gedcom`
  bzw. `gedzip`, `lib/services/gedcom-export.ts`), bisher immer mit allem,
  was der Benutzer sehen darf.
- **Bezugsperson („in Scope“)**: Jeder Benutzer kann sich in seinem
  Benutzerstamm eine Person zuordnen („das bin ich“). Zusätzlich lässt sich
  vorübergehend eine andere Person als Bezugsperson setzen (z.B. im Gespräch
  mit dem Sohn: „schau, dein Ururopa“). Im Baum steht dann an den Personen,
  soweit bestimmbar, der Verwandtschaftsgrad zur Bezugsperson. Grundlage:
  `lib/kinship.ts` (`findBloodRelation`, `describePath`), MCP `get_kinship`.
- **Farbe je Linie**: Vorfahren des Vaters der Bezugsperson in einer Farbe,
  der Mutter in einer anderen, weiter aufgeteilt nach Großeltern (Vorbild:
  Baumansicht von MyHeritage). Nie nur Farbe (Barrierefreiheit).
- **GEDCOM-Export mit Familienauswahl** — erledigt (Branch
  `export-dubletten`): Dialog auf `/admin/data` (`components/GedcomExportDialog.tsx`),
  Prüfung und Filter in `lib/services/export-selection.ts`,
  `buildExport(scope, selection)`. Alles angekreuzt = bisheriger Export.
  Teil-Exporte: gültiges 5.5.1, Rundreise verlustfrei, keine hängenden
  Zeiger (Tests). Import in MyHeritage selbst weiterhin nicht ausprobiert.
- **Changelog** — erledigt auf Branch `changelog` (ausgerollt 21.11.).
  Migration `20261122000000_changelog` (rein ergänzend): Tabelle
  `ChangeSet`, im `AuditLog` `changeSetId`, `personIds`, `familyIds`
  (GIN). `lib/change-sets.ts`: Paket je API-Anfrage (`lib/api.ts`), eigene
  Titel für GEDCOM-Import, Daten einspielen, Zusammenführen,
  Sammel-Zusammenführen, Importe verbinden; MCP `begin_change_set` und
  optional `change_set_id` an allen Schreibwerkzeugen, sonst Bündeln je
  Benutzer und Schlüssel im 30-Minuten-Fenster (MCP ist zustandslos, keine
  Sitzung). `lib/audit.ts`: `fieldChanges` (vorher → nachher) und
  Momentaufnahme der Personen/Familien; alle audit-Stellen angepasst, Import
  schreibt je betroffener Person einen Eintrag. Anzeige: Abschnitt
  „Änderungen“ auf der Personenseite (`components/PersonChanges.tsx`, nur
  Bearbeiter) und `/admin/changes` (nur Admins, Standard letzte 30 Tage).
  Lesen/Rechte/Maskierung in `lib/services/changes.ts`. Kein „Paket
  rückgängig“ (Entscheidung 21.11.). Offen zur Entscheidung: Paket-Titel aus
  `begin_change_set` werden Bearbeitern unverändert gezeigt (die KI könnte
  dort Namen nennen); GEDCOM-Import protokolliert gelöschte Datensätze nur
  als Zahl, nicht je Person.

Freigabe (21.11.): „bauen und Gas geben“ — die Wünsche werden umgesetzt.
- **Bilder per MCP an Quellen, Ereignisse und Belege** („wenn ich die Bilder
  per MCP zu Quellen gebe … auch den entsprechenden Einträgen beigefügt“) —
  erledigt, ausgerollt 22.11. Migration
  `20261123000000_medien_an_eintraegen` (Tabellen `SourceMedia`,
  `EventMedia`, `CitationMedia`; rein ergänzend, ohne Datenänderung —
  `Source.mediaId` bleibt Hauptscan, die App liest beide Stellen). Regel:
  Quellenbild erscheint bei allen Belegen der Quelle, außer es hängt an
  einem Beleg derselben Quelle (dann nur dort); Details README „Bilder an
  Quellen, Ereignissen und Belegen“. MCP `add_media` (url über
  `lib/safe-fetch.ts` oder `data_base64`) und `link_media`; Server-Hinweis
  mit den drei Wegen (eigene Zeile, nach „Sources“). `/api/mcp` nimmt für
  Schlüssel mit Schreibstufe größere Anfragen an (MAX_UPLOAD_BYTES × 4/3 +
  1 MiB) — beim Ausrollen `client_max_body_size` des Proxys prüfen.
  Austauschformat Version 4, GEDCOM-Export mit OBJE an SOUR/Ereignis/Beleg.
  Prüfstand (22.11., Worktree `familiy-tree-medien`, eigene Mock-DB):
  Typecheck, Lint, Vitest 751/752 (1 Ausfall: `tests/mcp.db.test.ts`
  erwartet den DB-Namen `familytree_mock`, bekannt); schema-diff-check
  Exit 0; `prisma migrate diff` Migrationen ↔ Schema ohne Abweichung;
  Playwright auf frischem Server, zwischen read und write neu gestartet:
  setup 6/6, read 167/167, write 89/89. Offen: http-Adressen (nur https,
  wie beim GEDCOM-Fotoimport); Bilder werden bei einer Löschung über einen
  erneuten GEDCOM-Import (Ereignis/Beleg entfällt) nicht eigens behandelt
  (die Verknüpfung geht per Cascade, das Bild bleibt verwaist für Admins).
- **Dubletten: keine Vorfahren/Nachkommen als Kandidaten** — erledigt
  (Branch `export-dubletten`): `ScoreOptions.lineage` in `lib/duplicates.ts`
  (alle PARENT_OF-Kanten, wie die Zyklus-Sperre beim Zusammenführen; Kette
  nur über sichtbare Personen). Liste und MCP über `findDuplicatePairs`,
  Hinweis über eine rekursive Abfrage (`linealRelatives`), dazu Importe
  verbinden (Anker, Ausbreitung, Cluster) und Sammel-Zusammenführen.
  Laufzeit im Rauschen: 11 847 erzeugte Personen Liste ~1,4 s, Hinweis
  Median ~74 ms je Person (vorher ~73 ms); Mock ~19 ms bzw. ~6 ms.
- **Neuigkeiten / „Was ist neu?“** („Mit jeder neuen Version bitte das
  Changelog mit erstellen und anzeigen beim erstmaligen Laden durch den
  Anwender“) — erledigt auf Branch `neuigkeiten` (NICHT gemergt, nicht
  ausgerollt). Quelle `CHANGELOG.md` (Format und Kennung `JJJJ-MM-TT.N`:
  AGENTS.md Abschnitt 3, README „Neuigkeiten“), rückwirkend ab 20.11.
  befüllt; das kommende Release steht als `2026-11-22.3` drin — beim
  Ausrollen an einem anderen Tag die Kennung anpassen. Zur Build-Zeit
  eingebaut (Webpack `?raw`, `.dockerignore` lässt die Datei durch).
  Migration `20261124000000_neuigkeiten` (`User.lastSeenReleaseId`, nur
  `ADD COLUMN`). Fenster einmal nach einer neuen Version (höchstens drei
  Releases, Rest per Link), Seite `/neuigkeiten`, Link in der Fußzeile.
  Bestehende Benutzer sehen beim ersten Ausrollen nur das neueste Release;
  neu eingeladene starten beim neuesten (Verfeinerung gegenüber dem
  Entwurf, damit Neue nicht mit „Neuigkeiten“ begrüßt werden). Mock-Seed
  setzt das neueste als gesehen.
  Prüfstand (22.11., Worktree `familiy-tree-neuigkeiten`): Typecheck, Lint,
  Vitest 848/848; schema-diff-check Exit 0, `prisma migrate diff` ohne
  Abweichung; `npm run build` ok (Text im Server-Bundle); Playwright auf
  frischem Server, zwischen read und write neu gestartet: setup 6/6, read
  186/186, write 100/100. Ein erster write-Lauf unter starker Last durch
  parallele Agenten hatte 4 Zeitüberschreitungen (darunter der erste Aufruf
  von `/neuigkeiten`, inzwischen im Vorwärmen); Wiederholung grün.

- **Orte: zeitabhängige Staatszugehörigkeit** (Idee aus dem Paket
  `orte-ki`, nicht beauftragt): Breslau 1900 = Deutsches Reich, heute Polen —
  Bezeichnung oder Karte je nach Jahr mit dem damaligen Staat. Bräuchte
  historische Grenzen bzw. eine Zuordnung Ort × Zeitraum → Staat.
- **Orte: eigene Orte in der Automatik** (offen): Eigene Orte (Wüstung, Hof)
  erscheinen bei späteren Texten als Vorschlag, die automatische Zuordnung
  nutzt sie aber nicht (gleichnamige Weiler wären riskant). Bei Bedarf
  entscheiden.

### 4. Weitere offene Punkte

- **Karte „Wurzeln nach Jahr“** — erledigt auf Branch `karte` (freigegeben,
  NICHT gemergt, nicht ausgerollt). Migration `20261123000001_orte` (Tabelle
  `Place`, rein ergänzend). `/map` (Menüpunkt „Karte“) und `/admin/places`
  „Orte zuordnen“ (nur Admins; bewusst KEIN eigener Menüpunkt — verlinkt von
  der Karte und unter „Daten“, gehört beim Zusammenführen ins geplante
  Verwaltungsmenü). Mitgeliefert: `geo/gazetteer.tsv.gz` (GeoNames,
  CC BY 4.0, 4,4 MB) und `public/geo/countries.json` (Natural Earth, 337 KB),
  erzeugt von `scripts/build-geodata.mjs`. Regeln, Datenschutz, Leistung,
  Lizenzen: README „Karte und Orte“. Einzige Änderung an
  `components/NavBar.tsx`: Innenabstand der Menüpunkte unter `xl`
  (`px-2 xl:px-3`), sonst passte die Admin-Zeile mit „Karte“ bei 1024 px
  nicht mehr (Test „schmalster Desktop“) — entfällt mit dem Verwaltungsmenü.
  Prüfstand (22.11.): Typecheck, Lint, Vitest 776/777 (einzig
  `tests/mcp.db.test.ts`, bekannt wegen des Datenbanknamens im Worktree);
  schema-diff-check Exit 0, `prisma migrate diff` ohne Abweichung;
  Playwright auf frischem Server: setup 6/6, read 177/178 (der bekannte
  seltene Hydration-Fehler auf `/people`, „Sortierung nach Geburt“; einzeln
  wiederholt grün, Aufzeichnung außerhalb des Repos gesichert), nach Neustart
  write 87/87 (der erste Lauf fand eine Wettlaufsituation auf der neuen
  Seite — behoben, Knöpfe bis zum Neuladen gesperrt).
  Entschieden (22.11.): Start bleibt „Orte der Auswahl“; Ortsverzeichnis
  4,4 MB bleibt; Ortsnamen „heutiger Name (alter/deutscher Name)“, z.B.
  „Wrocław (Breslau), Polen“, im deutschen Sprachraum ohne Klammer — auf
  `karte` umgesetzt (README „Karte und Orte“, Ortsnamen). Bekannte
  Grenzfälle: ohne alten Namen in den Daten steht der deutsche Name von
  GeoNames in der Klammer („Lviv (Lwiw)“, erst mit „Lemberg“ in den Daten
  „Lviv (Lemberg)“); in der Schweiz ist der Hauptname der deutsche („Genf“).
  Weiter offen: Kreise ab 70 px begrenzt; kein MCP-Werkzeug; Kartendaten für
  „alle“ bei 12 000 Personen 1,4 MB und gut 1 s auf dem Server.
- **Stammbaum auf dem Telefon**: Kopf und Werkzeugleiste belegen bei
  360×740 gut 40 % der Höhe, die Karten sind beim Standardzoom klein.
  Braucht eine Gestaltungsentscheidung (Leiste einklappen, Vollbild, Titel
  und Zähler weglassen). Dunkles Farbschema, Querformat und echtes
  iOS-Safari sind für die Telefon-Überarbeitung nicht geprüft.

- **Admin-Aktion „Quellen neu einordnen“** für gespeicherte Daten. Die
  Anzeige ist bereits robust; gespeicherte Art, Anbieter und Belegadressen
  älterer Importe sind es noch nicht. Regeln: von Hand Geändertes nicht
  anfassen, Fingerabdrücke der Herkunftsvermerke nachziehen, doppelte Belege
  nur auf ausdrückliches Ankreuzen entfernen.
- **Hydration-Fehler beim Laden (React #418) — behoben (Branch
  `hydration`, noch nicht ausgerollt).** Ursache: Fehler im React, das
  Next.js 15.5 mitbringt (facebook/react#35210, Korrektur #35494 erst in
  React 19.3) — setzt die Hydration nach dem Warten auf nachgeschobene
  RSC-Daten an einem Element wieder auf, steht der DOM-Zeiger schon eine
  Ebene zu tief. Rückportierung als Webpack-Loader
  (`lib/next-patches/react-hydration-replay-fix.cjs`, Regel in
  `next.config.mjs`; bricht den Build ab, wenn die Stelle nach einer
  Next-Aktualisierung nicht mehr passt). Nachgestellt mit
  `scripts/hydration-rate.mjs --gap=50` (gestrecktes Streaming): ohne
  Korrektur 13/240 Aufrufe mit #418, mit Korrektur 0/720. Die E2E-Wache
  wertet #418 jetzt immer als Fehler. Mit Next.js 16 / React 19.3 Loader,
  Regel und `tests/react-hydration-replay-fix.test.ts` entfernen (der Test
  schlägt dann von selbst an).
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

- **E2E laufen gegen einen Produktions-Build** der Mock-Umgebung
  (`npm run test:e2e`: baut nach `.next-e2e` nur bei geänderten Quellen,
  startet `next start` auf `MOCK_PORT`, beendet ihn danach). Damit gilt
  nicht mehr: Server vor dem Gesamtlauf neu starten, zwischen read und
  write neu starten, `--workers=1` auf belasteter Maschine, während des
  Laufs nichts ändern (Änderungen wirken erst mit dem nächsten Build). Ein
  schon laufender Server auf dem Port wird mitbenutzt — nach
  Codeänderungen einen von Hand gestarteten `mock:start` beenden.
- **Entwicklungsserver** (nur noch bei `--dev` bzw. `npm run dev:mock`):
  verwirft übersetzte Seiten, wächst auf 3–4 GB, die erste Übersetzung
  einer Seite reißt Zeitgrenzen; dort gelten die alten Regeln weiter (vor
  dem Lauf neu starten, zwischen read und write neu starten, nichts
  ändern). `onDemandEntries` in `next.config.mjs` hat nicht geholfen.
- **Dev-Login im Produktions-Build** nur über die eng begrenzte
  Mock-Freigabe (`lib/dev-login.ts`: `E2E_PRODUCTION_DEV_LOGIN=mock-only`
  plus Datenbank `…_mock`/`…_test` plus Medienordner `…-mock`/`…-test`).
  Nie im Stack setzen.
- **Windows**: `prisma generate` scheitert mit EPERM, solange ein
  Entwicklungsserver die Engine-Datei geladen hat. Vorher stoppen.
- **npm ab Version 12** blockiert Install-Skripte: nach `npm install` einmal
  `npx prisma generate` ausführen.
- **Mock**: Seed und Setup verweigern Datenbanknamen ohne Endung
  `_mock`/`_test` und Medienordner ohne `-mock`/`-test`.
- **Playwright**: lesende Tests mit 6 Workern, schreibende mit 2 (mehr
  ist nicht schneller und trifft öfter fremde „E2E …“-Datensätze in
  Zählungen); Dateien im Modus `serial` überspringen nach einem Fehler den
  Rest der Datei.
- **Migrationen**: eine veröffentlichte Migration nie nachträglich ändern.
  `node docker/schema-diff-check.mjs < migration.sql` prüft, ob eine neue
  rein ergänzend ist; Abweichungen in der Release-Beschreibung begründen.
- **Öffentliches Repository**: nichts Persönliches committen (keine
  Hostnamen, keine Namen oder Daten aus echten Stammbäumen). Echte
  GEDCOM-Dateien liegen nur lokal unter `data/import/` (von Git ausgenommen).
