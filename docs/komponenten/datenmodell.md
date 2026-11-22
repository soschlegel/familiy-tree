# Datenmodell (`prisma/schema.prisma`)

Fachlich-technische Beschreibung des Datenbankschemas (PostgreSQL über
Prisma). Maßgeblich ist immer `prisma/schema.prisma` samt
`prisma/migrations/` — weicht diese Beschreibung ab, gilt der Code, und die
Beschreibung wird berichtigt (AGENTS.md, Abschnitt 1).

Querverweise: Datumslogik `lib/dates.ts`, Rechte `lib/scope.ts` und
`lib/authz.ts`, Audit `lib/audit.ts`, Pakete `lib/change-sets.ts` — siehe
[bibliotheken.md](bibliotheken.md). Dienste, die die Tabellen schreiben:
[dienste.md](dienste.md).

## Überblick

| Bereich | Modelle | Enums |
|---|---|---|
| Benutzer und Anmeldung | `User`, `Account`, `Session`, `VerificationToken` | `Role`, `UserStatus` |
| KI-Zugang (MCP) | `ApiToken` | `AiAccess`, `ApiTokenLevel`, `ApiTokenKind` |
| Familien (Rechte) | `Family`, `PersonFamily`, `UserFamily` | `FamilyRole` |
| Stammbaum | `Person`, `PersonName`, `Relationship` | `Gender`, `PersonNameType`, `RelationType`, `RelationSubtype`, `DatePrecision`, `DateQualifier` |
| Lebensereignisse | `Event` | `EventType` |
| Medien | `MediaAsset`, `PersonMedia`, `RelationshipMedia`, `SourceMedia`, `EventMedia`, `CitationMedia` | — |
| Quellen und Belege | `Source`, `Citation` | `SourceKind`, `CitationFact`, `CitationConfidence` |
| Import und Herkunft | `ImportBatch`, `ImportLink`, `ExternalId`, `ImportRawRecord`, `DuplicateDismissal` | `ImportStatus` |
| Audit und Änderungsgeschichte | `AuditLog`, `ChangeSet` | `AuditChannel` |
| Orte (Karte) | `Place` | `PlaceSource`, `PlacePrecision` |

Allgemeine Konventionen:

- Primärschlüssel sind `cuid()`-Zeichenketten; Verknüpfungstabellen haben
  zusammengesetzte Primärschlüssel.
- **Prisma kennt keine Check-Constraints.** Regeln wie „genau ein Träger“
  (Event, Citation, ExternalId) oder „kanonische Reihenfolge“ (PARTNER_OF,
  DuplicateDismissal) prüfen die Dienste in `lib/services`, nicht die
  Datenbank.
- Löschverhalten: Inhalte, die nur zu einem Träger gehören (Ereignisse,
  Belege, Namen, Verknüpfungen, Herkunft), werden mit ihm gelöscht
  (`Cascade`). Verweise auf Benutzer, Importläufe und Pakete werden beim
  Löschen auf `NULL` gesetzt (`SetNull`), damit Protokolle und Inhalte
  erhalten bleiben.
- Einige Verweise sind **bewusst ohne Fremdschlüssel**: `AuditLog.apiTokenId`,
  `ChangeSet.apiTokenId`, `ImportLink.mergedFromId`,
  `ImportLink.missingSinceBatchId`; `Place` hängt nur über den
  normalisierten Ortstext an den Daten.

## Ungenaue Datumsangaben (Muster für alle Datumsfelder)

Jedes fachliche Datum ist eine Gruppe aus sechs Spalten mit gemeinsamem
Präfix — bei `Person` `birthDate…` und `deathDate…`, bei `Relationship`
`startDate…` und `endDate…`, bei `Event` und `Source` `date…`:

| Spalte | Bedeutung |
|---|---|
| `<x>` (DateTime, optional) | **Anker**, sortierbar, UTC-Mitternacht. Bei Genauigkeit Monat der Monatserste, bei Jahr der 1. Januar; bei Bereichen der Anfang. |
| `<x>Precision` (`DatePrecision`, Standard `DAY`) | Wie viel bekannt ist: Tag, Monat oder Jahr. |
| `<x>Qualifier` (`DateQualifier`, Standard `EXACT`) | Zusatz: genau, um, vor, nach, geschätzt, errechnet, zwischen, Zeitraum, bis. |
| `<x>To` (DateTime, optional) | Ende eines Bereichs — nur bei `BETWEEN` und `PERIOD` belegt. |
| `<x>ToPrecision` (Standard `DAY`) | Genauigkeit des Endes. |
| `<x>Phrase` (Text, optional) | **Wortlaut**, wenn sich die Angabe nicht verlustfrei strukturiert darstellen lässt („Weihnachten 1850“, julianischer Kalender, GEDCOM-Datumsphrase). Ergänzt das Datum oder steht allein. |

Die Standardwerte (Tag, genau) entsprechen allen Daten, die vor der
Erweiterung erfasst wurden — so brauchte die Migration keine
Datenumstellung. Lesen, Anzeigen, Vergleichen: `lib/dates.ts`
(`fuzzyField`, `fuzzyColumns`, `dateBounds`, `phraseAfterUpdate`).

## Enums

### `Role`
Globale Rolle: `ADMIN`, `EDITOR`, `VIEWER` (Standard). Wirksam ist für
globale Verwaltungsrechte nur `ADMIN` (`lib/authz.ts`); inhaltliche Rechte
kommen aus den Familienrollen (`UserFamily.role`). `EDITOR` als globale
Rolle hat derzeit keine eigenen Rechte.

### `UserStatus`
`INVITED` (vom Admin angelegt, noch nie angemeldet; Standard), `ACTIVE`
(beim ersten Login gesetzt), `BLOCKED` (Anmeldung und laufende Sitzungen
gesperrt, `lib/auth.ts`).

### `AiAccess`
Geordnete Stufe des KI-Zugangs eines Benutzers: `NONE` (Standard), `READ`,
`WRITE` (schließt `READ` ein). Bewusst eine Stufe statt zweier Schalter, damit
„schreiben ohne lesen“ nicht darstellbar ist. Auch `ADMIN` hat ihn nur, wenn
er ausdrücklich vergeben ist.

### `ApiTokenLevel`
Stufe eines Schlüssels: `READ`, `WRITE`. Wirksam ist das Minimum aus
Schlüsselstufe und `User.aiAccess`, bei jeder Prüfung neu berechnet.

### `ApiTokenKind`
Herkunft eines Schlüssels: `PERSONAL` (in der App erzeugt, Standard),
`OAUTH` (über einen OAuth-Ablauf ausgestellt).

### `FamilyRole`
Rolle in einer Familie: `EDITOR` (sehen und bearbeiten), `VIEWER` (nur
sehen, Standard).

### `Gender`
`MALE`, `FEMALE`, `OTHER`, `UNKNOWN` (Standard). `UNKNOWN` gilt beim
Zusammenführen als leer.

### `DatePrecision`
`DAY`, `MONTH`, `YEAR` — siehe oben.

### `DateQualifier`
`EXACT`, `ABOUT` (um, GEDCOM ABT), `BEFORE` (BEF), `AFTER` (AFT),
`ESTIMATED` (EST), `CALCULATED` (CAL, z.B. aus einer Altersangabe),
`BETWEEN` (ein Zeitpunkt zwischen Anfang und Ende, BET … AND), `PERIOD`
(Zeitraum von … bis …, ohne Ende „ab/seit“, FROM … TO), `UNTIL` (Zeitraum
bis …, TO). Die ersten vier gibt es seit `20261116000000_…`, die übrigen
seit `20261119000000_…`.

### `PersonNameType`
Art eines weiteren Namens: `BIRTH` (abweichend erfasster Geburtsname),
`MARRIED` (früherer Ehename), `ALIAS` (auch bekannt als), `RELIGIOUS`
(Ordens-/Taufname), `IMMIGRANT` (Name nach Einwanderung), `VARIANT`
(andere Schreibweise), `OTHER` (Standard; freie Bezeichnung in `label`).

### `RelationType`
`PARENT_OF` (gerichtet: `fromPersonId` = Elternteil, `toPersonId` = Kind)
und `PARTNER_OF` (ungerichtet, kanonisch gespeichert mit `fromPersonId` <
`toPersonId`, geprüft im Dienst).

### `RelationSubtype`
Für `PARENT_OF`: `BIOLOGICAL` (Standard), `ADOPTIVE`, `STEP`, `FOSTER`.
Für `PARTNER_OF`: `MARRIED`, `UNMARRIED`, `DIVORCED`, `PARTNER_UNKNOWN`
(Partnerschaft mit unbekanntem Ehestand, z.B. Import ohne Heiratsangabe).
Welche Untertypen zu welchem Typ passen, prüft `lib/validation.ts`
(`subtypeMatchesType`).

### `EventType`
Ereignisarten nach GEDCOM 5.5.1 (Tag jeweils im Schemakommentar). Personen:
Taufe, Kindstaufe, Erwachsenentaufe, Beerdigung, Einäscherung, Adoption,
Konfirmation/Firmung, Erstkommunion, Bar/Bat Mitzwa, Segnung, Ordination,
Abschluss, Ausbildung, Beruf, Ruhestand, Wohnort, Volkszählung, Aus- und
Einwanderung, Einbürgerung, Militärdienst, Religion, Staatsangehörigkeit,
Titel, Besitz, Beschreibung, Kennnummer, Stand/Kaste, Kinderzahl, Zahl der
Ehen, Testament, Testamentseröffnung. Partnerschaften: Verlobung, Aufgebot,
Ehevertrag, Heiratserlaubnis, Ehevereinbarung, Scheidungsantrag,
Annullierung. Frei: `CUSTOM` (Bezeichnung in `Event.label`).
**`BIRTH`, `DEATH`, `MARRIAGE`, `DIVORCE`** gibt es nur als abweichende
Zweitangabe (`isAlternative`) — die Hauptangabe steht in `Person` bzw.
`Relationship`. Regeln: `lib/events.ts`.

### `SourceKind`
`CHURCH_BOOK`, `CIVIL_REGISTRY`, `CENSUS`, `GRAVESTONE`, `FAMILY_DOCUMENT`,
`ORAL`, `WEBSITE`, `OTHER` (Standard), seit `20261121000000_…` zusätzlich
`ONLINE_TREE` (Stammbäume anderer Nutzer bei einem Anbieter — **keine
unabhängige Quelle**) und `ONLINE_COLLECTION` (Online-Sammlung eines
Anbieters). Einordnung beim Import: `lib/source-classify.ts`.

### `CitationFact`
Welche Angabe ein Beleg stützt: `NAME`, `BIRTH`, `DEATH`, `PARTNERSHIP`
(nur an `PARTNER_OF`), `PARENTAGE` (nur an `PARENT_OF`), `OTHER` (Standard),
`EVENT` (Beleg für ein Ereignis, `Citation.eventId` gesetzt).

### `CitationConfidence`
`HIGH` (gesichert), `MEDIUM` (wahrscheinlich), `LOW` (unsicher); optional.

### `ImportStatus`
`PENDING` (Lauf angelegt, Datei gespeichert; Standard), `COMPLETED`,
`FAILED`.

### `AuditChannel`
Kanal einer Änderung; derzeit nur `MCP`. `NULL` bedeutet Web-App bzw.
Eintrag aus der Zeit vor dem KI-Zugang.

### `PlaceSource`
Herkunft einer Ortszuordnung: `AUTO` (aus dem mitgelieferten
Ortsverzeichnis `geo/gazetteer.tsv.gz`), `MANUAL` (von Hand bestätigt oder
eingegeben — wird nie automatisch überschrieben).

### `PlacePrecision`
Genauigkeit einer Ortszuordnung: `PLACE` (der Ort selbst), `REGION`
(Bundesland, historische Landschaft), `COUNTRY` (nur das Land).

## Modelle

### `User`
**Bedeutung:** Benutzerkonto und zugleich **Allowlist** — wer hier nicht
steht, kommt trotz gültigem Google-/GitHub-Konto nicht hinein
(`signIn`-Callback in `lib/auth.ts`).

**Felder:** `email` (eindeutig, kleingeschrieben verglichen), `name`,
`image`, `emailVerified`, `role` (Standard `VIEWER`), `status` (Standard
`INVITED`), `createdAt`, `lastLoginAt`, `aiAccess` (Standard `NONE`),
`personId` (**Bezugsperson** „das bin ich“, optional).

**Beziehungen:** Konten (`Account`), Sitzungen (`Session`), hochgeladene
Medien, Audit-Einträge, Pakete (`ChangeSet`), Familienmitgliedschaften
(`UserFamily`), angelegte Quellen, Schlüssel (`ApiToken`), Importläufe,
„kein Duplikat“-Markierungen; `person` über die Relation `UserSelf`.

**Löschverhalten:** `Account`, `Session`, `UserFamily`, `ApiToken` werden
mit dem Benutzer gelöscht (Cascade). Medien, Quellen, Importläufe, Audit,
Pakete und Markierungen behalten ihren Inhalt, der Verweis wird `NULL`.
Wird die Bezugsperson gelöscht, wird `personId` `NULL` (SetNull); beim
Zusammenführen hängt der Dienst `lib/services/merge.ts` den Verweis auf die
bleibende Person um.

**Indizes:** eindeutig `email`; `personId` (Suche „welche Benutzer haben
diese Person als sich selbst gewählt“, u.a. beim Zusammenführen und
Löschen).

### `Account`, `Session`, `VerificationToken`
Tabellen des Auth.js-Prisma-Adapters (`@auth/prisma-adapter`).
`Account` hält die Verknüpfung zum OAuth-Anbieter (eindeutig je
`provider` + `providerAccountId`, Cascade mit dem Benutzer). `Session` und
`VerificationToken` sind vom Adapter vorgegeben; da die App JWT-Sitzungen
nutzt (`lib/auth.ts`), werden `Session`-Zeilen vermutlich nicht beschrieben
(unklar, nicht geprüft).

### `ApiToken`
**Bedeutung:** Persönlicher, widerrufbarer Zugangsschlüssel für den
MCP-Endpunkt. Gespeichert wird nie das Geheimnis, nur dessen SHA-256-Hash
(`lib/ai-tokens.ts`).

**Felder:** `name` (vom Benutzer), `prefix` (nicht geheimer Anfang
`ftk_` + 12 Hex-Zeichen, eindeutig — zum Wiedererkennen in Listen und zum
Nachschlagen bei der Prüfung), `secretHash`, `level`, `kind`, `createdAt`,
`lastUsedAt`, `expiresAt`, `revokedAt` (gesetzt = widerrufen; der Dienst
`lib/services/ai-access.ts` leitet daraus den Status ab).

**Regel:** wirksame Stufe = min(`level`, `User.aiAccess`), bei jeder Prüfung
neu berechnet — ein Herabsetzen der Benutzerrechte wirkt sofort.

**Löschverhalten:** Cascade mit dem Benutzer. Audit-Einträge verweisen
ohne Fremdschlüssel auf `ApiToken.id` und bleiben deshalb erhalten.

**Indizes:** eindeutig `prefix`; `userId` (Schlüsselliste eines Benutzers).

### `Family`
**Bedeutung:** Einheit der Rechtevergabe. Eine Person kann zu beliebig
vielen Familien gehören; Benutzer bekommen Zugriff je Familie.

**Felder:** `name` (eindeutig), `description`, `createdAt`.

**Löschverhalten:** Löscht man eine Familie, verschwinden ihre
`PersonFamily`- und `UserFamily`-Zeilen (Cascade) — die Personen selbst
bleiben. Personen ohne jede Familie sind danach nur noch für Admins
sichtbar (`lib/scope.ts`).

### `PersonFamily`
Zuordnung Person ↔ Familie (Primärschlüssel aus beiden IDs). Durch Heirat
verbinden sich Familien — wer einheiratet, gehört fortan zu beiden.
Cascade auf beiden Seiten. Index `familyId` (alle Personen einer Familie;
Sichtbarkeitsfilter `personVisibilityFilter`).

### `UserFamily`
Zugriff eines Benutzers auf eine Familie mit `role` (`FamilyRole`, Standard
`VIEWER`). Ohne Eintrag kein Zugriff. Cascade auf beiden Seiten. Index
`familyId` (Mitglieder einer Familie).

### `Person`
**Bedeutung:** Ein Mensch im Stammbaum mit seinen Hauptangaben.

**Felder:**
- Hauptname: `givenName` (Pflicht), `familyName`, `birthName`, dazu die
  Namensteile `nickname` (Rufname, GEDCOM NICK), `namePrefix` (Titel/Vorsatz,
  NPFX), `nameSuffix` (Zusatz wie „jun.“, NSFX). Weitere Namen stehen in
  `PersonName`.
- `gender` (Standard `UNKNOWN`).
- Geburt: Datumsgruppe `birthDate…` (siehe oben) und `birthPlace`.
- Tod: Datumsgruppe `deathDate…`, `deathPlace`, `deathCause`.
- `notes` (Forschungsnotizen), `createdAt`, `updatedAt`.

Orte sind Freitext; Koordinaten kommen über `Place` (normalisierter Text).

**Beziehungen:** `relationsFrom`/`relationsTo` (Relationship), Medien,
Familien, Belege, Ereignisse, weitere Namen, Fremdkennungen, Rohdaten,
Herkunft (`importLinks`, nach dem Zusammenführen mehrere), „kein
Duplikat“-Markierungen (als A oder B), `selfOfUsers` (Benutzer, die diese
Person als Bezugsperson gewählt haben).

**Löschverhalten:** Beim Löschen einer Person verschwinden per Cascade ihre
Beziehungen (beide Richtungen), Familienzuordnungen, Bildverknüpfungen
(nicht die Bilder selbst), Belege, Ereignisse, Namen, Fremdkennungen,
Rohdaten, Herkunftslinks und Markierungen; Benutzer verlieren ihre
Bezugsperson (SetNull).

**Indizes:** (`familyName`, `givenName`) für Namenssuche und Sortierung.

### `PersonName`
**Bedeutung:** Weitere Namen einer Person (Ehename, Schreibvariante,
Alias …); der Hauptname bleibt in `Person`.

**Felder:** `type` (`PersonNameType`, Standard `OTHER`), `givenName`,
`familyName`, `prefix`, `suffix`, `nickname`, `label` (freie Bezeichnung,
z.B. GEDCOM NAME.TYPE bei `OTHER`), `notes`, `sortOrder`, `createdAt`.

**Löschverhalten:** Cascade mit der Person; Herkunftslinks
(`ImportLink.personNameId`) Cascade mit dem Namen.

**Index:** `personId`.

### `Relationship`
**Bedeutung:** Beziehung zwischen zwei Personen — bewusst eigene Tabelle
statt `parentId` an der Person, damit Adoption, Stiefverhältnisse,
Mehrfachehen und Beziehungszeiträume ohne Schemaänderung abbildbar sind.

**Felder:** `type`, `subtype` (Standard `BIOLOGICAL`), `fromPersonId`,
`toPersonId`; Beginn als Datumsgruppe `startDate…` mit `startPlace` (bei
`PARTNER_OF` Heirat bzw. Beginn der Partnerschaft; bei `PARENT_OF` Beginn
eines Adoptiv-/Stief-/Pflegeverhältnisses); Ende als `endDate…` mit
`endPlace` (Scheidung bzw. Ende); `notes`, `createdAt`.

**Regeln (im Dienst bzw. `lib/validation.ts`, `lib/graph.ts`):** Untertyp
muss zum Typ passen; `PARTNER_OF` kanonisch (`fromPersonId` <
`toPersonId`); keine Zyklen bei `PARENT_OF`; Ende nicht vor Beginn.

**Beziehungen:** Bilder (`RelationshipMedia`), Belege, Ereignisse,
Fremdkennungen, Rohdaten, Herkunft.

**Löschverhalten:** Cascade mit jeder der beiden Personen; Unterdaten
Cascade mit der Beziehung.

**Indizes:** eindeutig (`type`, `fromPersonId`, `toPersonId`) — zwischen
zwei Personen höchstens eine Beziehung je Typ (bei `PARTNER_OF` dank
kanonischer Reihenfolge auch richtungsunabhängig); `fromPersonId` und
`toPersonId` einzeln (Eltern/Kinder/Partner einer Person laden).

### `Event`
**Bedeutung:** Lebensereignis an **genau einer** Person oder Beziehung
(geprüft im Dienst). Sichtbarkeit und Bearbeitbarkeit folgen dem Träger.

**Felder:** `personId` oder `relationshipId`, `type` (`EventType`), `label`
(bei `CUSTOM` Pflicht, sonst optionale Präzisierung wie GEDCOM TYPE),
`isAlternative` (abweichende Zweitangabe zu einer Tatsache, die schon
anderswo steht — überschreibt nichts, erscheint nicht in Zeitleisten und
Plausibilitätsprüfung), Datumsgruppe `date…`, `place`, `address`
(Anschrift, Zeilen mit Zeilenumbruch), `value` (Beruf, Religion, Titel …),
`cause`, `age` (Altersangabe der Quelle wörtlich), `agency` (zuständige
Stelle), `notes`, `sortOrder` (Reihenfolge undatierter Ereignisse und
Gleichstand), `createdAt`, `updatedAt`.

**Beziehungen:** Belege (`Citation.eventId`), Fremdkennungen, Herkunft,
Bilder (`EventMedia`).

**Löschverhalten:** Cascade mit Person bzw. Beziehung; Belege, Bild-
verknüpfungen, Fremdkennungen, Herkunft Cascade mit dem Ereignis.

**Indizes:** `personId`, `relationshipId` (Ereignisse eines Trägers),
`type` (z.B. alle Beerdigungen für Karte/Prüfungen, Suche nach Art).

### `MediaAsset`
**Bedeutung:** Eine Bilddatei. Die Datei selbst liegt unter `MEDIA_DIR`
(`lib/storage.ts`), ausgeliefert nur über die App.

**Felder:** `storageKey` (eindeutig, relativer Pfad unter `MEDIA_DIR`, z.B.
`originals/<uuid>.webp`), `thumbnailKey`, `fileName` (ursprünglicher
Dateiname, menschenlesbarer Verweis im Export), `mimeType`, `sizeBytes`,
`width`, `height`, `caption`, `uploadedById`, `createdAt`.

**Beziehungen:** Verknüpfungen zu Personen, Beziehungen, Quellen
(`SourceMedia` und das ältere `Source.mediaId`), Ereignissen, Belegen;
Fremdkennungen; Herkunft.

**Löschverhalten:** Uploader gelöscht → `uploadedById` `NULL`. Ein
gelöschtes Bild entfernt alle Verknüpfungen (Cascade) und setzt
`Source.mediaId` auf `NULL`. Ein Bild ohne jede Zuordnung ist „verwaist“
und nur für Admins sichtbar (`lib/media-scope.ts`).

**Index:** eindeutig `storageKey`.

### Medien-Verknüpfungstabellen
Alle nach demselben Muster: zusammengesetzter Primärschlüssel (Träger,
Bild), `sortOrder`, Cascade auf **beiden** Seiten (gelöscht wird nur die
Verknüpfung), Index auf `mediaId` (alle Zuordnungen eines Bildes — für
Rechteprüfung und Löschen).

| Tabelle | Träger | Besonderheit |
|---|---|---|
| `PersonMedia` | Person | `isPrimary` (Hauptbild der Person) |
| `RelationshipMedia` | Beziehung | `isPrimary`; vor allem Hochzeitsfotos |
| `SourceMedia` | Quelle | `createdAt`; mehrere Scans/Fotos einer Quelle. `Source.mediaId` bleibt der „Hauptscan“; die App liest beide Stellen zusammen (`lib/services/attached-media.ts`), ohne Datenübernahme |
| `EventMedia` | Ereignis | `createdAt`; sichtbar und änderbar wie das Ereignis |
| `CitationMedia` | Beleg | `createdAt`; der Ausschnitt der Quelle, der genau diese Angabe belegt; sichtbar und änderbar wie der Beleg |

### `Source`
**Bedeutung:** Eine Quelle (Kirchenbuch, Urkunde, Online-Stammbaum …), die
viele Angaben vieler Personen belegen kann. Sichtbar ist sie, sobald der
Benutzer etwas sieht, wofür sie zitiert wird — Rechte hängen an den
Belegen; außerdem für Admins und den Ersteller (`lib/services/sources.ts`,
`lib/media-scope.ts`).

**Felder:** `title` (Pflicht), `kind` (Standard `OTHER`), `kindLabel` (freie
Art, z.B. „Adressbuch“), `provider` (Anbieter wie MyHeritage), `author`,
`repository` (Archiv, Pfarramt), `callNumber` (Signatur), `url`,
Datumsgruppe `date…`, `notes` (Abschrift), `mediaId` (Hauptscan, älteres
Feld), `createdById`, `createdAt`, `updatedAt`.

**Löschverhalten:** Belege, Fremdkennungen, Rohdaten, Herkunft und
`SourceMedia` Cascade mit der Quelle. Hauptscan bzw. Ersteller gelöscht →
`mediaId` bzw. `createdById` `NULL`.

**Index:** `title` (Suche/Sortierung).

### `Citation`
**Bedeutung:** Beleg — eine Quelle stützt eine Angabe zu **genau einer**
Person oder Beziehung (geprüft im Dienst). Ein Beleg für ein Ereignis trägt
zusätzlich `eventId` (`fact = EVENT`); `personId` bzw. `relationshipId` ist
dann der Träger des Ereignisses, damit Rechte, Export und Löschen
unverändert gelten.

**Felder:** `sourceId`, `personId`/`relationshipId`/`eventId`, `fact`
(Standard `OTHER`), `detail` (Seite, Eintragsnummer, GEDCOM PAGE), `url`
(Internetadresse des Eintrags, aus PAGE herausgelöst, nur http/https),
`confidence` (optional), `text` (Abschrift/Notiz), `createdAt`.

**Löschverhalten:** Cascade mit Quelle, Person, Beziehung und Ereignis;
Bildverknüpfungen und Herkunft Cascade mit dem Beleg.

**Indizes:** `sourceId` (Belege einer Quelle → Sichtbarkeit), `personId`,
`relationshipId`, `eventId` (Belege eines Trägers).

### `ImportBatch`
**Bedeutung:** Ein Importlauf (GEDCOM, JSON …), nur für Administratoren
(`lib/services/imports.ts`). Die Originaldatei liegt unverändert unter
`MEDIA_DIR/imports/` (`storageKey`).

**Felder:** `userId`, `format`, `fileName`, `fileSizeBytes`, `fileSha256`,
`storageKey` (eindeutig), `sourceTreeId` (Kennung des Stammbaums in der
Quelle — Läufe mit derselben Kennung sind Stände desselben Baums, nur
innerhalb davon wird abgeglichen), Dateikopf (`sourceSystem`,
`sourceSystemName`, `sourceVersion`, `gedcomVersion`, `charset`, `header`
als JSON), `counts` und `warnings` (JSON), `status`, `notes`, `createdAt`,
`finishedAt`.

**Löschverhalten:** Benutzer gelöscht → `userId` `NULL`. Ein gelöschter
Lauf setzt `ImportLink.firstBatchId/lastBatchId`, `ExternalId.batchId` und
`ImportRawRecord.batchId` auf `NULL` — importierte Daten bleiben.

**Indizes:** `fileSha256` (dieselbe Datei erneut hochgeladen?),
(`sourceTreeId`, `createdAt`) (Stände desselben Baums in zeitlicher
Folge), `createdAt` (Liste der Läufe); eindeutig `storageKey`.

### `ImportLink` (Herkunft)
**Bedeutung:** Herkunft eines importierten Datensatzes — eine Zeile je
Datensatz **und** Datensatz der Quelle (`sourceTreeId` + `externalKey`).
Angelegt bzw. fortgeschrieben von jedem Import, der den Datensatz anlegt,
aktualisiert oder mit einem vorhandenen verknüpft. Von Hand angelegte
Datensätze haben keine.

**Felder:**
- `entityType` (Text: `PERSON`, `RELATIONSHIP`, `EVENT`, `PERSON_NAME`,
  `CITATION`, `SOURCE`, `MEDIA`) und genau eine der Träger-Spalten
  `personId`, `relationshipId`, `eventId`, `personNameId`, `citationId`,
  `sourceId`, `mediaId`.
- `sourceTreeId`, `externalKey` (Schlüssel in der Quelle, frei vom Import
  gewählt, z.B. `UID:…`, `XREF:@I12@`, `XREF:@I12@/BIRT#2`).
- `firstBatchId`, `lastBatchId`, `importedAt`.
- `importHash`: Fingerabdruck der Werte, wie der letzte Import sie
  geschrieben hat (`lib/import-fingerprint.ts`). Stimmt er mit dem
  Fingerabdruck des heutigen Stands überein, wurde der Datensatz seither in
  der App nicht geändert und darf aktualisiert werden — sonst entscheidet
  die Vorschau.
- `sourceStamp`: Änderungsstempel der Quelle wörtlich (`_UPD`, `CHAN.DATE`).
- `missingSinceBatchId`: Datensatz fehlte in einem neueren Stand der
  Quelle — gelöscht wird nichts (ohne Fremdschlüssel).
- `mergedFromId`: Link kam beim Zusammenführen vom weggefallenen Datensatz
  (dessen ID, ohne Fremdschlüssel). Ohne Wert ist es der ursprüngliche Link;
  der GEDCOM-Export schreibt dessen Originaldaten (`_UID`).
- `mergedAt`: Datensatz war an einem Zusammenführen beteiligt; ein erneuter
  Import ohne neue Angaben meldet ihn dann still als unverändert statt als
  „in der App geändert“.

**Besonderheit:** Bewusst **kein** Unique auf (Datensatz, Baum) — wer eine
Dublette innerhalb eines Baums zusammenführt, behält beide Links desselben
Baums. Die ursprünglichen Unique-Indizes je Träger-Spalte wurden mit
`20261120000000_dubletten_zusammenfuehren` zu gewöhnlichen Indizes.

**Löschverhalten:** Cascade mit dem jeweiligen Träger; Läufe → SetNull.

**Indizes:** (`sourceTreeId`, `externalKey`) — Wiedererkennen beim
erneuten Import; `firstBatchId`, `lastBatchId`; je Träger-Spalte ein Index
(Herkunft eines Datensatzes laden, Umhängen beim Zusammenführen).

### `ExternalId`
**Bedeutung:** Fremdkennung eines Datensatzes, damit ein erneuter Import
ihn wiedererkennt: `system` z.B. `GEDCOM_XREF` (Wert `@I12@`, nur zusammen
mit `batchId` eindeutig), `UID` (`_UID`), `RIN`, `REFN`, `AFN`. Gehört zu
genau einem Datensatz (geprüft im Dienst): `personId`, `relationshipId`,
`eventId`, `sourceId` oder `mediaId`.

**Löschverhalten:** Cascade mit dem Träger; Lauf gelöscht → `batchId`
`NULL`.

**Indizes:** (`system`, `value`) zum Nachschlagen; `batchId`; je Träger.

### `ImportRawRecord`
**Bedeutung:** Daten, die der Import nicht deuten konnte, als JSON-Teilbaum
— damit nichts still verloren geht und eine spätere Version sie auswerten
kann (und der GEDCOM-Export sie zurückschreiben kann). Sichtbar wie der
Träger (Person, Beziehung, Quelle); ohne Träger nur für Admins.

**Felder:** `batchId`, `personId`/`relationshipId`/`sourceId` (optional),
`recordType` (Satzart bzw. Tag-Pfad wie `INDI`, `INDI.BIRT.AGE`, `_MYTAG`),
`xref`, `content` (JSON), `reason` (für Menschen), `sizeBytes`,
`supersededAt` (gesetzt, wenn ein späterer Import für denselben Träger neue
Rohdaten abgelegt hat; ältere Stände bleiben, bis ein Admin sie entfernt —
`pruneRawRecords`), `createdAt`.

**Löschverhalten:** Cascade mit dem Träger; Lauf → SetNull.

**Indizes:** `batchId`, `personId`, `relationshipId`, `sourceId`.

### `DuplicateDismissal`
**Bedeutung:** Ein Paar, das ein Bearbeiter als „kein Duplikat“ markiert
hat. Es erscheint nicht mehr unter „Mögliche Dubletten“, nicht als
Importvorschlag und nicht beim Zusammenlegen von Bäumen. Kanonisch
gespeichert (`personAId` < `personBId`, geprüft im Dienst).

**Felder:** `personAId`, `personBId` (Primärschlüssel), `userId`,
`createdAt`.

**Löschverhalten:** Cascade mit jeder der beiden Personen; Benutzer
gelöscht → `userId` `NULL`.

**Index:** `personBId` (Abfragen von der B-Seite; die A-Seite deckt der
Primärschlüssel ab).

### `AuditLog`
**Bedeutung:** Protokoll jeder Änderung (`lib/audit.ts`). Schreibfehler im
Audit rollen die eigentliche Änderung nicht zurück (`audit` fängt Fehler ab).

**Felder:**
- `userId`, `action` (Text: `CREATE`, `UPDATE`, `DELETE`, `MERGE`,
  `CONNECT`), `entityType` (Text, z.B. `Person`, `Relationship`,
  `MediaAsset`, `User`, `Family`, `Source`, `Citation`, `ApiToken`, `Event`,
  `PersonName`, `ImportBatch`, `ImportRawRecord`, `Place`), `entityId`.
- `diff` (JSON): bei `UPDATE` seit dem Changelog
  `{ changes: { feld: { from, to } } }` (Datumsspalten zu einem Feld in
  Anzeigeform zusammengefasst, `fieldChanges`); ältere Einträge enthalten
  meist nur die neuen Werte.
- `channel` (`AuditChannel`) und `apiTokenId` (ApiToken.id, nie das
  Geheimnis) — **ohne Fremdschlüssel**, damit der Verweis auch nach dem
  Löschen des Benutzers samt Schlüsseln erhalten bleibt.
- `changeSetId`: Paket, zu dem die Änderung gehört (`NULL` bei älteren
  Einträgen).
- `personIds`, `familyIds` (Text-Listen, Standard leer): **Momentaufnahme**
  der betroffenen Personen und deren Familien zum Zeitpunkt der Änderung —
  Verlauf je Person und Übersicht je Familie kommen so ohne Rekonstruktion
  aus, auch wenn der Datensatz später gelöscht wird.
- `createdAt`.

**Löschverhalten:** Benutzer gelöscht → `userId` `NULL`; Paket gelöscht →
`changeSetId` `NULL`.

**Indizes:** (`entityType`, `entityId`) Verlauf eines Datensatzes;
`createdAt` chronologische Listen; `apiTokenId` Änderungen eines
Schlüssels; `changeSetId` Einträge eines Pakets; **GIN** auf `personIds`
und `familyIds` (Array-Enthaltensein: „alle Änderungen an Person X“ bzw.
„in Familie Y“).

### `ChangeSet`
**Bedeutung:** Paket zusammengehöriger Änderungen (Changelog,
`lib/change-sets.ts`). In der App bildet jede Anfrage (bzw. ein Import, ein
Zusammenführen, ein Sammel-Zusammenführen) ein Paket; über den KI-Zugang
öffnet `begin_change_set` eines mit Titel, sonst bündelt der Server je
Benutzer und Schlüssel innerhalb eines Zeitfensters (30 Minuten). Angelegt
wird ein Paket erst mit dem ersten Audit-Eintrag.

**Felder:** `title`, `kind` (Text: `APP` Standard, `IMPORT`, `MERGE`,
`CONNECT`, `MCP` über `begin_change_set`, `MCP_AUTO`), `userId`, `channel`,
`apiTokenId` (wie im AuditLog ohne Fremdschlüssel), `createdAt`,
`lastActivityAt` (letzter Eintrag — für das Bündeln ohne Kennung).

**Löschverhalten:** Benutzer gelöscht → `userId` `NULL`; Einträge behalten
ihren Inhalt (SetNull auf `AuditLog.changeSetId`).

**Indizes:** `createdAt` (Übersicht); (`userId`, `kind`, `lastActivityAt`)
— genau die Abfrage „laufendes MCP-Paket dieses Benutzers“.

### `Place`
**Bedeutung:** Zuordnung eines Ortstexts (wie er an Personen, Beziehungen
und Ereignissen steht) zu Koordinaten für die Karte „Wurzeln nach Jahr“.
Schlüssel ist der normalisierte Text (`placeKey` in
`lib/places/normalize.ts`): Schreibweisen, die sich nur in Groß-/
Kleinschreibung, Unicode-Form und Leerzeichen unterscheiden, teilen sich
eine Zeile. Ortstexte ohne Zeile sind „offen“. Nur Administratoren sehen
und ändern die Tabelle (`lib/services/places.ts`, Aktion `place:manage`);
die Karte liest nur Koordinaten zu Ortstexten sichtbarer Personen.

**Felder:** `key` (eindeutig), `text` (zuletzt zugeordnete Schreibweise,
für die Anzeige), `source` (`AUTO`/`MANUAL`), `unresolvable` (von Hand als
„nicht zuordenbar“ markiert, dann ohne Koordinaten), `precision`,
`latitude`, `longitude`, `label` (Anzeigename der Zuordnung), `countryCode`,
`gazetteerId` (GeoNames-ID bzw. `h…` für historische Landschaften; leer bei
von Hand eingegebenen Koordinaten), `createdAt`, `updatedAt`.

**Besonderheit:** Keine Fremdschlüssel — die Verbindung zu Personen
entsteht nur über den normalisierten Text.

**Indizes:** eindeutig `key`; `source` (z.B. „alle automatischen neu
zuordnen“, von Hand Bestätigtes nie überschreiben).

## Migrationen (`prisma/migrations/`)

| Ordner | Inhalt |
|---|---|
| `0_init` | Ausgangsstand: Benutzer/Rollen, Familien, Auth.js-Tabellen, `Person`, `Relationship`, `MediaAsset`, `PersonMedia`, `RelationshipMedia`, `AuditLog`. |
| `20261116000000_ungenaue_daten_und_quellen` | Enums `DatePrecision`, `DateQualifier` (EXACT/ABOUT/BEFORE/AFTER), Genauigkeits-/Zusatzspalten mit Standardwert an Person und Beziehung; Tabellen `Source` und `Citation` mit `SourceKind`, `CitationFact`, `CitationConfidence`. |
| `20261117000000_ki_zugang` | `User.aiAccess` (Standard NONE), Tabelle `ApiToken`, Enums für Stufe/Herkunft, im `AuditLog` `channel` und `apiTokenId`. |
| `20261119000000_genealogie_ereignisse_import` | `Event`, `PersonName`, `ImportBatch`, `ImportLink` (damals mit Unique je Träger), `ExternalId`, `ImportRawRecord`; neue Datumszusätze, Bereichsende und Wortlaut je Datum, Namensteile, Todesursache, Heirats-/Scheidungsort, `Citation.eventId`, `PARTNER_UNKNOWN`, `CitationFact.EVENT`. |
| `20261120000000_dubletten_zusammenfuehren` | Die sieben Unique-Indizes auf den Träger-Spalten von `ImportLink` werden gewöhnliche Indizes (`DROP INDEX` — vom Prüfskript als nicht ergänzend gemeldet, aber ohne Datenänderung); `ImportLink.mergedFromId`/`mergedAt`; Tabelle `DuplicateDismissal`. |
| `20261121000000_quellen_einordnen` | `SourceKind` um `ONLINE_TREE`, `ONLINE_COLLECTION`; `Source.provider`, `Citation.url`. |
| `20261122000000_changelog` | Tabelle `ChangeSet`; im `AuditLog` `changeSetId` (SetNull), `personIds`, `familyIds` mit GIN-Indizes. |
| `20261122000001_bezugsperson` | `User.personId` mit Index und Fremdschlüssel `ON DELETE SET NULL`. |
| `20261123000000_medien_an_eintraegen` | Tabellen `SourceMedia`, `EventMedia`, `CitationMedia` (Cascade beidseitig); bestehende Hauptscans werden bewusst nicht kopiert. |
| `20261123000001_orte` | Tabelle `Place`, Enums `PlaceSource`, `PlacePrecision`. |

`migration_lock.toml` legt den Anbieter (PostgreSQL) fest.

## Migrationsregeln

- **Schema ändern nur per Migration:** `npm run db:migrate`
  (`prisma migrate dev`) erzeugt den Ordner, der mit eingecheckt wird.
  `npm run db:push` existiert für lokale Experimente, ist aber nicht der Weg
  in Produktion.
- **Rein ergänzend:** neue Tabellen, Spalten (mit Standardwert oder
  optional), Indizes, Fremdschlüssel, Enum-Werte, Standardwerte, „NOT NULL
  aufheben“. Alles andere (DROP, Typänderung, Umbenennung,
  DELETE/UPDATE/TRUNCATE, NOT NULL erzwingen) kann beim Update Daten
  verlieren oder umwandeln und muss bewusst entschieden werden. Rein
  ergänzende Migrationen erlauben das Zurückrollen der App ohne
  Schema-Rückbau.
- **Prüfskripte vor dem Commit:**
  - `node docker/schema-diff-check.mjs < prisma/migrations/<name>/migration.sql`
    — Exit 0: rein ergänzend; Exit 3: Liste der kritischen Anweisungen.
    Entfernt Kommentare (auch bei CRLF) und prüft jede Anweisung bzw. jede
    Teilaktion eines `ALTER TABLE` gegen eine Positivliste.
  - `prisma migrate diff` zwischen Migrationen und Schema: muss ohne
    Abweichung sein (UEBERGABE/AGENTS, „Migrationen ↔ Schema“).
- **Veröffentlichte Migrationen nie nachträglich ändern** (AGENTS.md,
  Abschnitt 3).
- **Im Betrieb** wendet der App-Container beim Start `prisma migrate deploy`
  an (`docker/entrypoint.sh`), nach einer automatischen Sicherung
  (`backup-db`). Eine Datenbank mit Tabellen, aber ohne Migrationshistorie
  (früher per `db push`) führt zum Abbruch; Baselining beschreibt die README
  („Schema und Migrationen“).
