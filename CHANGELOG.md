# Neuigkeiten

Was sich im Stammbaum für Anwender geändert hat — die neueste Version
zuerst. Die App zeigt diese Einträge unter „Neuigkeiten“ (Link in der
Fußzeile) und nach einer neuen Version einmal im Fenster „Was ist neu?“.

<!--
Regeln für neue Einträge (AGENTS.md, Abschnitt 3 „Ausrollen“):
- Jedes Release nach main bekommt hier einen neuen Eintrag ganz oben, im
  selben Stand wie die Änderung.
- Überschrift genau so: "## JJJJ-MM-TT.N — Kurztitel". JJJJ-MM-TT ist der
  Tag des Ausrollens, N die laufende Nummer an diesem Tag (1, 2, …).
  Keine Commit-Kennungen.
- Darunter Stichpunkte ("- …") in Anwendersprache: Was kann ich jetzt, was
  hat sich geändert? Keine Technikbegriffe, keine echten Namen, Orte oder
  Daten. Ein Stichpunkt darf über mehrere, eingerückte Zeilen gehen.
- Geprüft von tests/release-notes.test.ts (lib/release-notes.ts).
-->

## 2026-11-22.4 — Orte: Vorschlag beim Eingeben, Ortsseiten und KI

- Beim Eintippen eines Orts siehst du gleich darunter, welcher Ort gemeint
  ist — auch bei alten Namen: „Breslau“ → „Wrocław (Breslau), Polen“. Gibt es
  mehrere Orte dieses Namens, steht „mehrdeutig“ dabei.
- Mit „Ort wählen …“ suchst du dir den richtigen Ort selbst aus. Dein Text
  bleibt dabei genau so, wie du ihn eingegeben hast.
- Neue Orte kommen jetzt von selbst auf die Karte: nach dem Speichern und
  nach einem Import, ohne dass jemand „Automatisch zuordnen“ drücken muss.
- Jeder Ort hat eine eigene Seite: heutiger und früherer Name, Lage auf
  einer kleinen Karte, alle Schreibweisen und die Personen, die dort
  geboren wurden, geheiratet haben oder gestorben sind. Auf der Personenseite
  führt jeder erkannte Ort dorthin.
- Der KI-Assistent kann offene Orte für Administratoren zuordnen, auch
  fehlende Orte wie Höfe oder Wüstungen anlegen. Seine Vorschläge stehen
  unter „Orte zuordnen“ als „von KI“ mit Begründung und lassen sich dort
  bestätigen.
- Im GEDCOM-Export stehen Orte jetzt mit heutigem Namen, Region, Land und
  Koordinaten; dein ursprünglicher Text steht als Notiz dabei und kommt beim
  Wiedereinlesen zurück.

## 2026-11-22.3 — Neuigkeiten und Hilfe in der App

- Neue Seite „Hilfe“ (Link unten in der Fußzeile und im Menü „Verwaltung“):
  kurze Erklärungen zu allen Bereichen — vom Anlegen von Personen über
  Stammbaum, Karte und Dubletten bis zum KI-Zugang. An vielen Stellen führt
  ein kleiner Link „Wie funktioniert das?“ direkt zur passenden Erklärung.
- Nach einer neuen Version erscheint beim ersten Aufruf einmal das Fenster
  „Was ist neu?“ mit den Neuigkeiten seit deinem letzten Besuch.
- Alle Neuigkeiten stehen jederzeit auf der Seite „Neuigkeiten“ — der Link
  steht unten in der Fußzeile.
- KI-Zugang: Die Anleitung erklärt jetzt, wie sich die KI anmeldet — mit dem
  Schlüssel im Feld „Authorization“ und dem Wort „Bearer“ davor. Das hilft,
  wenn eine KI-App statt der Anmeldeseite nach einem solchen Feld fragt.

## 2026-11-22.2 — Karte „Wurzeln nach Jahr“

- Neuer Menüpunkt „Karte“: Wo lebten die Vorfahren in einem bestimmten
  Jahr? Ein Jahresregler mit „Abspielen“ zeigt je Ort einen Kreis, gefärbt
  nach den Linien der vier Großeltern. Ein Klick auf einen Kreis listet die
  Personen.
- Ortsnamen erscheinen als „heutiger Name (alter Name)“, z.B. bei Orten, die
  heute in einem anderen Land liegen.
- Für Administratoren: „Orte zuordnen“ — die Ortsangaben automatisch einem
  Ort auf der Karte zuordnen lassen und von Hand berichtigen.
- Bilder an einem Beleg erscheinen nur noch einmal: beim Ereignis, das der
  Beleg stützt, statt zusätzlich im Abschnitt „Quellen“.
- KI-Zugang: Widerrufene und abgelaufene Schlüssel sind ausgeblendet (Verlauf
  per Schalter); nicht mehr gebrauchte Schlüssel lassen sich endgültig
  löschen.
- Kleine Fehler in Listen, im Zeitstrahl und bei der Personenauswahl
  behoben.

## 2026-11-22.1 — Bilder an Quellen, Ereignissen und Belegen

- Bilder lassen sich jetzt auch an Quellen, Ereignissen und Belegen
  anhängen — in der App und über die KI. Das Bild einer Quelle erscheint bei
  den Belegen dieser Quelle.
- Stammbaum mit eingeschalteten „Linien“: Auch die Verbindungslinien
  zwischen Eltern und Kindern tragen jetzt die Farbe ihrer Großeltern-Linie.
- Familien, Benutzer, Änderungen und KI-Zugang stehen gesammelt im Menü
  „Verwaltung“; auf dem Handy als eigene Gruppe im Menü.
- KI-Zugang: Schritt-für-Schritt-Anleitung „Claude auf dem Handy“, dazu
  Anleitungen für den Browser, die Desktop-App und Claude Code.

## 2026-11-21.1 — Bezugsperson, Linienfarben und Änderungen

- „Das bin ich“: Auf deiner eigenen Personenseite kannst du dich als
  Bezugsperson festlegen. Im Stammbaum steht dann unter jeder Person, wie sie
  mit dir verwandt ist, z.B. „Urgroßvater“ — auch auf den Personenseiten.
- „Baum aus dieser Sicht“: vorübergehend eine andere Person als Bezugsperson
  wählen, z.B. um einem Kind seine Vorfahren zu zeigen.
- Schalter „Linien“ im Stammbaum: Die Vorfahren von Vater und Mutter und
  weiter nach den vier Großeltern erscheinen in eigenen Farben, mit Kürzel und
  Legende.
- Änderungsgeschichte: Bearbeiter sehen auf der Personenseite unter
  „Änderungen“, wer wann was geändert hat (vorher → nachher). Administratoren
  haben dazu die Übersicht „Änderungen“.
- Export als GEDCOM-Datei: Vorher lassen sich die Familien auswählen, die in
  die Datei sollen.
- Mögliche Dubletten: Vorfahren und Nachkommen einer Person werden nicht mehr
  als mögliche Dubletten vorgeschlagen.
- Bearbeiter können sich bei den Familien einer Person nicht mehr
  versehentlich selbst aussperren.

## 2026-11-20.1 — Besser auf dem Handy

- Auf dem Handy: größere Tippflächen, gut lesbare Eingabefelder,
  Verwaltungstabellen als Blöcke statt breiter Tabellen; die Fußzeile sitzt
  am unteren Rand.
- Personenseite: Ein Hinweis zeigt, wenn es zu dieser Person mögliche
  Dubletten gibt.
