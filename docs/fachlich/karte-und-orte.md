# Karte und Orte

**Karte „Wurzeln nach Jahr“** (`/map`, Menüpunkt „Karte“): Wo lebten die
Vorfahren in einem bestimmten Jahr? Eine eigene Welt-/Europakarte mit
Jahresregler und „Abspielen“; je Ort ein Kreis, dessen Fläche mit der Zahl
der Personen wächst, eingefärbt nach den vier Großeltern-Linien der
[Bezugsperson](bezugsperson.md) (gleiche Farben und Kurzzeichen VV/VM/MV/MM wie
im Baum, zusätzlich ein Muster je Linie; gemischte Orte als Tortenstücke). Ein
Klick auf einen Kreis listet die Personen mit Link zur Personenseite.

- **Ausgangsperson** — ohne Angabe die Bezugsperson (Adresse vor Cookie
  `tree-bezug` vor „das bin ich“), sonst „Andere Person …“ (`?person=<id>`;
  ändert die Bezugsperson des Baums nicht). **Auswahl** „Vorfahren“
  (Standard, samt Ausgangsperson) oder „Alle sichtbaren Personen“
  (`?mode=vorfahren|alle`; ohne Ausgangsperson „alle“, dann ohne Linien).
  `?jahr=` gibt das Jahr vor; beim Verstellen schreibt die Seite es in die
  Adresse, ohne neu zu laden.
- **Lebend** im Jahr J: Beginn ≤ J ≤ Ende. Beginn = Geburtsjahr, sonst das
  früheste datierte Ereignis (Taufe — auch ohne Ort —, Heirat …). Ende = Todesjahr, sonst das
  Jahr der Beerdigung/Einäscherung, sonst geschätzt: Beginn + 100 Jahre
  (mindestens das letzte datierte Ereignis, höchstens das laufende Jahr).
  Personen ganz ohne Datum stehen nur in der Zahl „ohne Lebensdaten“.
- **Ort** im Jahr J: der zuletzt bekannte bis einschließlich J — Geburt,
  Ereignisse mit Ort und Datum (Wohnort, Volkszählung, Beruf, Auswanderung …),
  Heirat und Scheidung (Ort an der Beziehung, für beide Partner), Tod. Ein
  Geburtsort ohne Geburtsdatum gilt ab dem Beginn, andere Angaben ohne Datum
  zählen nicht, abweichende Zweitangaben auch nicht; im selben Jahr zählt die
  letzte Angabe. Vor der ersten Ortsangabe: „ohne bekannten Ort“ (Zähler,
  anklickbar). Ein Ortstext ohne Koordinaten zählt als „Ort, der nicht auf
  der Karte ist“ — er verdrängt einen früheren Ort.
- **Ungenaue Daten** zählen mit ihrem Jahr: „um 1850“, „vor 1850“, „nach
  1850“ als 1850, „zwischen 1850 und 1854“ als 1852, ein Zeitraum „von …
  bis …“ mit seinem Beginn. Orte, die nur als Region oder Land bekannt sind,
  stehen in deren Mitte (in der Personenliste vermerkt).
- **Zeitreise** — Zeitstrahl über die ganze Spanne (frühester Beginn bis
  spätestes Ende, höchstens das laufende Jahr) mit Balken „Lebende je Jahr“,
  Schiebefeld (Pfeile ±1, Bild-auf/-ab ±10, Pos1/Ende), Knöpfen ±1/±10,
  Feld „Gehe zu“ (auf die Spanne begrenzt) und „Abspielen“ mit
  Pause/Weiter und drei Tempi; bei „Bewegung reduzieren“ kein Abspielen,
  nur Schritte. Daneben die Liste **„Wer lebte J?“**: genau die Lebenden
  der Zählzeile, mit Alter, Ort (wie die Karte) und Link; nach Ort
  gruppiert (Standard), nach Name oder Alter; ein gewählter Kreis bzw. Ort
  filtert sie. **Alter** = J − Geburtsjahr, ersatzweise Taufjahr; „etwa“
  bei ungenauer Geburt (jeder Qualifier außer „genau“) oder nur Taufe;
  ohne beides „Alter unbekannt“. Zeile **„In diesem Jahr“**: Geburten
  (Geburts- bzw. Taufjahr = J), Hochzeiten (Ehe oder geschiedene Ehe mit
  Beginn in J, beide Partner sichtbar), Todesfälle (Todes- bzw.
  Beerdigungsjahr = J; ein geschätztes Ende zählt nicht), je Zahl und
  aufklappbare Namen. Alles rechnet der Browser aus denselben Daten
  (`lib/map/year.ts`), kein Abruf je Jahr.
- **Bedienung** — Ziehen verschiebt (auch mit dem Finger), Mausrad bzw. zwei
  Finger zoomen, Knöpfe „+“/„−“ und die Ausschnitte „Orte“ (alle Orte der
  Auswahl, Standard), „Europa“, „Welt“; auf der fokussierten Karte
  Pfeiltasten und +/−. Der Jahresregler ist ein normales Schiebefeld. Für
  Screenreader und Tastatur stehen dieselben Angaben in der Liste „Orte im
  Jahr …“ unter der Karte. Hinweis „heutige Grenzen“ auf der Karte.
- **Datenschutz** — gerechnet wird nur mit Personen, die der Benutzer sehen
  darf: Vorfahren und Linien auf dem Graphen der sichtbaren Personen
  (`visibleIndex`, wie bei der Bezugsperson), Ereignisse und Heiraten nur
  dieser Personen. Gesperrte erscheinen weder auf der Karte noch in einer
  Zahl (auch nicht in „Wer lebte“ und „In diesem Jahr“; eine Hochzeit nur
  mit beiden Partnern sichtbar); eine gesperrte `?person=` wird still ignoriert. Dieselben Daten
  liefert `GET /api/map?person=&mode=ancestors|all`.
- **Leistung** — der Server rechnet einmal je Ausgangsperson
  ([lib/services/map.ts](../../lib/services/map.ts),
  [lib/map/build.ts](../../lib/map/build.ts)), der Browser wechselt die Jahre
  selbst ([lib/map/year.ts](../../lib/map/year.ts)). Gemessen: Mock-Daten rund
  25 ms; mit 12 000 zusätzlichen Personen in der Mock-Datenbank 1,1–1,4 s
  auf dem Server (überwiegend das Laden des Graphen und der Ereignisse),
  1,4 MB Daten; ohne Datenbank 63 ms Aufbau und 0,6 ms je Jahr
  (`tests/map.test.ts`). Die Zeitreise ergänzt nur, wo nötig (Geburtsjahr
  fürs Alter bei ungenauer Geburt oder nur Taufe, Hochzeiten als flache
  Zahlenliste): im selben Test mit 6 000 Ehen rund 90 KB mehr; Liste und
  „In diesem Jahr“ unter 1 ms je Jahr.

**Lebensweg** (`/map?mode=lebensweg&person=<id>&art=person|vaterlinie|mutterlinie`,
eigene Betriebsart der Karte, Einstieg auch von der Personenseite): die Orte
eines Lebens bzw. einer Linie als Weg — nummerierte Punkte, Linie mit
Pfeilen, Beschriftung mit Jahr (bei Linien Name und Jahr), daneben die Liste
der Stationen; Liste und Karte wählen gegenseitig.

- **Person** — Stationen sind alle Angaben mit Ortstext: Geburt, Tod,
  Heirat/Scheidung bzw. Beginn/Ende einer Partnerschaft (Ort an der
  Beziehung), jedes Lebensereignis der Person und ihrer Partnerschaften
  (ohne Zweitangaben `isAlternative`). Reihenfolge: Geburt vorn; Tod, danach
  Beerdigung/Einäscherung/Testamentseröffnung hinten — auch ohne Datum;
  dazwischen nach dem Anker des Datums (wie [ungenaue Daten](ungenaue-daten.md)
  sortieren), bei gleichem Anker die genauere Angabe zuerst. Mittlere
  Stationen ohne Datum stehen unter „ohne Datum“ und gehören nicht zur Linie.
  Ungenaue Daten sind mit „(ungenau)“ beschriftet.
- **Vater-/Mutterlinie** — je Generation unter den leiblichen Eltern der
  sichtbare mit Geschlecht MALE bzw. FEMALE. Genau einer → weiter; mehrere
  oder (wenn keiner passt) ein sichtbarer mit unbekanntem/anderem Geschlecht
  → Ende „nicht eindeutig“; keiner passt, aber ein Elternteil ist nicht
  sichtbar → Ende „weiter hinauf nicht freigegeben“; sonst Ende „nicht
  erfasst“. Höchstens 12 Generationen. Station je Vorfahr: Geburtsort, sonst
  Taufort; Jahr der Geburt, sonst der Taufe. Älteste Generation zuerst.
- **Karte** — nur Stationen mit Ortszuordnung samt Koordinaten (Tabelle
  `Place`, „nicht zuordenbar“ und fehlende Zuordnung wie bei der Karte nicht
  gezeichnet, in der Liste „Ort nicht zugeordnet“ bzw. „nicht zuordenbar“;
  „unsicher“ gesetzte Zuordnungen gelten wie auf der Karte). Aufeinander
  folgende Stationen mit gleichen Koordinaten werden ein Punkt; liegt eine
  Station ohne Ort auf der Karte zwischen zwei Punkten, ist das Teilstück
  gestrichelt. Kehrt der Weg an einen früheren Ort zurück, zeichnet die
  Karte dort eine Marke mit allen Nummern („1–2, 5–6“).
- **Datenschutz** — Ausgangsperson nur, wenn sichtbar (sonst Bezugsperson).
  Heirat, Scheidung und Ereignisse einer Partnerschaft nur mit sichtbarem
  Partner (die Personenseite zeigt Ort und Datum der Ehe nur an der Karte
  eines sichtbaren Partners). Ein nicht sichtbarer Vorfahr beendet die
  Linie; Antwort und Seite verraten nur, dass sie dort endet — keine
  Kennung, kein Name, Geschlecht, Ort oder Jahr.
- **Leistung** — keine Abfrage je Station und nicht die Kartendaten „alle“:
  Person mit Partnerschaften, deren Ereignisse und die Ortszuordnungen in je
  einer Abfrage; Linien Generation für Generation eine Abfrage für beide
  Linien zugleich (höchstens 13), dann Taufen und Ortszuordnungen. Dieselben
  Daten liefert `GET /api/map?mode=lifepath&kind=person|father|mother&person=`.

**Orte zuordnen** (`/admin/places`, nur Administratoren; verlinkt auf der
Karte und unter „Daten“): Orte sind Freitext. Die Tabelle `Place` (Migration
`20261123000001_orte`) ordnet jedem normalisierten Ortstext (`placeKey`:
Groß-/Kleinschreibung und Leerzeichen vereinheitlicht) Koordinaten zu, mit
Herkunft (automatisch/von Hand), Genauigkeit (Ort/Region/Land) oder „nicht
zuordenbar“. Die Seite listet alle vorkommenden Ortstexte (Geburt, Tod,
Heirat, Scheidung, Ereignisse) mit Häufigkeit, Zuordnung und Vorschlag
(„mehrdeutig“, wenn es einen ähnlich großen gleichnamigen Ort anderswo gibt).
Von Hand: Vorschlag übernehmen bzw. bestätigen, im Verzeichnis suchen (auch
alte Namen), Koordinaten eingeben, „nicht zuordenbar“, zurücksetzen.
**Neue Ortstexte ordnet die App selbst zu** (Migration
`20261124000001_orte_ki`): nach dem Speichern einer Person, eines Ereignisses
oder einer Beziehung und nach GEDCOM- bzw. Austausch-Import, im Hintergrund —
das Speichern wartet nicht darauf und scheitert nie daran; nur Texte ohne
Zuordnung, ohne Treffer bleiben sie offen. Der Knopf **Automatisch zuordnen**
ordnet den Altbestand neu zu (alle Texte, die weder von Hand bestätigt noch
von der KI gesetzt sind); von Hand Bestätigtes wird nie überschrieben.
**Zuordnungen des KI-Assistenten** (MCP `assign_place`, siehe
[KI-Zugang](../betrieb/ki-zugang.md)) stehen als „von KI“ mit eigenem Filter, ggf.
„unsicher“ und der Begründung der KI; sie gelten sofort für die Karte, die
Automatik überschreibt sie nie, der Admin **bestätigt** sie (→ von Hand) oder
ändert sie. Mit eigenen Koordinaten angelegte Orte (Wüstung, Hof, Weiler)
sind **eigene Orte** und werden bei späteren Texten wieder vorgeschlagen.

**Ortsseiten** (`/places/<Kennung>`, für alle Angemeldeten): Jeder
zugeordnete Ort hat eine Seite mit heutigem Namen (früherer/deutscher Name),
Region, Land, Koordinaten und kleiner Lagekarte, Herkunft der Zuordnung
(Begründung nur für Admins), den Freitexten, die auf ihn zeigen, weiteren
Namen aus dem Verzeichnis und den Personen mit Angaben dort (Geburt, Tod,
Heirat, Scheidung, Ereignisse — mit Art und Jahr), 50 je Seite. Ein Ort sind
alle Zuordnungen mit demselben Verzeichniseintrag bzw. bei eigenen Orten
denselben Koordinaten. Es erscheinen nur Personen, die der Benutzer sehen
darf; Freitexte nur gesperrter Personen fehlen, ein Ort ohne sichtbare
Angabe gilt als nicht vorhanden. Auf der **Personenseite** wird jeder
zugeordnete Ort zum Link mit dem systematischen Namen („Karlsruhe,
Baden-Württemberg, Deutschland“, „Wrocław (Breslau), Polen“); der Freitext
steht im Titel und dezent daneben, wenn er mehr sagt als der Ortsname
(`textCoveredByLabel` in `components/PlaceText.tsx`).

**Echte Orte auswählen:** Unter jedem Ortsfeld öffnet „Ort wählen …“ die
Kandidaten (Verzeichnis und eigene Orte). Die Wahl wird nach dem Speichern
als Zuordnung „von Hand“ genau für diesen Freitext gespeichert
(`POST /api/places/choose`, für jeden, der den Eintrag bearbeiten darf);
der Text bleibt wie eingegeben. Ohne Auswahl ordnet die App automatisch zu.
Es gibt keinen Fremdschlüssel an Person oder Ereignis — die Verbindung läuft
über den normalisierten Ortstext. Eine von Hand bestätigte, andere
Zuordnung desselben Texts ändert nur ein Admin.

**Vorschlag am Ortsfeld:** Unter Geburts- und Sterbeort, dem Ort eines
Ereignisses und den Orten einer Ehe/Beziehung zeigt die App beim Tippen
dezent, welcher Ort erkannt wird — dieselbe Regel wie die automatische
Zuordnung: „→ Wrocław (Breslau), Polen · früherer bzw. deutscher Name:
Breslau“, „mehrdeutig“ (weitere Orte gleichen Namens — ein Zusatz wie Kreis
oder Land hilft) oder „Ort nicht gefunden“. Der eingegebene Text bleibt, wie
er ist. Für Administratoren und Bearbeiter (`GET /api/places/suggest?q=`,
nur Verzeichnisdaten und eigene Orte, nichts über Personen); das erste
Ortsfeld einer Seite lädt das Verzeichnis vorab (rund 0,9 s), danach dauert
ein Vorschlag wenige Millisekunden. Jede Änderung steht im
`AuditLog` (`entityType` „Place“, vorher → nachher), die automatische
Zuordnung als ein Paket „Orte automatisch zugeordnet“ (unter „Änderungen“).
Die Ortstexte sieht nur der Admin — sie enthalten auch Angaben gesperrter
Personen (`GET/PUT /api/places`, `POST /api/places/auto`,
`GET /api/places/search?q=`, sonst 403).
Zeitabhängige Staatszugehörigkeit (Breslau 1900 = Deutsches Reich) zeigt die
App nicht — die Bezeichnung nennt immer das heutige Land. Der Mock-Seed ordnet alle
Ortstexte automatisch zu.

**Automatische Zuordnung** ([lib/places/match.ts](../../lib/places/match.ts)):
GEDCOM-Ortsformen werden an Kommas zerlegt und vom spezifischen zum
allgemeinen Teil gesucht („Berkum, Peine, Lk Peine, Niedersachsen,
Germany“). Vorsätze („Lk“, „Kreis“, „Amt“ …), reine Beschreibungen
(„Kreisstadt“), Anschriften mit Hausnummer und Klammerzusätze fallen weg,
„St.“ = „Sankt“, „Peine-Vöhrum“ zuletzt in Hälften. Ein heutiges
Land im letzten Teil schränkt ein; ein historisches („Preußen“,
„Österreich-Ungarn“) oder ein Land zusammen mit einer historischen Landschaft
(„Breslau, Schlesien, Germany“) gibt nur einen Vorzug. Regionen (Bundesland,
Bundesstaat) schränken ein, historische Landschaften („Schlesien“,
„Ostpreußen“, „Banat“ …) bevorzugen Orte in ihrer Nähe. Nennt ein späterer
Teil ebenfalls einen Ort, muss der Kandidat höchstens 50 km davon liegen.
Ohne Ort: Region, dann Land. Ohne Länderhinweis entscheiden Heimatvorzug
(Deutschland, Österreich/Schweiz, Europa) und Größe zusammen. Auf den
Mock-Daten werden alle 36 Ortstexte (341 Angaben) als Ort zugeordnet.

**Ortsnamen** (Entscheidung des Eigentümers; Karte, Ortsliste, Seitenleiste,
„Orte zuordnen“; [lib/places/gazetteer.ts](../../lib/places/gazetteer.ts),
`entryLabel`): der heutige offizielle Name vorn, in Klammern der Name, unter
dem der Ort in den Daten steht, sonst der deutsche bzw. historische Name —
nur wenn er sich unterscheidet: „Wrocław (Breslau), Polen“, „Gdańsk
(Danzig), Polen“, „Timișoara (Temeswar), Rumänien“, „Kaliningrad (Königsberg),
Russland“. Orte in Deutschland, Österreich und der Schweiz nie mit Klammer,
dafür mit Bundesland bzw. Kanton: „Aachen, Nordrhein-Westfalen,
Deutschland“ (auch für „Aix-la-Chapelle“). Gespeicherte automatische Zuordnungen bekommen die neue
Form mit dem nächsten „Automatisch zuordnen“; von Hand Bestätigte behalten
ihre Bezeichnung.

**Mitgelieferte Daten** — kein Dienst im Netz, die Karte lädt nichts von
fremden Servern, die Ortsnamen verlassen den Server nie:

| Datei | Inhalt | Größe |
|---|---|---|
| `geo/gazetteer.tsv.gz` | Ortsverzeichnis: Deutschland, Österreich, Schweiz mit allen bewohnten Orten (auch Ortsteile und historische), übriges Europa ab 1000 Einwohnern, Welt ab 15 000; Regionen erster Ebene, Länder, 43 historische Landschaften (von Hand, ungefähre Mitte). Weitere Namen in lateinischer Schrift, für Europa nach Sprache gefiltert (u.a. de, en, fr, pl, cs, hu, ro, la; historische wie „Breslau“, „Aix-la-Chapelle“, „Temeswar“); Hauptname der heutige offizielle (Landessprache statt englischer Form: „München“, nicht „Munich“), dazu je Ort außerhalb des deutschen Sprachraums der deutsche bzw. historische Name („Breslau“). 229 491 Einträge | 4,4 MB (12 MB entpackt); nur auf dem Server, erst bei Bedarf geladen (rund 1 s, gut 100 MB Speicher, nach 10 min ohne Benutzung freigegeben) |
| `public/geo/countries.json` | Ländergrenzen, Natural Earth 1:50m, Mercator-projiziert und vereinfacht (Europa feiner) als SVG-Pfade | 337 KB (87 KB gzip) |

Erzeugt mit `node scripts/build-geodata.mjs <geonames-ordner>
<naturalearth-ordner>` (Eingaben und Bezugsquellen im Kopf des Skripts). Die
Größe des Ortsverzeichnisses ist bewusst: eine kleinere Auswahl (nur Orte ab
1000 Einwohnern) verfehlt Dörfer und Ortsteile wie „Berkum“ oder
„Vöhrum“, die in Stammbäumen typisch sind.

**Lizenzen:** Ortsverzeichnis aus [GeoNames](https://www.geonames.org/),
Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — ausgewählt
und umgeformt; Quellenangabe auf der Karte und hier. Ländergrenzen und
Ländermittelpunkte aus [Natural Earth](https://www.naturalearthdata.com/),
gemeinfrei.
