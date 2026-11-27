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

## 2026-11-27.5 — Geburtstage zuerst, Zeitgeschichte passend zur Gegend

- Startseite: Ganz oben stehen jetzt die Geburtstage der Lebenden — heute
  und in den nächsten 14 Tagen. Darunter folgen die Jahrestage des Tages
  und unter „Demnächst“ die weiteren Geburtstage.
- Zeitgeschichte passend zur Gegend: Jedes Ereignis hat einen
  Geltungsbereich. Unter dem Lebenslauf und in der Zeitreise der Karte
  stehen Ereignisse aus der Gegend vorn, in der jemand zu der Zeit lebte —
  der Bau der Berliner Mauer etwa bei Personen in Ostdeutschland. Anderes
  findest du unter „weitere Ereignisse“ bzw. „Andere Gegenden“.
- Administratoren legen den Geltungsbereich eigener Ereignisse unter
  „Verwaltung“ → „Zeitgeschichte“ fest: Länder, Regionen oder eine
  Schnellwahl wie „Ostdeutschland“. Auch der KI-Assistent gibt ihn an.

## 2026-11-27.4 — Zeitgeschichte mit dem KI-Assistenten ergänzen

- Dein KI-Assistent kann die Zeitgeschichte jetzt lesen und — mit einem
  Schlüssel „lesen und schreiben“ eines Administrators — ergänzen, zum
  Beispiel um Ereignisse aus den Gegenden, in denen deine Vorfahren lebten.
- Einträge der KI sind sofort sichtbar, tragen aber überall den Vermerk
  „von KI, ungeprüft“, bis ein Administrator sie unter „Verwaltung“ →
  „Zeitgeschichte“ bestätigt. Dort stehen auch die Begründung der KI und
  ihre Quelle.
- Solange ein Eintrag ungeprüft ist, steht er unter dem Lebenslauf hinter
  den großen Ereignissen.

## 2026-11-27.3 — Startseite, Lebenslauf, Zeitreise und mehr

- Neue Startseite „Heute in der Familie“: Jahrestage des Tages, die
  Geburtstage der nächsten 30 Tage und runde Jubiläen. Du landest nach dem
  Anmelden dort; das Zeichen „Stammbaum“ oben links führt immer dorthin
  zurück, der Baum ist einen Klick entfernt.
- „Wie sind wir verwandt?“: Wähle zwei Personen — die App nennt die
  Verwandtschaft in Worten und zeichnet den Weg über die gemeinsamen
  Vorfahren. Den Knopf findest du auf der Personenseite und unter
  „Recherche“.
- Lebenslauf: Auf der Personenseite steht ein kurzer Text in ganzen Sätzen,
  automatisch aus den erfassten Daten erstellt — mit „Text kopieren“.
- Karte: Die neue Art „Lebensweg“ zeigt die Orte eines Lebens als Weg mit
  Jahreszahlen, wahlweise auch die Vater- oder Mutterlinie über die
  Generationen.
- Karte: Zeitreise mit Zeitstrahl, Schritten und „Abspielen“ — daneben
  steht, wer im gewählten Jahr lebte, wie alt er war und was in dem Jahr
  in der Familie geschah.
- Ringe: Mit „Nachfahren“ siehst du Kinder, Enkel und Urenkel einer Person
  im Kreis. „Drucken“ macht aus den Ringen ein Blatt von A4 bis zum Poster,
  als PDF oder als Bild für die Druckerei.
- Neue Seite „Rekorde“: höchstes Alter, längste Ehe, meiste Kinder, längste
  Abstammungslinie und mehr — erreichbar über „Statistik“ und die
  Startseite.
- Neue Seite „Forschungs-Fortschritt“: wie vollständig die Vorfahren je
  Generation und Linie erfasst und belegt sind, mit Vorschlägen, wo sich
  das Weitersuchen lohnt — erreichbar über „Recherche“ und die Startseite.
- Zeitgeschichte: Im Zeitstrahl des Baums, in der Zeitreise der Karte und
  unter dem Lebenslauf steht, was in der Zeit geschah — vom Dreißigjährigen
  Krieg bis zur Wiedervereinigung. Mit dem Schalter „Zeitgeschichte“
  blendest du das aus; Administratoren ergänzen eigene Ereignisse unter
  „Verwaltung“.

## 2026-11-27.2 — Stammbaum als Ringe

- Neue Ansicht „Ringe“ im Stammbaum: In der Mitte steht eine Person, im
  ersten Ring ihre Eltern je auf einer Hälfte, in jedem weiteren Ring die
  Eltern davon — so siehst du alle Vorfahren auf einen Blick.
- Tippe eine Fläche an, um Name, Lebensdaten und Verwandtschaft zu sehen.
  „Zur Person“ öffnet die Personenseite, „In die Mitte“ stellt diese Person
  ins Zentrum.
- Du wählst 3 bis 7 Generationen und färbst die Ringe „nach Linie“ (je
  Großelternteil eine Farbe) oder „nach Wurzeln“ (Land des Geburtsorts).

## 2026-11-27.1 — Wurzeln und Statistik

- Neuer Abschnitt „Wurzeln“ auf der Personenseite: Ein Ring zeigt, aus
  welchen Ländern oder Regionen die Vorfahren stammen — gerechnet aus den
  Geburtsorten im Stammbaum. Du wählst, bis zu welcher Generation gerechnet
  wird, und schaltest zwischen „nach Land“ und „nach Region“ um.
- Neue Seite „Statistik“ im Menü: Geburtsorte, Geschlecht, häufigste Nach-
  und Vornamen, Geburten je Jahrzehnt, erreichtes Lebensalter, Kinderzahl,
  Heiratsalter und Geburtsmonate — auf Wunsch für eine einzelne Familie.
  Gezählt werden nur Personen, die für dich freigegeben sind; einzelne
  Personen nennt die Seite nicht.

## 2026-11-26.3 — Anmelden per E-Mail-Link, Vollbild, Vorschläge beim Import

- Du hast kein Google- oder GitHub-Konto? Ist der E-Mail-Versand
  eingerichtet, kannst du dir auf der Anmeldeseite einen Anmeldelink per
  E-Mail schicken lassen — ohne Passwort. Der Link gilt 15 Minuten und nur
  einmal; du bestätigst die Anmeldung mit „Jetzt anmelden“.
- Stammbaum im Vollbild: Der neue Knopf „Vollbild“ oben rechts im Baum zeigt
  ihn bildschirmfüllend — besonders praktisch auf dem Handy. Beenden mit
  „Vollbild beenden“, der Zurück-Taste des Handys oder Esc. Die Legende
  bleibt erreichbar.
- Beim Einspielen einer GEDCOM-Datei zeigt die Vorschau, welche Personen es
  schon gibt — auch aus anderen Importen —, aufgeteilt nach „sicher“, „sehr
  wahrscheinlich“, „wahrscheinlich“ und „unklar“. Du entscheidest je Person:
  neu anlegen (vorausgewählt) oder mit der vorhandenen Person verknüpfen.
- Verknüpfen ergänzt die vorhandene Person nur: Leeres wird gefüllt,
  Abweichendes kommt als Zweitangabe dazu, nichts wird überschrieben. Hat
  sich seit der Vorschau etwas geändert, wird nichts importiert, und die
  Vorschau sagt dir, was du neu entscheiden musst.
- Wurden Personen zusammengeführt, siehst du im Abschnitt „Änderungen“ jetzt
  auch die Einzelheiten zu Ereignissen, Namen, Belegen, Bildern und
  Beziehungen der früheren Person, wenn du diese damals sehen durftest. Das
  gilt für Änderungen ab diesem Update.
- „Importe verbinden“ auf dem Handy: Die Personenzahl steht ordentlich neben
  dem Namen, und die Übersicht der Importe ist lesbar beschriftet.
- Zusätzlicher Schutz: Der Browser führt auf den Seiten des Stammbaums nur
  noch Programmteile der App selbst aus.

## 2026-11-26.2 — Änderungen zusammengeführter Personen

- Im Abschnitt „Änderungen“ einer Person stehen jetzt auch die früheren
  Änderungen der Personen, die mit ihr zusammengeführt wurden —
  gekennzeichnet mit „aus zusammengeführtem Eintrag“.

## 2026-11-26.1 — Einstellungen in der App, Änderungen besser nachvollziehbar

- Neue Seite „Einstellungen“ im Menü „Verwaltung“ (nur für
  Administratoren): Einstellungen der Installation lassen sich direkt in der
  App setzen, ändern und entfernen. Die Seite zeigt, welcher Wert gerade
  gilt.
- Die Adresse für den Claude-Connector, die auf der Seite „KI-Zugang“ in der
  Anleitung steht, trägt ein Administrator jetzt dort ein.
- In den Änderungen siehst du auch bei gelöschten oder zusammengeführten
  Personen wieder die Werte vorher und nachher, wenn die Person zu einer
  deiner Familien gehörte. Das gilt für Einträge ab diesem Update.

## 2026-11-23.1 — Zusammenführen leichter, Herkunft sichtbar, KI prüft Dubletten vor

- Personenseite: Der neue Knopf „Zusammenführen …“ zeigt mögliche Dubletten
  dieser Person mit Begründung und darunter eine Suche nach jeder anderen
  Person. Zusammengeführt wird weiterhin erst im Vergleich.
- Nach dem Zusammenführen nennt die Ergebnisseite Verwandte, die jetzt
  doppelt dastehen. Die sicheren lassen sich nach einer Vorschau gemeinsam
  zusammenführen.
- Sind nur die Eltern doppelt erfasst, geht „Erst die Eltern, dann dieses
  Paar“ in einem Schritt.
- Alte Links und Lesezeichen einer zusammengeführten Person führen von
  selbst zur bleibenden Person.
- Stammbaum: Der Schalter „Herkunft“ zeigt an jeder Karte, aus welchem
  Import eine Person stammt (Buchstaben A, B, C …; „H“ = von Hand erfasst).
  Ein Klick in der Legende hebt alle Personen eines Imports hervor.
- Personenseite: Der Block „Herkunft“ nennt die Importe der Person und ob
  sie aus mehreren Einträgen zusammengeführt wurde.
- Importe haben lesbare Namen: Administratoren benennen sie unter
  „Verwaltung“ → „Daten“. „Importe verbinden“ zeigt dazu eine Übersicht, wie
  viele Personen zwei Importe schon verbinden.
- Der KI-Assistent kann mögliche Dubletten vorprüfen und hinterlässt am Paar
  eine Einschätzung mit Begründung: „zusammenführen“, „strittig“ oder „kein
  Duplikat“. Du siehst sie unter „Mögliche Dubletten“ (mit Filter), im
  Hinweis auf der Personenseite und im Dialog „Zusammenführen …“.
  Zusammenführen kann die KI nie — das entscheidest immer du.
- Wurde ein Eintrag seit der Einschätzung geändert, steht „veraltet“ daran.
- Seiten laden zuverlässiger: Das gelegentliche kurze Neuaufbauen einer
  Seite direkt nach dem Laden ist behoben.
- Mehr Schutz für deine Daten: Scans einer gemeinsam genutzten Quelle kann
  nur noch löschen, wer auch die Quelle löschen dürfte. Die KI lehnt das
  Löschen ab, wenn dabei ein Bild verloren ginge. In der Änderungsgeschichte
  sind Namen fremder KI-Schlüssel nicht mehr zu sehen.

## 2026-11-22.5 — Orte in der Anzeige

- Auf der Personenseite steht bei zugeordneten Orten jetzt der vollständige
  Ort als Link, zum Beispiel „Karlsruhe, Baden-Württemberg, Deutschland“. Ein
  Klick führt zur Ortsseite mit allen Schreibweisen und den Personen, die
  ebenfalls mit diesem Ort zu tun haben.
- Dein eingegebener Text bleibt gespeichert. Er steht klein daneben, wenn er
  mehr sagt als der Ortsname, etwa eine Anschrift.
- Nach dem Speichern erscheint der Ort sofort als Link — bisher erst nach
  erneutem Laden der Seite.

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
