# Orte zuordnen

Für Administratoren: wie Ortstexte zu Koordinaten für die Karte kommen — automatisch oder von Hand. Der eingegebene Text bleibt dabei immer, wie er ist.

## Der Ortstext bleibt

Orte sind im Stammbaum **Freitext**: „Hamburg“, „Kleinbach, Kreis Musterstadt, Preußen“, „bei Bremen“. Daran ändert die Zuordnung nichts. Sie legt nur **zusätzlich** fest, welcher Punkt auf der Karte zu diesem Text gehört.

Die Zuordnung gilt je Text, nicht je Person: Steht „Hamburg“ bei 40 Angaben, genügt eine Zuordnung für alle. Groß-/Kleinschreibung und Leerzeichen spielen dabei keine Rolle; „hamburg“ und „Hamburg“ sind derselbe Ortstext (in der Liste „+1 Schreibweisen“).

## Die Seite „Orte zuordnen“

Du erreichst sie über **Daten** („Orte zuordnen“) oder über den Hinweis unter der [Karte](05-karte.md). Sie listet jeden vorkommenden Ortstext — aus Geburt, Tod, Heirat, Scheidung und Lebensereignissen — mit der Zahl der Angaben und dem Stand:

| Stand | Bedeutung |
|---|---|
| **offen** | noch keine Zuordnung |
| **automatisch** | von der automatischen Zuordnung gesetzt |
| **bestätigt** | von Hand gewählt oder bestätigt — wird nie automatisch überschrieben |
| **nicht zuordenbar** | bewusst ohne Ort (z.B. „auf See“, „unbekannt“) |

Über die Filter oben siehst du nur einen Stand; die Suche findet einen bestimmten Ortstext.

## Automatisch zuordnen

Der Knopf **Automatisch zuordnen** sucht für alle Texte, die nicht von Hand bestätigt sind, den passenden Ort im mitgelieferten Ortsverzeichnis. Danach steht da, wie viele neu, geändert und ohne Treffer sind.

Die automatische Zuordnung versteht die üblichen Schreibweisen aus Stammbaumprogrammen: Sie zerlegt „Kleinbach, Musterkreis, Niedersachsen, Germany“ an den Kommas und sucht vom genauesten zum allgemeinsten Teil; Zusätze wie „Kreis“ oder „Amt“, Anschriften mit Hausnummer und Klammerzusätze lässt sie weg; „St.“ versteht sie als „Sankt“. Ein Land oder Bundesland im Text schränkt die Suche ein, historische Namen („Preußen“, „Schlesien“) bevorzugen Orte in der Gegend. Ohne Hinweis gewinnen Orte im deutschsprachigen Raum und größere Orte. Ist nur eine Region oder ein Land erkennbar, wird es deren Mitte.

> **Wichtig:** Neue Ortstexte — z.B. nach einem Import oder wenn jemand einen neuen Ort eintippt — erscheinen erst auf der Karte, wenn sie zugeordnet sind. Drück nach größeren Änderungen also wieder „Automatisch zuordnen“. Von Hand Bestätigtes bleibt dabei unangetastet.

## Von Hand zuordnen

Bei jedem Ortstext steht, was zugeordnet ist („Zugeordnet: …“) und gegebenenfalls ein **Vorschlag**. Ist der Vorschlag als **mehrdeutig** markiert, gibt es weitere, weit entfernte Orte gleichen Namens — dann lohnt ein Blick.

- **Bestätigen** — die automatische Zuordnung stimmt; sie wird dadurch „bestätigt“ und nie mehr automatisch geändert.
- **Vorschlag übernehmen** — den angezeigten Vorschlag nehmen.
- **Anderen Ort wählen …** — im Ortsverzeichnis suchen (auch nach alten Namen wie „Breslau“) oder Koordinaten selbst eingeben, mit Angabe, ob es ein Ort, eine Region oder ein Land ist.
- **Nicht zuordenbar** — der Text bezeichnet keinen Ort, der auf die Karte gehört.
- **Zurücksetzen** — eine Handzuordnung wieder aufheben; danach darf die automatische Zuordnung den Text wieder bearbeiten.

Jede Zuordnung steht in der [Änderungsgeschichte](09-aenderungen.md); die automatische als ein Paket „Orte automatisch zugeordnet“.

## Warum nur Administratoren?

Die Liste enthält die Ortstexte **aller** Personen — auch solcher, die andere Benutzer nicht sehen dürfen. Deshalb ist die Seite dem Administrator vorbehalten.
