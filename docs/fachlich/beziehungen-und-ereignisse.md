# Beziehungen, Lebensereignisse und Namen

Beziehungen liegen in einer eigenen Tabelle statt als `parentId` an der
Person: Ein Stammbaum ist ein Graph, kein Baum — nur so sind zwei
Elternteile, Adoption, Stiefverhältnisse, Mehrfachehen und
Beziehungszeiträume ohne Schemaänderung abbildbar. Alle Tabellen und Felder:
[datenmodell.md](../komponenten/datenmodell.md).

## Regeln für Beziehungen

Geprüft in [lib/validation.ts](../../lib/validation.ts) und
[lib/services/relationships.ts](../../lib/services/relationships.ts):

- Die Art muss zum Typ passen — Eltern: leiblich, adoptiert, Stief, Pflege;
  Partner: verheiratet, unverheiratet, geschieden, Ehestand unbekannt
  (`PARTNER_UNKNOWN`, z.B. aus einem Import ohne Heiratsangabe; zählt nicht
  als Ehe, heißt in Verwandtschaftsbegriffen „Partner/Partnerin“).
- Höchstens **zwei leibliche** Eltern; Adoptiv-, Stief- und Pflegeeltern
  kommen beliebig hinzu.
- Keine Zyklen (niemand ist sein eigener Vorfahre), keine Partnerschaft
  zwischen Elternteil und Kind, keine doppelten Beziehungen.
- Daten müssen plausibel sein: kein Jahr vor 1000, Geburt und Tod nicht in der
  Zukunft, Tod nicht vor der Geburt, Ende einer Beziehung nicht vor ihrem
  Beginn — bei ungenauen Daten nur, wenn es für jede Lesart gilt (siehe
  [Ungenaue Daten](ungenaue-daten.md)).

## Lebensereignisse, Namen und Import

Jede Angabe steht an genau einer Stelle (Regeln in
[lib/events.ts](../../lib/events.ts)):

| Angabe | Ort |
|---|---|
| Geburt, Tod (Datum, Ort, Wortlaut, Todesursache) | Spalten an `Person` |
| Heirat bzw. Beginn einer Partnerschaft, Scheidung bzw. Ende | `Relationship.startDate/startPlace`, `endDate/endPlace` |
| Hauptname | `givenName`, `familyName` (heutiger, z.B. Ehename), `birthName`, `nickname`, `namePrefix`, `nameSuffix` |
| weitere Namen | `PersonName` |
| alles andere — Taufe, Konfirmation, Beruf, Wohnort, Auswanderung, Militärdienst, Beerdigung, Verlobung, Aufgebot, … | `Event` an der Person bzw. Beziehung |

Eine zweite, abweichende Angabe zu Geburt, Tod, Heirat oder Scheidung (in
GEDCOM-Dateien häufig) überschreibt nichts, sondern wird ein Ereignis mit
`isAlternative`; die Arten BIRTH, DEATH, MARRIAGE und DIVORCE gibt es nur
so. Alternativen erscheinen nicht in Zeitleisten und Plausibilitätsprüfung.
Unbekannte Ereignisarten sind `CUSTOM` mit freier Bezeichnung. Ereignisse
sind sichtbar und änderbar wie ihr Träger. Sie erscheinen in Personendetail,
Zeitleisten, Personensuche nach Ort (jeder Ort einer Person, auch Heirats-
und Ereignisorte) und Plausibilitätsprüfung (Beerdigung vor dem Tod,
Ereignis vor der Geburt bzw. nach dem Tod); „Ehe ohne Ort“ und „Ehestand
unbekannt“ sind Datenlücken an Beziehungen.

**In der Oberfläche:** Die Personenseite hat den Abschnitt
„Lebensereignisse“ — Ereignisse der Person und ihrer Partnerschaften
(Verlobung, Aufgebot …, mit „mit <Partner>“ gekennzeichnet) in einer
chronologischen Liste, undatierte am Ende; Bearbeiter legen dort an, ändern,
löschen und hängen über „Beleg“ eine Quelle an ein Ereignis. Abweichende
Hauptangaben stehen als „abweichende Angabe“ neben Geburt bzw. Tod im Kopf
und neben der Heirat auf der Partnerkarte, bearbeitet werden sie in der
Ereignisliste (eigene Gruppe). Rufname, Namenszusätze und Todesursache
stehen im Kopf und im Personenformular unter „Weitere Angaben“, weitere
Namen in einer eigenen Karte. Heirats-/Scheidungsorte und „Ehestand
unbekannt“ (im Baum gepunktete Linie mit „?“) pflegt der Beziehungseditor.
Datumsfelder verstehen Bereiche; ein Text, der kein Datum ist, lässt sich
per Häkchen bewusst als Wortlaut speichern und bleibt im Feld bearbeitbar.
Die Personenliste sucht zusätzlich nach Ort und nennt bei Treffern über
Rufname, weiteren Namen oder Ereignisort den Grund.

**Import** (Dienste in [lib/services/imports.ts](../../lib/services/imports.ts) und
[lib/services/import-apply.ts](../../lib/services/import-apply.ts), nur
Administratoren): Jeder Lauf (`ImportBatch`) bewahrt die Originaldatei unter
`MEDIA_DIR/imports/` auf (also in der normalen Bildersicherung). Jeder
importierte Datensatz hat eine Herkunft (`ImportLink`: Lauf, Schlüssel in der
Quelle, Fingerabdruck der importierten Werte, Änderungsstempel der Quelle) und
optional Fremdkennungen (`ExternalId`, z.B. `_UID`). So erkennt ein
erneuter Import desselben Baums seine Datensätze wieder und sieht, was seither
in der App geändert wurde — das wird nicht still überschrieben. Was der Import
nicht deuten kann, landet als JSON-Teilbaum im Rohdatenspeicher
(`ImportRawRecord`), sichtbar wie die Person bzw. Beziehung. Gelöscht wird
durch einen Import nur, was der Administrator in der Vorschau ausdrücklich
ankreuzt und bestätigt ([GEDCOM](gedcom.md)).
