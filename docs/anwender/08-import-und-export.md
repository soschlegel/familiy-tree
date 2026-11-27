# Import und Export

Daten sichern, mit anderen Stammbaumprogrammen austauschen und einen Stammbaum aus MyHeritage übernehmen. Alles unter „Daten“ im Menü.

## Exportieren (alle Benutzer)

Exportieren darf jeder — aber immer nur, was er sehen darf. Nicht freigegebene Personen fehlen samt aller Verweise auf sie.

- **ZIP mit Bildern** bzw. **Nur JSON**: das eigene Format der App, vollständig (Personen, Beziehungen, Ereignisse, Quellen, Belege, Bildzuordnungen). Das ZIP enthält zusätzlich die Bilddateien und eignet sich als Sicherung oder für einen Umzug.
- **GEDCOM** bzw. **GEDCOM mit Bildern (ZIP)**: das Austauschformat der Stammbaumprogramme (MyHeritage, Ancestry, Gramps, Ahnenblatt …).

Beim GEDCOM-Export fragt ein Dialog, was in die Datei soll. Oben wählst du die Art: **Nach Familien** (so startet der Dialog) oder **Ab einer Person**.

Nach Familien kreuzt du an, **welche Familien** in die Datei sollen (alle sind vorausgewählt, mit **Alle auswählen** und **Keine auswählen**). Der Dialog zeigt, wie viele Personen das sind. Eine Person mit mehreren Familien ist dabei, sobald eine davon gewählt ist; Beziehungen kommen nur mit, wenn beide Personen dabei sind.

### GEDCOM ab einer Person

Mit **Ab einer Person** kommt eine Person mit ihren Vorfahren in die Datei — Eltern, Großeltern, Urgroßeltern und so weiter, so weit sie erfasst sind. Vorbelegt ist deine eigene Person („Das bin ich“), wenn du sie festgelegt hast; mit **ändern** suchst du eine andere. Auf jeder Personenseite führt unter „Familie“ der Link **Vorfahren als GEDCOM exportieren …** direkt hierher, schon mit dieser Person.

Ohne Häkchen sind nur die Person und ihre leiblichen Vorfahren dabei. Mit den Kästchen nimmst du mehr mit:

| Kästchen | Was dazukommt |
|---|---|
| **Partner** | Ehe- und Lebenspartner der Person und aller Vorfahren, auch frühere, samt Hochzeit und Scheidung |
| **Geschwister** | Brüder und Schwestern der Person und jedes Vorfahren, auch Halbgeschwister — also z.B. auch Onkel, Tanten, Großonkel |
| **Partner und Kinder der Geschwister** | nur zusammen mit **Geschwister**: die Partner der Geschwister (Schwager und Schwägerin, angeheiratete Onkel und Tanten) und ihre Kinder (Neffen und Nichten, Cousins und Cousinen) — eine Stufe, nicht deren Kinder |
| **Nachkommen der Person** | Kinder, Enkel und alle weiteren; mit **Partner** auch deren Partner |
| **Auch Adoptiv-, Stief- und Pflegeeltern** | sonst nur leibliche Eltern; mit dem Häkchen auch diese Eltern und deren Vorfahren |

**Generationen hinauf** begrenzt, wie weit es zurückgeht: 1 = nur die Eltern, 2 = bis zu den Großeltern. Leer lassen heißt: alle.

Unten zeigt der Dialog vor dem Herunterladen, wie viele Personen in die Datei kommen — aufgeteilt nach Vorfahren, Geschwistern, Partnern usw. Ohne gewählte Person bleibt **Herunterladen** gesperrt. Der Dateiname nennt nur die Anzahl, keinen Namen.

> Auch hier gilt: nur, was du sehen darfst. Ist ein Vorfahr für dich nicht freigegeben, endet die Linie dort — seine Eltern und Großeltern kommen nicht mit, selbst wenn du sie sonst sehen dürftest.

Ob andere Programme den GEDCOM-Export vollständig übernehmen, ist noch nicht ausprobiert.

## Importieren (nur Administratoren)

Bearbeiter und Betrachter sehen den Import nicht. Ein Import ändert erst etwas, **nachdem du die Vorschau gesehen und bestätigt hast**.

### Eine GEDCOM-Datei einspielen — z.B. aus MyHeritage

1. Exportiere den Stammbaum im anderen Programm als GEDCOM-Datei (`.ged`, oder ein `.zip`, das eine `.ged` enthält).
2. Unter **Daten** die Datei wählen und **Vorschau der GEDCOM-Datei**. An den Daten ändert sich dabei nichts.
3. Die Vorschau erkennt, ob dieser Baum schon einmal importiert wurde („Automatisch erkennen“), und sortiert alles in Gruppen: **Neu**, **In der Datei geändert**, **In der App geändert**, **Fehlt in der Datei**, **Nicht übernehmbar**, **Schon vorhanden**, **Unverändert**.
4. Sieht eine neue Person einer schon vorhandenen ähnlich — von Hand erfasst oder aus einem anderen Import —, steht das oben in der Vorschau: **„Dieser Import hängt über … Personen mit vorhandenen Daten zusammen“**. Standard ist immer **Neu anlegen**; verbunden wird nur, was du einzeln auswählst (siehe [Vorschläge](#vorschlaege-personen-die-es-schon-gibt)).
5. Wähle, zu welchen **Familien** die neuen Personen gehören sollen (siehe unten).
6. „Was der Import tut“ fasst alles in Sätzen zusammen. **GEDCOM-Import ausführen** fragt noch einmal nach und läuft dann im Hintergrund.

### Vorschläge: Personen, die es schon gibt

Oft stehen in einer neuen Datei Menschen, die es in der App schon gibt — etwa die Urgroßeltern, die auch im Stammbaum von Tante Erika vorkommen. Die Vorschau vergleicht deshalb jede **neue** Person der Datei mit allen vorhandenen Personen (von Hand erfasste und aus allen anderen Importen) — genauso wie [Importe verbinden](07-dubletten.md). Wird ein Baum erneut eingespielt, erkennt die App ihre eigenen Personen ohnehin wieder; Vorschläge gibt es nur für die wirklich neuen.

Oben in der Vorschau steht dann **„Dieser Import hängt über … Personen mit vorhandenen Daten zusammen“**, aufgeteilt nach Einstufung:

| Einstufung | Bedeutung |
|---|---|
| **sicher** | gleicher ganzer Name, gleiche tagesgenaue Lebensdaten bzw. dieselben Verwandten, kein Widerspruch |
| **sehr wahrscheinlich** | zwei passende Verwandte, oder gleiches Geburtsdatum plus ein passender Verwandter |
| **wahrscheinlich** | Name und passende Daten plus ein weiterer Hinweis — bitte ansehen |
| **unklar** | nur Name und ungefähres Jahr, ein Widerspruch oder mehrere ähnlich gute Kandidaten — meist verschiedene Menschen |

Je Person siehst du, worin sie übereinstimmen und worin sie abweichen (z.B. „Geburtsort nur in der Datei: Neudorf“), und woher die vorhandene Person stammt. Du wählst:

- **Neu anlegen** — das ist immer vorausgewählt, auch bei „sicher“.
- **Mit vorhandener Person verknüpfen** — die Person aus der Datei wird keine neue Person, sondern gehört zur vorhandenen.

Mit **Alle sicheren auswählen** wählst du in einem Schritt alle Vorschläge der Einstufung „sicher“; jede Wahl bleibt danach einzeln sichtbar, und du kannst sie mit **Neu anlegen** wieder abwählen. Eine vorhandene Person kannst du nur einmal wählen.

**Was „verknüpfen“ bewirkt:** Die vorhandene Person bleibt, wie sie ist, und wird nur ergänzt. Leere Angaben werden aus der Datei gefüllt, von zwei passenden Daten gewinnt das genauere („12.03.1850“ statt „um 1850“). Weicht etwas ab, bleibt der Wert der App, und die Angabe aus der Datei kommt als **Zweitangabe** dazu (z.B. ein abweichendes Sterbedatum) bzw. als weiterer Name. Ereignisse, Namen und Belege aus der Datei hängen danach an der vorhandenen Person; ein Ereignis oder Name, den sie schon genauso hat, wird nicht doppelt angelegt. Die Familien der vorhandenen Person ändern sich nicht. Die Person trägt danach beide Importe als **Herkunft**, und in den **Änderungen** steht je verknüpfter Person ein Eintrag „Beim Import mit einer Person aus der Datei verknüpft“ mit vorher → nachher.

Beim Ausführen prüft die App jede Wahl noch einmal. Hat sich seit der Vorschau etwas geändert (die vorhandene Person wurde bearbeitet, zusammengeführt oder gelöscht, oder sie passt jetzt schlechter), wird **gar nichts importiert**: Die Vorschau nennt die betroffenen Personen, setzt genau diese Wahl zurück, und du entscheidest neu.

### Wiederholte Importe

Der Normalfall ist, denselben Baum regelmäßig neu zu exportieren und einzuspielen. Die App erkennt jeden Eintrag wieder:

- **In der Datei geändert** wird übernommen.
- **In der App geändert** bleibt wie in der App — außer du stellst ausdrücklich „Dateiversion übernehmen“ ein. Hier Geändertes wird also nie still überschrieben.
- **Fehlt in der Datei** bleibt erhalten. Gelöscht wird nur, was du einzeln ankreuzt und beim Ausführen noch einmal bestätigst.

Nichts geht verloren: Was die App nicht abbilden kann, bewahrt sie unverändert auf und schreibt es beim GEDCOM-Export zurück. Die Originaldatei jedes Imports kannst du im Importverlauf wieder herunterladen.

### Importe benennen

Unter **Verwaltung → Daten**, im Abschnitt „Importe“, steht die Liste **Namen der Importe**. Jeder Import — mehrere Stände desselben Stammbaums zählen als einer — hat dort seinen Buchstaben, seine Farbe und einen Namen. Mit **Umbenennen** gibst du ihm einen sprechenden Namen, z.B. „Stammbaum Tante Erika“.

Der Name erscheint überall, wo der Import genannt wird: im [Stammbaum](04-stammbaum.md#herkunft), im Block „Herkunft“ der Personenseite, bei möglichen Dubletten, im Vergleich und unter „Importe verbinden“ — auch für Bearbeiter. Ohne eigenen Namen sehen Bearbeiter „Import vom 12.03.2026“. Den **Dateinamen** sehen nur Administratoren. Buchstabe und Farbe ändern sich durch das Umbenennen nicht; lässt du das Feld leer, gilt wieder der Standardname.

### Familien beim Import

Sichtbarkeit hängt an Familien (siehe [Erste Schritte](01-erste-schritte.md#familien-wer-was-sieht)). Neue Personen kommen deshalb standardmäßig in **keine** Familie — dann sieht sie nur der Administrator, bis er sie zuordnet. Du kannst sie aber gleich vorhandenen Familien oder einer neuen Familie zuordnen. Personen, die in der Datei als privat oder lebend markiert sind, bleiben auf Wunsch (Standard) ohne Familie.

### Fotos aus MyHeritage

MyHeritage verweist in der Datei auf Fotos auf seinen Servern. Heruntergeladen werden sie **nur**, wenn du den Haken **Fotos jetzt herunterladen** setzt (Standard: aus). Gegen echte MyHeritage-Server ist das noch nicht ausprobiert.

### Quellen aus MyHeritage

Quellen werden beim Import eingeordnet: Kirchenbuch, Standesamt, Volkszählung usw., wenn der Titel das hergibt. Stammbäume anderer Nutzer („… Stammbäume“, „Smart Matches“) werden **Online-Stammbaum** — keine unabhängige Quelle, siehe [Quellen und Belege](03-quellen-und-belege.md).

## Sicherung einspielen (JSON/ZIP)

Eine Exportdatei im eigenen Format (JSON oder ZIP) spielt der Administrator unter „Import“ wieder ein. Auch hier zuerst die Vorschau; vorhandene Einträge werden erkannt und aktualisiert, unbekannte ergänzt. **Gelöscht wird nichts.**

Mehrfach vorhandene Personen aus verschiedenen Importen führst du danach zusammen — siehe [Dubletten](07-dubletten.md).
