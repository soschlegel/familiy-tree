# Bezugsperson

Jeder Benutzer kann sich eine Person zuordnen („das bin ich“): auf der
Personenseite mit **„Das bin ich“** (nur für Personen, die er sehen darf),
oder ein Administrator tut es in der Benutzerverwaltung („Person:
zuordnen“). Gespeichert in `User.personId` (Migration
`20261122000001_bezugsperson`, `ON DELETE SET NULL`; beim Zusammenführen
wandert der Verweis auf die bleibende Person).

Daneben lässt sich **vorübergehend eine andere Person** als Bezugsperson
wählen — etwa im Gespräch mit dem Sohn, um den Baum aus seiner Sicht zu
zeigen: „Baum aus dieser Sicht“ auf seiner Personenseite bzw.
`/tree?bezug=<id>` (auch `/people/<id>?bezug=<id>`). Der Browser merkt sie
sich im Cookie `tree-bezug`; oben steht dann deutlich „Sicht von: <Name> ·
zurück zu mir“ (ohne eigene Person: „aufheben“), `?bezug=ich` führt ebenfalls
zurück. Vorrang: Adresse vor Cookie vor eigener Person.

- **Baum** (alle drei Ansichten) — unter jeder Karte der Verwandtschaftsgrad
  zur Bezugsperson („Urgroßvater väterlicherseits“, „Cousine 1. Grades,
  eine Generation darüber“, „Schwägerin“, „angeheirateter Onkel …“), auch für
  Screenreader. Die Bezugsperson selbst ist gestrichelt umrandet und trägt
  „Bezugsperson“ bzw. „ich · Bezugsperson“. Ohne `focus` steht sie in der
  Fokus-Ansicht im Mittelpunkt.
- **Linien** (Schalter in der Werkzeugleiste, im Cookie `tree-lines` gemerkt)
  — Vorfahren nach den vier Großeltern getönt, wie bei MyHeritage: väterlich
  Blau (Vater des Vaters, „VV“) und Grün („VM“), mütterlich Rot („MV“) und
  Gelb („MM“). Nie nur Farbe: jede Karte trägt zusätzlich Streifen und
  Kurzzeichen, die Legende nennt die vier Großeltern. Vater und Mutter
  gehören zu beiden Linien ihrer Seite, Vorfahren mit Ahnenschwund zu
  mehreren; alle anderen bleiben neutral. Auch die **Verbindungen** der
  Ahnenketten sind farbig (`edgeLine` in [lib/reference.ts](../../lib/reference.ts)):
  eine Eltern-Kind-Linie bekommt die Farbe, wenn Eltern- und Kindseite genau
  eine Linie gemeinsam haben; Verbindungen zu Vater/Mutter/Bezugsperson
  (mehrere Linien) und zu Seitenverwandten bleiben grau, das Strichmuster der
  Elternschaftsart bleibt. Farben als CSS-Variablen (`--line-ff` …) in
  [app/globals.css](../../app/globals.css), je eigene Werte für das dunkle
  Farbschema.
- **Personenseite** — „Für dich (…) ist X: Großonkel väterlicherseits“, dazu
  „Das bin ich“ und „Baum aus dieser Sicht“.

**Berechnung** ([lib/reference.ts](../../lib/reference.ts)): ein Durchgang von der
Bezugsperson aus statt einer Abfrage je Paar — erst ihre Vorfahren
(`ancestorDistances`), dann von allen Vorfahren gleichzeitig abwärts,
geordnet nach (Abstand gesamt, Abstand hinauf); das ergibt für jede Person
den nächsten gemeinsamen Vorfahren wie `findBloodRelation`, samt Halb-,
Adoptiv- und väterlicher-/mütterlicherseits. Wer nicht blutsverwandt ist,
bekommt den Begriff des kürzesten Wegs über Eltern- und Partnerkanten
(`describePath`, dieselben Wege wie `shortestPath`); passt kein Begriff,
bleibt die Karte ohne Angabe. `tests/reference.test.ts` vergleicht das
Ergebnis für alle Paare der Mock-Daten und erzeugter Bäume mit
`kinshipInGraph`. Linien: Vater/Mutter (leiblich vor adoptiv, je
Geschlecht), deren Eltern als die vier Großeltern, und deren Vorfahren.
Gemessen: rund 1 ms auf den Mock-Daten, rund 50 ms für 10 000 erzeugte
Personen mit 23 000 Kanten.

**Datenschutz**: gerechnet wird nur auf dem Graphen der Personen, die der
Benutzer sehen darf (Kanten zwischen zwei sichtbaren Personen,
`visibleIndex` in [lib/services/reference.ts](../../lib/services/reference.ts)).
Gesperrte Platzhalter bekommen keine Angabe und keine Linie, kein Weg führt
über sie (ein sichtbarer Urgroßvater hinter einem gesperrten Großvater bleibt
ohne Bezeichnung), eine gesperrte Person kann nicht Bezugsperson sein
(unbekannt und gesperrt sehen gleich aus), und die Legende nennt nur
sichtbare Großeltern („nicht erfasst“ sonst). Das ist strenger als die
MCP-Abfrage `get_kinship`, die Wege durch Platzhalter zulässt.
