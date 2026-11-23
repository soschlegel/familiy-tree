# Oberflächen-Komponenten (`components/`) und Gestaltungssystem

Beschreibung jeder Datei in `components/` (React-Komponenten und Helfer) sowie
des Gestaltungssystems in `app/globals.css`. Je Komponente: Zweck, Einsatzort,
Props/Daten, Verhalten (Interaktion, Zustände, Tastatur, Telefonbreite,
Barrierefreiheit), Server- oder Client-Komponente, aufgerufene API-Routen und
zugehörige Tests.

Code bleibt die Wahrheit: Weicht er von dieser Beschreibung ab, gilt der Code,
und die Beschreibung wird im selben Commit berichtigt (siehe `AGENTS.md`,
Abschnitt 1). Seiten und API-Routen selbst stehen in
[seiten-und-api.md](seiten-und-api.md), die Server-Dienste in
[dienste.md](dienste.md), Hilfsbibliotheken unter `lib/` in
[bibliotheken.md](bibliotheken.md), Werkzeuge, Betrieb und Testaufbau in
[betrieb-und-tests.md](betrieb-und-tests.md).

## Inhalt

- [Stammbaum und Karte](#stammbaum-und-karte) — `FamilyTree`, `PersonNode`,
  `MarriageNode`, `MarriageEdge`, `ParentEdge`, `ReferenceLines`,
  `ReferenceChip`, `ReferencePanel`, `MapExplorer`, `MapPersonChooser`, `Avatar`,
  `gender-style`
- [Gestaltungssystem: app/globals.css](#gestaltungssystem-appglobalscss)
- [Personen, Ereignisse, Quellen und Medien](#personen-ereignisse-quellen-und-medien)
  — `PersonForm`, `DateInput`, `EventSection`, `CitationSection`,
  `CitationLink`, `NameVariants`, `PersonFamilies`, `RelationshipEditor`,
  `PersonChanges`, `PersonPicker`, `AttachedMedia`, `MediaGallery`,
  `DeletePersonButton`, `SelfPersonButton`, `SourceForm`, `DeleteSourceButton`
- [Rahmen und Helfer](#rahmen-und-helfer) — `NavBar`, `PageLoading`,
  `AutoSubmit`, `api-client`, `useDismiss`, `ai-access-labels`,
  `WhatsNewDialog`, `ReleaseNoteList`, `HelpLink` (mit `FooterHelpLink`),
  `help-render`
- [Import, Export, Dubletten und Zusammenführen](#import-export-dubletten-und-zusammenführen)
  — `GedcomImport`, `GedcomExportDialog`, `DataTransfer`, `ImportHistory`,
  `ConnectImports`, `DuplicateBanner`, `DuplicateList`, `MergeView`,
  `MergeDialog`, `FollowUpDuplicates`, `ChangeSetList`, `ChangeEntryList`
- [Verwaltung und KI-Zugang](#verwaltung-und-ki-zugang) — `UserAdmin`,
  `FamilyAdmin`, `PlaceAdmin` (exportiert `PlaceAutoAssign` und `PlaceTable`),
  `AiAccessManager`, `AiConnectGuide`, `ApiTokenList`

## Stammbaum und Karte

### Zusammenspiel der Stammbaum-Ansichten

Die Baumseite `app/tree/page.tsx` (Server-Komponente) entscheidet anhand der Adresse, welche Daten sie lädt, und übergibt sie an **eine** Client-Komponente, `FamilyTree`. Alle drei Ansichten teilen sich Werkzeugleiste, Knoten- und Kantentypen; sie unterscheiden sich nur in Datenmenge und Layout.

**URL-Parameter und Cookies**

- `view` — `generations` oder `timeline` zeigen den ganzen Baum; jeder andere Wert (oder keiner) die Fokus-Ansicht.
- `focus` — Fokusperson (Fokus-Ansicht) bzw. Person, auf die der ganze Baum zentriert wird. Geprüft gegen ein ID-Muster.
- `up`, `down` — Tiefe der Vorfahren bzw. Nachkommen in der Fokus-Ansicht (1–4, Standard 2, `FOCUS_DEPTH` in `lib/focus-tree.ts`). Standardwerte lässt `treeUrl` (exportiert aus `FamilyTree.tsx`) weg, damit Adressen kurz bleiben.
- `bezug` — vorübergehende Bezugsperson; `bezug=ich` kehrt zur eigenen Person zurück.
- `denied` — nur für den Hinweis „fehlende Berechtigung“ der Seite.
- Cookies: `tree-focus` (zuletzt fokussierte Person, `FOCUS_COOKIE`), `tree-lines` (Schalter „Linien“, `LINES_COOKIE`), `tree-bezug` (vorübergehende Bezugsperson, `REFERENCE_COOKIE`). Gesetzt werden sie im Browser von `FamilyTree` bzw. `ReferenceChip`, gelesen vom Server.

**Datenfluss**

- Der Server lädt einmal den Graphen der sichtbaren Personen (`loadGraph` aus `lib/services`) und bestimmt die Bezugsperson (`resolveReference`, Vorrang Adresse vor Cookie vor eigener Person).
- **Fokus-Ansicht:** `loadFocusTree` liefert nur den Ausschnitt um die Fokusperson (Personen, Beziehungen und je Person Generation, Rolle sowie Anzahl verborgener Eltern/Kinder jenseits des Ausschnitts). Ohne `focus` gilt: angefragte Person → `bezug` → gemerkte Person aus dem Cookie → Bezugsperson; ein nicht vorhandener oder gesperrter `focus` ergibt den Hinweis „Person nicht gefunden“ statt eines Baums.
- **Generationen/Zeitstrahl:** `loadTree` liefert den ganzen (maskierten) Bestand; gesperrte Personen sind Platzhalter mit `restricted`. Zwischen Generationen und Zeitstrahl wechselt der Browser ohne neues Laden (nur die Adresse wird per `replaceState` nachgeführt); der Wechsel zwischen Fokus und ganzem Baum ist eine Navigation, weil sich die Daten ändern.
- Zur Bezugsperson berechnet der Server `referenceView` (Verwandtschaftsbegriffe je sichtbarer Person, vier Großeltern, Ahnenlinien je Person) — in der Fokus-Ansicht beschränkt auf die Personen des Ausschnitts.

**Layout (lib/)**

- `lib/tree-layout.ts` — gemeinsame Typen (`TreeData`, `TreePerson`, `LayoutNode`, `MarriageInfo`), Kartenmaße `NODE_WIDTH`/`NODE_HEIGHT`, Anzeigehilfen `displayName`, `lifeSpan`, `formatDate`.
- `lib/layout-generations.ts` — `layoutGenerations` (Ebenen nach Abstammung, Paare als Doppelkarten, Treffpunkte, Korridore über übersprungene Ebenen, Spuren) und `layoutTimeline` (senkrechte Jahresachse, Hochzeiten als eigene Ereignisse mit Positionen und Achsenmarken).
- `lib/focus-tree.ts` — Auswahl des Ausschnitts und `layoutFocus` (dasselbe Layout mit fest vorgegebenen Ebenen relativ zur Fokusperson), dazu `FOCUS_DEPTH`, `FOCUS_COOKIE`, `parseDepth`, Typ `TreeView`.
- `lib/reference.ts` — Linien-Schlüssel und -Beschriftungen (`LINE_KEYS`, `LINE_CODE` VV/VM/MV/MM, `LINE_LABEL`), `edgeLine` (Farbe einer Eltern-Kind-Verbindung), Cookie-Namen.
- `lib/partner-labels.ts` — Symbole, Bezeichnungen und Linienbild je Partnerschaftsart (verheiratet, unverheiratet, geschieden, Ehestand unbekannt).
- `lib/graph.ts` bzw. `lib/services/graph-data.ts` — Graph-Index, auf dem Server-Dienste (Fokus, Bezugsperson, Karte) rechnen; von den Komponenten nicht direkt benutzt.

`FamilyTree` berechnet das Layout im Browser (in `useMemo`, abhängig nur von Daten, Filter und Ansicht — nicht von der Suche) und übersetzt es in React-Flow-Knoten und -Kanten.

**Knoten und Kanten**

- Knotentypen: `person` (`PersonNode`; eine Person oder Doppelkarte eines Paares), `junction` (`JunctionNode` aus `MarriageNode.tsx`; Treffpunkt, an dem beide Elternlinien zusammenlaufen und sich auf die Kinder verteilen), `marriage` (`MarriageNode`; nur im Zeitstrahl, Hochzeit als Ereignis auf ihrem Datum).
- Kantentypen: `marriage` (`MarriageEdge`; Ehe zwischen zwei getrennt stehenden Knoten, unter der Kartenreihe herumgeführt) und `parent` (`ParentEdge`; Abstammung, Treffpunkt-Zuläufe/-Abgänge und im Zeitstrahl die Anbindung der Partner an ein Hochzeitsereignis, Variante `event`).
- Absorbierte Paare (Doppelkarte) tragen ihre Ehe nicht als Kante, sondern als Verbindungsstück in der Karte (`MarriageLink` in `PersonNode.tsx`).
- Im Zeitstrahl ersetzt `FamilyTree` die direkte Ehe-Kante eines Paares durch zwei Ereignis-Kanten zum Hochzeitsknoten.

**Linienfarben**

- Art der Elternschaft je Linie (`PARENT_EDGE_STYLE` in `ParentEdge.tsx`): leiblich grau durchgezogen, Adoption Akzentgrün gestrichelt, Stiefkind Messing gepunktet, Pflegekind Violett Strich-Punkt. Bündelt eine Linie mehrere Beziehungen, gilt sie als leiblich, sobald eine davon leiblich ist (`lineSubtype` in `FamilyTree`).
- Partnerschaften: Rosa durchgezogen, geschieden grau gestrichelt, „Ehestand unbekannt“ gepunktet (Linienbild aus `partnerLineStyle`).
- Hochzeitsereignis-Anbindung: Rosa gestrichelt.
- Ahnenlinien (Schalter „Linien“): Eltern-Kind-Kanten einer Ahnenkette in der Farbe ihrer Großeltern-Linie (`--line-ff` … `--line-mm`), etwas dicker; das Strichmuster der Elternschaftsart bleibt.
- Während einer Suche im ganzen Baum werden alle Kanten stark zurückgenommen.

**Referenzpersonen und Referenzlinien**

- Die Bezugsperson wird über `ReferenceContext` (aus `ReferenceLines.tsx`) an alle Karten verteilt, nicht über Knotendaten — so muss React Flow beim Umschalten der Linien keine Knoten neu anlegen.
- Jede sichtbare Karte zeigt darunter den Verwandtschaftsbegriff zur Bezugsperson; die Bezugsperson selbst ist gestrichelt umrandet („Bezugsperson“ bzw. „ich · Bezugsperson“).
- Mit „Linien“ tragen Vorfahren Tönung, Randstreifen und Kurzzeichen ihrer Großeltern-Linie; die Legende nennt die vier Großeltern (`LineLegend`).
- Oben auf der Seite zeigt `ReferenceChip`, aus wessen Sicht der Baum gerade gezeigt wird.

### components/FamilyTree.tsx

**Zweck:** Interaktive Stammbaumfläche für alle drei Ansichten (Fokus, Generationen, Zeitstrahl) samt Werkzeugleiste, Suche, Familienfilter, Legende, Fokus-Verlauf und Jahresachse. Exportiert außerdem `treeUrl` (Adressbau der Baumseite).

**Wo eingesetzt:** `app/tree/page.tsx` — je einmal für die Fokus-Ansicht und für den ganzen Baum (mit unterschiedlichem `key`, damit beim Wechsel neu aufgebaut wird).

**Props/Daten:** Baumdaten (ganzer Baum oder Fokus-Ausschnitt mit Mitgliedsangaben), die aktive Ansicht, die Liste der sichtbaren Familien für den Filter, optional eine zu zentrierende Person, die Bezugsperson samt Verwandtschaft (oder keine) und den Anfangszustand des Schalters „Linien“ aus dem Cookie.

**Verhalten:**

- *Ansichtsumschalter* „Fokus / Generationen / Zeitstrahl“ als Knopfgruppe mit `aria-pressed`. In der Fokus-Ansicht zusätzlich Auswahlfelder „Vorfahren“/„Nachkommen“ (Tiefe, ersetzt die Adresse) und ein Link „Ganzer Baum“; im ganzen Baum stattdessen „Alles zeigen“ (passt alles ein).
- *Fokus-Navigation:* Klicks auf Fokus-Verweise führt die Komponente selbst aus (Mittel-/Strg-Klick bleibt beim Browser). Der neue Ausschnitt wird so verschoben, dass die angeklickte Karte stehen bleibt; bekannte Karten gleiten an ihre neue Position, neue blenden ein (Übergang abgeschaltet bei `prefers-reduced-motion`). Danach rückt der Blick auf die Kernfamilie (Fokus, Eltern, Kinder), passt bei ausreichender Größe den ganzen Ausschnitt ein und hält sonst eine lesbare Zoomstufe.
- *Adresse und Gedächtnis:* Die Fokusperson wird im Cookie gemerkt; hat der Server die Person selbst gewählt, wird die Adresse per `replaceState` ergänzt. Ein Fokus-Verlauf (bis zu vier zuletzt besuchte Personen) liegt bewusst nur im Speicher der laufenden Sitzung und erscheint oben als „Im Fokus: … · zuletzt: …“.
- *Suche:* Kombinationsfeld mit Trefferliste (max. 8). Im ganzen Baum sucht sie lokal (alle Wörter im Namen, gesperrte Personen ausgenommen), dimmt Nicht-Treffer und zentriert auf den gewählten Treffer. In der Fokus-Ansicht fragt sie verzögert den Server und stellt den Treffer in den Mittelpunkt. Pfeiltasten bewegen die Auswahl, Enter wählt, Escape schließt erst die Liste und leert beim zweiten Mal das Feld; Trefferzahl wird über `aria-live` angesagt.
- *Familienfilter* (nur ganzer Baum, Mehrfachauswahl, bleibt beim Ankreuzen offen; „Alle Familien“ hebt auf und schließt). Beziehungen bleiben nur, wenn beide Personen übrig sind. In der Fokus-Ansicht deaktiviert und auf dem Telefon ausgeblendet. Schließen bei Klick daneben, Escape oder Fokusverlust über `useDismiss`.
- *„Ehen zeigen“:* aus = Partnerbeziehungen entfernt, Paare werden getrennt und Generationen richten sich nur nach Abstammung; in der Fokus-Ansicht blendet es Partner ohne gemeinsames Kind im Ausschnitt aus (Logik in `layoutFocus`).
- *„Linien“* (nur mit Bezugsperson): färbt Ahnenketten, merkt sich den Zustand im Cookie und klappt die Legende auf.
- *Legende* (unten links, aufklappbar): Arten der Elternschaft, Partnerschaftsarten, „nicht freigegeben“, Geschlechtsfarben, Klickverhalten je Ansicht; bei aktiven Linien zuerst die Großeltern-Legende. Anfangs offen nur auf breiten Bildschirmen und nicht in der Fokus-Ansicht (außer Linien sind beim Laden an).
- *Anfangsausschnitt im ganzen Baum:* passt der Baum lesbar hinein, wird eingepasst; sonst beginnt die Ansicht lesbar bei der obersten Generation mit einer sichtbaren Person. Verschieben ist auf den Baum plus Rand begrenzt.
- *Zeitstrahl:* Jahresachse als feste Leiste links, die beim Verschieben stehen bleibt und Zoom/Verschiebung direkt aus dem React-Flow-Speicher liest.
- *Leistung:* Knotenobjekte werden zwischengespeichert, solange sich ihr Zustand nicht ändert; Kanten hängen nur davon ab, *ob* gesucht wird. Im ganzen Baum werden nur sichtbare Elemente gezeichnet, in der Fokus-Ansicht alle (damit Tab alle Karten erreicht).
- *Tastatur/Fokus:* Karten sind Links; beim Tab-Sprung auf eine Karte setzt die Komponente das Browser-Scrollen der Fläche zurück und zentriert stattdessen die Karte. React-Flow-eigene Knoten-/Kantenfokussierung ist aus.
- *Telefonbreite:* Suche volle Breite, Werkzeugleiste umsortiert (Ansicht zuerst, „Ehen zeigen“ und Tiefe teilen sich eine Zeile), Tiefe-Beschriftungen als ▲/▼, Tippziele ≥ 44 px, Übersichtskarte (MiniMap) erst ab `sm`, aufgeklappte Legende rückt über die Zoom-Knöpfe.
- *Barrierefreiheit:* Werkzeugleiste mit `role="toolbar"`, Menü mit `menuitemradio`/`menuitemcheckbox`, `aria-busy` und Statusanzeige „Lädt …“ während Navigationen, beschriftete Übersichtskarte. Leerer Filter zeigt „Keine Person in dieser Familie.“
- Dunkles Schema: Hintergrundraster und MiniMap-Farben folgen `prefers-color-scheme`.

**Server oder Client:** Client (`"use client"`).

**Ruft auf:** `GET /api/persons?q=…&limit=8` (Suche in der Fokus-Ansicht); Porträts indirekt über die Karten (`/api/media/<id>?variant=thumb`). Navigation über den Next-Router.

**Tests:** `e2e/read/tree-focus.spec.ts` (Startperson, Fokus-Klick, Verlauf, Tiefe, Zurück/Vor, Suche, „Ganzer Baum“, gesperrte Personen), `e2e/read/tree-whole.spec.ts` (Ansichtswechsel, Hochzeitsknoten im Zeitstrahl, Suche, Familienfilter, „Ehen zeigen“, Legende), `e2e/read/reference.spec.ts` (Schalter „Linien“, farbige Kanten, Linienlegende), `e2e/read/permissions.spec.ts` (keine fremden Namen, Suche), `e2e/read/mobile.spec.ts` und `e2e/read/quality.spec.ts` (Tippziele, Bildschirmhöhe, axe), `e2e/read/navigation.spec.ts` (Fußzeile auf der Baumseite). Layout-Logik: `tests/layout.test.ts`, `tests/focus.test.ts`, `tests/focus.db.test.ts`.

### components/PersonNode.tsx

**Zweck:** React-Flow-Knoten für eine Person oder eine Doppelkarte (Paar mit Verbindungsstück). Exportiert außerdem `TreeNavContext` (Klickverhalten), die Symbole `FocusIcon`, `OpenIcon`, `LockIcon` sowie die Typen `PersonNodeData` und `HiddenKin`.

**Wo eingesetzt:** als Knotentyp `person` in `FamilyTree`; `LockIcon` zusätzlich auf `app/people/[id]/page.tsx` und `app/sources/[id]/page.tsx`.

**Props/Daten:** Person, optional Partner und Ehe-Angaben, Hervorhebung, Dimmung, ob Nachkommen existieren, sowie je Person die Zahl verborgener Eltern/Kinder (nur Fokus-Ansicht). Klickverhalten und Bezugsperson kommen aus `TreeNavContext` bzw. `ReferenceContext`.

**Verhalten:**

- *Karte:* Porträt (Vorschaubild, verstorbene leicht entsättigt) oder Initialen, Ring/Farbe nach Geschlecht (`gender-style.ts`), Vor- und Familienname, Lebensdaten (mit † bei Verstorbenen ohne Todesdatum am Anfang).
- *Klickverhalten:* Im ganzen Baum führt die Karte zur Personenseite, das Ecksymbol in die Fokus-Ansicht. In der Fokus-Ansicht stellt die Karte die Person in den Mittelpunkt, das Ecksymbol öffnet die Personenseite; die Fokuskarte selbst öffnet die Personenseite und trägt das Abzeichen „Im Fokus“.
- *Randhinweise* (Fokus-Ansicht): „▲ Vorfahren“ oben bzw. „▼ +n Kinder“ unten, wenn Verwandte außerhalb des Ausschnitts liegen.
- *Bezugsperson:* Verwandtschaftsbegriff als Plakette unter der Karte, Bezugsperson gestrichelt umrandet; bei „Linien“ Tönung, Streifen und Kurzzeichen.
- *Gesperrte Person:* Platzhalter „Nicht freigegeben / keine Angaben“ mit Schloss, ohne Link, ohne Randhinweise, nicht fokussierbar.
- *Ehe-Verbindungsstück* (`MarriageLink`): Hochzeitsbild oder Symbol je Partnerschaftsart, Linienbild und Kurzjahr; Link auf die Personenseite mit `?rel=<Beziehung>`.
- *Anschlüsse:* eindeutige Handle-IDs; Doppelkarten haben zusätzlich Anschlüsse über/unter jeder Hälfte (damit eine Linie nicht fälschlich vom Paar ausgeht), Ehe-Anschlüsse unten seitlich versetzt; bei Paaren mit Kindern ein senkrechter „Stiel“ aus der Paarmitte.
- *Barrierefreiheit:* versteckter Text für Screenreader (was der Klick tut, was jenseits des Ausschnitts liegt, Verwandtschaft, Ahnenlinie); `aria-current` an der Fokuskarte; Ecksymbol mit `aria-label`. Telefon: unsichtbar vergrößerte Tippfläche am Ecksymbol.

**Server oder Client:** Client.

**Ruft auf:** keine API per fetch; Bilder über `/api/media/<id>?variant=thumb`.

**Tests:** `e2e/read/tree-focus.spec.ts` (Fokus-Klick, `tree-person-open`, Randhinweise, Platzhalter), `e2e/read/tree-whole.spec.ts` (`tree-person-focus`, Doppelkarten), `e2e/read/reference.spec.ts` (`tree-kinship`, Kurzzeichen, `data-reference`), `e2e/read/dates.spec.ts` (Datumsanzeige auf der Baumkarte), `e2e/write/media.spec.ts` (Porträt auf der Baumkarte), `e2e/read/permissions.spec.ts`, `e2e/read/mobile.spec.ts`.

### components/MarriageNode.tsx

**Zweck:** Enthält drei kleine Knotentypen: `MarriageNode` (Hochzeit als rundes Ereignis im Zeitstrahl, bewusst kleiner als eine Personenkarte) und `JunctionNode` (Treffpunkt zweier Elternlinien als kleiner Punkt).

**Wo eingesetzt:** in `FamilyTree` als Knotentypen `marriage` und `junction`. Die Jahresachse des Zeitstrahls zeichnet `FamilyTree` als eigenes Overlay (`TimelineAxis`).

**Props/Daten:** Hochzeitsdatum samt Genauigkeit/Qualifier/Enddatum, Partnerschaftsart, Hochzeitsbild, Partnernamen, Dimmung; der Treffpunkt nur Dimmung.

**Verhalten:** Bild oder Symbol je Partnerschaftsart (geschieden/unbekannt gedämpft), darunter das formatierte Datum; Tooltip mit Art, Partnernamen und Datum. Nicht anklickbar, nicht fokussierbar, nicht verschiebbar (in `FamilyTree` so konfiguriert). Bei Suche gedimmt, sofern kein Partner Treffer ist.

**Server oder Client:** Client.

**Ruft auf:** Bild über `/api/media/<id>?variant=thumb`.

**Tests:** `e2e/read/tree-whole.spec.ts` (Hochzeitsknoten nur im Zeitstrahl, mit Jahreszahl). Treffpunkte nur indirekt; Layout in `tests/layout.test.ts`.

### components/MarriageEdge.tsx

**Zweck:** Kante für eine Ehe/Partnerschaft zwischen zwei getrennt stehenden Knoten. Sie läuft unter der Kartenreihe herum (mit gerundeten Ecken), damit sie keine dazwischenliegenden Karten durchschneidet.

**Wo eingesetzt:** Kantentyp `marriage` in `FamilyTree` (Generationen und Fokus; im Zeitstrahl durch Ereignis-Kanten ersetzt).

**Props/Daten:** Ehe-Angaben (Beziehungs-ID, Person, Datum mit Genauigkeit, Art, Hochzeitsbild) und Dimmung.

**Verhalten:** Linienbild je Partnerschaftsart; in der Mitte ein anklickbarer Marker (Hochzeitsbild oder Symbol plus Kurzjahr) als Link zur Personenseite mit `?rel=<Beziehung>`, Tooltip mit Art und Datum. Der Marker nimmt Zeigerereignisse gezielt wieder an, obwohl der Beschriftungsbereich von React Flow sie sonst abschaltet. Bei Suche stark gedimmt.

**Server oder Client:** Client.

**Ruft auf:** Bild über `/api/media/<id>?variant=thumb`.

**Tests:** kein Test prüft diese Kante oder ihren Marker gezielt (unklar, ob indirekt über Screenshots/axe abgedeckt).

### components/ParentEdge.tsx

**Zweck:** Abstammungslinie im klassischen Stammbaumstil (senkrecht – waagerecht – senkrecht) und Anbindung an Hochzeitsereignisse. Exportiert `PARENT_EDGE_STYLE` (Strichmuster und Farbe je Elternschaftsart, auch von der Legende genutzt) und `ParentSubtype`.

**Wo eingesetzt:** Kantentyp `parent` in `FamilyTree`.

**Props/Daten:** Variante (Abstammung oder Ereignis), Elternschaftsart, Spur, Wegpunkte durch Korridore übersprungener Ebenen, Dimmung, optional Ahnenlinie.

**Verhalten:** Das waagerechte Stück sitzt dicht unter dem Elternknoten, sodass Geschwister eine gemeinsame „Sammelschiene“ teilen. Mehrere Elternpaare werden über Spuren in der Höhe versetzt (bei engem Abstand zusammengerückt). Über Wegpunkte führt die Linie durch reservierte Korridore statt quer durch Zwischenebenen. Steht das Kind direkt darunter, wird eine gerade Linie gezeichnet. Ahnenlinien färben die Linie über die CSS-Variable der Linie und machen sie dicker; das Strichmuster bleibt, damit Farbe nie das einzige Merkmal ist. Die Kante trägt `data-line` für Tests.

**Server oder Client:** Client.

**Ruft auf:** nichts.

**Tests:** `e2e/read/reference.spec.ts` (gefärbte Kanten über `data-line`); Wegpunkte/Spuren über `tests/layout.test.ts`; Linienzuordnung `edgeLine` über `tests/reference.test.ts`. Elternschaftsarten-Darstellung nur indirekt (Legendentext in `e2e/read/tree-whole.spec.ts`).

### components/ReferenceLines.tsx

**Zweck:** Darstellungsbausteine für Bezugsperson und Ahnenlinien: `ReferenceContext` (Bezugsperson und Schalterzustand), `lineTint` (zarte Kartentönung, mehrere Linien als Streifen nebeneinander), `LineStripe` (Farbstreifen am linken Kartenrand), `LineCodes`/`LineCode` (Kurzzeichen VV/VM/MV/MM, höchstens zwei plus „+n“), `linesText` (Screenreader-Text) und `LineLegend` (Legende mit den Namen der vier Großeltern, „nicht erfasst“ für fehlende/gesperrte, darunter Kontexthilfe „Wie funktioniert das?“ → `/hilfe/stammbaum#linienfarben`).

**Wo eingesetzt:** `FamilyTree` (Kontext, Legende), `PersonNode` (Tönung, Streifen, Kurzzeichen, Text), `MapExplorer` (`LineCode` in Legende, Personen- und Ortsliste).

**Props/Daten:** Liste der Linien einer Person bzw. die Bezugsperson-Sicht mit Großeltern.

**Verhalten:** Tönung höchstens 14 % Linienfarbe über dem Kartenhintergrund, in beiden Farbschemata; Farben ausschließlich über `--line-*`-Variablen, Schrift auf den Kurzzeichen über `--line-*-fg`. Streifen und Kurzzeichen sind für Screenreader ausgeblendet; die Information steht im versteckten Kartentext.

**Server oder Client:** Client.

**Ruft auf:** nichts.

**Tests:** `e2e/read/reference.spec.ts` (`tree-line-codes`, `tree-line-legend`, „nicht erfasst“, keine Linien an Platzhaltern), `e2e/read/map.spec.ts` (Linienlegende der Karte). `tree-line-stripe` wird nicht direkt geprüft.

### components/ReferenceChip.tsx

**Zweck:** Hinweis, aus wessen Sicht Baum bzw. Personenseite gerade gezeigt werden, und Pflege des Cookies der vorübergehenden Bezugsperson.

**Wo eingesetzt:** `app/tree/page.tsx` (Kopfzeile; ohne wirksame Bezugsperson nur, damit `?bezug=ich` das Cookie löscht) und in `ReferencePanel` auf `app/people/[id]/page.tsx`.

**Props/Daten:** ID und Name der Bezugsperson, ihre Herkunft (Adresse, Cookie, eigene Person), ob eine eigene Person zugeordnet ist, und der rohe Wert von `?bezug=`.

**Verhalten:** Kommt die Bezugsperson aus der Adresse, wird sie im Cookie gespeichert (ein Jahr); `?bezug=ich` oder eine Adresse, die zur eigenen Person führt, löscht das Cookie. Vorübergehende Bezugsperson: deutliche Plakette „Sicht von: <Name> · zurück zu mir“ (ohne eigene Person „aufheben“) mit `role="status"`; der Knopf löscht Cookie und Parameter und lädt per Router neu. Eigene Person: zurückhaltend „Bezugsperson: <Name> (ich)“, auf dem Telefon ausgeblendet. Ohne Angaben rendert sie nichts. Telefon: Knopf mit 44 px Tippziel.

**Server oder Client:** Client.

**Ruft auf:** keine API; nur Router (`replace`, `refresh`) und `document.cookie`.

**Tests:** `e2e/read/reference.spec.ts` (Quelle `param`/`cookie`/`self`, „zurück zu mir“, Telefonbreite), `e2e/write/reference.spec.ts`.

### components/ReferencePanel.tsx

**Zweck:** Abschnitt „Bezugsperson“ auf der Personenseite: was diese Person für die Bezugsperson ist, „Das bin ich“ und „Baum aus dieser Sicht“.

**Wo eingesetzt:** `app/people/[id]/page.tsx`.

**Props/Daten:** Berechtigungsbereich des Benutzers, ID und Name der Person, roher Wert von `?bezug=`.

**Verhalten:** Liest das Bezugsperson-Cookie, berechnet über `loadReferenceFor` (nur über sichtbare Personen) die Sicht. Drei Fälle: Person ist selbst Bezugsperson („… ist die Bezugsperson — das bist du.“), Verwandtschaftsbegriff (oder „keine Verwandtschaft über freigegebene Personen bekannt“), keine Bezugsperson (Hinweis auf „Das bin ich“). Bindet `ReferenceChip` (nur bei nicht-eigener Bezugsperson mit Namen) und `SelfPersonButton` ein; „Baum aus dieser Sicht“ führt zu `/tree?focus=<id>&bezug=<id>` und fehlt, wenn die Person schon Bezugsperson ist. Daneben ein „?“ (`HelpLink`) zu `/hilfe/stammbaum#bezugsperson`.

**Server oder Client:** Server-Komponente (async, kein `"use client"`).

**Ruft auf:** keine API per fetch; Server-Dienst `loadReferenceFor` direkt. Die Schreibaktion „Das bin ich“ liegt in `SelfPersonButton` (nicht Teil dieses Abschnitts).

**Tests:** `e2e/read/reference.spec.ts` (`person-reference-term`, `-kinship`, `-self`, `-view`), `e2e/write/reference.spec.ts`; Dienstlogik `tests/reference.db.test.ts`.

### components/MapExplorer.tsx

**Zweck:** Interaktive Karte „Wurzeln nach Jahr“: eigene SVG-Karte ohne fremde Kachelserver, Kreise je Ort für das gewählte Jahr, Jahresregler mit Abspielen, Personenliste je Ort, Legende und eine Ortstabelle als zugängliche Alternative.

**Wo eingesetzt:** `app/map/page.tsx` (nicht, wenn „Vorfahren“ ohne Ausgangsperson gewählt ist).

**Props/Daten:** Kartendaten aller Jahre (Orte mit Koordinaten und Genauigkeit, Personen mit Lebensspanne, Ortsverlauf und Linienbits, Jahresbereich, Zahl ohne Lebensdaten), Startjahr, Großeltern der Ausgangsperson und ob Linien gezeigt werden.

**Verhalten:**

- *Jahr:* Schiebefeld, Knöpfe ‹ ›, „Abspielen/Anhalten“ (ein Jahr je Takt, Tempo langsam/normal/schnell, hält am Ende; startet am Ende wieder vorn). Das Jahr wird ohne Neuladen in `?jahr=` geschrieben (nicht während des Abspielens). Die Jahresdaten rechnet der Browser (`snapshot` aus `lib/map/year.ts`).
- *Zählzeile:* Lebende, davon auf der Karte, „ohne bekannten Ort“ und „Ort nicht auf der Karte“ als anklickbare Auswahl; `aria-live` nur, wenn nicht abgespielt wird.
- *Karte:* Ländergrenzen aus `public/geo/countries.json` (einmal geladen, im Modul zwischengespeichert), Projektion und Ausschnitte aus `lib/map/projection.ts`. Kreisfläche wächst mit der Zahl (begrenzt), große Kreise mit Zahl; mit Linien als Tortenstücke mit Farbe **und** Muster je Linie. Kreise erst nach dem Einhängen gezeichnet (Gleitkomma-Unterschiede Server/Browser).
- *Bedienung:* Ziehen (Maus/ein Finger), zwei Finger und Mausrad zoomen, Knöpfe +/− (44 px), Ausschnitte „Orte“ (alle Orte der Auswahl, Standard), „Europa“, „Welt“; auf der fokussierten Karte Pfeiltasten und +/−. Ein Klick nach echtem Ziehen wählt keinen Kreis. Größenänderungen behalten den gewählten Ausschnitt.
- *Auswahl:* Kreis oder Ortszeile füllt die Seitenleiste mit den Personen (Links zur Personenseite, ggf. Kurzzeichen, Hinweis bei nur Region/Land bekannt) und setzt den Fokus auf deren Überschrift.
- *Ortstabelle:* „Orte im Jahr …“, zunächst 30 Zeilen, „Alle … Orte zeigen“.
- *Barrierefreiheit:* SVG mit `role="img"` und ausführlichem `aria-label`, Tooltips je Kreis und Land, Tabelle als gleichwertige Alternative.
- *Telefonbreite:* Seitenleiste unter der Karte (zweispaltig erst ab `lg`), Kartenhöhe nach Bildschirmhöhe, Auswahlfeld in Viewportbreite begrenzt.
- Farben der Karte über `--map-*`, Linien über `--line-*` (hell/dunkel).

**Server oder Client:** Client.

**Ruft auf:** `fetch("/geo/countries.json")` (statische Datei, keine API-Route). Die Kartendaten liefert die Seite serverseitig (`loadMapView`); keine API-Route aus der Komponente.

**Tests:** `e2e/read/map.spec.ts` (Kreise, Grenzen, Legende, Regler per Tastatur ohne Neuladen, Abspielen, Kreis-Auswahl, Ortsliste und Fokus, Ausschnitte/Zoom, axe, Telefon antippen ohne Querscrollen). Rechenlogik: `tests/map.test.ts` (`snapshot`, Projektion, `zoomAt`, `fitViewBox`), `tests/map.db.test.ts`. Pfeiltasten auf der Karte, Tempo und „ohne bekannten Ort“-Auswahl sind nicht gezielt getestet.

### components/MapPersonChooser.tsx

**Zweck:** Knopf „Andere Person …“ mit aufklappendem Suchfeld, um die Ausgangsperson der Karte zu wählen (ändert die Bezugsperson des Baums nicht).

**Wo eingesetzt:** `app/map/page.tsx`.

**Props/Daten:** die aktuelle Auswahl (`vorfahren` oder `alle`), die bei der Navigation erhalten bleibt.

**Verhalten:** Öffnen setzt den Fokus ins Suchfeld; ab zwei Zeichen verzögert gesucht (max. 8 Treffer, Name und Lebensjahre), „Niemand gefunden.“ bei leerem Ergebnis. Auswahl führt zu `/map?person=<id>&mode=…`. Schließen bei Klick daneben, Escape oder Fokusverlust (`useDismiss`). Telefon: Box höchstens Bildschirmbreite minus Rand; Feld nutzt `.field` (16 px, 44 px). Liste mit `aria-busy`; die Trefferliste ist eine einfache Knopfliste ohne Listbox-Rolle.

**Server oder Client:** Client.

**Ruft auf:** `GET /api/persons?q=…&limit=8`.

**Tests:** `e2e/read/map.spec.ts` („andere Ausgangsperson wählen“).

### components/Avatar.tsx

**Zweck:** Rundes Porträt mit dezentem Geschlechtsring; ohne Bild die Initialen. Verstorbene leicht entsättigt.

**Wo eingesetzt:** `app/people/page.tsx` (Personenliste) und `app/people/[id]/page.tsx` (Kopf der Personenseite groß, zusätzlich mittelgroß an anderer Stelle der Seite).

**Props/Daten:** Person (Vor-/Familienname, Geschlecht, Porträt-ID, optional Todesdatum), Größe `md`/`lg`. Geladen wird immer die Vorschau (`?variant=thumb`).

**Verhalten:** Bild mit leerem `alt` (dekorativ, der Name steht daneben), verzögert geladen; Initialen sind `aria-hidden`. Große Größe wächst ab `sm`. Ringe und Initialfarben kommen wie bei `PersonNode` aus `components/gender-style.ts` (`GENDER_RING`, `GENDER_INITIALS_BG`).

**Server oder Client:** ohne `"use client"` — läuft als Server-Komponente, ist aber auch im Client verwendbar (keine Hooks).

**Ruft auf:** Bild über `/api/media/<id>?variant=thumb`.

**Tests:** `e2e/write/media.spec.ts` („Porträt erscheint auf der Baumkarte und in der Personenliste“); sonst nur indirekt über Seitentests der Personenliste/-seite.

### components/gender-style.ts

**Zweck:** Gemeinsame Tailwind-Klassen für die dezente Geschlechtsmarkierung an Porträts: `GENDER_RING` (Ring) und `GENDER_INITIALS_BG` (Initialen ohne Bild), dazu der Typ `Gender`. Liegt unter `components/`, weil Tailwind nur `app/` und `components/` nach Klassen durchsucht.

**Wo eingesetzt:** `Avatar`, `PersonNode` — beide Darstellungen sehen dadurch gleich aus.

## Gestaltungssystem: app/globals.css

Globale Styles plus wenige gemeinsame Bausteinklassen statt einer Komponentenbibliothek; die Seiten bleiben dadurch einfache Server-Komponenten. `tailwind.config.ts` benennt die Variablen als Tailwind-Farben.

**Farben und Tokens**

- Farbwerte als RGB-Kanäle in CSS-Variablen, damit Tailwind Deckkraftstufen bilden kann (`rgb(var(--x) / <alpha-value>)` in `tailwind.config.ts`).
- `--paper` (warmer Seitenhintergrund) und `--surface` (Karten/Felder) → Tailwind `bg-paper`, `bg-surface`.
- `--accent-50` … `--accent-900`: gedecktes Patina-Grün (Hauptakzent, Knöpfe, aktive Zustände) → `accent-*`.
- `--brass-100` … `--brass-700`: Messing für Hervorhebungen (Suchtreffer, Bezugsperson, Warnungen, Fokusrahmen) → `brass-*`.
- `--footer-h`: Höhe der Fußzeile mit Build-Angabe, von der Baumseite für ihre Höhenberechnung genutzt.
- Schriften über `--font-sans`/`--font-serif` (in `tailwind.config.ts` als `font-sans`/`font-serif`); Überschriften `h1`–`h3` serif.
- Schatten `shadow-card` und `shadow-lift` (in `tailwind.config.ts`).

**Grundregeln**

- `html` und `body` in Papierfarbe (kein heller/dunkler Streifen beim Überziehen). `body` mindestens sichtbare Höhe (`100dvh`, mit `100vh` als Rückfall davor — bewusst nicht als Tailwind-Klassen, wegen deren Reihenfolge).
- Sichtbarer Tastaturfokus überall über `:focus-visible` (Messing-Umriss), Mausklicks ohne Rahmen.

**Knopf- und Feldklassen (`@layer components`)**

- `.btn` (Basis), `.btn-primary` (Akzent gefüllt), `.btn-secondary` (Fläche mit Rand), `.btn-danger`, `.btn-sm`, `.btn-link` (Textknopf in Listen), `.btn-link-danger`. Deaktiviert: halbe Deckkraft, Sperrcursor.
- `.field`, `.field-invalid`, `.field-label`, `.field-error`.
- `.card`, `.badge`, `.badge-accent`, `.badge-alt` (abweichende Zweitangabe), `.alert` mit `-error`, `-warning`, `-success`, `-info`.
- Text: `.muted`, `.page-title`, `.section-title`, `.eyebrow`.

**Telefon-Regeln (unter 768 px)**

- `.btn` und `.field` mindestens 44 px hoch; `.field` 16 px Schrift (verhindert Zoom beim Antippen auf iOS).
- `.btn-link` mit größerer Schrift und 44 px Tippfläche, die per negativem Außenabstand das Layout nicht verändert; `.btn-sm` etwas größer.
- Kontrollkästchen und Auswahlpunkte 1,25 rem.
- React-Flow-Zoomknöpfe 44 × 44 px nebeneinander am unteren Rand statt übereinander.

**React Flow**

- Attribution ausgeblendet, Bedienknöpfe abgerundet, Übersichtskarte auf `--surface`; im dunklen Schema Bedienknöpfe in Flächenfarbe mit hellem Symbol.

**Linienfarben**

- `--line-ff` (Blau, Großvater väterlicherseits), `--line-fm` (Grün), `--line-mf` (Rot), `--line-mm` (Gelb), angelehnt an die farbfehlsichtigen-freundliche Okabe-Ito-Palette; je `--line-*-fg` als Schriftfarbe auf der Linienfarbe. Nie allein verwendet — Kurzzeichen (und auf der Karte Muster) kommen immer hinzu.
- Karte: `--map-sea`, `--map-land`, `--map-border`, `--map-neutral` (Personen ohne Ahnenlinie), `--map-ring` (gewählter Kreis).

**Dunkles Schema**

- Ausschließlich über `prefers-color-scheme: dark` (kein Umschalter): dunkle Werte für `--paper`, `--surface`, alle `--line-*` (hellere Töne, dunkle Schrift darauf) und `--map-*`; Fließtext hell. Die `accent`- und `brass`-Skalen haben keine dunklen Werte; Komponenten wählen im Dunklen über `dark:`-Klassen andere Stufen.
- `color-scheme: light dark` auf `:root`, damit Browser-Bedienelemente mitziehen.

**Tests:** `e2e/read/mobile.spec.ts` (Tippziele, 16-px-Feld, `dvh`-Mindesthöhe, kein Querscrollen), `e2e/read/quality.spec.ts` (axe auf Desktop- und Telefonbreite). Das dunkle Schema ist nicht gezielt getestet (unklar, ob axe im dunklen Modus läuft).

## Personen, Ereignisse, Quellen und Medien

Diese Komponenten bilden die Bearbeitungsoberfläche rund um eine Person
(`app/people/[id]/page.tsx`, `app/people/new`, `app/people/[id]/edit`) und um
Quellen (`app/sources/...`). Bis auf `CitationLink` sind alle
Client-Komponenten (`"use client"`). Gemeinsames Muster der Abschnitte auf der
Personenseite:

- Schreibzugriffe laufen über `apiFetch`/`jsonBody` aus
  `components/api-client` gegen die REST-Routen unter `app/api/`; Server
  Actions werden nirgends verwendet.
- Nach Erfolg `router.refresh()` – die Server-Seite lädt die Daten neu, die
  Komponente hält keinen eigenen Datenbestand.
- Zustände `busy` (sperrt Knöpfe, verhindert Doppelklick), `error`
  (Gesamtmeldung mit `role="alert"`), `fields` (Feldfehler vom Server,
  Rückgabe `res.fields`), `notice` (Erfolgsmeldung). Meldungen stehen in einem
  `aria-live="polite"`-Bereich.
- Löschen immer mit `confirm()`-Rückfrage, die die Folgen nennt.
- Rechte entscheidet der Server; die Komponenten blenden Bedienelemente nur
  anhand übergebener Flags (`canEdit` u. ä.) aus.
- Telefonbreite: Tippziele per `max-md:min-h-11` bzw. `max-md:py-3`,
  Formulare einspaltig unter `sm`.

### components/PersonForm.tsx

**Zweck:** Formular zum Anlegen und Bearbeiten der Stammdaten einer Person
(Name, Geschlecht, Geburt, Tod, weitere Namensangaben, Notizen; beim Anlegen
auch die Familienzuordnung).

**Wo eingesetzt:** `app/people/new/page.tsx` (mit `families`),
`app/people/[id]/edit/page.tsx` (mit `initial`, ohne `families`).

**Props/Daten:** `initial` – vorhandene Werte inkl. `id` (dann Bearbeiten-Modus);
Datumsfelder kommen als Eingabetext in gespeicherter Genauigkeit, dazu je
Datum ein Flag „als Wortlaut“ und ein gespeicherter Wortlaut neben dem Datum
(nur Anzeige). `families` – Familien, denen der Benutzer eine neue Person
zuordnen darf. Exportiert den Typ `PersonFormValues`.

**Verhalten:**
- Gruppen „Name“ (Vorname Pflicht, Nachname, Geburtsname, Geschlecht),
  „Lebensdaten“ (Geburts-/Sterbedatum über `DateInput` mit Wortlaut-Option,
  Geburts-/Sterbeort mit `PlaceHint` darunter), aufklappbare „Weitere Angaben“ (Rufname,
  Namenszusätze vorn/hinten, Todesursache – automatisch offen, wenn eines
  davon belegt ist oder einen Fehler hat), Notizen.
- Vorabprüfung im Browser mit denselben Regeln wie der Server: Vorname
  gesetzt, Datumstext lesbar (oder bewusst Wortlaut), Datumslogik über
  `personDateIssues` (z. B. Tod vor Geburt). Fehler stehen am Feld
  (`aria-invalid`, `aria-describedby`), dazu eine Gesamtmeldung.
- Leere Textfelder werden als `null` gesendet, damit Bearbeiten wirklich
  leert; Datumsfelder baut `datePayload`.
- Nur beim Anlegen: Familien als Umschaltknöpfe (`aria-pressed`), die erste
  ist vorausgewählt; ohne Auswahl Warnung „nur für Administratoren sichtbar“.
- Nach Erfolg Weiterleitung auf `/people/<id>`; `saving` bleibt bis dahin
  gesetzt. „Abbrechen“ führt zur Person bzw. zur Personenliste.
- Telefon: Familienknöpfe mit 44 px Mindesthöhe; Felder einspaltig.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/persons` (mit `familyIds`), `PATCH /api/persons/<id>`.

**Tests:** `e2e/write/person-lifecycle.spec.ts` („anlegen: Prüfungen stehen auf
Deutsch am Feld“, „bearbeiten“), `e2e/write/dates.spec.ts` (Datumshinweise,
Rundreise durch das Bearbeitungsformular), `e2e/write/genealogy.spec.ts`
(Rufname, Zusätze, Todesursache über `person-more`),
`e2e/read/mobile.spec.ts` und `e2e/read/quality.spec.ts` (Seite
`/people/new`), `e2e/read/permissions.spec.ts` (Betrachter ohne Zugriff).
Unit: `tests/validation.test.ts` (`personDateIssues`), `tests/dates.test.ts`
(`parseFuzzyDate`).

### components/DateInput.tsx

**Zweck:** Textfeld für (auch ungenaue) Daten statt des nativen Datumsfelds –
Jahr, Monat, Tag, „um/vor/nach/geschätzt“, Bereiche („zwischen … und …“,
„von … bis …“, „ab“, „bis“), optional ein frei formulierter Wortlaut.

**Wo eingesetzt:** keine Seite direkt; in `PersonForm`, `EventSection`
(Ereignisformular), `RelationshipEditor` (Hinzufügen und Ändern) und
`SourceForm`. Reicht außerdem `dateInputError`, `dateFieldFrom` und
`datePayload` aus `lib/date-fields` weiter.

**Props/Daten:** Beschriftung, Wert und Änderungs-Callback; optional `id`
(sonst `useId`), `error` (Server- oder Formularmeldung), `className`,
`compact` (ohne Beispieltext bei leerem Feld, kürzerer Platzhalter),
`allowPhrase`/`asPhrase`/`onAsPhraseChange` (Wortlaut-Häkchen) und `phrase`
(gespeicherter Wortlaut neben einem Datum).

**Verhalten:**
- Parst bei jeder Eingabe mit `parseFuzzyDate` und zeigt darunter „Verstanden
  als: …“, bei leerem Feld Beispiele (`DATE_INPUT_EXAMPLES`), sonst den
  Fehler. Fremder `error` hat Vorrang vor dem eigenen.
- Unlesbarer Text: mit `allowPhrase` erscheint das Häkchen „Als Wortlaut
  speichern“; erst angehakt verschwindet der Fehler und der Hinweis erklärt,
  dass der Text ohne Einordnung in Zeitleiste und Prüfungen gespeichert wird.
- Ein Wortlaut neben einem gültigen Datum wird nur als Hinweis angezeigt
  („bleibt erhalten, solange das Datum gleich bleibt“).
- Barrierefreiheit: Hinweis/Fehler per `aria-describedby` verknüpft und
  `aria-live="polite"`; `aria-invalid` bei Fehler; Rechtschreibprüfung und
  Autovervollständigen aus.

**Server oder Client:** Client.

**Ruft auf:** nichts (reine Eingabe).

**Tests:** `e2e/write/dates.spec.ts` („Hinweis beim Tippen und Ablehnung von
Unsinn“, „um 1850“/„vor 1900“, Rundreise), `e2e/write/genealogy.spec.ts`
(„Unlesbarer Wortlaut bleibt erhalten und bearbeitbar“, Testids
`date-as-phrase`, `date-phrase`, `date-hint`), `e2e/read/quality.spec.ts`
(axe mit sichtbarem Wortlaut-Häkchen), `e2e/write/sources.spec.ts` (Datum der
Quelle). Unit: `tests/dates.test.ts` (Parser/Formatierung); die Helfer aus
`lib/date-fields` (`dateInputError`, `datePayload`, `dateFieldFrom`) haben
keinen eigenen Unit-Test.

### components/EventSection.tsx

**Zweck:** Abschnitt „Lebensereignisse“ der Personenseite: Ereignisse der
Person und ihrer Partnerschaften (Taufe, Beruf, Wohnort, Beerdigung, eigene
Ereignisse …) anzeigen, anlegen, ändern, löschen; abweichende zweite Angaben
zu Geburt/Tod/Heirat/Scheidung als eigene Gruppe.

**Wo eingesetzt:** `app/people/[id]/page.tsx`.

**Props/Daten:** `personId`; `events` (fertig aufbereitete Zeilen: Art,
Bezeichnung, Titel, Datum in allen Teilen plus fertigem Anzeigetext, Ort,
Anschrift, Wert, Ursache, Alter, Institution, Notizen, Kennzeichen
„abweichend“, eigenes Bearbeitungsrecht, Träger „person“ oder
Beziehungs-ID mit Beschriftung, Belege, eigene Bilder und geerbte
Belegbilder); `owners` (wählbare Träger für neue Ereignisse: Person oder
Partnerschaften); `canEdit`; `mediaCandidates` (Bilder der Seite zum
Verknüpfen). Exportiert `EventRow`, `EventOwnerOption`.

**Verhalten:**
- Liste in der vom Server gelieferten Reihenfolge; Ereignisse mit Art aus
  `ALTERNATIVE_ONLY_TYPES` und Kennzeichen „abweichend“ stehen getrennt unter
  „Abweichende Angaben zu Hauptdaten“. Ohne Ereignisse und ohne Recht wird
  nichts gerendert.
- Jede Zeile hat den Anker `ereignis-<id>`; beim Laden mit diesem Hash wird
  sie in die Mitte gescrollt. Zeile zeigt Datum (oder „ohne Datum“), Titel,
  Präzisierung, Wert, Badge „abweichende Angabe zur …“, Träger, Details,
  Notizen, Belege mit Link zur Quelle und eine `AttachedMedia`-Leiste.
- Bearbeiter sehen je Zeile „Beleg (n)“/„Beleg hinzufügen“ (Sprung
  `#beleg-event:<id>`, den `CitationSection` auswertet), „ändern“ (Formular
  inline unter der Zeile) und „entfernen“ (Rückfrage nennt mitgelöschte
  Belege; Quellen bleiben).
- Formular (`EventForm`, intern): „Gehört zu“ nur beim Anlegen und bei
  mehreren Trägern (Wechsel setzt die Art auf die erste passende zurück);
  Art gruppiert in häufige, „Eigenes Ereignis …“, „Weitere“ und „Abweichende
  Angabe“ (`eventTypeGroups`); Bezeichnung Pflicht bei eigenem Ereignis;
  Datum mit Wortlaut-Option; Ort; Wertfeld mit artabhängiger Beschriftung
  (`valueCaption`); Häkchen „Abweichende Angabe“ (bei Nur-abweichend-Arten
  fest gesetzt und gesperrt); aufklappbare weitere Felder (Ursache, Alter,
  Institution, Anschrift, Notizen – offen, wenn belegt oder fehlerhaft).
  Lokale Prüfung von Datum und Bezeichnung vor dem Senden.
- Ist beim Ändern der Träger nicht in `owners` (z. B. Eltern-Kind-Beziehung),
  wird er per Fallback ergänzt.
- Aktionsknöpfe tragen sprechende `aria-label` („<Titel> ändern/entfernen“);
  Überschrift per `aria-labelledby`. Telefon: Zusammenfassung der weiteren
  Felder mit größerem Tippziel.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/persons/<id>/events` bzw.
`POST /api/relationships/<id>/events`, `PATCH /api/events/<id>`,
`DELETE /api/events/<id>`; Bilder über `AttachedMedia`.

**Tests:** `e2e/write/genealogy.spec.ts` (Ereignisse anlegen inkl. Bereich und
Verlobung an der Ehe, ändern und löschen, abweichende Geburtsangabe, Wortlaut,
Beleg an einem Ereignis, Betrachter ohne Bedienelemente),
`e2e/read/quality.spec.ts` (axe mit offenem Ereignisformular, auch auf dem
Telefon), `e2e/write/import.spec.ts` (importierte Ereignisse),
`e2e/write/attached-media.spec.ts` (Bild am Ereignis),
`e2e/read/export.spec.ts`.

### components/CitationSection.tsx

**Zweck:** Abschnitt „Quellen“ der Personenseite: Belege nach belegter Angabe
gruppiert anzeigen, ändern, entfernen und neue hinzufügen – für die Person,
ihre Beziehungen und ihre Lebensereignisse; bei Bedarf gleich eine neue
Quelle anlegen.

**Wo eingesetzt:** `app/people/[id]/page.tsx`.

**Props/Daten:** `personId`; `citations` (Beleg mit Angabe, Fundstelle,
geprüfter Internetadresse, Verlässlichkeit, Quelle mit Titel und Art, Bezug
auf Beziehung oder Ereignis samt Beschriftung, Bearbeitungsrecht, eigenen
Bildern und Bildern der Quelle); `targets` (wählbare Ziele: „person“,
Beziehungs-IDs, `event:<id>`, jeweils mit erlaubten Angaben); `sources`
(wählbare vorhandene Quellen); `canEdit`; `canCreateSource`;
`mediaCandidates`. Exportiert `CitationRow`, `CitationTargetOption`.

**Verhalten:**
- Gruppen in der Reihenfolge von `CITATION_FACTS`; Zeile mit Link zur Quelle,
  Art-Badge, Bezug, Fundstelle, `CitationLink`, Verlässlichkeits-Badge. Bei
  abgeleiteten Quellarten (`DERIVED_SOURCE_KINDS`, z. B. Online-Stammbaum)
  statt Verlässlichkeit der Hinweis „keine unabhängige Quelle“.
- Je Beleg eine `AttachedMedia`-Leiste; Bilder der Quelle erscheinen dort als
  geerbte Bilder mit Vermerk „Bild der Quelle“. **Ausnahme Ereignis-Belege**
  (Entscheidung des Eigentümers, 22.11.: „nur am Eintrag + Sammlung“): Belegt
  der Beleg ein Ereignis, stehen seine eigenen und geerbten Bilder nur in der
  Ereigniszeile (`EventSection`); hier steht dann nur ein Hinweis wie „1 Bild
  beim Ereignis“, „Bild hinzufügen“ bleibt möglich. Kein Bild steht zugleich
  in Ereigniszeile und Quellen-Abschnitt; der Abschnitt „Belegbilder“ zeigt
  jedes Bild genau einmal.
- Inline-Editor (`CitationEditor`, intern): Angabe (bei Ereignis-Belegen nur
  „Ereignis“), Fundstelle, Verlässlichkeit.
- Hinzufügen: Auswahl „Was wird belegt?“ (Optgroups je Ziel, Ereignisse unter
  „Lebensereignisse“), Quelle (oder „+ Neue Quelle anlegen…“, nur mit
  `canCreateSource`; dann Titel und Art), Fundstelle, Verlässlichkeit. Bei
  neuer Quelle wird zuerst die Quelle angelegt, dann der Beleg; scheitert der
  Beleg, bleibt die neue Quelle ausgewählt und die Meldung sagt das.
- Hash `#beleg-<Ziel>` (aus `RelationshipEditor` bzw. `EventSection`) öffnet
  das Formular mit diesem Ziel vorbelegt und scrollt sanft zum Abschnitt; der
  Abschnitt hört auch auf `hashchange`. Abschnitt hat Anker `quellen`.
- Barrierefreiheit: Formulare mit `aria-label`, „ändern“ mit
  `aria-expanded`, „entfernen“ mit sprechendem `aria-label`.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/sources` (neue Quelle), `POST /api/citations`,
`PATCH /api/citations/<id>`, `DELETE /api/citations/<id>`; Bilder über
`AttachedMedia`.

**Tests:** `e2e/write/sources.spec.ts` („für eine Geburt und eine Heirat
zitieren“, „Beleg ändern“, „Beleg entfernen“, „neue Quelle direkt beim
Zitieren anlegen“), `e2e/write/genealogy.spec.ts` („Beleg an einem
Ereignis“), `e2e/write/import-sources.spec.ts` (Link und Hinweis statt
Verlässlichkeit), `e2e/write/attached-media.spec.ts` (Belegbilder),
`e2e/read/permissions.spec.ts`. Unit (Dienste dahinter):
`tests/sources.db.test.ts`.

### components/CitationLink.tsx

**Zweck:** Link „Eintrag öffnen · <Host>“ zum Eintrag eines Belegs bei einem
Online-Anbieter.

**Wo eingesetzt:** `CitationSection` (Personenseite) und
`app/sources/[id]/page.tsx` (Belegliste der Quelle).

**Props/Daten:** `url` (kann fehlen), optional `className`.

**Verhalten:** Die Adresse gilt als nicht vertrauenswürdig (oft aus Importen):
`safeHttpUrl` lässt nur http/https durch, sonst rendert die Komponente nichts.
Öffnet in neuem Fenster mit `noopener noreferrer`, volle Adresse im `title`,
Host über `urlHost`. Wird nie serverseitig abgerufen.

**Server oder Client:** keine `"use client"`-Direktive – Server-Komponente,
funktioniert aber auch eingebettet in Client-Komponenten.

**Ruft auf:** nichts.

**Tests:** `e2e/write/import-sources.spec.ts` (Testid `citation-link`, auf
Quellen- und Personenseite). `safeHttpUrl`/`urlHost` sind in
`tests/source-classify.test.ts` nicht direkt getestet.

### components/NameVariants.tsx

**Zweck:** Abschnitt „Weitere Namen“ (Ehename, Schreibvariante, „auch bekannt
als“ …) anzeigen und bearbeiten.

**Wo eingesetzt:** `app/people/[id]/page.tsx`.

**Props/Daten:** `personId`, `names` (Art mit Beschriftung, Vorname,
Nachname, Zusätze, Rufname, freie Bezeichnung, Notiz, fertiger
Anzeigename), `canEdit`. Exportiert `NameRow`.

**Verhalten:**
- Ohne Namen und ohne Recht nichts; ohne Namen mit Recht eine kompakte
  Karte mit Hinweis „keine erfasst“.
- Liste mit Anzeigename, Art-Badge, Notiz; Bearbeiter: „ändern“ (inline,
  `aria-expanded`) und „entfernen“ (Rückfrage), beide mit sprechendem
  `aria-label`.
- Formular (`NameForm`, intern): Art (`PERSON_NAME_TYPES`, Vorgabe
  Ehename), bei „Sonstiges“ zusätzlich Bezeichnung; Vorname, Nachname,
  Zusätze, Rufname, Notiz. Lokale Prüfung: mindestens Vorname, Nachname oder
  Rufname. Leere Felder gehen als `null`.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/persons/<id>/names`, `PATCH /api/names/<id>`,
`DELETE /api/names/<id>`.

**Tests:** `e2e/write/genealogy.spec.ts` („Weitere Namen, Rufname, Zusätze
und Todesursache“), `e2e/read/quality.spec.ts` (axe mit offenem
Namensformular), `e2e/write/import.spec.ts` (importierter Name sichtbar),
`e2e/read/export.spec.ts`.

### components/PersonFamilies.tsx

**Zweck:** Familienzuordnung einer Person im Verwaltungsbereich der
Personenseite – sie entscheidet, wer die Person sieht.

**Wo eingesetzt:** `app/people/[id]/page.tsx` (Abschnitt „Verwaltung“, nur
für Bearbeiter).

**Props/Daten:** `personId`, `assigned` (zugeordnete Familien), `available`
(alle Familien), `editableFamilyIds` (Familien mit Bearbeitungsrecht; für
Admins alle), `canEdit`, `isAdmin`.

**Verhalten:**
- Je Familie ein Umschaltknopf (`aria-pressed`, ✓/+), gesperrt ohne Recht
  in dieser Familie (mit erklärendem `title`).
- Schutz gegen Selbstaussperren: Nicht-Admins können die letzte zugeordnete
  Familie mit eigenem Bearbeitungsrecht nicht abwählen; der Knopf ist
  gesperrt und per `aria-describedby` mit einer Erklärung verknüpft (Testid
  `person-families-last`). Der Dienst (`setPersonFamilies`) lehnt das
  ebenfalls ab.
- Admins dürfen die letzte Familie entfernen, aber erst nach Rückfrage
  („nur noch für Administratoren sichtbar“).
- Ohne Zuordnung Warnhinweis; ohne Familien „Noch keine Familien angelegt“.
- Sendet immer die vollständige neue Liste. Telefon: Knöpfe mit 44 px
  Mindesthöhe. Der laufende Knopf pulsiert.

**Server oder Client:** Client.

**Ruft auf:** `PUT /api/persons/<id>/families`.

**Tests:** `e2e/read/person-families.spec.ts` (gesperrte letzte Familie,
Beschreibung per `aria-describedby`), `e2e/write/person-lifecycle.spec.ts`
(„Familienzuordnung: Bearbeiter nur in eigenen Familien, Admin frei“),
`e2e/write/import.spec.ts` (Warnung „keiner Familie zugeordnet“).

### components/RelationshipEditor.tsx

**Zweck:** Beziehungen einer Person (Elternteil, Kind, Partner) im
Verwaltungsbereich auflisten, ändern, entfernen und neue hinzufügen. Die
Ansicht der Verwandten als Karten steht davon getrennt auf der Seite.

**Wo eingesetzt:** `app/people/[id]/page.tsx` (Abschnitt „Verwaltung“).

**Props/Daten:** `personId`; `relations` (Rolle der anderen Seite, Untertyp,
Start-/Enddatum mit Genauigkeit, Zusatz, Bereichsende und Wortlaut, Orte,
andere Person mit Name, Flag „nicht freigegeben“, Zahl der Belege);
`people` (Auswahl für den `PersonPicker`); `canEdit`;
`newPersonFamilies` (die für den Benutzer bearbeitbaren Familien der
Ausgangsperson — dorthin kommt eine im Wähler neu angelegte Person).
Exportiert `RelationRow`.

**Verhalten:**
- Zeile: Rolle, Name (Link; bei nicht freigegebener Person kursiv ohne Link),
  Kurzbeschreibung aus Untertyp, Zeitraum und Orten. Bearbeiter: „Belege (n)“
  springt zu `#beleg-<id>` im Abschnitt Quellen, „ändern“ (`aria-expanded`),
  „entfernen“ (Rückfrage; nennt eine nicht freigegebene Person neutral).
- Welche Datums-/Ortsfelder erscheinen, hängt vom Untertyp ab
  (`DATE_FIELDS`): Ehe – Hochzeitsdatum/-ort; unverheiratet bzw. Ehestand
  unbekannt – „Zusammen seit“/Ort; geschieden – zusätzlich
  Scheidungsdatum/-ort; Adoption und Pflege – nur Datum; leiblich und
  Stief – keine.
- Ändern (`RelationDateEditor`, intern): Untertyp innerhalb der Gruppe
  (Partner bzw. Eltern), Daten mit Wortlaut-Option und angezeigtem
  gespeicherten Wortlaut; ausgeblendete Felder werden beim Speichern
  geleert. Speichern gesperrt, solange ein Datum ungültig ist.
- Hinzufügen: Art (Kind/Elternteil/Partner – Wechsel setzt Untertyp und
  Formular zurück), Person per `PersonPicker` (inkl. Neuanlage; neue Personen
  kommen in die Familien der Ausgangsperson — der Anlege-Eintrag nennt sie,
  bei einer familienlosen Ausgangsperson steht dort „ohne Familie – danach nur
  für Administratoren sichtbar“ — und werden lokal in die Auswahl
  übernommen), Untertyp, Daten und Orte. Vorher bekamen Administratoren hier
  Personen ganz ohne Familie, die danach nur Administratoren sahen. Die
  Richtung wird aufgelöst: `PARENT_OF` zeigt immer vom Elternteil zum Kind.
  Erfolgsmeldung nennt die Person.
- Telefon: Formularfelder unter `sm` volle Breite.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/relationships`, `PATCH /api/relationships/<id>`,
`DELETE /api/relationships/<id>`; indirekt `POST /api/persons` über den
`PersonPicker`.

**Tests:** `e2e/write/person-lifecycle.spec.ts` („Beziehungen: Eltern, Grenze
für leibliche Eltern, Adoption, Partner, Kind“, „Beziehung ändern und
entfernen“), `e2e/write/genealogy.spec.ts` („Beziehung: Orte, Ehestand
unbekannt und Datumsbereich“), `e2e/write/sources.spec.ts`
(`relation-citations-link`), `e2e/read/quality.spec.ts` (axe mit offenem
Änderungsformular), `e2e/read/permissions.spec.ts`.

### components/PersonChanges.tsx

**Zweck:** Abschnitt „Änderungen“ der Personenseite: wer hat wann was
geändert, neueste zuerst.

**Wo eingesetzt:** `app/people/[id]/page.tsx`, nur wenn der Benutzer die
Person bearbeiten darf.

**Props/Daten:** nur `personId`.

**Verhalten:** Zugeklappt; lädt erst beim ersten Aufklappen 20 Einträge,
danach „Ältere Änderungen laden“ per Cursor (hängt an). Darstellung über
`ChangeEntryList`. Knopf mit `aria-expanded`/`aria-controls`, Panel mit
`hidden`; Ladezustand und Anzahl werden über eine unsichtbare
`aria-live`-Zeile angesagt. Leere Liste: „Noch keine Änderungen erfasst“.

**Server oder Client:** Client.

**Ruft auf:** `GET /api/persons/<id>/changes?limit=20&cursor=…`.

**Tests:** `e2e/write/changelog.spec.ts` („Personenseite: Änderungen mit
vorher → nachher …“, Betrachter: „kein Abschnitt ‚Änderungen‘, API
verweigert“). Unit (Dienst): `tests/changelog.test.ts`,
`tests/changelog.db.test.ts`.

### components/PersonPicker.tsx

**Zweck:** Suchfeld zur Personenauswahl statt Drop-Down (bei vielen Personen
und gleichnamigen Verwandten), optional mit Neuanlage aus dem Suchtext.

**Wo eingesetzt:** nicht direkt in `app/`; in `RelationshipEditor`
(Personenseite, mit Neuanlage), `MergeDialog` (Personenseite, Dubletten
zusammenführen) und `UserAdmin` (`app/admin/users`, Person einem Benutzer
zuordnen).

**Props/Daten:** `people` (Name und Lebensdaten in allen Teilen), `value`
(gewählte ID), `onChange`, optional `onCreated` (schaltet Neuanlage frei),
`createFamilyIds` (Familien der neuen Person; ohne Angabe entscheidet
`createPerson`: Bearbeiter → erste bearbeitbare Familie, Administratoren →
keine), `createNote` (Hinweis im Anlege-Eintrag, Testkennung
`picker-create-note`), `placeholder`, `labelledBy` (ID der sichtbaren
Beschriftung). Exportiert `PickerPerson`.

**Verhalten:**
- Gewählt: Anzeige von Name und Lebensdaten mit Knopf „ändern“ (hebt die
  Auswahl auf).
- Suche: alle Wörter müssen in „Name + Geburtsdatum“ vorkommen; höchstens 8
  Treffer, jede Zeile mit Geburtsdatum bzw. Lebensspanne. Ohne Eingabe die
  ersten 8.
- Neuanlage ab 2 Zeichen: „Neu anlegen: <Text>“ – erstes Wort Vorname, Rest
  Nachname; die neue Person wird gemeldet und gleich gewählt.
- Tastatur: Pfeil hoch/runter bewegt die Markierung, Enter wählt bzw. legt an,
  Escape schließt. Schließen auch bei Klick daneben und Tab aus dem Feld
  (`useDismiss`). Trefferknöpfe haben `tabIndex=-1`.
- Barrierefreiheit: Eingabe mit `role="combobox"`, `aria-expanded`,
  `aria-controls`, `aria-autocomplete="list"`; die Trefferliste hat jedoch
  keine `listbox`/`option`-Rollen und kein `aria-activedescendant` – die
  Markierung ist für Screenreader nicht wahrnehmbar.
- Telefon: volle Breite, Treffer mit größerem Tippabstand.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/persons` (nur bei Neuanlage, nur Vor- und Nachname,
ohne `familyIds`).

**Tests:** `e2e/write/person-lifecycle.spec.ts` (Auswahl über die Combobox
„Person“, „Neu anlegen: …“), `e2e/write/reference.spec.ts` (Zuordnung in
der Benutzerverwaltung), `e2e/write/merge.spec.ts` (Suche im Picker von
`MergeDialog` über den Platzhalter). Kein Unit-Test.

### components/AttachedMedia.tsx

**Zweck:** Kleine Bildleiste an einem Ereignis, Beleg oder einer Quelle:
Vorschauen, für Bearbeiter Hochladen, Verknüpfen vorhandener Bilder und
Lösen.

**Wo eingesetzt:** `EventSection` und `CitationSection` (Personenseite);
`app/sources/[id]/page.tsx` („Bilder zur Quelle“ und – nur lesend – an den
Belegen der Quelle).

**Props/Daten:** `target` (Art `event`/`citation`/`source` und ID);
`items` (eigene Bilder mit Beschriftung, ggf. Kennzeichen Hauptscan);
`inherited` (geerbte Belegbilder mit Herkunftsvermerk, nur Anzeige);
`canEdit`; `candidates` (verknüpfbare Bilder der Seite); `label` (wofür –
für Beschriftungen der Bedienelemente); `fallbackAlt`; `testId`. Exportiert
`AttachedItem`, `InheritedItem`, `MediaCandidate`, `AttachTarget`.

**Verhalten:**
- Ohne Bilder und ohne Recht nichts. Vorschau 64 px (`?variant=thumb`), Klick
  öffnet das Bild groß in neuem Tab. Alt-Text: Beschriftung, sonst
  `fallbackAlt`. Hauptscan wird markiert; geerbte Bilder tragen ihren Vermerk.
- Bearbeiter: aufklappbares „Bild hinzufügen“ mit „Datei hochladen“
  (mehrere Dateien, nacheinander; bricht beim ersten Fehler mit Dateinamen
  ab) und „Vorhandenes Bild“ + „Verknüpfen“ (nur Kandidaten, die hier noch
  nicht hängen). „entfernen“ löst das Bild nach Rückfrage; hing es sonst
  nirgends, meldet der Server die Löschung und die Meldung sagt das.
- Barrierefreiheit: Liste mit `aria-label` „Bilder zu …“, Vorschau-Links und
  Entfernen-Knöpfe mit sprechenden Labels, Zusammenfassung mit
  Screenreader-Zusatz „zu <label>“. Telefon: Tippziele mindestens 44 px.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/media` (Formular mit `eventId`/`citationId`/
`sourceId`), `POST /api/media/<id>/links`,
`DELETE /api/media/<id>/links?<feld>=<id>`; Bilder über
`GET /api/media/<id>`.

**Tests:** `e2e/write/attached-media.spec.ts` (Bild am Ereignis, Bild an der
Quelle als Belegbild, Verknüpfen an einen Beleg, Betrachter ohne
Bedienelemente, Telefonbreite mit 44-px-Tippzielen und axe, Entfernen mit
Löschen). Unit (Dienst): `tests/media-links.test.ts`,
`tests/media-links.db.test.ts`, `tests/media-cleanup.db.test.ts`.

### components/MediaGallery.tsx

**Zweck:** Bildergalerie einer Person (Porträt) oder einer Partnerschaft
(Hochzeitsbilder) mit Hochladen, Hauptbild festlegen und Löschen.

**Wo eingesetzt:** `app/people/[id]/page.tsx` – einmal für die Person, je
Partnerkarte in einem aufklappbaren Bereich für die Beziehung (`compact`,
Titel „Hochzeitsbilder“ bzw. „Bilder zur Partnerschaft“; per `?rel=…`
vorgeöffnet).

**Props/Daten:** `owner` (Person oder Beziehung mit ID), `items` (Bild-ID,
Beschriftung, Hauptbild-Kennzeichen), `canUpload`, `canDelete`, `title`,
`compact`. Exportiert `GalleryItem`, `MediaOwner`.

**Verhalten:**
- Überschrift mit Anzahl (bei `compact` als `h4`, sonst `h2`). Raster
  2–5 Spalten (kompakt 3–4). Klick öffnet das Bild groß in neuem Tab.
- Hauptbild heißt bei Personen „Porträt“, bei Beziehungen „Hauptbild“;
  Badge auf dem Bild, Knopf „Als Porträt/Hauptbild“ an den übrigen.
- Hochladen mehrerer Dateien nacheinander (stabile Reihenfolge, kein
  Speicherstoß); Dateifeld danach geleert, damit dieselbe Datei erneut
  wählbar ist.
- Löschen löscht das Bild endgültig (Rückfrage), nicht nur die Zuordnung.
- Aktionen: auf dem Desktop bei Zeiger oder Tastaturfokus eingeblendet
  (`group-focus-within`), auf dem Telefon immer sichtbar und unter dem Bild
  mit 44 px Tippziel.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/media` (mit `personId` bzw. `relationshipId`),
`POST /api/media/<id>/primary`, `DELETE /api/media/<id>`.

**Tests:** `e2e/write/media.spec.ts` („hochladen und als Porträt
festlegen“, „Bild löschen“, Porträt in Baum und Liste),
`e2e/write/import.spec.ts` und `e2e/write/attached-media.spec.ts`
(`gallery-person`), `e2e/read/permissions.spec.ts` (Betrachter sieht kein
„Bilder hinzufügen“). Die Beziehungsgalerie (`gallery-relationship`) hat
keinen eigenen UI-Test.

### components/DeletePersonButton.tsx

**Zweck:** Person löschen mit zweistufiger Bestätigung.

**Wo eingesetzt:** `app/people/[id]/page.tsx` (Abschnitt „Verwaltung“).

**Props/Daten:** `personId`, `personName`.

**Verhalten:** Erste Rückfrage („nicht rückgängig“). Antwortet der Server mit
409 (Person hat noch Beziehungen, Anzahl im Antwortkörper), folgt eine zweite
Rückfrage, die die getrennten Verbindungen im Baum benennt; erst dann Löschen
mit `?force=true`. Danach Weiterleitung auf `/people?deleted=<Name>`.
Fehler als `role="alert"`.

**Server oder Client:** Client.

**Ruft auf:** `DELETE /api/persons/<id>` (ggf. mit `?force=true`).

**Tests:** `e2e/write/person-lifecycle.spec.ts` („löschen mit
Bestätigung“), `e2e/write/media.spec.ts` (Löschen entfernt das Bild),
`e2e/read/permissions.spec.ts` (Knopf fehlt für Betrachter, API 403/404).

### components/SelfPersonButton.tsx

**Zweck:** Knopf „Das bin ich“ / „Das bin ich nicht“ zum Setzen bzw.
Aufheben der eigenen Person (Bezugsperson).

**Wo eingesetzt:** in `ReferencePanel` auf `app/people/[id]/page.tsx`.

**Props/Daten:** `personId`, `personName`, `isSelf`, `currentSelfName` (Name
der bisherigen eigenen Person, falls eine andere gesetzt und sichtbar ist).

**Verhalten:** Ist bereits eine andere Person gewählt, fragt er vor dem
Ersetzen nach. Aufheben ohne Rückfrage. Testids `self-person-set` bzw.
`self-person-clear`. Fehler als `role="alert"` in voller Zeilenbreite.

**Server oder Client:** Client.

**Ruft auf:** `PUT /api/me/person` (mit `personId` oder `null`).

**Tests:** `e2e/write/reference.spec.ts` („Betrachter: ‚Das bin ich‘ auf der
Personenseite …; wieder aufheben“, API nur für sichtbare Personen),
`e2e/read/reference.spec.ts`. Unit (Dienst): `tests/reference.test.ts`,
`tests/reference.db.test.ts`.

### components/SourceForm.tsx

**Zweck:** Quelle anlegen oder bearbeiten (Titel, Art, Datum, Verfasser,
Internetadresse, Archiv, Signatur, Abschrift/Notizen, beim Bearbeiten
Hauptscan).

**Wo eingesetzt:** `app/sources/new/page.tsx` (ohne Props),
`app/sources/[id]/edit/page.tsx` (mit `initial` und `scanCandidates`).

**Props/Daten:** `initial` (Werte inkl. `id`; Datum als Eingabetext mit
Wortlaut-Flag und gespeichertem Wortlaut; `mediaId` des Scans);
`scanCandidates` (Bilder, die schon an Personen/Ehen hängen, für die die
Quelle zitiert ist – mit Beschriftung und Besitzer). Exportiert
`SourceFormValues`.

**Verhalten:**
- Gruppen „Quelle“ (Titel Pflicht, Art aus `SOURCE_KINDS`, Datum über
  `DateInput` mit Wortlaut-Option, Verfasser/Herkunft, Internetadresse) und
  „Fundort“ (Archiv, Signatur), dazu Abschrift und Notizen.
- Vorabprüfung: Titel und Datum; Feldfehler mit `aria-invalid`/
  `aria-describedby`, Gesamtmeldung als `role="alert"`.
- Scan nur beim Bearbeiten: Auswahl aus den Kandidaten; ein bisheriger Scan,
  der nicht unter den Kandidaten ist, bleibt als „bisheriger Scan“ wählbar.
  `mediaId` wird nur gesendet, wenn geändert – sonst würde ein für den
  Benutzer unsichtbares Bild versehentlich entfernt. Ohne Kandidaten nur ein
  Hinweistext (die zugehörige `label` zeigt dann auf kein Feld).
- Leere Felder gehen als `null`. Nach Erfolg Weiterleitung auf
  `/sources/<id>?saved=1`.

**Server oder Client:** Client.

**Ruft auf:** `POST /api/sources`, `PATCH /api/sources/<id>`.

**Tests:** `e2e/write/sources.spec.ts` („Quelle anlegen (mit Prüfung am
Feld)“, „Scan aus einem vorhandenen Bild wählen“, Datum der Quelle),
`e2e/write/dates.spec.ts`, `e2e/read/mobile.spec.ts` und
`e2e/read/quality.spec.ts` (`/sources/new`), `e2e/read/permissions.spec.ts`
(Betrachter: kein „Quelle anlegen“). Unit (Dienst):
`tests/sources.db.test.ts`.

### components/DeleteSourceButton.tsx

**Zweck:** Quelle samt aller Belege löschen.

**Wo eingesetzt:** `app/sources/[id]/page.tsx` (nur wenn der Server
`canDelete` meldet).

**Props/Daten:** `sourceId`, `title`, `citationCount`.

**Verhalten:** Rückfrage nennt die Zahl der mitverschwindenden Belege. Nach
Erfolg Weiterleitung auf `/sources?deleted=<Titel>`. Fehler als
`role="alert"`.

**Server oder Client:** Client.

**Ruft auf:** `DELETE /api/sources/<id>`.

**Tests:** `e2e/write/sources.spec.ts` („Quelle löschen“),
`e2e/read/permissions.spec.ts` (Knopf fehlt, API 403/404),
`e2e/write/attached-media.spec.ts` (Löschen räumt Bilder mit ab).

## Rahmen und Helfer

### components/NavBar.tsx

- **Zweck:** Kopfzeile mit Hauptnavigation, Untermenü „Verwaltung“, Benutzername und Abmelde-Knopf; dazu der Inhaltsrahmen und das Logo.
- **Wo eingesetzt:** `app/layout.tsx` (`NavBar`, `MainContainer`, Typ `NavItem`); `BrandMark` zusätzlich in `app/login/page.tsx` und `app/tree/page.tsx`.
- **Exporte / Props:**
  - `NavBar`: `items` (Liste von `NavItem` = Ziel, Beschriftung, optional `group: "admin"`), `userLabel` (Anzeigename), `signOut` (fertiges Element, kommt vom Layout).
  - `BrandMark`: stilisiertes Stammbaum-Zeichen als SVG, Größe über `className`, für Screenreader ausgeblendet.
  - `MainContainer`: `<main id="inhalt">` (Ziel des Sprunglinks im Layout); unter `/tree` volle Breite, sonst Lesebreite.
- **Welche Punkte erscheinen** (entscheidet `app/layout.tsx`, nicht die Komponente): Baum, Karte, Personen, Recherche, Quellen, Daten in der Hauptzeile; im Untermenü „Verwaltung“ KI-Zugang (nur bei KI-Recht oder noch nicht widerrufenen Schlüsseln), Familien, Benutzer, Änderungen (je nach Rechten). Ohne Anmeldung ist die Liste leer.
- **Verhalten:**
  - Aktiver Bereich: exakter Pfad oder Unterpfad, Link bekommt `aria-current="page"`. Der Knopf „Verwaltung“ trägt `data-active`, solange man in einem seiner Bereiche ist.
  - Ab Breite `lg`: Hauptpunkte als eine Zeile; „Verwaltung“ als Knopf mit `aria-expanded`/`aria-controls`, der eine Liste aufklappt. Der Benutzername wird gekürzt (vollständig im Tooltip).
  - Unter `lg`: Knopf „Menü“ (☰/✕, unter `md` 44 px hoch) öffnet ein Ausklappmenü. Darin stehen die Verwaltungspunkte als beschriftete Gruppe (kein zweites Aufklappen), unten Name und Abmelden. Die Kopfzeile bleibt unter `md` 55 px hoch; laut Kommentar rechnet die Baumseite mit dieser Höhe.
  - Schließen über `useDismiss`: Klick daneben, Escape (Fokus zurück auf den Auslöser), Tab aus dem Menü heraus. Nach jedem Seitenwechsel schließen beide Menüs.
- **Server oder Client:** Client (`"use client"`; braucht `usePathname`).
- **Ruft auf:** nichts. Navigiert nur über `next/link`.
- **Tests:** `e2e/read/navigation.spec.ts` (Menüpunkte je Rolle, `aria-current`, Untermenü mit Escape und Fokusrückgabe, mobiles Menü); `e2e/read/mobile.spec.ts`; Hilfsfunktionen in `e2e/support/nav.ts`, die `e2e/write/admin.spec.ts`, `ai-access.spec.ts` und `changelog.spec.ts` benutzen; `e2e/read/auth.spec.ts`.

### components/PageLoading.tsx

- **Zweck:** Platzhalter, solange eine Seite lädt: ruhig pulsierende Balken und Kärtchen statt eines Spinners.
- **Wo eingesetzt:** `app/research/loading.tsx` und als `Suspense`-Platzhalter in `app/tree/page.tsx`, sonst nirgends.
- **Props:** `label` (optional; Standard „Wird geladen…“). Der Text ist nur für Screenreader sichtbar.
- **Verhalten:** Hülle mit `role="status"` und `aria-live="polite"`; die Platzhalterformen sind `aria-hidden`. Das Kachelraster hat 1, 2 bzw. 3 Spalten je nach Breite.
- **Server oder Client:** kein `"use client"`. Reine Darstellung, als Server-Komponente nutzbar.
- **Ruft auf:** nichts.
- **Tests:** keine gezielten. Kein Test sucht den Ladetext.

### components/WhatsNewDialog.tsx

- **Zweck:** Fenster „Was ist neu?“ — zeigt nach einer neuen Version einmal die Neuigkeiten seit dem zuletzt gesehenen Release (`CHANGELOG.md`, README „Neuigkeiten“). Nicht zu verwechseln mit der Änderungsgeschichte der Daten.
- **Wo eingesetzt:** nur in `app/layout.tsx`, und nur für Angemeldete mit ungesehenen Releases (Auswahl `releasesSince` auf dem Server).
- **Props:** `releases` (höchstens drei, neueste zuerst), `more` (Zahl weiterer ungesehener), `latestId` (neueste Kennung, wird als gesehen gespeichert).
- **Verhalten:**
  - Echtes `<dialog>` mit `showModal` beim ersten Rendern (nicht auf `/login`): Fokus im Fenster auf „Gelesen“, Escape und Klick auf den Hintergrund schließen; danach Fokus zurück auf das vorher fokussierte Element, sofern es eines gab.
  - Jedes Schließen — „Gelesen“, Escape, Hintergrund, Link „Alle Neuigkeiten“ (führt zu `/neuigkeiten`) — speichert genau einmal `latestId`. Scheitert das (Netz), gibt es keine Meldung; das Fenster erscheint beim nächsten Laden wieder.
  - Titel über `aria-labelledby`; Releases als `h3` unter dem `h2` „Was ist neu?“. Gibt es mehr als drei, nennt ein Hinweis die Zahl und verweist auf die Seite.
  - Telefon: Breite und Höhe auf den Bildschirm begrenzt, der Inhalt scrollt, Knöpfe mindestens 44 px hoch; dunkles Farbschema über die üblichen Klassen.
  - Nach dem Schließen rendert die Komponente nichts mehr; das Layout bleibt bei Seitenwechseln stehen, das Fenster kommt also erst nach einem neuen Laden mit neuem Release wieder.
- **Server oder Client:** Client.
- **Ruft auf:** `PUT /api/me/release-seen` (über `apiFetch`).
- **Tests:** `e2e/write/whats-new.spec.ts` (eigener eingeladener Benutzer: kein Fenster nach Einladung; Lesemarke zurückgesetzt → Fenster, Fokus, axe, Escape speichert; drei plus Hinweis; „Alle Neuigkeiten“; 360 px ohne Überlauf). Die Auswahl prüft `tests/release-notes.test.ts`.

### components/ReleaseNoteList.tsx

- **Zweck:** Darstellung von Releases (Kurztitel als Überschrift, Datum ausgeschrieben, ab der zweiten Version des Tages mit Nummer, Stichpunkte).
- **Wo eingesetzt:** `app/neuigkeiten/page.tsx` (Überschriften `h2`) und `WhatsNewDialog` (`h3`).
- **Props:** `releases`, `headingLevel` (2 oder 3).
- **Verhalten:** je Release ein `<section>` mit `data-testid="release"` und `data-release-id`; lange Wörter brechen um.
- **Server oder Client:** kein `"use client"`, in beiden Welten nutzbar.
- **Tests:** über `e2e/read/neuigkeiten.spec.ts` und `e2e/write/whats-new.spec.ts`.

### components/AutoSubmit.tsx

- **Zweck:** `AutoSubmitSelect` ist ein Auswahlfeld, das sein Formular beim Ändern sofort abschickt (über `requestSubmit`). Ohne JavaScript bleibt der Absenden-Knopf des Formulars der Weg.
- **Wo eingesetzt:** `app/people/page.tsx` (Felder Familie und Sortierung), `app/sources/page.tsx` (Feld Art der Quelle).
- **Props:** alle Attribute eines `<select>`. Ein mitgegebenes `onChange` wird zuerst aufgerufen.
- **Verhalten:** Die Bedienung per Tastatur ist die eines normalen `<select>`. Jede Änderung schickt das Formular ab, auch beim Durchblättern mit den Pfeiltasten, sofern der Browser dabei `change` auslöst.
- **Server oder Client:** Client.
- **Ruft auf:** nichts direkt. Die GET-Formulare der Seiten laden mit neuen Suchparametern.
- **Tests:** `e2e/read/people-list.spec.ts` (Familienfilter und Sortierung per `selectOption`, wartet auf die Hydrierung von `#people-sort`). Für den Filter auf der Quellenseite ist kein Test erkennbar.

### components/api-client.ts

- **Zweck:** Einheitliche Aufrufe der eigenen API aus Client-Komponenten, mit deutschen Fehlermeldungen.
- **Wo eingesetzt:** nur in Komponenten, aus diesem Abschnitt in `GedcomImport`, `DataTransfer`, `ImportHistory`, `ConnectImports`, `DuplicateList`, `MergeView`, `ChangeSetList`, `UserAdmin`, `FamilyAdmin`, `PlaceAdmin` und `AiAccessManager`, dazu viele Komponenten zu Personen, Quellen und Medien. Keine Seite unter `app/` importiert die Datei direkt.
- **Exporte:**
  - `apiFetch(url, init)` gibt entweder `{ ok: true, status, data }` oder `ApiFailure` zurück. `ApiFailure` enthält `status`, `message`, `fields` und den rohen `body`.
  - `jsonBody(method, data)` baut Methode, JSON-Kopf und Inhalt zusammen.
  - Typen `ApiFailure` und `ApiSuccess`.
- **Verhalten:**
  - Netzwerkfehler werden nicht geworfen, sondern als `status: 0` mit der Meldung „Keine Verbindung zum Server“ zurückgegeben.
  - Bei einer Fehlerantwort gilt das `error` des Servers. Fehlt es, kommt ein fester deutscher Text für 401, 403, 404, 409 und 413, sonst „Unerwarteter Fehler (Status)“.
  - Aus Validierungsfehlern (`issues`) entsteht je Feld eine Meldung, aus dem ersten Pfadelement; die erste Meldung je Feld zählt.
  - Ein leerer oder ungültiger JSON-Inhalt wird zu `null` bzw. `{}`.
- **Server oder Client:** kein `"use client"`. Gedacht für den Browser, die Datei selbst ist neutral.
- **Ruft auf:** die jeweils übergebene URL.
- **Tests:** keine eigenen Unit-Tests. Indirekt prüfen alle e2e-Tests mit Fehlermeldungen die Funktion mit.

### components/useDismiss.ts

- **Zweck:** Gemeinsames Schließverhalten für Menüs und Aufklapplisten.
- **Wo eingesetzt:** `NavBar`, dazu `FamilyTree`, `MapPersonChooser` und `PersonPicker` (andere Bereiche).
- **Export:** `useDismiss(open, close, inside, trigger?)`.
  - `inside`: Refs aller Elemente, die als „innen“ gelten (Menü und Auslöser).
  - `trigger`: optional; erhält bei Escape den Fokus zurück.
- **Verhalten:**
  - Nur aktiv, solange `open` gilt.
  - Schließt bei einem Zeigerdruck außerhalb. Der Hook lauscht dafür in der Capture-Phase, weil die Baumfläche (React Flow) die Weitergabe ihrer Zeigerereignisse stoppt.
  - Schließt bei Escape und setzt den Fokus auf den Auslöser zurück.
  - Schließt, wenn der Fokus per Tab nach außen wandert (`focusin`).
- **Server oder Client:** Client.
- **Ruft auf:** nichts.
- **Tests:** indirekt über `e2e/read/navigation.spec.ts` und `e2e/read/mobile.spec.ts` (Escape mit Fokusrückgabe), `e2e/read/tree-whole.spec.ts` (Menü im Baum). Kein Unit-Test.

### components/ai-access-labels.ts

- **Zweck:** Gemeinsame deutsche Bezeichnungen und kleine Hilfen rund um den KI-Zugang. Nur Darstellung; die Regeln stehen in `lib/services/ai-access.ts`.
- **Wo eingesetzt:** `UserAdmin`, `AiAccessManager`, `ApiTokenList`.
- **Exporte:**
  - Typen: `AiAccessLevel` (NONE, READ, WRITE), `ApiTokenLevelName`, `ApiTokenStatusName` und `TokenRow` (eine Zeile der Schlüsselliste ohne Besitzer).
  - Beschriftungen: `AI_ACCESS_LABEL` und `TOKEN_LEVEL_LABEL` („kein Zugang“, „lesen“, „lesen und schreiben“), `TOKEN_STATUS_LABEL` („aktiv“, „widerrufen“, „abgelaufen“), `TOKEN_STATUS_CLASS` (Abzeichen-Klassen).
  - Stufen: `aiRank` (Rangfolge der Stufen) und `effectiveLevel` (wirksame Stufe = die kleinere von Schlüssel und Benutzerrecht).
  - Formatierung: `formatDay`, `formatDateTime` (fehlt der Wert, erscheint „—“ bzw. „nie“) und `countKeys` (zum Beispiel „1 aktiver Schlüssel“ bzw. „3 aktive Schlüssel“).
- **Server oder Client:** neutral (kein `"use client"`).
- **Ruft auf:** nichts.
- **Tests:** keine eigenen. `tests/ai-access.test.ts` prüft die Serverregel `effectiveAiLevel`, nicht diese Datei. `e2e/write/ai-access.spec.ts` deckt die angezeigten Texte ab (`ai-token-effective`, Status).

### components/HelpLink.tsx

- **Zweck:** Kontexthilfe — kleiner Link zur passenden Seite der Anwender-Hilfe (`/hilfe/…`), und `FooterHelpLink`, der Link „Hilfe“ in der Fußzeile.
- **Wo eingesetzt:** `HelpLink` auf `/map` (in „Wie wird gezählt?“ und am Admin-Hinweis „Orte zuordnen“), `/admin/data` (Orte zuordnen), `/research/duplicates`, `/ai-access`, in `ReferencePanel` und `LineLegend`; `FooterHelpLink` in `app/layout.tsx` (nur angemeldet).
- **Props:** `to` (Schlüssel aus `HELP_LINKS` in `lib/help/links.ts` — nie eine freie Adresse, damit der Test alle Ziele kennt), `label` (Standard „Wie funktioniert das?“), `compact` (nur „?“ im Kreis; Text dann als `sr-only` und Tooltip; auf dem Telefon 44 px Tippziel), `className`.
- **Verhalten:** `next/link`, `data-testid="help-link"`. Neue Stellen: Ziel in `HELP_LINKS` ergänzen (Anker aus der Überschrift, siehe `slugify`).
- **Server oder Client:** neutral (kein `"use client"`), auch in Client-Komponenten nutzbar.
- **Tests:** `e2e/read/help.spec.ts` (Karte, KI-Zugang, Personenseite, Dubletten, Daten, Fußzeile, Menü), Ziele in `tests/help.test.ts`.

### components/help-render.ts

- **Zweck:** Gibt den Syntaxbaum der Anwender-Hilfe (`lib/help/markdown.ts`) als React-Elemente aus (`renderHelpBlocks`, `hrefOf`).
- **Wo eingesetzt:** `app/hilfe/[thema]/page.tsx`.
- **Verhalten:** Ohne JSX (`createElement`), damit Vitest die Ausgabe mit `renderToStaticMarkup` prüfen kann; liegt unter `components/`, damit Tailwind die Klassen findet. Kein `dangerouslySetInnerHTML` — aller Text wird von React maskiert. Hilfe- und App-Links über `next/link`, externe (nur https) mit `target="_blank"` und `rel="noopener noreferrer"`. Überschriften mit `id` (Anker) und `scroll-mt`; `>`-Blöcke als Hinweiskasten (`alert-info` mit Akzentrand); Tabellen in einem eigenen, per Tastatur erreichbaren Scrollrahmen, damit die Seite auf dem Telefon nicht seitlich scrollt; Farben über die Klassen des Gestaltungssystems mit `dark:`-Varianten.
- **Server oder Client:** neutral; benutzt nur auf dem Server.
- **Tests:** `tests/help.test.ts` (rohes HTML bleibt Text, gefährliche Links werden Text), `e2e/read/help.spec.ts` (axe hell/dunkel, Telefonbreite).

## Import, Export, Dubletten und Zusammenführen

**Ergänzung (22.11.):** `HISTORY_PARAM`, `isHistoryToken`, `canDeleteToken` (Spiegel von `apiTokenDeletable`), `deleteTokenQuestion(t, owner?)` (Rückfrage mit Folgen je Status, „Änderungsgeschichte bleibt“, „nicht rückgängig“).

### components/GedcomImport.tsx

- **Zweck:** GEDCOM-Import mit Vorschau in den Schritten Datei → Vorschau → Entscheidungen → Ausführen → Ergebnis. Die Vorschau ändert nichts.
- **Wo eingesetzt:** `app/admin/data/page.tsx`, nur bei Recht `data:import`.
- **Props / Exporte:**
  - `GedcomImport({ families })`: `families` ist die Liste der wählbaren Familien (ID und Name).
- **Verhalten:**
  - **Datei:** Erlaubt sind `.ged`, `.gedcom` und `.zip`. Knopf „Vorschau der GEDCOM-Datei“.
  - **Kopf der Vorschau:** Dateiname, Herkunftsprogramm, Version, Zeichensatz und Zahl der Datensätze.
  - **Quell-Baum:** zeigt, ob die Datei als Aktualisierung eines früheren Imports oder als neuer, unabhängiger Baum erkannt wurde. Tragen Personen Kennungen, die schon in einem anderen importierten Baum vorkommen, erscheint eine Warnung. Ein Auswahlfeld legt fest: automatisch erkennen, neuer Baum oder Aktualisierung eines bestimmten Baums. Nach dieser Wahl berechnet der Server die Vorschau neu, und die Einzelentscheidungen werden zurückgesetzt.
  - **Übersicht:** Kacheln je Gruppe (neu, in der Datei geändert, in der App geändert, fehlt in der Datei, nicht übernehmbar, unverändert) und eine Tabelle Art × Gruppe. Die Tabelle steht in einem waagerecht verschiebbaren Bereich mit Fokus und Beschriftung.
  - **Gruppenlisten:** je Gruppe ein `<details>`. „In der App geändert“, „Fehlt in der Datei“ und „Nicht übernehmbar“ sind anfangs offen.
    - Reiter je Art (`role="tablist"`); ab mehr als 20 Einträgen ein Suchfeld.
    - Einträge werden seitenweise zu je 50 nachgeladen („Weitere laden“).
    - „In der App geändert“: eine Vorgabe für alle (App-Version behalten oder Dateiversion übernehmen) und je Eintrag eine Ausnahme.
    - „Fehlt in der Datei“: Einträge einzeln oder alle angezeigten zum Löschen vormerken (mit Rückfrage).
    - Neue Personen: Vorschläge ähnlicher, von Hand angelegter Personen zur Zuordnung. Ohne Wahl gilt „Nein — neu anlegen“.
  - **Familienzuordnung neuer Personen:** keine Familie (dann nur für Administratoren sichtbar), vorhandene Familien (Mehrfachauswahl) oder neue Familie mit Name. Ein Haken lässt Personen ohne Familie, die in der Datei als privat bzw. lebend markiert sind; er ist voreingestellt. Hinweis auf Personen ohne Sterbeangabe, die vor weniger als 100 Jahren geboren sind.
  - **Fotos:** optional jetzt von fremden Servern herunterladen. Lokale Bildpfade werden nie gelesen.
  - **Hinweise:** Vollständigkeit (wie viele Zeilen gedeutet, als Rohdaten erhalten oder verloren sind), Prüfmeldungen, Übernahmehinweise, Lesewarnungen und nicht gedeutete Tags.
  - **Kasten „Was der Import tut“:** fasst die Entscheidungen in Sätzen zusammen.
  - **Ausführen:**
    - Zuerst kommt eine Rückfrage. Sie warnt, wenn Löschungen vorgemerkt sind oder Fotos heruntergeladen werden.
    - Erst danach werden die Familienangaben geprüft: Name bzw. mindestens eine Familie muss gewählt sein.
    - Dann wird der Import gestartet; der Stand wird einmal je Sekunde abgefragt.
  - **Ergebnis:** Zahlen je Art, gelöschte Einträge, Fotos; Links „Zum Importverlauf“ (Anker `#importe`) und „Weitere Datei importieren“.
  - **Abbrechen:** verwirft die Vorschau auf dem Server.
  - **Fensterereignisse:** löst `import-finished` aus und hört auf `import-preview-started`. Über dieses Ereignis übernimmt die Komponente eine Vorschau aus `ImportHistory`.
  - **Bedienbarkeit:** Status- und Fehlerzeilen haben `role="status"` bzw. `role="alert"`. Auf dem Telefon ist das Dateifeld mindestens 44 px hoch.
- **Server oder Client:** Client.
- **Ruft auf:**
  - `POST /api/import/gedcom` (Vorschau aus der hochgeladenen Datei)
  - `POST` und `DELETE /api/import/gedcom/[id]` (Baumwahl neu berechnen bzw. Vorschau verwerfen)
  - `GET /api/import/gedcom/[id]/items` (Einträge einer Gruppe, seitenweise)
  - `POST` und `GET /api/import/gedcom/[id]/apply` (Import starten bzw. Stand abfragen)
- **Tests:** `e2e/write/gedcom-import.spec.ts` (Kacheln, Gruppen, Einträge, Familienwahl, App-Version, Ergebnis). Die Logik dahinter prüfen `tests/gedcom-import.db.test.ts` und die übrigen `tests/gedcom-*.test.ts`.

### components/GedcomExportDialog.tsx

- **Zweck:** Knöpfe „GEDCOM“ und „GEDCOM mit Bildern (ZIP)“ mit einem Dialog zur Familienauswahl vor dem Herunterladen.
- **Wo eingesetzt:** nur in `DataTransfer`, also auf `/admin/data`.
- **Props:** `overview` (`ExportFamilyOverview` aus `lib/export-selection`): die Familien des Benutzers, Personen je Familienkombination und die Zahl der Personen ohne Familie. Ist dieser Wert `null`, ist die Option „Personen ohne Familie“ nicht möglich.
- **Verhalten:**
  - Echtes `<dialog>` mit `showModal`: Der Fokus bleibt im Dialog, Escape schließt, danach kehrt der Fokus zum auslösenden Knopf zurück. Ein Klick auf den abgedunkelten Hintergrund schließt ebenfalls.
  - Titel und Hinweis sind über `aria-labelledby` und `aria-describedby` verbunden.
  - Kontrollkästchen je Familie mit Personenzahl, dazu „Personen ohne Familie“; Knöpfe „Alle auswählen“ und „Keine auswählen“.
  - Eine Live-Zeile (`role="status"`) nennt die Personenzahl im Export. Bei voller Auswahl erklärt sie, dass derselbe Export wie bisher entsteht. Dann wird auch keine Auswahl an die URL gehängt.
  - Ist nichts ausgewählt, ist „Herunterladen“ deaktiviert. Sonst ist es ein Link, damit der Browser auch große Dateien selbst herunterlädt.
  - Telefon: Breite und Höhe sind auf den Bildschirm begrenzt, die Liste scrollt, die Tippziele sind mindestens 44 px groß.
  - Was tatsächlich exportiert werden darf, entscheidet der Server.
- **Server oder Client:** Client.
- **Ruft auf:** `GET /api/export?format=gedcom|gedzip`, bei Teilauswahl mit Auswahlparametern aus `selectionQuery`.
- **Tests:** `e2e/read/gedcom-export-dialog.spec.ts` (Tastatur, Escape, Fokus, Auswahl); `e2e/write/gedcom-import.spec.ts` (Export nach Import). Die Serverseite prüft `tests/gedcom-export-selection.db.test.ts`.

### components/DataTransfer.tsx

- **Zweck:** Kasten „Export“ (eigenes JSON/ZIP-Format und GEDCOM) und Kasten „Import“ für eigene JSON- oder ZIP-Exportdateien.
- **Wo eingesetzt:** `app/admin/data/page.tsx`.
- **Props:** `canImport` (Recht `data:import`), `gedcomOverview` (wird an `GedcomExportDialog` weitergereicht).
- **Verhalten:**
  - Export steht allen offen: Links „ZIP mit Bildern“ und „Nur JSON“, darunter der GEDCOM-Dialog.
  - Import nur mit Recht, sonst steht dort ein Hinweis.
  - Ablauf: Datei wählen → „Vorschau der JSON/ZIP-Datei“ → „Import ausführen“ (mit Rückfrage). Der Ausführen-Knopf ist erst nach einer Vorschau aktiv und nach dem Import wieder gesperrt.
  - Das Ergebnis zeigt Personen, Beziehungen, Bilder sowie, wenn der Server sie liefert, Lebensereignisse, weitere Namen, Quellen und Belege. Dazu kommen bis zu 8 Warnungen.
  - Status und Fehler haben die Rollen `status` bzw. `alert`. Auf dem Telefon stehen die Kästen untereinander, ab `md` nebeneinander.
- **Server oder Client:** Client.
- **Ruft auf:** `POST /api/import?apply=false|true` (Formular mit Datei); die Export-Links auf `/api/export`.
- **Tests:** `e2e/read/export.spec.ts`, `e2e/write/import.spec.ts`, `e2e/write/media.spec.ts` (Import mit Bildern), `e2e/read/navigation.spec.ts`, `e2e/write/gedcom-import.spec.ts`.

### components/ImportHistory.tsx

- **Zweck:** Importverlauf. Zeigt ausgeführte Läufe mit Ergebnis, Originaldatei und dem Entfernen überholter Rohdaten. Darunter stehen zugeklappt die nie ausgeführten GEDCOM-Vorschauen.
- **Wo eingesetzt:** `app/admin/data/page.tsx`, nur bei Recht `data:import`. Abschnitts-Anker `#importe`.
- **Props:** keine. Die Komponente lädt selbst bis zu 50 Läufe.
- **Verhalten:**
  - Je Lauf: Datei, Zeitpunkt, Format, Herkunftssystem, Benutzer, Status, Ergebniszahlen, Rohdatensätze (davon überholte).
  - Aktionen je Lauf:
    - „Originaldatei“ herunterladen.
    - „Aus der aufbewahrten Datei neu einlesen“, nur bei ausgeführtem GEDCOM-Lauf. Erzeugt eine neue Vorschau, reicht sie per Fensterereignis an `GedcomImport` weiter und scrollt nach oben.
    - „Überholte Rohdaten entfernen“, mit Rückfrage.
  - Vorschauen: „Verwerfen“, mit Rückfrage; die aufbewahrte Datei wird dabei gelöscht. Nach 7 Tagen verfallen Vorschauen von selbst (laut Text, die Umsetzung liegt im Server).
  - Lädt neu, sobald das Ereignis `import-finished` kommt.
- **Server oder Client:** Client.
- **Ruft auf:**
  - `GET /api/import/batches?limit=50` (Verlauf laden)
  - `POST /api/import/batches/prune` (überholte Rohdaten entfernen)
  - `POST /api/import/gedcom/[id]/reread` (aus der aufbewahrten Datei neu einlesen)
  - `DELETE /api/import/gedcom/[id]` (Vorschau verwerfen)
  - `GET /api/import/batches/[id]/file` (Originaldatei, als Link)
- **Tests:** `e2e/write/gedcom-import.spec.ts` (`import-entry`, `import-preview-entry`, Verwerfen, überholte Rohdaten). Das Neu-Einlesen prüft nur die Serverseite: `tests/import-sources.db.test.ts`. Der Knopf `import-reread` kommt in keinem e2e-Test vor.

### components/ConnectImports.tsx

- **Zweck:** Importe verbinden. Findet Personen, die in mehreren Importen (oder doppelt in einem) vorkommen, und führt sie gesammelt zusammen. Ablauf: Auswahl → Abgleich → Liste nach Klassen → gemeinsame Vorschau → Zusammenführen im Hintergrund → Ergebnis mit Folge-Abgleich.
- **Wo eingesetzt:** `app/research/connect/page.tsx`. Nicht-Administratoren bekommen dort `notFound`.
- **Props:** keine. Die Komponente lädt Gruppen und den letzten Lauf selbst.
- **Verhalten:**
  - Auswahl der Importe; anfangs sind alle angehakt. Option „Doppelte innerhalb eines Imports suchen“.
  - Ein laufender Abgleich, eine Vorschau oder ein Zusammenführen wird alle 1,5 s abgefragt, mit Fortschrittsanzeige. Ein unterbrochener Lauf (etwa durch einen Neustart der App) bietet „Fortsetzen“.
  - Zusammenfassung: Familienverbände vorher und nachher, Zahl je Klasse, Zahl der ausgewählten Paare, Verbindungspersonen je Import-Paar. Ein Hinweis erklärt: Eine Verbindung, die als einzige zwei Familien verbindet, gilt nie als „sicher“.
  - Filter als Knöpfe mit `aria-pressed`: Verbindungspersonen, sicher, sehr wahrscheinlich, wahrscheinlich, unklar. Je Filter steht ein Erklärtext darunter.
  - Seiten zu je 50 Paaren. „Alle auf dieser Seite auswählen“ bzw. „abwählen“.
  - Je Paar: Kontrollkästchen, Klassen- und Brücken-Abzeichen, beide Personen als Links, Begründungssatz (`evidenceSentence`), Widersprüche, „Vergleich ansehen“ (öffnet `MergeView`) und „Kein Duplikat“.
  - „Gemeinsame Vorschau“: was umzieht, zusammenfällt oder blockiert ist, und eine Warnung, wenn danach mehr Personen für weitere Familien sichtbar werden.
  - „Jetzt zusammenführen“ mit Rückfrage. Danach Ergebnis und gegebenenfalls ein Knopf zum Folge-Abgleich.
  - Der Lauf-Bereich ist `aria-live="polite"`. Auf dem Telefon haben die Personen-Links größere Tippziele.
- **Server oder Client:** Client.
- **Ruft auf:**
  - `GET` und `POST /api/connect` (Gruppen und Läufe laden bzw. Abgleich starten)
  - `GET /api/connect/[id]` (Lauf laden, mit Filter und Seite)
  - `POST /api/connect/[id]` mit Aktion `decide`, `preview` oder `apply`
- **Tests:** `e2e/write/connect.spec.ts` (Start, Zusammenfassung, Vorschau, Anwenden, Folge-Abgleich). Die Logik prüfen `tests/import-linking.test.ts` und `tests/import-linking.db.test.ts`. Das Fortsetzen eines unterbrochenen Laufs (`connect-interrupted`) ist in e2e nicht abgedeckt.

### components/DuplicateBanner.tsx

- **Zweck:** Hinweis oben auf der Personenseite auf mögliche Dubletten dieser Person. Führt selbst nichts zusammen.
- **Wo eingesetzt:** `app/people/[id]/page.tsx`.
- **Props:** `personId`; `duplicates` (Gesamtzahl und angezeigte Einträge aus `listDuplicatesOfPerson`; wer was sehen darf, entscheidet der Dienst).
- **Verhalten:**
  - Gibt es keine Dubletten, erscheint nichts.
  - Je Kandidat: Name (mit Geburtsname), Lebensdaten, Herkunft, Sicherheitsstufe und der Link „Vergleichen“. Der Link öffnet die Vergleichsseite für genau dieses Paar; der Screenreader hört dazu den Namen.
  - Gibt es mehr Kandidaten als angezeigt, verweist der Hinweis auf „Mögliche Dubletten“.
  - Ausgezeichnet als `<aside>` mit Überschrift.
  - Rechts neben der Überschrift Kontexthilfe „Was bedeuten „sicher“ und „wahrscheinlich“?“ (Ziel aus `HELP_LINKS.dublettenKlassen`); in der Schriftfarbe des Hinweises statt der Akzentfarbe, wegen des Kontrasts auf dem Messing-Hintergrund.
- **Server oder Client:** Server (kein `"use client"`).
- **Ruft auf:** nichts. Nur Links.
- **Tests:** `e2e/read/duplicate-banner.spec.ts` und `e2e/write/duplicate-banner.spec.ts`. Den Dienst prüft `tests/person-duplicates.db.test.ts`.

### components/DuplicateList.tsx

- **Zweck:** Liste möglicher Dubletten mit Aktionen: Zusammenführen über den Vergleich, „Kein Duplikat“ und Sammel-Zusammenführen für die Klasse „sicher“.
- **Wo eingesetzt:** `app/research/duplicates/page.tsx` (mit Leertext) und `app/research/page.tsx` (Vorschau auf der Recherche-Übersicht).
- **Props:** `items` (Kandidaten mit Klasse, Ähnlichkeit, Gründen, Widersprüchen und `canMerge`), `emptyText` (optional).
- **Verhalten:**
  - Je Paar: Abzeichen für Klasse und Ähnlichkeit in Prozent, gegebenenfalls „zwei Importe“; beide Personen als Links; Gründe und Widersprüche.
  - Darf der Benutzer zusammenführen: „Zusammenführen …“ (Link zum Vergleich) und „Kein Duplikat“. „Kein Duplikat“ blendet das Paar dauerhaft aus und lädt die Seite neu.
  - Nur sichere, zusammenführbare Paare haben ein Kontrollkästchen. Darüber stehen „Alle sicheren auf dieser Seite auswählen“ und „Ausgewählte zusammenführen …“.
  - Die gemeinsame Vorschau nennt je Paar „bleibt / geht darin auf“ und den Zustand: bereit, erst nach den Eltern oder blockiert. Übersprungene Paare und die Summen (umziehende Beziehungen, Ereignisse, Belege, Bilder, zusätzliche Familienzugehörigkeiten) stehen dabei.
  - Es folgt keine weitere Rückfrage. Der Knopf „N Paare zusammenführen“ ist die Bestätigung.
  - Das Ergebnis steht in einer Erfolgszeile (`role="status"`). Fehler haben `role="alert"`.
- **Server oder Client:** Client.
- **Ruft auf:** `POST /api/duplicates/dismiss` („Kein Duplikat“); `POST /api/persons/merge/bulk`, erst mit `dryRun` für die Vorschau, dann zum Ausführen.
- **Tests:** `e2e/write/merge.spec.ts` (`dup-item`, `dup-merge`, `dup-dismiss`, Sammel-Zusammenführen). Die Logik prüfen `tests/duplicates.test.ts`, `tests/merge.db.test.ts` und `tests/merge-rules.test.ts`.

### components/MergeView.tsx

- **Zweck:** Vergleich zweier Personen vor dem Zusammenführen. Beide Seiten stehen nebeneinander, Abweichungen sind markiert und je Feld wählbar. Darunter steht in ganzen Sätzen, was geschieht.
- **Wo eingesetzt:** `app/people/merge/page.tsx`. Die Seite setzt `key` aus beiden IDs, sodass ein neues Paar neu aufgebaut wird.
- **Props:** `keepId` (bleibt), `otherId` (geht darin auf).
- **Verhalten:**
  - Jede Änderung einer Wahl holt die Vorschau neu vom Server. Eine Laufnummer verwirft verspätete Antworten.
  - Personenkarten „Bleibt“ und „Geht darin auf“ mit Lebensdaten, Eltern, Partnern, Kindern, Familien, Importen und Zählern.
  - „⇄ Seiten tauschen“ ersetzt die URL; es wird kein innerer Zustand getauscht.
  - Blockaden stehen in einer Fehlerbox (`role="alert"`), gegebenenfalls mit Links zum Zusammenführen der Eltern zuerst.
  - „Erst die Eltern, dann dieses Paar zusammenführen …“ erscheint in der Fehlerbox nur, wenn nichts anderes im Weg steht als doppelt erfasste Eltern, die sich alle zuordnen lassen (`resolvable` der Sperre). Der Knopf holt die Vorschau jedes Elternpaars und zeigt sie: wer bleibt, wer darin aufgeht, was dabei geschieht, Link „Einzeln vergleichen“. Erst „Eltern und dieses Paar zusammenführen“ (mit Rückfrage) führt aus — in einem Aufruf, mit dem Stand aller Vorschauen. Jede neue Vorschau des Paars schließt den Abschnitt wieder.
  - „Angaben einzeln ansehen und wählen“ ist ein eigens gesteuertes `<details>`. Je Feld gibt es Optionsfelder (bleibt, andere, gegebenenfalls „beide behalten“) und eine Begründung. Abweichende Felder sind farbig hinterlegt und für Screenreader als „weicht ab“ gekennzeichnet.
  - Für Beziehungen, die beide Personen haben, wählt man die Art (leiblich, Adoption usw.).
  - „Zusammenführen“ mit Rückfrage. Der Server bekommt den Token der Vorschau mit. Bei 409 (zwischenzeitlich geändert) wird die Vorschau neu geladen.
  - Das Ergebnis zeigt Sätze und Links „Zur Person“ und „Weitere Dubletten prüfen“, nach „Erst die Eltern“ auch die dabei zusammengeführten Elternteile, und darunter `FollowUpDuplicates` für die bleibende Person (und diese Elternteile).
  - Auf dem Telefon stehen die Spalten untereinander; die Seitenbeschriftung „Bleibt“ bzw. „Andere“ erscheint dann sichtbar.
  - Der Bereich trägt `aria-busy`, solange geladen wird.
- **Server oder Client:** Client.
- **Ruft auf:** `POST /api/persons/merge/preview` (auch je Elternpaar), `POST /api/persons/merge` (gegebenenfalls mit `parentsFirst`).
- **Tests:** `e2e/write/merge.spec.ts` (Tauschen, Felder, Blockaden mit Eltern-Link, Ausführen); `e2e/write/merge-comfort.spec.ts` (Eltern zuerst, Folgedubletten); `e2e/read/duplicate-banner.spec.ts` und `e2e/write/duplicate-banner.spec.ts` (Weg vom Hinweis zum Vergleich). Die Logik prüfen `tests/merge.db.test.ts` und `tests/merge-rules.test.ts`.

### components/MergeDialog.tsx

- **Zweck:** Knopf „Zusammenführen …“ im Kopf der Personenseite mit Dialog: zuerst die möglichen Dubletten dieser Person, darunter die freie Personensuche.
- **Wo eingesetzt:** `app/people/[id]/page.tsx`, neben „Im Stammbaum zeigen“; nur für Bearbeiter.
- **Props:** `personId` (bleibt), `personName`, `people` (Auswahlliste für `PersonPicker`).
- **Verhalten:**
  - Echtes `<dialog>` (`showModal`): Fokus bleibt im Dialog, Escape und ein Klick auf den Hintergrund schließen, danach kehrt der Fokus zum Knopf zurück.
  - Die Kandidaten werden erst beim Öffnen geladen: Name, Lebensdaten, Herkunft, Klasse (alle drei, auch „unklar“), Begründungssatz, Widersprüche und „Vergleichen“. Eingetragene Vorfahren und Nachkommen sind nie darunter (Regel des Dienstes); ohne Kandidaten steht das dort.
  - Darunter `PersonPicker` mit „Vergleichen“ (erst aktiv, wenn eine Person gewählt ist).
  - Der Dialog führt selbst nichts zusammen: Jede Wahl öffnet `/people/merge?keep=<diese>&other=…`; dort lassen sich die Seiten tauschen.
  - Der Dialog steht oben statt mittig und schneidet nicht ab, damit die Vorschlagsliste der Suche über seinen Rand hinaus aufklappen kann.
- **Server oder Client:** Client.
- **Ruft auf:** `GET /api/persons/[id]/duplicates`.
- **Tests:** `e2e/write/merge-comfort.spec.ts` (Kandidaten, Suche, Escape, ohne Kandidaten), `e2e/write/merge.spec.ts` (`merge-open`, `merge-compare`; Betrachter ohne Knopf).

### components/FollowUpDuplicates.tsx

- **Zweck:** Folgedubletten auf der Ergebnisseite nach einem Zusammenführen: Eltern, Partner und Kinder der bleibenden Person, die jetzt selbst doppelt aussehen.
- **Wo eingesetzt:** `components/MergeView.tsx` (Ergebnis).
- **Props:** `personIds` (bleibende Person, gegebenenfalls dazu die im selben Schritt zusammengeführten Elternteile).
- **Verhalten:**
  - Ohne Folgedubletten erscheint der Abschnitt gar nicht.
  - Je Paar: Klasse, beide Personen mit Lebensdaten als Links, über wen gefunden („Beide als Eltern von …“), Begründungssatz, Widersprüche, „Vergleichen“ (öffnet den Vergleich dieses Paars).
  - Nichts ist angekreuzt oder vorausgewählt. Gibt es „sichere“ Paare: „Alle sicheren Folgedubletten zusammenführen … (N)“ zeigt zuerst die gemeinsame Vorschau des Sammel-Zusammenführens; erst deren Knopf führt aus. „Wahrscheinlich“ und „unklar“ gehen nie mit.
  - Danach wird neu gesucht — auch bei den dabei bleibenden Personen, deren Eltern nun ebenfalls doppelt sein können.
- **Server oder Client:** Client.
- **Ruft auf:** `GET /api/persons/merge/followups`; `POST /api/persons/merge/bulk` (erst `dryRun`, dann Ausführen).
- **Tests:** `e2e/write/merge-comfort.spec.ts`; Dienst: `tests/merge-followups.db.test.ts`.

### components/ChangeSetList.tsx

- **Zweck:** Übersicht der Änderungspakete. Jede Zeile lässt sich bis zum einzelnen Feld aufklappen.
- **Wo eingesetzt:** `app/admin/changes/page.tsx`.
- **Exporte / Props:**
  - `ChangeSetList({ sets, filterQuery })`: `sets` sind Pakete mit einem auf dem Server vorformatierten Zeitpunkt `lastText`, damit die Ausgabe beim Hydrieren gleich bleibt. `filterQuery` ist der Suchteil der aktiven Filter.
  - Typ `ChangeSetRowData`.
- **Verhalten:**
  - Je Paket: Titel, Zeitpunkt (`<time>`), Benutzer, Kanal-Abzeichen, Zusammenfassung bzw. Zahl der Änderungen.
  - „Einzelheiten“ (`aria-expanded`, `aria-controls`) lädt die Einträge beim ersten Öffnen nach, seitenweise per Cursor („Weitere Einträge laden“). Die Einträge zeigt `ChangeEntryList`.
  - Der Knopf trägt für Screenreader den Pakettitel. Lange Titel brechen um.
- **Server oder Client:** Client.
- **Ruft auf:** `GET /api/changes/[key]`, mit den Filtern und gegebenenfalls `cursor`.
- **Tests:** `e2e/write/changelog.spec.ts`. Die Paketbildung prüfen `tests/changelog.test.ts` und `tests/changelog.db.test.ts`.

### components/ChangeEntryList.tsx

- **Zweck:** Darstellung einzelner Einträge des Änderungsverlaufs: Zeitpunkt, Benutzer, Kanal, Paket, Beschreibung, Notiz und je Feld vorher → nachher.
- **Wo eingesetzt:** in `ChangeSetList` (Admin-Übersicht) und `PersonChanges` (Verlauf auf der Personenseite). Keine Seite importiert die Datei direkt.
- **Exporte / Props:**
  - `ChangeEntryList({ entries, showChangeSet = true })`. In der Paketübersicht wird der Pakettitel ausgeblendet.
  - `ChannelBadge({ channel, tokenName })` zeigt „App“ oder „KI über MCP“, gegebenenfalls mit Schlüsselname.
- **Verhalten:**
  - Werte als Definitionsliste. Der alte Wert ist durchgestrichen (`<del>`), der neue eingefügt (`<ins>`). Für Screenreader stehen „vorher:“ und „nachher:“ dabei; der Pfeil ist ausgeblendet.
  - Beim Anlegen erscheint nur der neue Wert, beim Löschen nur der alte. Fehlt der alte Wert, steht der Hinweis „vorheriger Wert nicht erfasst“. Leere Werte erscheinen als „leer“.
  - Lange Werte brechen um; auf dem Telefon gibt es keinen waagerechten Überlauf.
- **Server oder Client:** Client (`"use client"`; enthält aber keine Zustände oder Effekte).
- **Ruft auf:** nichts. Die Zeit formatiert `formatChangeTime`.
- **Tests:** `e2e/write/changelog.spec.ts` (`change-entry`, Kanal „KI über MCP“).

## Verwaltung und KI-Zugang

### components/UserAdmin.tsx

- **Zweck:** Benutzerverwaltung: einladen, Rolle und Status ändern, löschen, E-Mail korrigieren, Bezugsperson zuordnen, KI-Zugang vergeben und Schlüssel anderer Benutzer einsehen bzw. widerrufen.
- **Wo eingesetzt:** `app/admin/users/page.tsx`. Laut Navigation im Layout nur mit Recht `user:manage` erreichbar.
- **Props:**
  - `users`: Zeilen mit E-Mail, Name, Rolle, Status, letzter Anmeldung, KI-Recht und Zahl aktiver Schlüssel. Dazu Zahl der Familienzuordnungen, `neverSignedIn`, `lastAdmin` und eigene Person.
  - `currentUserId`.
  - `people` (Auswahl für den `PersonPicker`).
- **Verhalten:**
  - **Einladen:** E-Mail und Rolle (Betrachter, Bearbeiter, Administrator).
  - **Rolle:** per Auswahlfeld, das sofort speichert. Beim eigenen Zugang ist es gesperrt.
  - **Sperren und Entsperren:** Sperren fragt nach.
  - **Löschen:** Die Rückfrage zählt auf, was mitgelöscht wird (Familienzuordnungen, KI-Schlüssel, Sitzungen und verknüpfte Konten) und was ohne Verweis bleibt. Für den eigenen Zugang und den letzten aktiven Admin ist Löschen gesperrt; ein sichtbarer Grund ist mit `aria-describedby` verbunden.
  - **E-Mail ändern:** nur, solange sich der Benutzer nie angemeldet hat. Öffnet eine Formularzeile.
  - **Person zuordnen, ändern oder aufheben:** setzt die Bezugsperson für den Verwandtschaftsgrad.
  - **KI-Zugang:** Auswahl „kein Zugang“, „lesen“ oder „lesen und schreiben“. Entziehen fragt nach und nennt dabei die Zahl der betroffenen Schlüssel. Die Erfolgsmeldung erklärt, wie ein Herabsetzen auf vorhandene Schlüssel wirkt.
  - **„Schlüssel: N aktiv“** klappt die Schlüssel des Benutzers auf; dort lassen sie sich widerrufen (mit Rückfrage). Die Liste wird nach Änderungen neu geladen.
  - Meldungen stehen in einem `aria-live`-Bereich. Jede Aktion sperrt alle Knöpfe, bis sie fertig ist.
  - Auf dem Telefon wird jede Tabellenzeile zum Block mit vorangestellten Beschriftungen (per CSS-`content`). Die Formularzeilen sind `sticky`, damit sie im sichtbaren Teil bleiben.
- **Server oder Client:** Client.
- **Ruft auf:**
  - `POST /api/users` (einladen)
  - `PATCH /api/users/[id]` (Rolle, Status, E-Mail, `personId`)
  - `DELETE /api/users/[id]` (löschen)
  - `PUT /api/users/[id]/ai-access` (KI-Zugang)
  - `GET /api/ai-tokens?all=1&userId=…` (Schlüssel eines Benutzers)
  - `DELETE /api/ai-tokens/[id]` (Schlüssel widerrufen)
- **Tests:** `e2e/write/admin.spec.ts` (einladen, Rolle, sperren, löschen, E-Mail korrigieren, `user-delete-why`); `e2e/write/ai-access.spec.ts` (KI-Recht, Schlüsselliste); `e2e/write/reference.spec.ts` (Person zuordnen); `e2e/read/mobile.spec.ts` (Telefonbreite).

**Ergänzung (22.11.):** In der aufgeklappten Schlüsselliste eines Benutzers Verlauf-Schalter (ein gemeinsamer für alle Listen, `?verlauf=1`) und „löschen“ mit Rückfrage „… von <E-Mail> endgültig löschen?“; danach wird die Liste neu geladen.

### components/FamilyAdmin.tsx

- **Zweck:** Familien anlegen und löschen; Zugriffsrechte je Benutzer und Familie festlegen.
- **Wo eingesetzt:** `app/admin/families/page.tsx`. Laut Navigation nur mit Recht `family:manage`.
- **Props:** `families` (mit Zahl der Personen und Mitglieder), `users` (mit Admin-Kennzeichen und Rolle je Familie), `unassignedPersons`.
- **Verhalten:**
  - Gibt es Personen ohne Familie, erscheint eine Warnung mit Link zur Recherche. Der Link ist ein einfaches `<a>`, kein `Link`.
  - Familie anlegen über ein Formular mit Pflichtname.
  - Löschen fragt nach. Hängen Personen oder Benutzer an der Familie, warnt die Rückfrage, dass Personen ohne Familie dann nur noch für Administratoren sichtbar sind. Gelöscht wird immer mit `force=true`.
  - Rechtematrix Benutzer × Familie mit den Werten „kein Zugriff“, „lesen“ und „bearbeiten“. Bei Administratoren ist das Feld gesperrt und zeigt „alles (Admin)“. Jede Änderung speichert sofort.
  - Auf dem Telefon wird je Benutzer ein Block mit zwei Spalten gebildet, beschriftet über `data-label`.
  - Meldungen stehen in einem `aria-live`-Bereich. Die Auswahlfelder haben sprechende `aria-label`.
- **Server oder Client:** Client.
- **Ruft auf:** `POST /api/families`, `DELETE /api/families/[id]?force=true`, `POST /api/families/[id]/members`. Die JSON-Inhalte werden hier von Hand gebaut, nicht über `jsonBody`.
- **Tests:** `e2e/write/admin.spec.ts` (anlegen, Zugriff setzen, löschen); `e2e/read/permissions.spec.ts`; `e2e/read/navigation.spec.ts`; `e2e/read/mobile.spec.ts`. `e2e/global.setup.ts` und `e2e/write/gedcom-import.spec.ts` nutzen die Seite für ihre Vorbereitung bzw. Aufräumarbeit.

### components/PlaceAdmin.tsx

- **Zweck:** Freitext-Ortsangaben Koordinaten zuordnen, für die Karte.
- **Wo eingesetzt:** `app/admin/places/page.tsx`. Diese Seite liefert Filter, Suche und Seiten selbst. Verlinkt ist sie von `/admin/data` (bei Recht `place:manage`) und von `/map`; in der Navigation steht sie nicht. Die Datei selbst exportiert keine Komponente namens `PlaceAdmin`.
- **Exporte:**
  - `PlaceAutoAssign({ open })`: Knopf „Automatisch zuordnen“ (für den Altbestand — neue Texte ordnet das Speichern selbst zu) mit der Zahl offener Ortstexte. Das Ergebnis (neu, geändert, entfernt, ohne Treffer, von Hand bestätigt, von KI) steht in einer Statuszeile.
  - `PlaceTable({ rows })`: Liste der Ortstexte. Ist sie leer, erscheint ein Hinweis.
- **Verhalten:**
  - **Je Zeile:** Text, weitere Schreibweisen, Häufigkeit, Status (offen, automatisch, von KI, bestätigt, nicht zuordenbar); KI-Zuordnungen mit eigenem Abzeichen, ggf. „unsicher“ und „Begründung der KI: …“ (`note`; nach dem Bestätigen „Notiz: …“), eine KI-Markierung „nicht zuordenbar“ als Satz. Dazu die aktuelle Zuordnung (Bezeichnung, Genauigkeit, Koordinaten) und ein Vorschlag aus dem Ortsverzeichnis, gegebenenfalls mit dem Teil des Texts, der getroffen hat, und der Warnung „mehrdeutig“.
  - **Aktionen:** Bestätigen (automatisch bei gleichem Vorschlag; „von KI“ immer — wird `MANUAL`), Vorschlag übernehmen bzw. Anderen Ort wählen (ändern), Nicht zuordenbar, Zurücksetzen (auch für KI-Zuordnungen).
  - **Anderen Ort wählen:** öffnet einen Editor.
    - Suche im Ortsverzeichnis, verzögert um 250 ms; ältere Anfragen werden abgebrochen. Vorbelegt ist der erste Teil des Texts ohne Klammern.
    - Alternativ Koordinaten mit Genauigkeit und Bezeichnung. Prüfung im Browser: Breite −90 bis 90, Länge −180 bis 180; ein Komma als Dezimalzeichen ist erlaubt.
  - Nach jeder Aktion wird die Seite neu geladen (`useTransition`). Bis sie fertig ist, bleiben die Knöpfe gesperrt, damit keine Aktion eine noch laufende Aktualisierung überholt.
  - Auf dem Telefon sind die Trefferknöpfe höher. Fehler haben `role="alert"`.
- **Server oder Client:** Client.
- **Ruft auf:**
  - `POST /api/places/auto` (automatisch zuordnen)
  - `PUT /api/places` mit Aktion `confirm`, `directory`, `coordinates`, `unresolvable` oder `reset`
  - `GET /api/places/search` (direkt mit `fetch`, nicht über `apiFetch`; Fehler werden still verschluckt)
- **Tests:** `e2e/write/places.spec.ts` (automatisch zuordnen, Editor, Koordinaten, Status); `e2e/read/map.spec.ts` (Link von der Karte). Die Logik prüfen `tests/places.test.ts` und `tests/map.db.test.ts`.

### components/PlaceText.tsx

- **Zweck:** Ortsangabe als Freitext der Person, bei zugeordnetem Ort als Link auf die Ortsseite (Titel = Anzeigename) und — wenn der Ort anders heißt — dezent „→ Wrocław, Polen“. Ohne Zuordnung reiner Text.
- **Wo eingesetzt:** Personenseite (Geburt, Tod, Orte der Partnerschaften), `EventSection` (Ort je Ereignis).
- **Props:** `text`, `links` (aus `placeLinksFor`, Schlüssel `placeKey`). Ohne Hooks, für Server- und Client-Komponenten.

### components/PlaceMiniMap.tsx

- **Zweck:** Kleine Lagekarte der Ortsseite: Ländergrenzen aus `public/geo/countries.json` (wie die große Karte, kein fremder Server), Punkt an den Koordinaten, `role="img"`.
- **Server oder Client:** Client.

### components/PlaceHint.tsx

- **Zweck:** Dezenter Hinweis unter einem Ortsfeld, welcher Ort beim Tippen erkannt wird: „→ Wrocław (Breslau), Polen · früherer bzw. deutscher Name: Breslau“, mit „(nur Region)“/„(nur Land)“, „eigener Ort“, „anderer Name: …“, Abzeichen „mehrdeutig“ oder „Ort nicht gefunden“. Der eingegebene Text bleibt unverändert — reine Anzeige.
- **Wo eingesetzt:** `PersonForm` (Geburts- und Sterbeort), `EventSection` (Ort im Ereignisformular), `RelationshipEditor` (Orte von Beginn/Ende beim Anlegen und Korrigieren einer Beziehung).
- **Props:** `text` (aktueller Feldinhalt), optional `id`; `chosen` und `onChoose` für die **Auswahl echter Orte**: „Ort wählen …“ lädt Kandidaten (`?candidates=1`: Verzeichnis und eigene Orte) zum Anklicken; die Wahl (`PlaceChoice`, gebunden an den Text — ändert er sich, verfällt sie) zeigt „→ … · ausgewählt“ mit „Auswahl aufheben“. `savePlaceChoices(target, choices)` speichert sie nach dem Speichern des Eintrags (`POST /api/places/choose`) und liefert Meldungen zurück (z.B. bereits von Hand anders zugeordnet). Wer nichts wählt, bekommt die automatische Zuordnung.
- **Verhalten:** ab 2 Zeichen, entprellt um 350 ms, ältere Anfragen werden abgebrochen; ein veralteter Hinweis wird nicht gezeigt. Das erste Ortsfeld einer Seite lädt das Ortsverzeichnis vorab (`GET /api/places/suggest` ohne `q`). Bei 403 (kein Bearbeitungsrecht) oder Netzfehler kein Hinweis. `aria-live="polite"`.
- **Server oder Client:** Client.
- **Ruft auf:** `GET /api/places/suggest` (direkt mit `fetch`).
- **Tests:** `tests/places-ai.db.test.ts` (Dienst und Route); `e2e/write/places.spec.ts` (Hinweis im Formular).

### components/AiAccessManager.tsx

- **Zweck:** Seite „KI-Zugang“ für den eigenen Benutzer: eigene Stufe ansehen, persönliche Schlüssel anlegen und widerrufen, Verbindungsdaten kopieren.
- **Wo eingesetzt:** `app/ai-access/page.tsx`. Die Seite ist laut Layout-Kommentar für jeden erreichbar, steht aber nur bei Bedarf in der Navigation.
- **Props:**
  - `info`: eigene Stufe, Zahl aktiver Schlüssel, Höchstzahl sowie Standard- und Höchstgültigkeit in Tagen.
  - `tokens`: eigene Schlüssel als `TokenRow`.
- **Verhalten:**
  - **Stufe:** Überschrift mit der eigenen Stufe und einem Erklärtext je Stufe. Ohne Zugang gibt es kein Anlegen-Formular.
  - **Anlegen:**
    - Felder Name (höchstens 80 Zeichen), Stufe und Gültigkeit in Tagen.
    - „lesen und schreiben“ ist deaktiviert, wenn das eigene Recht nur Lesen erlaubt.
    - Prüfung zuerst im Browser, Fehler stehen am Feld (`aria-invalid`, `aria-describedby`). Fehler des Servers werden über `fields` ebenfalls am Feld angezeigt.
    - Ist die Höchstzahl erreicht, erscheint ein Hinweis statt des Formulars. Ab höchstens 3 verbleibenden Schlüsseln steht ein Hinweis darunter.
  - **Neuer Schlüssel:**
    - Das Geheimnis lebt nur im Komponentenzustand, nicht in der URL, nicht im Speicher des Browsers und nicht im Server-HTML.
    - Ein Panel bekommt den Fokus und zeigt Kopierfelder für Schlüssel, MCP-Adresse (aus dem eigenen Origin, nur im Browser ermittelt), HTTP-Header und den Beispielbefehl für Claude Code.
    - „Fertig — Schlüssel ausblenden“ verwirft das Geheimnis. Wird der gerade angelegte Schlüssel widerrufen, verschwindet es ebenfalls.
  - **Kopierfelder:** Kopieren in die Zwischenablage. Geht das nicht, wird der Text markiert, mit dem Hinweis auf Strg+C. Die Rückmeldung ist `aria-live`.
  - **Liste:** Die eigenen Schlüssel zeigt `ApiTokenList` (Du-Form), Widerrufen mit Rückfrage. Ist die Liste leer, erscheint ein Leerzustand.
- **Server oder Client:** Client.
- **Ruft auf:** `POST /api/ai-tokens`, `DELETE /api/ai-tokens/[id]`.
- **Tests:** `e2e/write/ai-access.spec.ts` (Info, Anlegen, `ai-secret`, Limit, Widerrufen, wirksame Stufe). Serverregeln: `tests/ai-access.test.ts`, `tests/ai-access.db.test.ts`, `tests/mcp-http.db.test.ts`. Die Kopierknöpfe testet kein Test.

**Ergänzung (22.11.):** Eigene Schlüssel löschen (`DELETE …?endgueltig=1`, Rückfrage, Meldung „Schlüssel „…“ gelöscht.“); nach einem Widerruf Hinweis „Er steht jetzt im ausgeblendeten Verlauf.“, solange der Verlauf aus ist. Die Seite reicht `?verlauf=1` als `initialShowHistory` durch.

### components/AiConnectGuide.tsx

- **Zweck:** Schritt-für-Schritt-Anleitungen, wie man Claude mit dem Stammbaum verbindet:
  - Handy, Browser und Claude Desktop über einen „Custom Connector“ mit OAuth-Gateway; dort trägt man seinen persönlichen Schlüssel auf einer Anmeldeseite ein.
  - Claude Code direkt über den HTTP-Header.
- **Wo eingesetzt:** `app/ai-access/page.tsx`, unter `AiAccessManager`.
- **Exporte / Props:**
  - `AiConnectGuide({ connectorUrl, canUse })`: `connectorUrl` ist die öffentliche Adresse des Gateways oder `null`. `canUse` sagt, ob der Benutzer ein KI-Recht hat; ohne Recht erscheint ein Vorab-Hinweis.
  - `connectorUrlFromEnv(value)`: liest `MCP_CONNECTOR_URL` und übernimmt nur http(s)-Adressen. Bei leerem oder ungültigem Wert ergibt sie `null`.
- **Verhalten:**
  - Drei `<details>`-Abschnitte: Handy (anfangs offen), Browser und Desktop, Claude Code.
  - Dazwischen der feste Block „So meldet sich die KI an“ (`ai-guide-auth`): Anmeldung über die API mit HTTP-Header `Authorization`, Wert `Bearer <Schlüssel>` (Wort „Bearer“, Leerzeichen, Schlüssel); Hinweise, dass Anführungszeichen oder ein Schlüssel in der URL abgelehnt werden (entspricht `bearerToken` in `mcp/http.ts`). Schritt 5 der Handy-Anleitung verweist darauf, falls die Anmeldeseite nach einem Header fragt.
  - Ohne Adresse nennt die Anleitung den Administrator als Ansprechpartner. Die Adresse steht nie fest im Repository.
  - Auf dem Telefon sind die Zusammenfassungszeilen höher.
- **Server oder Client:** Server (kein `"use client"`); reine Darstellung.
- **Ruft auf:** nichts.
- **Tests:** `tests/ai-connect-guide.test.ts` (`connectorUrlFromEnv`); `e2e/read/mobile.spec.ts` (Anleitung auf Telefonbreite, Fall ohne Adresse). Den Fall mit hinterlegter Adresse (`ai-connector-url`) prüft kein e2e-Test.

### components/ApiTokenList.tsx

- **Zweck:** Liste von KI-Schlüsseln mit Name, erkennbarem Anfang, Stufe, wirksamer Stufe, Status und Daten. Aktive Schlüssel lassen sich widerrufen; die Rückfrage stellt der Aufrufer.
- **Wo eingesetzt:** `AiAccessManager` (eigene Schlüssel) und `UserAdmin` (Schlüssel eines Benutzers). Nicht direkt auf einer Seite.
- **Props:**
  - `tokens`.
  - `userAccess`: aktuelles KI-Recht des Besitzers; daraus ergibt sich die wirksame Stufe.
  - `busy`, `onRevoke`.
  - `label`: zugänglicher Name der Liste.
  - `own`: Hinweise in der Du-Form statt „der Benutzer“.
- **Verhalten:**
  - Liegt die wirksame Stufe eines aktiven Schlüssels unter seiner eigenen Stufe, steht ein Hinweis dabei: „wirkt derzeit nicht“ bzw. „wirkt derzeit nur: lesen“.
  - Daten: angelegt, zuletzt benutzt, widerrufen bzw. läuft ab oder abgelaufen.
  - Der Knopf „widerrufen“ erscheint nur bei aktiven Schlüsseln und hat ein sprechendes `aria-label`.
  - Auf dem Telefon stehen die Daten als zweispaltiges Raster, ab `sm` in einer Zeile.
- **Server oder Client:** Client (`"use client"`; enthält keine Zustände).
- **Ruft auf:** nichts selbst.
- **Tests:** `e2e/write/ai-access.spec.ts` (`ai-token-list`, `ai-token`, `ai-token-status`, `ai-token-prefix`, `ai-token-effective`).

**Verlauf und Löschen (seit 22.11.):** Aktive Schlüssel immer sichtbar; widerrufene/abgelaufene (Verlauf) standardmäßig ausgeblendet mit Zähler „N ausgeblendet“; Kontrollkästchen „Widerrufene und abgelaufene anzeigen (Verlauf)“ blendet sie als eigene Liste „Verlauf: …“ ein („N im Verlauf“). Knöpfe „widerrufen“ (aktiv) und „löschen“ (wenn `canDeleteToken`); Rückfragen stellt der Aufrufer (`onRevoke`, `onDelete`). `useHistoryToggle(initial)` hält den Zustand und schreibt `?verlauf=1` per `history.replaceState`; den Anfangswert liest die Seite serverseitig (`HISTORY_PARAM` aus `ai-access-labels.ts`, nicht aus der Client-Datei importieren). Telefon: Schalter und Knöpfe ≥ 44 px. Tests: `e2e/write/ai-access.spec.ts`.
