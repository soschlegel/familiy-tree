# Orte zuordnen

Wie Ortstexte zu einem Punkt auf der Karte kommen — von selbst, durch deine Auswahl beim Eingeben, durch den KI-Assistenten oder von Hand durch einen Administrator. Der eingegebene Text bleibt dabei immer, wie er ist.

## Der Ortstext bleibt

Orte sind im Stammbaum **Freitext**: „Hamburg“, „Kleinbach, Kreis Musterstadt, Preußen“, „bei Bremen“. Daran ändert die Zuordnung nichts. Sie legt nur **zusätzlich** fest, welcher Ort zu diesem Text gehört.

Die Zuordnung gilt je Text, nicht je Person: Steht „Hamburg“ bei 40 Angaben, genügt eine Zuordnung für alle. Groß-/Kleinschreibung und Leerzeichen spielen dabei keine Rolle; „hamburg“ und „Hamburg“ sind derselbe Ortstext (in der Liste „+1 Schreibweisen“).

## Beim Eingeben: Vorschlag und Auswahl

Unter jedem Ortsfeld — Geburts- und Sterbeort, Ort eines Ereignisses, Hochzeits- und Scheidungsort — zeigt die App beim Tippen, welcher Ort erkannt wird:

- „→ Wrocław (Breslau), Polen · früherer bzw. deutscher Name: Breslau“ — der Ort ist erkannt, hier über seinen alten Namen.
- **mehrdeutig** — es gibt weitere Orte dieses Namens. Ein Zusatz hilft, z.B. „Kleinbach, Kreis Musterstadt“ statt nur „Kleinbach“.
- **Ort nicht gefunden** — der Text bleibt trotzdem gespeichert, nur ohne Platz auf der Karte.

Mit **Ort wählen …** kannst du den richtigen Ort auch selbst **auswählen**: aus dem Ortsverzeichnis oder aus den eigenen Orten (siehe unten). Die Auswahl wird beim Speichern als Zuordnung „von Hand“ für genau diesen Text übernommen. Was du eingetippt hast, bleibt stehen. Wählst du nichts aus, ordnet die App den Text von selbst zu.

> Hat ein Administrator denselben Ortstext schon von Hand einem anderen Ort zugeordnet, ändert deine Auswahl das nicht — die Zuordnung gilt ja auch für die Angaben anderer Personen. Du bekommst dann einen Hinweis.

## Von selbst: automatische Zuordnung

Neue Ortstexte werden **nach dem Speichern von selbst zugeordnet** — beim Anlegen oder Ändern einer Person, eines Ereignisses oder einer Ehe und nach jedem Import. Das passiert im Hintergrund; das Speichern wird dadurch nicht langsamer. Was schon zugeordnet ist, bleibt, wie es ist.

Die automatische Zuordnung versteht die üblichen Schreibweisen aus Stammbaumprogrammen: Sie zerlegt „Kleinbach, Musterkreis, Niedersachsen, Germany“ an den Kommas und sucht vom genauesten zum allgemeinsten Teil; Zusätze wie „Kreis“ oder „Amt“, Anschriften mit Hausnummer und Klammerzusätze lässt sie weg; „St.“ versteht sie als „Sankt“. Ein Land oder Bundesland im Text schränkt die Suche ein, historische Namen („Preußen“, „Schlesien“) bevorzugen Orte in der Gegend. Ohne Hinweis gewinnen Orte im deutschsprachigen Raum und größere Orte. Ist nur eine Region oder ein Land erkennbar, wird es deren Mitte.

## Die Seite „Orte zuordnen“ (Administratoren)

Du erreichst sie über **Daten** („Orte zuordnen“) oder über den Hinweis unter der [Karte](05-karte.md). Sie listet jeden vorkommenden Ortstext — aus Geburt, Tod, Heirat, Scheidung und Lebensereignissen — mit der Zahl der Angaben und dem Stand:

| Stand | Bedeutung |
|---|---|
| **offen** | noch keine Zuordnung |
| **automatisch** | von der automatischen Zuordnung gesetzt |
| **von KI** | vom KI-Assistenten gesetzt — gilt sofort, bitte prüfen und bestätigen |
| **bestätigt** | von Hand gewählt oder bestätigt — wird nie automatisch überschrieben |
| **nicht zuordenbar** | bewusst ohne Ort (z.B. „auf See“, „unbekannt“) |

Über die Filter oben siehst du nur einen Stand; die Suche findet einen bestimmten Ortstext.

Der Knopf **Automatisch zuordnen** ist für den **Altbestand** gedacht: Er ordnet alle Texte neu zu, die weder von Hand bestätigt noch vom KI-Assistenten gesetzt sind.

### Von Hand zuordnen

Bei jedem Ortstext steht, was zugeordnet ist („Zugeordnet: …“) und gegebenenfalls ein **Vorschlag**. Ist der Vorschlag als **mehrdeutig** markiert, gibt es weitere, weit entfernte Orte gleichen Namens — dann lohnt ein Blick.

- **Bestätigen** — die automatische oder die KI-Zuordnung stimmt; sie wird dadurch „bestätigt“ und nie mehr automatisch geändert.
- **Vorschlag übernehmen** — den angezeigten Vorschlag nehmen.
- **Anderen Ort wählen …** — im Ortsverzeichnis suchen (auch nach alten Namen wie „Breslau“) oder Koordinaten selbst eingeben, mit Angabe, ob es ein Ort, eine Region oder ein Land ist. So legst du auch einen **eigenen Ort** an.
- **Nicht zuordenbar** — der Text bezeichnet keinen Ort, der auf die Karte gehört.
- **Zurücksetzen** — eine Zuordnung wieder aufheben; danach darf die automatische Zuordnung den Text wieder bearbeiten.

Jede Zuordnung steht in der [Änderungsgeschichte](09-aenderungen.md); die automatische als ein Paket „Orte automatisch zugeordnet“.

## Zuordnen mit dem KI-Assistenten

Ein Administrator mit KI-Zugang (Stufe „lesen und schreiben“) kann die offenen Ortstexte vom [KI-Assistenten](10-ki-zugang.md) abarbeiten lassen, z.B. mit der Bitte „Ordne die offenen Orte zu“ (Vorlage „Orte zuordnen“). Die KI

1. holt die offenen Ortstexte samt Zusammenhang (bei welcher Art Angabe, aus welcher Zeit — ohne Namen von Personen),
2. lässt sich für jeden Text die möglichen Orte zeigen („A, B oder C“, mit Einwohnerzahl, Land, früherem Namen),
3. ordnet die eindeutigen zu — mit einer kurzen Begründung — und markiert unsichere als **unsicher** oder lässt sie offen,
4. legt einen Ort, der im Verzeichnis fehlt (Wüstung, Weiler, Hof), auf Wunsch als **eigenen Ort** mit Koordinaten an,
5. nennt dir zum Schluss die unsicheren und offen gelassenen.

Solche Zuordnungen stehen auf „Orte zuordnen“ als **von KI**, mit der Begründung der KI und ggf. „unsicher“. Sie gelten sofort für die Karte. Prüfe sie und klicke **Bestätigen** — oder wähle einen anderen Ort. Von Hand Bestätigtes ändert die KI nie.

## Eigene Orte

Orte, die im Ortsverzeichnis fehlen, kann ein Administrator (oder die KI) mit Koordinaten selbst anlegen. Solche **eigenen Orte** erscheinen danach bei neuen Texten wieder als Vorschlag — beim Eingeben und für die KI —, damit niemand sie zweimal anlegen muss.

## Warum ist die Liste nur für Administratoren?

Die Liste enthält die Ortstexte **aller** Personen — auch solcher, die andere Benutzer nicht sehen dürfen. Deshalb ist die Seite dem Administrator vorbehalten. Vorschlag und Auswahl beim Eingeben zeigen dagegen nur Orte aus dem Verzeichnis und eigene Orte, nichts über Personen.
