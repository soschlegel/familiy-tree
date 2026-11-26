# Austauschformat

`/admin/data` bietet Export und Import.

- **JSON** — Personen, Beziehungen, Quellen mit Belegen und Bildzuordnungen.
  Bilder erscheinen als Verweis auf einen Dateinamen.
- **ZIP** — dasselbe JSON plus die Bilddateien unter `media/`. Damit ist der
  Export ein vollständiges Backup und ein Umzug auf eine andere Instanz
  funktioniert wirklich.
- **GEDCOM** — Export als GEDCOM 5.5.1 (UTF-8), auf Wunsch als ZIP mit den
  Bildern; Import mit Vorschau und Abgleich, siehe [GEDCOM](gedcom.md).

Der Import zeigt zuerst eine Vorschau (wie viel neu, wie viel aktualisiert) und
ändert erst nach ausdrücklicher Bestätigung etwas. Bestehende Einträge werden
über ihre ID wiedererkannt und aktualisiert, unbekannte ergänzt — **gelöscht
wird nie**. Importieren dürfen nur Administratoren; exportieren darf jeder, der
die Daten ohnehin sehen kann.

Formatversion 2 enthält zusätzlich je Datum Genauigkeit und Zusatz
(`birthDatePrecision`, `birthDateQualifier`, …) sowie `sources` und
`citations`. Belege werden nur für exportierte Personen und Beziehungen
mitgenommen, Quellen nur, soweit sie dafür zitiert sind (Administratoren:
alle; sonst zusätzlich die eigenen unbelegten). Ältere Exporte (Version 1)
ohne diese Felder lassen sich unverändert importieren; ihre Daten gelten als
tagesgenau.

Formatversion 3 enthält zusätzlich Datumsbereiche und Wortlaut (`…To`,
`…ToPrecision`, `…Phrase`), die neuen Zusätze, Rufname, Titel,
Namenszusatz, Todesursache, Heirats- und Scheidungsort, `events`
(Lebensereignisse), `personNames` (weitere Namen), Belege an Ereignissen,
`externalIds` (Fremdkennungen) und `rawRecords` (nicht zugeordnete
Importdaten) — jeweils nur für exportierte Personen, Beziehungen und Quellen.
Importläufe und ihre Herkunftsangaben gehören zur Instanz und reisen nicht
mit. Dateien der Versionen 1 und 2 lassen sich weiter unverändert importieren.

Formatversion 4 enthält zusätzlich die Bilder an Quellen (`sources[].media`,
neben dem Hauptscan `mediaId`), an Ereignissen (`events[].media`) und an
Belegen (`citations[].media`), je `{ mediaId, sortOrder }` mit Verweis auf
`media`. Sie reisen mit, wenn ihr Eintrag exportiert wird (bei der
Familienauswahl also nur an Exportiertem); der Import hängt sie ergänzend
wieder an. Dateien der Versionen 1–3 lassen sich weiter importieren.
