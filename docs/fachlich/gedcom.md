# GEDCOM (Import und Export)

GEDCOM ist das Austauschformat der Stammbaumprogramme (MyHeritage, Ancestry,
Gramps, Ahnenblatt …). Die App liest GEDCOM 5.5, 5.5.1 und 7.0 (auch die
Eigenheiten von MyHeritage) und schreibt GEDCOM 5.5.1 in UTF-8. Alles liegt
auf `/admin/data`; **importieren dürfen nur Administratoren** — Bearbeiter und
Betrachter sehen den Import nicht, die Schnittstellen antworten ihnen mit 403.

## Eine Datei vorab prüfen

```bash
npm run gedcom:check -- meine-datei.ged                 # Zählungen, Auffälligkeiten, Vollständigkeit
npm run gedcom:check -- meine-datei.ged --show-names    # Diagnosen zusätzlich mit Personennamen
npm run gedcom:check -- neu.ged --compare alt.ged       # was hat sich zwischen zwei Exporten geändert?
npm run gedcom:check -- meine-datei.ged --json          # alles als JSON
```

Ohne `--show-names` gibt das Programm keine Namen, Daten, Orte oder Texte
aus, nur Zählungen, Tag-Pfade und Kennungen (`@I12@`) — so lässt sich die
Ausgabe gefahrlos weitergeben. Es liest nur die Datei, die Datenbank bleibt
unberührt. Bibliothek dahinter: [lib/gedcom](../../lib/gedcom/README.md).

## Import Schritt für Schritt

1. **Datei wählen** (`.ged` oder `.zip` mit einer `.ged`) und „Vorschau der
   GEDCOM-Datei“. Die Originaldatei wird aufbewahrt (siehe unten); an den
   Stammbaumdaten ändert die Vorschau nichts. Sie lässt den echten Import
   probeweise laufen, zeigt also genau, was passieren würde.
2. **Welcher Baum ist das?** Die App erkennt einen früher importierten Baum
   am Dateikopf (MyHeritage `_PROJECT_GUID`, sonst Site-ID) oder an
   übereinstimmenden `_UID`-Kennungen. Im Auswahlfeld lässt sich das
   übersteuern: „Automatisch erkennen“, „Neuer, unabhängiger Baum“ oder
   „Aktualisierung von …“ (frühere Bäume mit Datum und Zahl gleicher
   Kennungen). Abgeglichen wird immer nur innerhalb des gewählten Baums.
3. **Übersicht und Gruppen.** Kacheln und Tabelle zählen je Art (Personen,
   Beziehungen, Ereignisse, weitere Namen, Quellen, Belege); die Gruppen
   lassen sich aufklappen, durchsuchen und seitenweise nachladen:

   | Gruppe | Bedeutung | Standard |
   |---|---|---|
   | Neu | gibt es in der App noch nicht | wird angelegt |
   | In der Datei geändert | seit dem letzten Import in der Datei geändert, in der App nicht (mit den abweichenden Feldern) | wird mit den Werten der Datei aktualisiert |
   | In der App geändert | seit dem letzten Import hier bearbeitet; „auch in der Datei geändert“, wenn beide Seiten abweichen | **App-Version bleibt** — für alle oder je Eintrag auf „Dateiversion übernehmen“ umstellbar |
   | Fehlt in der Datei | früher importiert, im neuen Stand nicht mehr enthalten | **bleibt erhalten** und wird vermerkt; gelöscht wird nur, was einzeln angekreuzt (oder mit „Angezeigte zum Löschen vormerken“ vorgemerkt) und beim Ausführen noch einmal bestätigt wird |
   | Nicht übernehmbar | verstößt gegen eine Regel der App, mit Grund (z.B. „Eltern und Kind können nicht als Partner verbunden werden“, dritter leiblicher Elternteil, Zyklus) | wird ausgelassen — **das Original bleibt erhalten** (siehe unten) |
   | Schon vorhanden | gibt es in der App schon, aber nicht aus diesem Baum (z.B. dieselbe Beziehung von Hand angelegt) | bleibt unverändert |
   | Unverändert | Datei und App stimmen überein | nichts zu tun |

4. **Vorschläge.** Sieht eine neue Person einer von Hand angelegten ähnlich
   (Name, Geburtsjahr und -ort, Namen der Eltern), steht bei ihr „Ist das eine
   dieser Personen?“. Nur wenn du eine auswählst, wird die Datei-Person ihr
   zugeordnet: ihre Angaben in der App bleiben, Ereignisse und Namen aus der
   Datei kommen hinzu. Zusammengeführt wird nie automatisch.
5. **Familienzuordnung der neuen Personen:** keiner Familie (Standard),
   vorhandenen Familien oder einer neuen Familie. In der Datei als privat
   bzw. lebend markierte Personen bleiben auf Wunsch (Standard) ohne
   Familie. Vorhandene Personen behalten ihre Zuordnung. Warum das zählt:
   Sichtbarkeit hängt an Familien ([Berechtigungen](berechtigungen.md)) —
   **importierte Personen ohne Familie sieht nur der Administrator**, bis er
   sie einer Familie zuordnet (Personenseite, „Familien“). So wird durch einen
   Import nichts versehentlich für alle sichtbar.
6. **Fotos** (nur wenn die Datei Fotoverweise enthält): siehe unten; der
   Haken ist aus.
7. **„Was der Import tut“** fasst alles in Sätzen zusammen (wie viel neu,
   aktualisiert, behalten, gelöscht, ausgelassen). „GEDCOM-Import ausführen“
   fragt noch einmal nach (mit Hinweis, falls etwas gelöscht oder Fotos
   geladen werden) und läuft im Hintergrund; danach zeigt die Seite das
   Ergebnis je Art. „Abbrechen“ verwirft die Vorschau samt aufbewahrter
   Datei.

Unter „Hinweise“ stehen Auffälligkeiten der Datei (fehlende Verweise, Kind
vor den Eltern geboren, leere Familien …), was beim Übernehmen angepasst
wurde, und die Vollständigkeit („nichts geht verloren — x von y Zeilen
gedeutet, z unverändert als Rohdaten erhalten“).

## Wiederholte Importe

Der Normalfall ist, denselben Baum regelmäßig neu zu exportieren und
einzuspielen. Jeder importierte Datensatz merkt sich seine Herkunft
(`ImportLink`): den Baum, seinen Schlüssel in der Datei (`_UID`, sonst RIN,
sonst Xref; Ereignisse über eigene `_UID` bzw. Art und Nummer) und einen
Fingerabdruck der importierten Werte. Daran erkennt der nächste Import jeden
Eintrag wieder — auch wenn das Programm die Xrefs neu durchnummeriert hat —
und sieht, ob er seither in der Datei, in der App oder in beiden geändert
wurde. Beziehungen werden über das Personenpaar erkannt, Quellen ohne
Kennung über Xref und Titel bzw. Titel und Verfasser. Ein zweiter Import
derselben Datei ergibt „alles unverändert“ und schreibt nichts Neues.

**In der App Geändertes** wird nie still überschrieben: Standard ist, die
App-Version zu behalten; ersetzt wird nur, was du ausdrücklich auf
„Dateiversion übernehmen“ stellst. Was in der Datei fehlt, bleibt
standardmäßig erhalten und wird beim nächsten Import wieder unter „Fehlt in
der Datei“ angeboten.

## Nichts geht verloren

- Jeder Personen-, Familien- und Quellendatensatz der Datei liegt zusätzlich
  unverändert als **Rohdaten** (`ImportRawRecord`) am zugehörigen Eintrag —
  auch alles, was die App nicht abbildet (fremde Tags, Koordinaten,
  Fotoverweise …). Der GEDCOM-Export schreibt es von dort zurück.
- Eine **abgelehnte Beziehung** (z.B. eine Partnerschaft zwischen Mutter und
  Sohn, ein dritter leiblicher Elternteil) wird nicht angelegt; das Original
  ihrer Familie samt Ereignissen, Notizen und Belegen bleibt aber bei einer
  der beteiligten Personen liegen. Die Vorschau sagt das je Eintrag („… —
  nicht übernehmbar, Original bleibt bei *Person* erhalten“), und der Export
  schreibt eine abgelehnte Partnerschaft wieder als Familie (ohne Kinder —
  deren Abstammung steht bei der eigentlichen Familie). Eine abgelehnte
  Eltern-Kind-Verbindung steht weiter im Original der Ein-Eltern-Familie bei
  diesem Elternteil; der Export schreibt sie aber nicht zurück.
- Widersprechen sich Abstammung und Partnerschaft derselben zwei Personen
  (Kind zugleich Partner eines Elternteils), bleibt die Abstammung, und die
  Partnerschaft wird abgelehnt.
- Unplausible Daten (vor dem Jahr 1000, in der Zukunft, Tod vor Geburt)
  kommen nur als Wortlaut, damit die Person nicht ausfällt.

**Wo die Dateien liegen:** Die Originaldatei jedes Laufs und der Plan der
Vorschau liegen unter `MEDIA_DIR/imports/` — im Betrieb also in
`${DATA_ROOT}/media/imports/` und damit in derselben Sicherung wie die
Bilder ([Sicherung](../betrieb/sicherung.md)). Rohdaten stehen in der Datenbank.

**Importverlauf** („Importe“ auf derselben Seite): jeder ausgeführte Lauf mit
Ergebnis, Benutzer und „Originaldatei“ zum Herunterladen. Ersetzt ein
späterer Import Rohdaten durch einen neueren Stand, bleiben die alten als
„überholt“ stehen, bis du sie mit „Überholte Rohdaten entfernen“ löschst (die
Originaldatei des Laufs bleibt). Nie ausgeführte Vorschauen stehen
zugeklappt darunter, lassen sich verwerfen und verschwinden nach 7 Tagen von
selbst.

Zur Sicherung im eigenen Format: Wird eine ältere JSON/ZIP-Sicherung
eingespielt, nachdem seither erneut per GEDCOM importiert wurde, kommen deren
Rohdaten mit ihrem damaligen Stand zurück; zu einer Person können dann zwei
gültige Rohdatensätze liegen, und der GEDCOM-Export nimmt einen davon. Ein
erneuter GEDCOM-Import bringt das wieder in Ordnung.

## Fotos aus der Datei

MyHeritage und andere verweisen in der Datei auf Fotos auf ihren Servern.
Die Vorschau zählt diese Verweise; heruntergeladen wird **nur, wenn du den
Haken „Fotos jetzt herunterladen“ setzt** (Standard: aus — dann bleiben die
Verweise gespeichert, ein späterer Import kann sie holen, und die App stellt
keine einzige Verbindung nach außen her). Schutz beim Herunterladen: nur
`https`, nur öffentliche Adressen (nichts im Heimnetz oder auf dem Server
selbst, auch nicht über Weiterleitungen — höchstens 3, jede neu geprüft),
Verbindung genau zur geprüften Adresse, höchstens 15 MB und 20 s je Bild,
nur Bilddateien, die sharp lesen kann; jedes Bild wird wie ein Upload
verarbeitet, ein schon geholtes nicht noch einmal geladen, und jede Adresse
steht im Lauf. Verweise auf lokale Dateipfade (`C:\…`) werden nie gelesen.
**Gegen echte MyHeritage-Server ist das noch nicht ausprobiert** — getestet
ist es mit Testservern und den Schutzregeln.

## Export

Zwei Downloads auf `/admin/data` für jeden Benutzer, beschränkt auf das, was
er sehen darf — verborgene Personen fehlen samt aller Verweise auf sie:

- **GEDCOM** — eine `.ged`-Datei (GEDCOM 5.5.1, UTF-8) mit Personen, Namen,
  Ereignissen, Familien, Quellen und Belegen sowie allem, was aus einem
  Import als Rohdaten erhalten ist.
- **GEDCOM mit Bildern (ZIP)** — dieselbe Datei plus die Bilddateien unter
  `media/`; Porträts, Hochzeitsbilder und Quellenbilder sind in der
  `.ged`-Datei mit ihrem Pfad verknüpft — als `OBJE` an der Person bzw.
  Familie, im `SOUR`-Datensatz (Hauptscan zuerst, dann weitere Bilder), unter
  dem Ereignis (`EVENT_DETAIL`) und unter dem Beleg (`SOURCE_CITATION`), wie
  GEDCOM 5.5.1 es an diesen Stellen erlaubt. Bilder am Beleg einer
  Eltern-Kind-Beziehung stehen am Beleg beim Kind.
- **Orte im GEDCOM** (Entscheidung des Eigentümers, immer): Ein zugeordneter
  Ortstext steht als heutige Form „Ort, Region, Land“ im `PLAC` (Namen aus
  dem Ortsverzeichnis, z.B. „Wrocław, Województwo dolnośląskie, Polen“),
  darunter `MAP`/`LATI`/`LONG` und — wenn er abweicht — der Originaltext als
  `NOTE Originaltext: Breslau`. Nicht zugeordnete Orte bleiben Freitext. Der
  eigene GEDCOM-Import liest den Originaltext zurück; eine wieder
  eingespielte eigene Datei ändert die Ortsangaben deshalb nicht. Das
  Austauschformat (JSON/ZIP, Version 5) behält den Freitext und nimmt die
  Zuordnungen zusätzlich mit; beim Einspielen werden nur Ortstexte ohne
  vorhandene Zuordnung übernommen.

Beide Knöpfe öffnen einen Dialog mit den Familien, die der Benutzer sehen
darf (alle vorausgewählt, „Alle“/„Keine“, für Administratoren zusätzlich
„Personen ohne Familie“) und der Personenzahl der Auswahl. Eine Person mit
mehreren Familien ist dabei, sobald eine davon gewählt ist; Beziehungen nur
zwischen exportierten Personen, Ereignisse, Namen, Belege, Rohdaten und
Bilder nur an Exportiertem, Quellen nur die zitierten. Ist alles angekreuzt,
ist es derselbe Export wie bisher (auch mit noch unbelegten Quellen). Über
die Schnittstelle: `/api/export?format=gedcom&families=<id>,<id>` bzw.
`&withoutFamily=1` (nur Administratoren); fremde oder unbekannte Familien
lehnt der Server mit 403 ab. Der Dateiname nennt nur die Anzahl
(`stammbaum_<Datum>_auswahl-2-familien.ged`).

Ob MyHeritage, Ancestry, Gramps & Co. den Export vollständig übernehmen, ist
**nicht ausprobiert**; die Tests lesen ihn mit der eigenen Bibliothek zurück
(Zählungen, keine offenen Verweise).

## Grenzen des GEDCOM-Imports

- Große Dateien laufen im Hintergrund: etwa 25 s für 5 000 Personen, wenige
  Sekunden für 500.
- Ein Lauf betrifft einen Baum; mehrere Bäume nebeneinander sind möglich,
  werden aber nicht miteinander abgeglichen (gleiche `_UID` in einem „neuen“
  Baum wird nicht zusammengeführt).
- Eine abgelehnte Eltern-Kind-Verbindung schreibt der Export nicht zurück
  (siehe oben).
- Doppelte Personen lassen sich nachträglich zusammenführen
  ([Dubletten zusammenführen](dubletten.md)); Vorschläge beim
  Import betreffen bisher nur von Hand angelegte Personen.

Dienste: [lib/services/gedcom-import.ts](../../lib/services/gedcom-import.ts)
(Vorschau; Ausführen im Hintergrund über
[import-jobs.ts](../../lib/services/import-jobs.ts)), Abbildung:
[lib/gedcom-import/mapping.ts](../../lib/gedcom-import/mapping.ts), Massenimport:
[lib/services/import-apply.ts](../../lib/services/import-apply.ts), Export:
[lib/services/gedcom-export.ts](../../lib/services/gedcom-export.ts), Fotos:
[lib/services/gedcom-photos.ts](../../lib/services/gedcom-photos.ts) mit
[lib/safe-fetch.ts](../../lib/safe-fetch.ts).
