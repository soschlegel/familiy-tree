# GEDCOM-Bibliothek (`lib/gedcom`)

Reine TypeScript-Bibliothek ohne Datenbank und ohne neue Abhängigkeit:
GEDCOM lesen (5.5, 5.5.1, 7.0 — nachsichtig), in ein neutrales
Zwischenmodell übersetzen, für die Importvorschau prüfen, zwei Exporte
vergleichen und GEDCOM 5.5.1 (UTF-8) schreiben. Der Import in die Datenbank,
die Vorschau-Oberfläche und der Export der App bauen darauf auf (Schritt G3).

## Schnittstelle

```ts
import {
  parseGedcom,          // Bytes/Text → { document, warnings, unknownTags, encoding, stats }
  writeGedcom,          // document → { text, bytes, idMap, warnings }   (5.5.1, UTF-8, optional BOM)
  diagnoseGedcom,       // document → Diagnosen (Schwere + deutsche Meldung), ändert nichts
  diffDocuments,        // (alt, neu) → je Datensatzart neu/entfernt/geändert/nur Stempel/gleich
  deriveRelationships,  // Familien → Partnerschaften + Eltern-Kind (App-Begriffe)
  familiesFromRelationships, // App-Beziehungen → Familien (für den Export)
  toAppDate, fromAppDate,    // GEDCOM-Datum ↔ Genauigkeit/Zusatz/Bereich der App
  verifyLossless,       // Nachweis: jede Zeile verstanden oder als Rohdaten erhalten
} from "@/lib/gedcom";
```

Das Modell (`types.ts`) besteht nur aus serialisierbaren Werten:
`GedcomDocument { header, persons, families, sources, repositories, notes,
media, submitters, unknownRecords }`. Was nicht verstanden wird, hängt als
`extensions: { path, node }[]` am nächsten Element (Pfad relativ zu diesem
Element) und wird vom Writer an dieselbe Stelle zurückgeschrieben.

Prüfprogramm: `npm run gedcom:check -- datei.ged [--show-names] [--json]
[--compare älterer-export.ged]` — gibt standardmäßig nur Zählungen, Tag-Pfade
und Kennungen aus, keine Namen, Daten, Orte oder Texte.

## Entscheidungen

- **Kodierung**: BOM → UTF-16 ohne BOM (Nullbytes) → `HEAD.CHAR` → Gegenprobe
  gegen die Bytes (ANSEL/ANSI behauptet, aber gültiges UTF-8 → UTF-8; UTF-8
  behauptet, aber ungültig → Windows-1252) → Rückfall UTF-8 bzw.
  Windows-1252. ASCII/ANSI/IBM WINDOWS/IBMPC werden als Windows-1252 gelesen
  (in der Praxis enthalten „ASCII“-Dateien oft Umlaute). **ANSEL ist selbst
  implementiert** (`ansel.ts`, Tabelle nach GEDCOM 5.5.1 Anhang D und MARC 21):
  ~100 Zeilen, kein Paket nötig; kombinierende Zeichen stehen in ANSEL vor dem
  Buchstaben und werden umgestellt und NFC-normalisiert.
- **Datum** ist eigenständig (`dates.ts`), nicht aus `lib/dates.ts`
  importiert: Die Bibliothek soll ohne App-Code laufen, und `lib/dates.ts`
  arbeitet mit `Date`-Objekten und wird parallel um Bereiche erweitert.
  `toAppDate()` liefert Genauigkeit/Zusatz in denselben String-Werten
  (`DAY|MONTH|YEAR`, `EXACT|ABOUT|BEFORE|AFTER`) plus `end`/`range` für
  Bereiche und `lossy`, wenn die App-Form weniger sagt als das Original.
  `original` bleibt immer erhalten.
- **Familienstand** (`status.ts`): `MARRIED` (MARR), `DIVORCED` (DIV/ANUL),
  `UNMARRIED` nur bei ausdrücklicher Angabe, sonst `UNKNOWN` mit
  `statusEvidence: "NO_MARRIAGE_EVENT"`. ENGA/MARB/MARC/MARL/MARS allein
  ändern nichts. Der Writer schreibt UNKNOWN ohne MARR und ohne Markierung,
  UNMARRIED als `1 _STAT Unmarried` (nicht als MARR+TYPE, weil 5.5.1-Leser
  jedes MARR als Ehe deuten).
- **HUSB/WIFE beim Export**: Mann → HUSB, Frau → WIFE; bei gleichem oder
  unbekanntem Geschlecht nach Reihenfolge (erster HUSB, zweiter WIFE) wie
  Gramps und GEDCOM 7 (dort sind HUSB/WIFE nur „Partner 1/2“). Zwei
  HUSB-Zeilen werden gelesen, aber nicht geschrieben.
- **Eltern-Kind-Art**: gelesen aus `FAMC.PEDI`, `ADOP`-Ereignis
  (`FAMC`/`ADOP BOTH|HUSB|WIFE`) und `_FREL`/`_MREL` (FTM/Legacy, je
  Elternteil). Geschrieben als `PEDI` (adopted/foster/step/birth), bei
  unterschiedlicher Art je Elternteil zusätzlich `_FREL`/`_MREL`.
  `step` ist kein 5.5.1-Wert, wird aber von verbreiteten Programmen gelesen.
- **Kein Download**: Medien bleiben Pfade bzw. URLs.
- **Privatsphäre**: RESN, `_PRIV`/`_PRIVATE`/`_LIVING`, Platzhalternamen
  („Private“, „Living“, „Lebend“ …) werden nur markiert (`person.privacy`).
- **Kopf beim Export**: Tags unter `HEAD.SOUR`/`DATE`/`GEDC`/`CHAR` des
  früheren Programms (z.B. `_RTLSAVE`) werden nicht übernommen; übrige
  Kopf-Erweiterungen und Kopf-Kennungen (`_UID`, `_PROJECT_GUID`) schon.

## Verlustfreiheit

Jeder verstandene Knoten wird (mit `keepRaw: true`) vermerkt; alles andere
landet unverändert in `extensions`/`unknownRecords`. `verifyLossless()` läuft
über den Rohbaum und prüft, dass jeder Knoten verstanden oder erhalten ist,
und dass die Zeilenbilanz aufgeht (Zeilen = Knoten + CONC/CONT + Leerzeilen +
reparierte + verworfene). Einzig verworfen werden unlesbare Zeilen *vor* dem
ersten Datensatz (gezählt, mit Warnung). Tests: `tests/gedcom-parser.test.ts`
(alle Fixtures) und Roundtrips in `tests/gedcom-writer.test.ts`.

## Wiedererkennung bei erneutem Import

`diffDocuments(alt, neu)` ordnet je Datensatz über `_UID` (7.0 `UID`) → `RIN`
→ Xref zu und übersetzt Verweise vor dem Vergleich. Stabilität der Schlüssel:

| Schlüssel | Stabilität | Herkunft |
|---|---|---|
| `_UID` (INDI, FAM, Ereignisse) | als dauerhafte Kennung gedacht; MyHeritage schreibt sie an jede Person/Familie | Konvention verbreitet (Tamura Jones, „_UID“); Stabilität über Exporte **angenommen** |
| `RIN MH:I…` | MyHeritage-interne Datensatznummer | Muster aus Beispieldateien; Stabilität **angenommen** |
| Xref `@I…@` | bei MyHeritage gleich der RIN-Nummer (echte Datei: 100 %) | beobachtet; laut Spezifikation **nicht** stabil |
| `_UPD` / `CHAN` | ändert sich bei Bearbeitung | Bedeutung laut webtrees „Updated at“; als Änderungsstempel genutzt |
| `_PHOTO_RIN MH:P…` | Kennung des Fotos | Beispieldateien; Stabilität **angenommen** |
| Quellen (`SOUR`) | MyHeritage-Quellen haben weder `_UID` noch `RIN` → nur Xref | echte Datei (beobachtet) |

## Unterstützt / bewusst nicht

Unterstützt: alle 5.5.1-Datensätze (HEAD, INDI, FAM, SOUR, REPO, NOTE, OBJE,
SUBM), Personen- und Familienereignisse und Merkmale, Namen mit allen Teilen
und Varianten, Orte mit Ebenen und Koordinaten, Adressen, Belege (PAGE,
QUAY, DATA, EVEN/ROLE), eingebettete Quellen, Notizen mit HTML, Medien
(Datensatz und eingebettet), 7.0: `UID`, `EXID`, `SNOTE`, `MIME`, Kalender als
Wort, `BCE`, `@VOID@`, `NO MARR`, RESN-Listen, PEDI in Großbuchstaben.
Nicht interpretiert (bleibt als Rohdaten erhalten): `ASSO`, `ALIA`, LDS-
Verordnungen, `SUBN`, 7.0 `PHRASE`/`SDATE`/`CROP`/`TRAN`/`SCHMA`, MyHeritage
`_PARENTRIN`/`_PARENTPHOTO`/`_POSITION`/`_RINS`/`_PUBLISH`/`_MTTAG`.
Bewusst nicht: Hebräischer Kalender wird nicht umgerechnet (bleibt mit
`unconverted`), Französisch-Republikanisch nur mit vollem Datum und Jahren
I–XIV, Codepage 850/437 („IBMPC“) wird als Windows-1252 gelesen, der Writer
schreibt nur 5.5.1 (nicht 7.0, nicht ANSEL), `SEX X` wird in 5.5.1 zu `U`,
Unterzeilen von `TRLR` werden nicht geschrieben.

## Leistung

Generierte Datei im MyHeritage-Stil (`tests/fixtures/gedcom/generate.ts`,
Messung `npx tsx tests/fixtures/gedcom/measure.ts <anzahl> [datei] [--parse-only]`),
Node 24, Windows:

| Personen | Datei | Lesen | Prüfen | Schreiben | Heap nach Lesen | Spitze RSS |
|---|---|---|---|---|---|---|
| 20 000 | 7,4 MB | 0,9 s | 0,7 s | 1,2 s | 114 MB | 0,5 GB (alles) |
| 100 000 | 37 MB | 4,4 s | 3,3 s | 6,1 s | 570 MB | 1,4 GB (alles) |
| 135 000 | 51 MB | 5,7 s | — | — | 750 MB | 1,05 GB (nur Lesen) |

Der Tokenizer arbeitet Datensatz für Datensatz (Generator, kein Zeilen-Array);
der Speicher steckt im Modell selbst. Für Dateien dieser Größe sollte der
Import in einem eigenen Prozess bzw. mit ausreichend `--max-old-space-size`
laufen.

## Quellen

Formate:
- GEDCOM 5.5.1 (mit Errata): https://gedcom.io/specifications/ged551-with-inline-errata.html — Zeilengrammatik, CONC/CONT, `@@`, Zeichensätze, ANSEL (Anhang D), Datumsgrammatik und Kalender, Lineage-Linked-Form, PEDI, ADOP.
- FamilySearch GEDCOM 7.0: https://gedcom.io/specifications/FamilySearchGEDCOMv7.html und Aufzählungen https://github.com/FamilySearch/GEDCOM/blob/main/specification/gedcom-3-structures-4-enumerations.md — kein CONC, nur führendes `@@`, nur UTF-8, `NO`, `UID`/`EXID`, `SNOTE`, Kalender als Wort.
- GEDCOM 5.5.5 / Paarbeziehungen über MARR.TYPE: https://www.tamurajones.net/GEDCOMRelationships.xhtml
- MARC 21 ANSEL-Tabelle (Library of Congress, „Extended Latin“).
- `_UID`: https://www.tamurajones.net/The_UIDTag.xhtml

MyHeritage-Dialekt (aus Dokumentation bzw. öffentlich gezeigten Beispieldateien = **belegt**, sonst **angenommen**):
- Kopf `SOUR MYHERITAGE`, `NAME MyHeritage Family Tree Builder`, `CORP MyHeritage.com`, `DEST MYHERITAGE`, `_RTLSAVE RTL`, `_RINS`, `_UID`, `_DESCRIPTION_AWARE`, Datensatz `0  _PUBLISH` (mit Doppel-Leerzeichen) mit `_USERNAME`/`_DISABLED`; `RIN MH:…`, `_UID`, `_UPD … GMT+1` an Personen und Ereignissen — **belegt**: https://yed.yworks.com/support/qa/17205/gedcom-import-from-myheritage-familytreebuilder-fails
- Tag-Liste (`_PROJECT_GUID`, `_EXPORTED_FROM_SITE_ID`, `_TIMEZONE`, `PERSONALPHOTO`, `*:_UPD`) — **belegt**: webtrees `app/CustomTags/MyHeritage.php` (https://github.com/fisharebest/webtrees)
- Fotos als eingebettetes `OBJE` mit `FORM jpg`, `FILE https://sites-cf.mhcache.com/…`, `_FILESIZE`, `_PRIM`, `_CUTOUT`, `_PARENTRIN`, `_PERSONALPHOTO`, `_PHOTO_RIN` — **belegt**: https://gramps.discourse.group/t/imported-media-e-g-from-myheritage-gedcom-export-handling/7886 ; MyHeritage-Hilfe „Exporte enthalten Links zu den Fotos“.
- HTML-Fragmente und unmarkierte Zeilenumbrüche in Notizen — **belegt**: https://gramps.discourse.group/t/import-of-gedcom-file-from-myheritage-fails/5722
- `_MARNM` unter `INDI.NAME` — **belegt** (Fixtures eines anderen Parsers): https://github.com/cacack/gedcom-go/issues/732 ; außerdem in der echten Datei beobachtet.
- `_PRIM_CUTOUT`, `_PARENTPHOTO`, `_MTTAG` — **belegt** als Tags (https://github.com/borisovodov/doru/pull/168), Bedeutung **angenommen**.
- Quellen mit `_TYPE`, `_MEDI`, Zitate mit `PAGE`, `QUAY`, `DATA/TEXT`, `EVEN/ROLE` — in der echten Datei beobachtet.
- Adoption bei MyHeritage (`PEDI` vs. `_FREL`/`_MREL`), `RESN`/Privatsphäre-Tags und Platzhalternamen bei MyHeritage — **angenommen** (nicht in Beispielen gefunden, in der echten Datei nicht vorhanden); alle gängigen Formen werden gelesen.
- `_FREL`/`_MREL` (FTM/Legacy/Ancestry) — **belegt** als Tags (gedcom-go #732), Werte „Natural/Adopted/Step“ belegt, „Foster“ angenommen.
- `_STAT`/`_MSTAT`/`_UST` als Familienstand — Tag-Bedeutung laut FHUG-Erweiterungsliste (https://fhug.org.uk/kb/kb-article/gedcom-extension-list/) **belegt**, konkrete Werte („Never Married“, „Partners“) **angenommen**.
- Nachsichtige Zeilen (fehlende Leerzeichen, Zeiger mit Kommentar, doppelte HEAD) — https://github.com/borisovodov/doru/pull/168
