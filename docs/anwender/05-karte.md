# Karte „Wurzeln nach Jahr“

Wo lebten die Vorfahren in einem bestimmten Jahr? Wie die Karte zählt, was mit ungenauen Daten geschieht und woher die Koordinaten kommen — und wie der Ring „Wurzeln“ auf der Personenseite rechnet.

## Was die Karte zeigt

Unter **Karte** im Menü siehst du eine Europa- bzw. Weltkarte mit einem **Jahresregler**. Für das gewählte Jahr steht jede Person, die damals lebte, an ihrem damaligen Ort. Je Ort gibt es einen Kreis; je mehr Personen, desto größer. Mit **Abspielen** wandert die Karte Jahr für Jahr durch die Zeit.

- **Ausgangsperson**: normalerweise deine [Bezugsperson](04-stammbaum.md#bezugsperson). Mit „Andere Person …“ wählst du eine andere — das ändert die Bezugsperson des Baums nicht.
- **Vorfahren** (Standard) zeigt die Ausgangsperson und ihre Vorfahren, **Alle sichtbaren Personen** alle, die du sehen darfst.
- Die Kreise sind nach den vier **Großeltern-Linien** eingefärbt, mit denselben Farben und Kürzeln (VV, VM, MV, MM) wie im [Stammbaum](04-stammbaum.md#linienfarben), dazu ein Muster je Linie. Orte mit Personen aus mehreren Linien sind wie eine Torte geteilt.
- Ein Klick auf einen Kreis listet die Personen dort, mit Link zur Personenseite.
- Ziehen verschiebt die Karte, Mausrad bzw. zwei Finger zoomen. „Orte“, „Europa“ und „Welt“ wählen den Ausschnitt. Unter der Karte stehen dieselben Angaben als Liste „Orte im Jahr …“.

## Wie wird gezählt?

**Wann lebt jemand?** Von seinem Geburtsjahr bis zu seinem Todesjahr (beide eingeschlossen). Fehlt die Geburt, beginnt es mit dem frühesten datierten Ereignis (Taufe, Heirat …). Fehlt der Tod, endet es mit dem Jahr der Beerdigung — und ist auch das nicht bekannt, höchstens 100 Jahre nach dem Beginn (nie über das laufende Jahr hinaus).

**Wo ist jemand?** Am **zuletzt bekannten Ort bis zu diesem Jahr**. Dafür zählen: der Geburtsort, jedes Ereignis mit Ort **und** Datum (Wohnort, Volkszählung, Beruf, Auswanderung …), Heirat und Scheidung (für beide Partner) und der Sterbeort.

Beispiel: Paul Vogt wurde 1850 in Hamburg geboren, zog laut Wohnort-Ereignis 1878 nach Bremen und starb 1912 in Hannover.

| Jahr | Paul steht in … |
|---|---|
| 1850 bis 1877 | Hamburg (ab der Geburt) |
| 1878 bis 1911 | Bremen (ab dem datierten Wohnort) |
| 1912 | Hannover (ab dem Todesjahr) |
| ab 1913 | nicht mehr auf der Karte |

Weitere Regeln:

- Gibt es im selben Jahr mehrere Angaben, zählt die letzte.
- Ein **Geburtsort ohne Geburtsdatum** gilt ab dem Beginn. Andere Angaben **ohne Datum** zählen nicht — die App weiß nicht, wann sie galten.
- **Abweichende Angaben** (eine zweite, widersprüchliche Geburt usw.) zählen nicht.
- Vor der ersten Ortsangabe steht die Person unter **„ohne bekannten Ort“** — eine Zahl bei der Karte, die du anklicken kannst.
- Personen ganz ohne Datum stehen nur in der Zahl **„ohne Lebensdaten“** und nie auf der Karte.

## Ungenaue Daten

Ungenaue Daten zählen mit ihrem Jahr: „um 1850“, „vor 1850“ und „nach 1850“ als 1850, „zwischen 1850 und 1854“ als 1852 (die Mitte), ein Zeitraum „von 1901 bis 1910“ mit seinem Beginn, also 1901.

## Woher kommen die Koordinaten?

Orte stehen im Stammbaum als **Text**, so wie du sie eingibst („Hamburg“, „Kleinbach, Kreis Musterstadt“). Für die Karte braucht jeder Ortstext Koordinaten. Die kommen aus einem **mitgelieferten Ortsverzeichnis** (GeoNames) — die App fragt dafür keinen Dienst im Internet, und die Ortsnamen verlassen den Server nie.

Neue Ortstexte ordnet die App nach dem Speichern von selbst zu; beim Eingeben kannst du den Ort auch auswählen, und Administratoren (auch mit Hilfe des KI-Assistenten) prüfen und ergänzen den Rest — siehe [Orte zuordnen](06-orte-zuordnen.md). Ein Ortstext, der (noch) keine Koordinaten hat, zählt als **„mit Ort, der nicht auf der Karte ist“**: Die Person ist dann an einem Ort, den die Karte nicht zeichnen kann, und steht nicht mehr am früheren Ort. Administratoren sehen unter der Karte, wie viele Ortsangaben noch fehlen.

Orte, die nur als Region oder Land bekannt sind („Westfalen“, „Polen“), stehen in deren Mitte; die Personenliste des Kreises vermerkt das.

## Ortsnamen: heutiger Name (alter Name)

Die Karte nennt Orte mit ihrem **heutigen** Namen, dahinter in Klammern den Namen, unter dem sie in den Daten stehen (bzw. den deutschen oder historischen Namen), wenn er anders ist: „Wrocław (Breslau), Polen“, „Gdańsk (Danzig), Polen“, „Kaliningrad (Königsberg), Russland“. Orte in Deutschland, Österreich und der Schweiz stehen ohne Klammer, dafür mit Bundesland bzw. Kanton: „Celle, Niedersachsen, Deutschland“.

Die Ländergrenzen sind die **heutigen** — die Karte zeigt keine historischen Grenzen.

## Wurzeln auf der Personenseite

Auf jeder Personenseite mit bekannten leiblichen Eltern steht der Abschnitt **Wurzeln**: ein Ring, der zeigt, aus welchen Ländern die Vorfahren dieser Person stammen — wie die Herkunfts-Torte bei Ahnenportalen, aber ohne DNA, nur aus dem Stammbaum gerechnet. Daneben steht jedes Stück mit Namen und Prozent.

- **Bis Generation**: welche Vorfahren-Ebene zählt — 2 sind die Großeltern, 3 die Urgroßeltern, 4 (Standard) die Ururgroßeltern, bis 8.
- **nach Land** (Standard) oder **nach Region**: Region heißt Bundesland, Kanton, Woiwodschaft oder Provinz von heute.

**So wird gezählt:** Jeder Platz der gewählten Generation zählt gleich viel — bei Generation 4 sind es 16 Plätze, jeder ein Sechzehntel. Beispiel: Sind von Lena Beispiel alle 16 Ururgroßeltern bekannt und 12 davon in Deutschland, 4 in Polen geboren, zeigt der Ring 75 % Deutschland und 25 % Polen.

- **Endet eine Linie früher**, steht der letzte bekannte Vorfahr für alle Plätze dahinter. Ist von einem Großvater kein Elternteil bekannt, zählt sein Geburtsort also für vier von 16 Plätzen.
- **Fehlt schon ein Elternteil** der Person selbst, ist diese Hälfte **Unbekannt**.
- Kommt **derselbe Vorfahr über zwei Linien** vor (etwa wenn Cousin und Cousine geheiratet haben), zählt er zweimal — so wie er im Stammbaum zweimal steht.
- Es zählen nur **leibliche** Eltern, keine Adoptiv-, Stief- oder Pflegeeltern.

**Welcher Ort?** Der Geburtsort; fehlt er, der Ort der Taufe. **Abweichende Angaben** zählen nicht. Welches Land bzw. welche Region zu einem Ort gehört, steht in der Ortszuordnung (siehe [Woher kommen die Koordinaten?](05-karte.md#woher-kommen-die-koordinaten)) — es zählen also die **heutigen** Länder: Ein Vorfahr aus „Breslau“ zählt zu Polen.

Die grauen Stücke:

| Stück | bedeutet |
|---|---|
| **Ort nicht zugeordnet** | Ein Ort steht da, ist aber (noch) keinem Ort im Ortsverzeichnis zugeordnet. |
| **Unbekannt** | Kein Geburts- und kein Taufort, oder ein Elternteil der Person fehlt. |
| **Nicht freigegeben** | Der Vorfahr gehört zu einer Familie, die du nicht sehen darfst. Dahinter rechnet die App nicht weiter. |
| **Sonstige** | Mehrere sehr kleine Stücke (unter 2 %) zusammen; darunter steht, welche. |

Nach **Region** steht ein Land mit dem Zusatz **(ohne Region)**, wenn sich die Region nicht sicher bestimmen lässt — etwa wenn ein Ort nur als Land oder als alte Landschaft („Schlesien“) zugeordnet ist.

Unter dem Ring steht, wie viele Linien bis zur gewählten Generation reichen („4 von 16 Linien reichen bis dorthin“). Die Prozente sind gerundet und ergeben zusammen immer 100; gleich große Stücke können deshalb um 1 % abweichen.

> **Datenschutz:** Von Vorfahren, die du nicht sehen darfst, verrät der Ring weder Namen noch Orte — ihr Anteil heißt nur „Nicht freigegeben“.

## Ortsseiten

Jeder zugeordnete Ort hat eine eigene **Ortsseite**. Du erreichst sie über die Personenseite: Dort steht bei jedem zugeordneten Ort der erkannte Ort als Link, zum Beispiel „Karlsruhe, Baden-Württemberg, Deutschland“ oder „Wrocław (Breslau), Polen“. Dein eingegebener Text bleibt gespeichert: Du siehst ihn beim Bearbeiten, auf der Ortsseite und — wenn er mehr sagt als der Ortsname, etwa eine Anschrift — klein daneben („eingegeben: …“). Auf der Ortsseite stehen:

- der heutige Name mit dem früheren bzw. deutschen Namen, Region, Land, Koordinaten und eine kleine Lagekarte,
- wie der Ort zugeordnet wurde (automatisch, von KI oder von Hand),
- alle Schreibweisen: die Texte in den Daten, die auf diesen Ort zeigen („Breslau“, „Breslau, Schlesien“, „Wrocław“), und weitere Namen aus dem Ortsverzeichnis,
- die **Personen mit Angaben an diesem Ort** — Geburt, Tod, Heirat, Scheidung und Lebensereignisse mit Jahr, je mit Link zur Person.

> **Datenschutz:** Auch auf der Ortsseite stehen nur Personen, die du sehen darfst — nicht freigegebene Personen erscheinen weder als Eintrag noch in einer Zahl.

## Orte im GEDCOM-Export

Beim [GEDCOM-Export](08-import-und-export.md) schreibt die App für zugeordnete Orte die volle **heutige** Form „Ort, Region, Land“ mit Koordinaten, damit andere Programme den Ort sicher finden — z.B. „Wrocław, Województwo dolnośląskie, Polen“. Dein ursprünglicher Text steht als Notiz dabei („Originaltext: Breslau“). Liest du die Datei wieder in diese App ein, kommt dein ursprünglicher Text zurück. Nicht zugeordnete Orte bleiben, wie sie sind.

> **Datenschutz:** Die Karte rechnet nur mit Personen, die du sehen darfst. Nicht freigegebene Personen erscheinen weder auf der Karte noch in einer Zahl.
