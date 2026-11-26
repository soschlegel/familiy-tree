# Fokus-Ansicht

Der ganze Baum wächst mit jeder Person in die Breite (die Mock-Daten mit 195
Personen sind über 10 000 px breit). Die Baumseite beginnt deshalb mit einem
Ausschnitt: eine Person im Mittelpunkt, darüber ihre Vorfahren, darunter ihre
Nachkommen — für die Startperson der Mock-Daten 23 Personen auf rund
1 900 × 750 px.

- **Inhalt** — Fokusperson mit allen Partnern, Vorfahren (leibliche, Adoptiv-,
  Stief- und Pflegeeltern) bis zur gewählten Tiefe, Geschwister und
  Halbgeschwister, Nachkommen bis zur gewählten Tiefe samt deren Partnern bzw.
  weiteren Elternteilen. Tiefe je Richtung 1–4 (Standard 2) über „Vorfahren“
  und „Nachkommen“ in der Werkzeugleiste.
- **Rand** — Karten am Rand zeigen, was jenseits liegt: „▲ Vorfahren“ (weitere
  Eltern) und „▼ +3 Kinder“ (Kinder außerhalb des Ausschnitts, z.B. Onkel und
  Tanten bei Großeltern). Ein Klick auf die Karte holt sie in den Ausschnitt.
- **Klicks** — in der Fokus-Ansicht stellt ein Klick auf eine Karte die Person
  in den Mittelpunkt; die angeklickte Karte bleibt dabei stehen, die übrigen
  gleiten an ihren Platz. Die Personenseite öffnet das Symbol in der
  Kartenecke (bzw. die Karte der Fokusperson selbst). Im ganzen Baum ist es
  umgekehrt: Karte → Personenseite, Ecksymbol → Fokus-Ansicht.
- **Adresse** — `/tree?focus=<id>&up=<1–4>&down=<1–4>`; Standardwerte entfallen.
  Zurück/Vor, Neuladen und „Im Stammbaum zeigen“ auf der Personenseite führen
  dorthin. Den ganzen Baum zeigen `/tree?view=generations` bzw.
  `/tree?view=timeline` (mit `focus=<id>` darauf zentriert).
- **Einstieg** — ohne `focus` die zuletzt fokussierte Person (Cookie
  `tree-focus`, wird serverseitig auf Sichtbarkeit geprüft), sonst die
  sichtbare Person, deren Ausschnitt die meisten Generationen und darin die
  meisten sichtbaren Verwandten zeigt. Ohne gemerkte Person steht die
  [Bezugsperson](bezugsperson.md) im Mittelpunkt.
- **Suche** — durchsucht in der Fokus-Ansicht den ganzen sichtbaren Bestand
  (`/api/persons?q=`) und stellt den Treffer in den Mittelpunkt.
- **Gesperrte Personen** erscheinen wie im ganzen Baum als Platzhalter (ohne
  Randhinweise) und können nicht in den Mittelpunkt rücken; eine unbekannte
  oder gesperrte `focus`-ID ergibt einen Hinweis statt eines leeren Bildes.
- **Vollbild** — der Knopf „Vollbild“ rechts oben in der Baumfläche (auch im
  ganzen Baum) zeigt die Fläche bildschirmfüllend, ohne Kopfzeile und
  Werkzeugleiste; Legende, Zoom und Fokus-Verlauf bleiben, Klicks wirken wie
  sonst. Zustand in der Adresse (`?vollbild=1`, wird bei Fokuswechseln
  mitgenommen); „Vollbild beenden“, Escape oder Zurück beenden es, ohne die
  Seite zu verlassen. Technik:
  [useTreeFullscreen](../komponenten/oberflaeche-komponenten.md#componentsusetreefullscreents).
- **Filter** — der Familienfilter ist in der Fokus-Ansicht abgeschaltet (der
  Ausschnitt zeigt ohnehin nur nahe Verwandte). „Ehen zeigen“ aus blendet
  Partner ohne gemeinsames Kind im Ausschnitt aus; Eltern der Nachkommen
  bleiben.

Der Server schickt nur den Ausschnitt (`loadFocusTree` in
[lib/services/tree.ts](../../lib/services/tree.ts), aufgebaut auf dem maskierten
Graphen von `loadTree`; Auswahl und Layout in
[lib/focus-tree.ts](../../lib/focus-tree.ts)). Den ganzen Graphen lädt die Seite erst
beim Wechsel auf „Generationen“ oder „Zeitstrahl“. Das Layout ist dasselbe wie
in der Generationenansicht, nur mit fest vorgegebenen Ebenen (Abstand zur
Fokusperson) und engerem Zeilenabstand.

## Grenzen

Die [Fokus-Ansicht](#) schickt nur einen Ausschnitt in den
Browser (Mock-Daten: 13 KB Baumdaten statt 93 KB); ihre Größe hängt von der
Tiefe und der Familiengröße ab, nicht vom Bestand. Der Server liest dafür aber
weiterhin den ganzen Graphen aus der Datenbank (eine Abfrage für Personen,
eine für Beziehungen) — bei sehr großen Beständen wäre hier auf eine
schrittweise Abfrage ab der Fokusperson umzustellen.

Die beiden Gesamtansichten (Generationen, Zeitstrahl) laden weiterhin den
kompletten Graphen in den Browser und legen ihn dort aus. Das bleibt bis rund
1000 Personen benutzbar, ergibt aber eine sehr große Fläche; darüber hinaus
ist die Fokus-Ansicht der vorgesehene Weg.
