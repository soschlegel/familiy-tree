# Quellen und Belege

Eine **Quelle** ist ein Dokument — ein Kirchenbuch, ein Standesamtsregister,
eine Volkszählungsliste, ein Grabstein, die Familienbibel, ein Gespräch mit
der Großmutter, eine Webseite. Sie hat Titel, Art, Verfasser/Herkunft,
Archiv und Signatur, Internetadresse, Datum (ungenau erlaubt), eine Abschrift
bzw. Notizen, optional einen Hauptscan (ein bereits hochgeladenes Bild einer
belegten Person oder Ehe) und beliebig viele weitere Bilder
([Bilder an Quellen, Ereignissen und Belegen](bilder-an-eintraegen.md)).

Ein **Beleg** verbindet eine Quelle mit genau einer Angabe: an einer Person
`Name`, `Geburt`, `Tod` oder `Allgemein` (die Person als Ganzes), an einer
Beziehung `Heirat & Partnerschaft` bzw. `Abstammung` (oder `Allgemein`).
Dazu kommen Fundstelle (Seite, Eintragsnummer), Internetadresse des
Eintrags (nur http/https; angezeigt als Link „Eintrag öffnen“ mit dem
Hostnamen, nie von der App selbst abgerufen), Verlässlichkeit (gesichert,
wahrscheinlich, unsicher oder nicht bewertet) und optional eine Abschrift
(`text`). Ein Beleg
kann auch ein einzelnes Lebensereignis stützen (`eventId`, Angabe
„Ereignis“); er hängt dann zugleich an dessen Person bzw. Beziehung, Rechte
und Export gelten wie dort. Eine Quelle kann beliebig viele Angaben vieler
Personen belegen.

**Quellen aus Importen.** Genealogie-Anbieter liefern ihre Quellen mit
eigenen Angaben (MyHeritage: `_TYPE`, `_MEDI`, HTML im Text, Adressen der
Einträge in der Fundstelle). Der GEDCOM-Import ordnet sie ein
([lib/source-classify.ts](../../lib/source-classify.ts)):

| Art | Wann |
|---|---|
| Kirchenbuch, Standesamt, Volkszählung, Grabstein … | Titel bzw. `_TYPE` nennen, was die Sammlung **ist** — auch wenn sie bei einem Anbieter liegt (der Anbieter steht dann daneben) |
| **Online-Stammbaum** | Stammbäume anderer Nutzer („… Stammbäume“, „Family Trees“, „Smart Matches“, Geni, WikiTree): **keine unabhängige Quelle** |
| **Online-Sammlung** | Sammlung/Datenbank eines erkannten Anbieters ohne bestimmbare Inhaltsart |
| Webseite / Sonstige | alles andere, wie bisher |

Der **Anbieter** (MyHeritage, Ancestry, FamilySearch, Geneanet, Filae, Geni,
WikiTree, Find a Grave, Matricula, Archion …) wird an Adressen oder am Namen
erkannt und an der Quelle angezeigt; unbekannte Anbieter bleiben leer. HTML
in Titel, Text und Notizen wird lesbarer Text (das Original bleibt in den
Rohdaten), die erste Adresse darin wird die Internetadresse der Quelle. Eine
Adresse in der Fundstelle eines Belegs wird dessen Link. Belege auf
**Online-Stammbäume** übernehmen die Verlässlichkeit der Datei nicht
(MyHeritage schreibt „QUAY 3“ an automatische Treffer) — sie sind „nicht
bewertet“ und tragen den Hinweis „aus einem Online-Stammbaum — keine
unabhängige Quelle“. Derselbe Beleg zweimal an derselben Person fällt beim
Import zusammen; ein allgemeiner Beleg, der sein Ereignis nennt (`EVEN BIRT`),
gehört zur Geburt usw.

Für schon Importiertes genügt ein erneuter Import derselben Datei: Quellen
und Belege gelten als „in der Datei geändert“ und werden berichtigt — außer
dem, was in der App von Hand geändert wurde. Ohne Datei zur Hand: im
Importverlauf (`/admin/data`) **„Aus der aufbewahrten Datei neu einlesen“** —
das Original des Laufs geht durch die normale Vorschau; geschrieben wird erst
nach „GEDCOM-Import ausführen“, der alte Lauf bleibt unverändert. Doppelte Belege aus
älteren Importen erscheinen dabei unter „Fehlt in der Datei“ und lassen sich
dort entfernen.

**Oberfläche:**

- Personenseite, Abschnitt **„Quellen“**: Belege nach Angabe gruppiert;
  Bearbeiter können Belege hinzufügen (auch mit gleich neu angelegter
  Quelle), ändern und entfernen — auch für die Ehen und Eltern-Kind-
  Beziehungen der Person. In der Beziehungsliste („Verwaltung“) führt
  „Belege“ direkt dorthin.
- **„Quellen“** in der Navigation: Liste mit Suche und Filter nach Art
  (mit Anbieter), Detailseite mit allem, wofür die Quelle zitiert wird — je
  Person bzw. Beziehung gruppiert, seitenweise —, Anlegen, Bearbeiten,
  Löschen.
- **„Recherche“**: Datenlücke „Angaben ohne Beleg“ — Personen, deren Geburt
  bzw. Tod erfasst ist (Datum oder Ort), aber keinen Beleg für genau diese
  Angabe hat.

**Rechte** (verbindlich in [lib/services/sources.ts](../../lib/services/sources.ts)):

- Ein Beleg ist sichtbar bzw. änderbar, wenn die Person (bzw. Beziehung) es
  ist, an der er hängt — dieselben Regeln wie für Personen und Beziehungen.
- Eine Quelle sieht, wer mindestens einen ihrer Belege sieht, wer sie
  angelegt hat, und der Administrator. Eine frisch angelegte, noch unbelegte
  Quelle ist also zunächst nur für ihren Ersteller sichtbar.
- Wird eine Quelle auch für Personen zitiert, die der Benutzer nicht sehen
  darf (z.B. ein Kirchenbuch für Familie A und B, Benutzer hat nur A),
  erscheinen diese Belege nicht — die Detailseite nennt nur ihre Anzahl.
- Ändern darf eine Quelle, wer sie angelegt hat oder einen ihrer Belege
  bearbeiten darf; löschen (samt aller Belege) nur, wer *jeden* ihrer Belege
  bearbeiten darf. Anlegen darf, wer in mindestens einer Familie Bearbeiter
  ist.
- Jede Änderung landet im Audit-Log (`Source`, `Citation`).

API: `GET/POST /api/sources`, `GET/PATCH/DELETE /api/sources/{id}`,
`POST /api/citations`, `PATCH/DELETE /api/citations/{id}`.
