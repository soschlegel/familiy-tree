# Seiten und API-Routen (`app/`)

Alles unter `app/` (Next.js 15, App Router): die Seiten der Weboberfläche
und die Route-Handler unter `app/api`. Die Fachlogik liegt nicht hier,
sondern in der Dienstschicht (`lib/services`); Seiten und Routen laden den
Benutzer, bilden den `Scope` (Familienrechte) und rufen die Dienste auf.
Der MCP-Endpunkt `/api/mcp` ist in [mcp.md](mcp.md) beschrieben.

## Grundregeln für alle Seiten und Routen

**Anmeldung.** Es gibt bewusst keine `middleware.ts`; geprüft wird in jeder
Seite bzw. Route selbst (`lib/session.ts`, `lib/api.ts`). Die Sitzung ist
ein JWT (Auth.js, `lib/auth.ts`); Rolle und Sperrstatus werden bei jeder
Anfrage frisch aus der Datenbank gelesen, eine Sperre wirkt also sofort
(die Sitzung gilt dann als leer).

- Seiten: `requireScope()` — ohne Anmeldung Umleitung nach `/login`, sonst
  Sitzung plus `Scope` (Familien und Rollen darin). `requirePage(action)` —
  zusätzlich ein globales Verwaltungsrecht; fehlt es, Umleitung nach
  `/tree?denied=1` (die Baumseite zeigt dann einen Hinweis).
- Routen: `route(action, handler)` — ohne Anmeldung **401**
  `{ error: "Nicht angemeldet" }`; mit `action` und fehlendem Recht **403**.
  Jede Anfrage bekommt ein eigenes Änderungspaket (`appChangeSet()`), das
  erst mit der ersten Änderung angelegt wird.

**Globale Rechte** (`lib/authz.ts`) hat nur die Rolle Administrator:
`user:read`, `user:manage`, `audit:read`, `data:import`, `family:manage`,
`place:manage`. Bearbeiter und Betrachter haben keine globalen Rechte —
alles Inhaltliche (Personen, Beziehungen, Quellen, Bilder) entscheiden die
Dienste über die Familienrollen im `Scope` (sehen = Mitglied der Familie,
ändern = Rolle `EDITOR` in einer Familie der Person; Administratoren sehen
und ändern alles).

**Unsichtbar = nicht vorhanden.** Personen, Quellen, Bilder und Ereignisse,
die der Benutzer nicht sehen darf, beantworten Seiten mit `notFound()`
(Seite „Seite nicht gefunden“) und Routen mit **404** — nie mit 403, damit
sich die Existenz nicht erraten lässt. Verwandte ohne Freigabe erscheinen
als Platzhalter „Nicht freigegeben“.

**Fehlerantworten der Routen** (`errorResponse` in `lib/api.ts`):
`ServiceError` → `NOT_FOUND` 404, `FORBIDDEN` 403, `CONFLICT` 409,
`VALIDATION` 400 (mit `issues`); ungültiges JSON 400; bekannte
Datenbankfehler: Datensatz fehlt 404, Eindeutigkeit verletzt 409,
Fremdschlüssel ins Leere 409; alles andere 500 mit allgemeiner Meldung
(Einzelheiten nur im Server-Log). Antworten sind JSON `{ error, … }`.

**Protokoll.** Änderungen schreiben die Dienste (bzw. einige Routen direkt
über `audit` mit `auditActor`) in das `AuditLog`, gebündelt im Paket der
Anfrage. Einige Abläufe benennen ihr Paket selbst (Import, Zusammenführen,
Sammel-Zusammenführen).

**Ladezustände.** Nur `/tree` und `/research` haben eine `loading.tsx`
(gemeinsame Komponente `PageLoading`). Bewusst nur auf Seiten ohne
`notFound()`: Eine Ladeanzeige streamt die Antwort, danach ließe sich kein
404-Status mehr setzen.

Alle Seiten außer `/login` und der Weiterleitung `/` sind
`force-dynamic` (kein Zwischenspeichern). Seitentitel nach dem Muster
„Titel · Stammbaum“.

## Übersicht: Seiten

| Adresse | Zweck | Rechte |
|---|---|---|
| `/` | Weiterleitung nach `/tree` | — |
| `/login` | Anmeldung (GitHub, Google, Dev-Login) | öffentlich; angemeldet → `/tree` |
| `/tree` | Stammbaum: Fokus-Ansicht, Generationen, Zeitstrahl | angemeldet |
| `/map` | Karte „Wurzeln nach Jahr“ | angemeldet |
| `/people` | Personenliste mit Suche und Filtern | angemeldet |
| `/people/new` | Person anlegen | Admin oder Bearbeiter in ≥ 1 Familie, sonst → `/tree?denied=1` |
| `/people/[id]` | Personenseite | Person sichtbar, sonst 404 |
| `/people/[id]/edit` | Person bearbeiten | sichtbar (sonst 404) und bearbeitbar (sonst → Personenseite) |
| `/people/merge` | Zwei Personen zusammenführen | angemeldet; Rechte prüft der Dienst |
| `/research` | Recherche-Überblick: Bestand, Lücken, Dubletten, Widersprüche | angemeldet |
| `/research/duplicates` | Alle möglichen Dubletten | angemeldet |
| `/research/connect` | Importe verbinden | nur Admin (sonst 404) |
| `/sources` | Quellenliste | angemeldet |
| `/sources/new` | Quelle anlegen | Bearbeiter in ≥ 1 Familie, sonst → `/sources` |
| `/sources/[id]` | Quellenseite | Quelle sichtbar, sonst 404 |
| `/sources/[id]/edit` | Quelle bearbeiten | sichtbar (sonst 404) und bearbeitbar (sonst → Quellenseite) |
| `/admin/data` | Export für alle; Import, Importverlauf nur Admin | angemeldet |
| `/ai-access` | Eigener KI-Zugang und Schlüssel | angemeldet |
| `/admin/families` | Familien und Zugriffe | `family:manage` (Admin) |
| `/admin/users` | Benutzerverwaltung | `user:manage` (Admin) |
| `/admin/changes` | Änderungsübersicht | `audit:read` (Admin) |
| `/admin/places` | Orte zuordnen | `place:manage` (Admin) |

## Übersicht: API-Routen

„angemeldet“ heißt: `route(null, …)`, die inhaltliche Prüfung macht der
Dienst über den `Scope`.

| Methode und Pfad | Zweck | Rechte |
|---|---|---|
| `GET, POST /api/auth/[...nextauth]` | Auth.js (Anmeldung, Rückruf, Abmeldung) | öffentlich |
| `GET /api/health` | Lebenszeichen | öffentlich |
| `POST /api/mcp` (übrige Methoden 405) | MCP-Endpunkt für KI-Assistenten | eigener Schlüssel, siehe [mcp.md](mcp.md) |
| `GET /api/tree` | Ganzer Graph mit Platzhaltern | angemeldet |
| `GET /api/map` | Kartendaten | angemeldet |
| `GET, POST /api/persons` | Personen suchen / anlegen | angemeldet (Anlegen: Dienst) |
| `GET, PATCH, DELETE /api/persons/[id]` | Person lesen / ändern / löschen | Dienst |
| `GET /api/persons/[id]/changes` | Änderungsverlauf einer Person | Bearbeiter der Person (Dienst) |
| `GET, POST /api/persons/[id]/events` | Ereignisse einer Person | Dienst |
| `PUT /api/persons/[id]/families` | Familienzuordnung setzen | Dienst |
| `GET, POST /api/persons/[id]/names` | Weitere Namen | Dienst |
| `POST /api/persons/merge/preview` | Vorschau Zusammenführen | Dienst |
| `POST /api/persons/merge` | Zusammenführen | Dienst |
| `POST /api/persons/merge/bulk` | Mehrere sichere Paare zusammenführen | Dienst |
| `PATCH, DELETE /api/names/[id]` | Weiteren Namen ändern / löschen | Dienst |
| `GET, PATCH, DELETE /api/events/[id]` | Ereignis | Dienst |
| `POST /api/relationships` | Beziehung anlegen | Dienst |
| `PATCH, DELETE /api/relationships/[id]` | Beziehung ändern / löschen | Dienst |
| `GET, POST /api/relationships/[id]/events` | Ereignisse einer Beziehung | Dienst |
| `GET, POST /api/sources` | Quellen suchen / anlegen | angemeldet (Anlegen: Bearbeiter) |
| `GET, PATCH, DELETE /api/sources/[id]` | Quelle | Dienst |
| `POST /api/citations` | Beleg anlegen | Dienst |
| `PATCH, DELETE /api/citations/[id]` | Beleg ändern / löschen | Dienst |
| `POST /api/media` | Bild hochladen | Dienst (ohne Ziel nur Admin) |
| `GET, DELETE /api/media/[id]` | Bild ausliefern / löschen | Bild sichtbar; Löschen mit Löschrecht |
| `POST, DELETE /api/media/[id]/links` | Bild verknüpfen / lösen | Bild sichtbar, Ziele bearbeitbar |
| `POST /api/media/[id]/primary` | Primärbild setzen | Uploadrecht an Person/Beziehung |
| `GET /api/duplicates` | Mögliche Dubletten seitenweise | angemeldet |
| `POST, DELETE /api/duplicates/dismiss` | „Kein Duplikat“ setzen / aufheben | Dienst |
| `GET /api/families` | Sichtbare Familien | angemeldet |
| `POST /api/families` | Familie anlegen | `family:manage` |
| `PATCH, DELETE /api/families/[id]` | Familie ändern / löschen | `family:manage` |
| `POST /api/families/[id]/members` | Benutzer zuordnen / entziehen | `family:manage` |
| `GET /api/users` | Alle Benutzer | `user:read` |
| `POST /api/users` | Benutzer einladen | `user:manage` |
| `PATCH, DELETE /api/users/[id]` | Benutzer ändern / löschen | `user:manage` |
| `PUT /api/users/[id]/ai-access` | KI-Recht setzen | `user:manage` |
| `GET, POST /api/ai-tokens` | Eigene Schlüssel / neuer Schlüssel; Admin: alle | angemeldet (Dienst) |
| `DELETE /api/ai-tokens/[id]` | Schlüssel widerrufen; mit `?endgueltig=1` endgültig löschen | eigener oder Admin |
| `PUT /api/me/person` | „Das bin ich“ setzen | angemeldet, Person sichtbar |
| `GET /api/changes` | Änderungspakete | `audit:read` |
| `GET /api/changes/[key]` | Einträge eines Pakets | `audit:read` |
| `GET /api/export` | Export JSON/ZIP/GEDCOM | angemeldet (nur Sichtbares) |
| `POST /api/import` | Austauschformat einspielen | `data:import` |
| `POST /api/import/gedcom` | GEDCOM hochladen, Vorschau | `data:import` |
| `GET, POST, DELETE /api/import/gedcom/[id]` | Vorschau lesen / neu berechnen / verwerfen | `data:import` |
| `GET /api/import/gedcom/[id]/items` | Vorschau-Einträge seitenweise | `data:import` |
| `POST, GET /api/import/gedcom/[id]/apply` | Import starten / Stand | `data:import` |
| `POST /api/import/gedcom/[id]/reread` | Original erneut einlesen | `data:import` |
| `GET /api/import/batches` | Importverlauf | `data:import` |
| `GET /api/import/batches/[id]/file` | Originaldatei herunterladen | `data:import` |
| `POST /api/import/batches/prune` | Überholte Rohdaten entfernen | `data:import` |
| `GET, POST /api/connect` | Importe verbinden: Auswahl / Lauf starten | `data:import` |
| `GET, POST /api/connect/[id]` | Lauf: Stand / Entscheiden, Vorschau, Ausführen | `data:import` |
| `GET, PUT /api/places` | Ortstexte / von Hand zuordnen | `place:manage` |
| `POST /api/places/auto` | Automatisch zuordnen | `place:manage` |
| `GET /api/places/search` | Suche im Ortsverzeichnis | `place:manage` |

---

## Seiten im Einzelnen

### Rahmen: `app/layout.tsx`

- Lädt die Sitzung. Für angemeldete Benutzer: Navigationsleiste
  (`NavBar`, `MainContainer` aus `components/NavBar.tsx`) mit Baum, Karte,
  Personen, Recherche, Quellen, Daten; im Untermenü „Verwaltung“:
  KI-Zugang (nur bei KI-Recht oder noch nicht widerrufenen Schlüsseln —
  dafür eine kleine Abfrage am Benutzer), Familien, Benutzer, Änderungen
  (je nach globalem Recht). Dazu Benutzername mit Rolle und
  Abmelde-Knopf (Server-Aktion `signOut`, danach `/login`).
- Ohne Anmeldung keine Navigation.
- Sprungmarke „Zum Inhalt springen“, Schriften (Fraunces, Source Sans 3
  über `next/font`), Farbe der Browserleiste je Farbschema, Fußzeile mit
  Build-Angabe (`buildInfo`/`buildLabel` aus `lib/build-info.ts`; ohne
  Anmeldung nur das Datum).

### Fehler und „nicht gefunden“

- `app/error.tsx` (Client-Komponente): unerwarteter Fehler beim Aufbau
  einer Seite. Freundlicher Hinweis, Fehlerkennung (`digest`) falls
  vorhanden, Knöpfe „Erneut versuchen“ und „Zum Stammbaum“. Die Details
  gehen in die Konsole bzw. das Server-Log.
- `app/not-found.tsx`: „Seite nicht gefunden“ — bewusst ohne
  Unterscheidung zwischen „gibt es nicht“ und „darfst du nicht sehen“.
  Links zur Personenliste und zum Stammbaum.

### `/` — `app/page.tsx`

Leitet immer nach `/tree` weiter (wer nicht angemeldet ist, landet von
dort auf `/login`).

### `/login` — `app/login/page.tsx`

- Öffentlich. Wer schon angemeldet ist, wird nach `/tree` geleitet.
- Zeigt je nach Konfiguration „Mit GitHub anmelden“ (`AUTH_GITHUB_ID`),
  „Mit Google anmelden“ (`AUTH_GOOGLE_ID`) und den Dev-Login mit
  E-Mail-Feld ohne Passwort (`ENABLE_DEV_LOGIN=true`, nur lokal); ohne
  jedes Verfahren eine Warnung.
- Anmeldung über Server-Aktionen; Ziel nach Erfolg `/tree`. Lehnt Auth.js
  ab (E-Mail nicht eingeladen oder gesperrt), geht es zurück nach
  `/login?error=<Typ>` mit dem Hinweis, die Adresse sei nicht
  freigeschaltet.
- Suchparameter: `error`.

### `/tree` — `app/tree/page.tsx` (+ `loading.tsx`)

Der Stammbaum in drei Ansichten. Bedienung: README, „Fokus-Ansicht“ und
„Bezugsperson“.

- **Rechte:** angemeldet. Ohne freigegebene Familie (und nicht Admin)
  wird nichts geladen; Hinweis „Noch keine Familie freigegeben“.
- **Suchparameter:**
  - `view` — `generations` oder `timeline` für den ganzen Baum; sonst
    Fokus-Ansicht.
  - `focus` — Person im Mittelpunkt (nur Zeichen `[A-Za-z0-9_-]`, höchstens
    64). Im ganzen Baum zentriert die Ansicht darauf.
  - `up`, `down` — Tiefe der Fokus-Ansicht (`parseDepth`, Grenzen und
    Standard aus `FOCUS_DEPTH` in `lib/focus-tree.ts`).
  - `bezug` — vorübergehende Bezugsperson; `bezug=ich` zurück zur eigenen.
  - `denied` — Hinweis nach einer Umleitung wegen fehlender Rechte.
- **Cookies:** `tree-focus` (zuletzt fokussierte Person), `tree-bezug`
  (Bezugsperson), `tree-lines` (Großeltern-Linien an/aus).
- **Daten:** `loadGraph` (ein Graph für Baum und Bezugsperson),
  `resolveReference` (Vorrang Adresse vor Cookie vor eigener Person; nur
  sichtbare Personen), `listFamilies`. Fokus-Ansicht: `loadFocusTree` mit
  Mittelpunkt aus `focus`, sonst `bezug`, sonst Cookie, sonst
  Bezugsperson; eine angefragte, aber unbekannte oder gesperrte Person
  ergibt den Hinweis „Person nicht gefunden“ (gemerkte Personen dürfen
  fehlen, dann Ersatzperson). Ganzer Baum: `loadTree`. Verwandtschaftsgrade
  und Linien über `referenceView` — in der Fokus-Ansicht nur für die
  Personen im Ausschnitt.
- **Anzeige:** Überschrift mit Zählung („n Personen (m weitere nicht
  freigegeben) · k Beziehungen“), `ReferenceChip` („Sicht von: …“),
  „Person anlegen“ (nur mit Bearbeitungsrecht), `FamilyTree` mit Ansicht,
  Daten, Familienauswahl, Bezugsperson und Linienstatus. Leerer Bestand →
  Hinweiskarte.
- Die Seite füllt genau die Bildschirmhöhe zwischen Kopf- und Fußzeile.

### `/map` — `app/map/page.tsx`

Karte „Wurzeln nach Jahr“ (README, „Karte und Orte“).

- **Rechte:** angemeldet; gezählt werden nur sichtbare Personen.
- **Suchparameter:** `person` (Ausgangsperson; ändert die Bezugsperson des
  Baums nicht), `mode` = `vorfahren` (Standard) oder `alle`, `jahr`
  (Startjahr; sonst das Jahr mit den meisten Personen).
- **Daten:** `loadMapView` (aus `lib/services/map.ts`) mit Person, Cookie
  der Bezugsperson und Modus.
- **Anzeige:** Ausgangsperson mit Link („ich“ bzw. „Bezugsperson“),
  `MapPersonChooser`, Umschalter Vorfahren/alle, `MapExplorer` (Karte,
  Jahresregler; Linien nur mit Ausgangsperson). Ohne Ausgangsperson im
  Modus Vorfahren ein Hinweis statt Karte. Für Administratoren ein Hinweis
  auf Ortstexte ohne Koordinaten mit Link nach `/admin/places`.
  Aufklappbare Zählregeln, Quellenangabe der Geodaten, Rechenzeit.

### `/people` — `app/people/page.tsx`

- **Rechte:** angemeldet; Liste enthält nur sichtbare Personen.
- **Suchparameter:** `q` (Namenswörter), `place` (Ort), `family` (nur
  sichtbare Familien werden übernommen), `sort` (`name`, `birthDate`,
  `birthDateDesc`, `updatedAt`), `page` (40 je Seite), `deleted` (Name
  einer eben gelöschten Person für die Erfolgsmeldung).
- **Daten:** `listFamilies`, `searchPersons`; für Trefferhinweise zusätzlich
  die weiteren Namen der Treffer direkt aus der Datenbank. Eine Seitenzahl
  jenseits des Endes zeigt die letzte Seite — mit denselben Filtern (auch
  `place`).
- **Anzeige:** Suchformular (Familienauswahl nur bei mehr als einer
  Familie, `AutoSubmitSelect`), Karten je Person mit `Avatar`,
  Lebensspanne, Geburtsname, Trefferhinweis („Rufname …“, „auch: …“, Ort bei
  Ereignis oder Ehe), Familienkennzeichen, Zahl der Beziehungen;
  Seitennavigation. „Person anlegen“ nur mit Bearbeitungsrecht.

### `/people/new` — `app/people/new/page.tsx`

- **Rechte:** Admin oder Bearbeiter in mindestens einer Familie; sonst
  `/tree?denied=1`.
- **Daten:** die Familien, in denen der Benutzer bearbeiten darf (Admin:
  alle).
- **Anzeige:** `PersonForm` mit Familienauswahl. Speichern geht über
  `POST /api/persons`.

### `/people/[id]` — `app/people/[id]/page.tsx`

Die Personenseite.

- **Rechte:** Person sichtbar, sonst `notFound()`. Bearbeitungsteile nur
  bei `canEdit` (aus `getPersonDetail`). Auch der Seitentitel (Name)
  entsteht erst nach der Rechteprüfung.
- **Suchparameter:** `rel` (eine Beziehungs-ID: deren Bilderbereich ist
  geöffnet — so verlinken Baum und Recherche), `bezug` (an
  `ReferencePanel` weitergereicht).
- **Daten:** `getPersonDetail` (einmal je Anfrage, auch für den Titel),
  Porträts der sichtbaren Verwandten (Platzhalter bekommen keines). Nur für
  Bearbeiter: `listPickablePersons` (nur sichtbare), `listFamilies`,
  `listSourceOptions`, `listDuplicatesOfPerson`.
- **Anzeige (Komponenten):** `DuplicateBanner` (nur Bearbeiter), Kopf mit
  `Avatar`, Lebensdaten samt abweichender Zweitangaben, Knöpfe
  „Bearbeiten“ und „Im Stammbaum zeigen“ (`/tree?focus=…`);
  `ReferencePanel` (Verwandtschaft zur Bezugsperson, „Das bin ich“, „Baum
  aus dieser Sicht“); Notizen; `EventSection` (Ereignisse der Person und
  ihrer Partnerschaften in einer Liste); `NameVariants`; Familie in
  Gruppen Eltern, Geschwister, Partner (mit Heirats-/Scheidungsorten,
  abweichenden Angaben und aufklappbaren Hochzeitsbildern über
  `MediaGallery`), Kinder — gesperrte Verwandte als Platzhalter;
  `CitationSection` (Belege); Belegbilder (Scans an Ereignissen, Belegen,
  zitierten Quellen, Vorschaubild über `/api/media/<id>?variant=thumb`);
  `MediaGallery` (eigene Bilder). Nur Bearbeiter: `PersonChanges`
  (Änderungsverlauf) und der Bereich „Verwaltung“ mit
  `RelationshipEditor`, `PersonFamilies`, `MergeWithPicker`,
  `DeletePersonButton`.

### `/people/[id]/edit` — `app/people/[id]/edit/page.tsx`

- **Rechte:** sichtbar, sonst 404; nicht bearbeitbar → zurück zur
  Personenseite.
- **Daten:** die Person direkt aus der Datenbank samt Familien; Geburts-
  und Sterbedatum als Eingabetext in gespeicherter Genauigkeit
  (`toDateInput`, `dateFieldFrom`; ein Wortlaut ohne Datum steht als Text
  im Feld).
- **Anzeige:** `PersonForm` mit allen Feldern; Speichern über
  `PATCH /api/persons/[id]`.

### `/people/merge` — `app/people/merge/page.tsx`

- **Rechte:** angemeldet; Rechte und Sichtbarkeit prüft der Dienst
  (unsichtbar = nicht gefunden).
- **Suchparameter:** `keep` (bleibende Person), `other` (aufgehende
  Person). Fehlt eines, ein Hinweis mit Link zu „Mögliche Dubletten“.
- **Anzeige:** `MergeView` (nutzt `POST /api/persons/merge/preview` und
  `POST /api/persons/merge`).

### `/research` — `app/research/page.tsx` (+ `loading.tsx`)

- **Rechte:** angemeldet; alle Zahlen nur über sichtbare Personen.
- **Daten:** `getStatistics`, `findDataGaps` (25 je Art),
  `listDuplicateCandidates` (20), `findInconsistencies` (200).
- **Anzeige:** Kennzahlen (Personen, Beziehungen, Zeitraum, Bilder),
  Personen je Familie (Link `/people?family=…`), Datenlücken je Art
  aufklappbar (Beziehungslücken mit Link `/people/<id>?rel=<Beziehung>`),
  mögliche Dubletten (`DuplicateList`, Link „alle prüfen“), Widersprüche
  je Art. Für Administratoren zusätzlich der Hinweis auf „Importe
  verbinden“.

### `/research/duplicates` — `app/research/duplicates/page.tsx`

- **Rechte:** angemeldet (Dienst filtert auf Sichtbares).
- **Suchparameter:** `klasse` (`high`, `medium`, `low`), `seite` (25 je
  Seite).
- **Daten:** `listDuplicateCandidates`. **Anzeige:** Klassenwahl mit
  Zahlen, `DuplicateList`, Zahl der als „kein Duplikat“ markierten Paare.

### `/research/connect` — `app/research/connect/page.tsx`

- **Rechte:** nur Administratoren; alle anderen bekommen 404.
- **Anzeige:** `ConnectImports` (arbeitet über `/api/connect…`).

### `/sources` — `app/sources/page.tsx`

- **Rechte:** angemeldet; nur sichtbare Quellen.
- **Suchparameter:** `q`, `kind` (Quellenart aus `SOURCE_KINDS`), `page`
  (40 je Seite), `deleted` (Titel einer eben gelöschten Quelle).
- **Daten:** `listSources`; eine Seitenzahl jenseits des Endes lädt die
  letzte Seite mit denselben Filtern. **Anzeige:** Suchformular, Liste,
  „Quelle anlegen“ nur bei `canCreateSources`.

### `/sources/new` — `app/sources/new/page.tsx`

- **Rechte:** `canCreateSources` (Bearbeiter in mindestens einer Familie),
  sonst → `/sources`.
- **Anzeige:** `SourceForm`. Bis zum ersten Beleg sehen nur der Anleger
  und Administratoren die Quelle.

### `/sources/[id]` — `app/sources/[id]/page.tsx`

- **Rechte:** Quelle sichtbar, sonst 404. Bearbeiten nur bei `canEdit`,
  Löschen nur bei `canDelete`.
- **Suchparameter:** `saved` (Meldung „Quelle gespeichert“), `seite`
  (Belege, 50 Gruppen je Seite).
- **Daten:** `getSource`, für Bearbeiter `listScanCandidates`.
- **Anzeige:** Kopf mit Art, Anbieter, Hinweis bei abgeleiteten Quellen
  (z.B. Online-Stammbäume anderer), Angaben (Archiv, Signatur, Datum,
  Internetadresse), Abschrift, Hauptscan und weitere Bilder
  (`AttachedMedia`), Belege gruppiert je Person bzw. Beziehung (gesperrte
  als Platzhalter, `CitationLink`, Bilder je Beleg), Zahl der verborgenen
  Belege, `DeleteSourceButton`.

### `/sources/[id]/edit` — `app/sources/[id]/edit/page.tsx`

- **Rechte:** sichtbar (sonst 404) und bearbeitbar (sonst → Quellenseite).
- **Daten:** `getSource`, `listScanCandidates`. **Anzeige:** `SourceForm`
  mit Datum in gespeicherter Genauigkeit und Scan-Auswahl.

### `/admin/data` — `app/admin/data/page.tsx`

- **Rechte:** angemeldet (der Export enthält nur Sichtbares). Import und
  Importverlauf nur mit `data:import`, Link zu „Orte zuordnen“ nur mit
  `place:manage`.
- **Daten:** `exportFamilyOverview` (Familien und Personenzahlen für den
  GEDCOM-Exportdialog), für Admins `listFamilies`.
- **Anzeige:** `DataTransfer` (Export, Austauschformat-Import),
  `GedcomImport`, `ImportHistory`.

### `/ai-access` — `app/ai-access/page.tsx`

- **Rechte:** jeder angemeldete Benutzer (nur eigene Schlüssel). Ohne
  KI-Recht erklärt die Seite die Lage; vorhandene Schlüssel lassen sich
  trotzdem widerrufen.
- **Daten:** `getAiAccessInfo`, `listApiTokens`, Umgebungsvariable
  `MCP_CONNECTOR_URL`.
- **Anzeige:** `AiAccessManager` (Schlüssel anlegen/widerrufen; das
  Geheimnis kommt nur aus der Antwort von `POST /api/ai-tokens` im Browser,
  nie aus dem HTML der Seite), `AiConnectGuide` (Anleitungen Handy,
  Browser/Desktop, Claude Code).

### `/admin/families` — `app/admin/families/page.tsx`

- **Rechte:** `family:manage`, sonst `/tree?denied=1`.
- **Daten:** direkt aus der Datenbank: alle Familien mit Personen- und
  Mitgliederzahl, alle Benutzer mit Familienrollen, Zahl der Personen ohne
  Familie.
- **Anzeige:** `FamilyAdmin` (nutzt `/api/families…`).

### `/admin/users` — `app/admin/users/page.tsx`

- **Rechte:** `user:manage`, sonst `/tree?denied=1`.
- **Daten:** direkt aus der Datenbank: alle Benutzer mit Rolle, Status,
  letzter Anmeldung, KI-Recht, eigener Person, Zahl aktiver Schlüssel,
  verknüpfter Anmeldekonten und Familien; `listPickablePersons` für
  „Person zuordnen“. Daraus: „nie angemeldet“ (E-Mail korrigierbar) und
  „letzter aktiver Admin“.
- **Anzeige:** `UserAdmin` (nutzt `/api/users…`, `/api/ai-tokens`).

### `/admin/changes` — `app/admin/changes/page.tsx`

- **Rechte:** `audit:read`, sonst `/tree?denied=1`.
- **Suchparameter:** `family`, `user`, `channel` (`APP` oder `MCP`), `from`,
  `to` (Datum `JJJJ-MM-TT`), `page`. Ohne `from` die letzten 30 Tage; ein
  bewusst leeres `from=` zeigt alles.
- **Daten:** `changeFilterFrom`, `changeFilterOptions`, `listChangeSets`.
- **Anzeige:** Filterformular, `ChangeSetList` (eine Zeile je Paket,
  aufklappbar über `GET /api/changes/[key]`), Seitennavigation.

### `/admin/places` — `app/admin/places/page.tsx`

- **Rechte:** `place:manage`, sonst `/tree?denied=1`.
- **Suchparameter:** `status` (`all`, `open`, `auto`, `manual`,
  `unresolvable`), `q`, `page`.
- **Daten:** `listPlaces`. **Anzeige:** Zähler je Status als Filter,
  `PlaceAutoAssign`, Suchfeld, `PlaceTable`, Seitennavigation.

---

## API-Routen im Einzelnen

Eingaben in Klammern sind JSON-Felder des Anfragekörpers, sofern nicht
anders angegeben. Wo nichts anderes steht, antworten Routen mit dem
Ergebnis des Dienstes als JSON (200, beim Anlegen 201) und mit den
Fehlercodes aus den Grundregeln.

### Anmeldung und Betrieb

- **`/api/auth/[...nextauth]`** (`GET`, `POST`): die Handler von Auth.js.
  Nur eingeladene, nicht gesperrte E-Mail-Adressen kommen durch; bei der
  Anmeldung wird der Benutzer auf aktiv gesetzt und `lastLoginAt`
  aktualisiert.
- **`GET /api/health`**: bewusst ohne Anmeldung und ohne Inhalt. Prüft die
  Datenbank (`SELECT 1`) und ob der Medienordner samt Unterordnern
  beschreibbar ist (`checkMediaDir`), je mit 3 s Zeitgrenze. Antwort
  `{ status: "ok" }` (200) oder `{ status: "error" }` (503), immer
  `no-store`; Fehler nur als eine Zeile im Server-Log. Test:
  `tests/health.test.ts`.
- **`/api/mcp`**: siehe [mcp.md](mcp.md).

### Baum und Karte

- **`GET /api/tree`**: der ganze Graph über `loadTree` — sichtbare
  Personen mit Angaben, alle übrigen als anonyme Platzhalter.
- **`GET /api/map`**: Kartendaten wie `/map` über `loadMapView`.
  Suchparameter `person`, `mode` = `ancestors` oder `all` (anders als die
  Seite, die `vorfahren`/`alle` nimmt); ohne `person` gilt die
  Bezugsperson aus dem Cookie.

### Personen

- **`GET /api/persons`**: `searchPersons`. Suchparameter `q`, `familyId`,
  `limit`, `offset`, `sort`. Antwort ist ein Array (ohne
  `relationCount`), Gesamtzahl im Kopf `X-Total-Count`. Den Ortsfilter der
  Personenliste bietet diese Route nicht an.
- **`POST /api/persons`**: `createPerson` — Felder der Person, optional
  Familien; ohne Angabe landet die Person bei Nicht-Admins in einer
  bearbeitbaren Familie (Regeln im Dienst). 201.
- **`GET /api/persons/[id]`**: `getPersonDetail`; unsichtbar → 404.
- **`PATCH /api/persons/[id]`**: `updatePerson` (Teil-Update).
- **`DELETE /api/persons/[id]`**: `deletePerson`; Suchparameter
  `force=true` — ohne ihn wird eine Person mit Beziehungen nicht gelöscht
  (Fehler mit Zahl der Beziehungen). Erfordert Bearbeitungsrecht.
- **`GET /api/persons/[id]/changes`**: `listPersonChanges`, neueste
  zuerst; Suchparameter `cursor`, `limit`. Nur für Bearbeiter der Person.
- **`GET /api/persons/[id]/events`**: `listPersonEvents` (ohne die
  Ereignisse der Beziehungen); fehlt/unsichtbar → 404.
- **`POST /api/persons/[id]/events`**: `createEvent` an dieser Person
  (Art, Bezeichnung, abweichende Angabe, Datum, Datumstext, Ort, Wert,
  Ursache, Alter, zuständige Stelle, Adresse, Notizen). Regeln in
  `lib/events.ts` (Geburt/Tod nur als abweichende Angabe). 201.
- **`PUT /api/persons/[id]/families`** (`familyIds`, höchstens 50):
  `setPersonFamilies`; ungültige Eingabe 400.
- **`GET /api/persons/[id]/names`**, **`POST`** (`type`, Namensteile,
  Bezeichnung, Notizen): `listPersonNames` bzw. `createPersonName`.
- **`PATCH /api/names/[id]`**, **`DELETE`**: `updatePersonName` bzw.
  `deletePersonName`; die Person bleibt fest.

### Zusammenführen und Dubletten

- **`POST /api/persons/merge/preview`** (`keepId`, `mergeId`, `choices`,
  `relationshipSubtypes`): `previewPersonMerge` — was geschähe (Felder,
  Zusammenfassung, Blockaden, Prüfwert `token`); schreibt nichts.
  Unsichtbare Personen 404.
- **`POST /api/persons/merge`** (dazu `expectedToken`): `mergePersons` in
  einer Transaktion. Doppeltes Absenden liefert das gespeicherte Ergebnis
  (`alreadyMerged`); Blockaden oder seit der Vorschau geänderte Daten →
  409. Erfordert Bearbeitungsrecht an beiden Personen.
- **`POST /api/persons/merge/bulk`** (`pairs` aus `{a, b}`, `dryRun`): mit
  `dryRun` gemeinsame Vorschau (`previewBulkMerge`), sonst Ausführen Paar
  für Paar (`bulkMerge`), ein gemeinsames Paket „Sammel-Zusammenführen“.
- **`GET /api/duplicates`**: `listDuplicateCandidates`; Suchparameter
  `offset`, `limit` (Standard 25), `confidence`.
- **`POST /api/duplicates/dismiss`** / **`DELETE`** (`a`, `b`):
  `dismissDuplicate` bzw. `undismissDuplicate`.

### Beziehungen und Ereignisse

- **`POST /api/relationships`**: `createRelationship` — Typ, Art, Personen,
  Zeitraum, Orte, Notiz; Regeln (Art passend zum Typ, plausible Daten,
  keine Zyklen, höchstens zwei leibliche Eltern, Rechte) im Dienst. 201.
- **`PATCH /api/relationships/[id]`**: `updateRelationship` (Art, Zeitraum,
  Orte, Notiz — die Personen bleiben fest). **`DELETE`**:
  `deleteRelationship`.
- **`GET /api/relationships/[id]/events`**, **`POST`**: Ereignisse einer
  Beziehung (Verlobung, Aufgebot, abweichende Heiratsangabe …); Felder wie
  bei Personen. 404 bei fehlender/unsichtbarer Beziehung.
- **`GET /api/events/[id]`** (404, wenn fehlt oder Träger unsichtbar),
  **`PATCH`** (Teil-Update, Träger bleibt fest), **`DELETE`** (samt
  Belegen): `getEvent`, `updateEvent`, `deleteEvent`.

### Quellen und Belege

- **`GET /api/sources`**: `listSources`; Suchparameter `q`, `kind`,
  `limit`, `offset`. Array, Gesamtzahl in `X-Total-Count`.
- **`POST /api/sources`**: `createSource` — nur mit Bearbeitungsrecht in
  mindestens einer Familie. 201.
- **`GET /api/sources/[id]`** (unsichtbar → 404), **`PATCH`**
  (`updateSource`), **`DELETE`** (`deleteSource`, samt aller Belege und
  nur noch daran hängender Bilder; abgelehnt mit 403, wenn die Quelle
  Angaben belegt, die der Benutzer nicht bearbeiten darf).
- **`POST /api/citations`** (`sourceId`, `personId` oder
  `relationshipId` bzw. Ereignis, `fact`, `detail`, `confidence`):
  `createCitation`. 201.
- **`PATCH /api/citations/[id]`** (Angabe, Fundstelle, Verlässlichkeit —
  Quelle und Bezug bleiben fest), **`DELETE`**: `updateCitation`,
  `deleteCitation`.

### Bilder

- **`POST /api/media`** (Formular: `file`, `caption`, höchstens **ein**
  Ziel aus `personId`, `relationshipId`, `eventId`, `citationId`,
  `sourceId`): `addMedia`. Der Upload läuft durch den Server; sharp prüft
  den echten Dateityp und erzeugt das Vorschaubild. Ohne Datei 400, mehr
  als ein Ziel 400, zu groß 413, falsches Format oder abweichender Typ
  415. Ohne Ziel nur für Administratoren (Dienst). 201.
- **`GET /api/media/[id]`**: liefert das Bild aus dem Medienordner aus —
  nur durch die App, nie direkt. Suchparameter `variant=thumb` für das
  Vorschaubild. Unbekannt oder unsichtbar → 404 (`canViewMedia`), fehlende
  Datei → 404 mit Hinweis im Log. Kopfzeilen `ETag`,
  `Cache-Control: private, max-age=31536000, immutable`; bedingte Anfrage
  mit passendem `If-None-Match` → 304.
- **`DELETE /api/media/[id]`**: unsichtbar 404, ohne Löschrecht
  (`canDeleteMedia`) 403. Löscht den Datensatz, danach die Dateien (eine
  verwaiste Datei wird hingenommen); Audit direkt in der Route mit den
  betroffenen Personen.
- **`POST /api/media/[id]/links`** (Einzel- oder Listenfelder für
  Personen, Beziehungen, Ereignisse, Belege, Quellen; je höchstens 50):
  `linkMedia` — Bild sichtbar, jedes Ziel bearbeitbar.
- **`DELETE /api/media/[id]/links`** (Ziele als Suchparameter, z.B.
  `?eventId=…`): `unlinkMedia` **mit** Löschen eines danach verwaisten
  Bildes (die Oberfläche fragt vorher). Anders als `link_media` über MCP,
  das nie löscht.
- **`POST /api/media/[id]/primary`** (genau eines von `personId`,
  `relationshipId`): Primärbild setzen (Porträt der Person bzw. Bild der
  Hochzeit). Rechte über `canUploadForPerson` /
  `canUploadForRelationship` (403); Bild nicht zugeordnet → 404. Zurücksetzen
  und Setzen in einer Transaktion; Audit in der Route.

### Familien und Benutzer

- **`GET /api/families`**: `listFamilies` — Nicht-Admins nur ihre eigenen
  Familien.
- **`POST /api/families`** (`name` bis 120, `description` bis 500):
  `family:manage`; gleicher Name → 409. Direkt über Prisma mit Audit. 201.
- **`PATCH /api/families/[id]`**: Name/Beschreibung ändern; fehlt → 404.
- **`DELETE /api/families/[id]`**: hängen noch Personen oder
  Benutzerzuordnungen daran, 409 mit Zahlen — Löschen nur mit
  `?force=true` (Personen ohne Familie sieht danach nur der Admin).
- **`POST /api/families/[id]/members`** (`userId`, `role` = `EDITOR`,
  `VIEWER` oder `null` zum Entziehen): Zuordnung setzen oder entfernen;
  Familie oder Benutzer fehlt → 404. Audit am Benutzer.
- **`GET /api/users`** (`user:read`): alle Benutzer mit KI-Recht und Zahl
  aktiver Schlüssel.
- **`POST /api/users`** (`user:manage`; Felder nach `userInput`):
  Einladung — legt den Benutzer mit Status „eingeladen“ an; vorhandene
  E-Mail → 409. 201.
- **`PATCH /api/users/[id]`** (`user:manage`; Felder nach `userPatch`,
  u.a. Rolle, Status, E-Mail, eigene Person): Schutzregeln mit 409 — E-Mail
  nur änderbar, solange sich der Benutzer nie angemeldet hat, und nicht auf
  eine vergebene; eigene Rolle und eigenen Status ändert nur ein anderer
  Admin; der letzte aktive Admin (schon einmal angemeldet) kann nicht
  herabgestuft oder gesperrt werden. Unbekannte Person → 404.
- **`DELETE /api/users/[id]`**: nicht sich selbst, nicht den letzten
  aktiven Admin (409).
- **`PUT /api/users/[id]/ai-access`** (`aiAccess` = `NONE`, `READ`,
  `WRITE`): `setUserAiAccess`; vorhandene Schlüssel bleiben, ihre
  wirksame Stufe folgt sofort dem neuen Recht.
- **`PUT /api/me/person`** (`personId` oder `null`): „Das bin ich“ über
  `setSelfPerson`; nur sichtbare Personen, sonst 404.

### KI-Schlüssel

- **`GET /api/ai-tokens`**: eigene Schlüssel samt eigenem KI-Recht und
  Grenzen (`{ info, tokens }`). Mit `?all=1` (optional `&userId=`) nur für
  Administratoren alle Schlüssel mit Besitzer (`listAllApiTokens`, sonst
  403). Keine Antwort enthält den Hash.
- **`POST /api/ai-tokens`** (`name`, `level`, `expiresInDays`):
  `createApiToken` — nur über die Weboberfläche, nur mit KI-Recht, Stufe
  höchstens das eigene Recht, begrenzte Zahl aktiver Schlüssel. Antwort
  201 mit `{ token, secret }` und `Cache-Control: no-store`; das Geheimnis
  steht nur hier.
- **`DELETE /api/ai-tokens/[id]?endgueltig=1`**: endgültig löschen (`deleteApiToken`) → `{ …ApiTokenDto, deleted: true }`; 404 fremd/unbekannt, 409 aktiv und schon benutzt („erst widerrufen“), 403 über den KI-Kanal.
- **`DELETE /api/ai-tokens/[id]`** (ohne Parameter): `revokeApiToken` — eigene immer,
  fremde nur als Admin (sonst 404); der Datensatz bleibt als widerrufen
  erhalten.

### Änderungsgeschichte

- **`GET /api/changes`** (`audit:read`): `listChangeSets`; Suchparameter
  `family`, `user`, `channel`, `from`, `to`, `page`.
- **`GET /api/changes/[key]`** (`audit:read`): `listChangeSetEntries` mit
  denselben Filtern und `cursor`.

### Export und Import

- **`GET /api/export`** (angemeldet; enthält nur, was der Benutzer sehen
  darf): Suchparameter `format` =
  - `json` (Standard): Austauschformat (`buildExport`) als Download
    `stammbaum_<Datum>.json`;
  - `zip`: dazu die Bilddateien unter `media/`; nicht lesbare Bilder werden
    übersprungen und in `HINWEIS.txt` gezählt;
  - `gedcom`: GEDCOM 5.5.1 (`buildGedcomExport`);
  - `gedzip`: GEDCOM mit Bildern als ZIP (`buildGedcomZip`);
  - bei GEDCOM optional Familienauswahl `families=<id>,<id>` und
    `withoutFamily=1` (`parseExportSelection`);
  - anderes Format → 400.
- **`POST /api/import`** (`data:import`; Formular `file` = JSON oder ZIP
  mit `stammbaum.json` und `media/`; Suchparameter `apply=true`): liest und
  prüft die Datei gegen das Austauschschema (Fehler → 400), berechnet einen
  Plan (anlegen/aktualisieren je Art, übersprungene Bilder, Warnungen;
  ungültige Beziehungen, Belege und Ereignisse werden nicht übernommen).
  Ohne `apply` nur Vorschau `{ preview: true, plan }`. Mit `apply` werden
  Personen, Beziehungen, Bilder, Quellen, Ereignisse, Namen, Belege,
  externe Kennungen und Rohdaten nacheinander per Upsert über ihre
  Kennungen eingespielt; Paket „Daten eingespielt („Datei“)“ und ein
  Sammel-Audit mit allen Personen der Datei. Eine umschließende
  Transaktion ist im Code nicht erkennbar (unklar, ob gewollt).
- **`POST /api/import/gedcom`** (Formular `file`, `.ged` oder `.zip` mit
  einer `.ged`): `startGedcomImport` — legt einen Lauf an, bewahrt das
  Original auf und berechnet die Vorschau; ändert keine Stammbaumdaten.
  Ohne Datei 400.
- **`GET /api/import/gedcom/[id]`**: Zusammenfassung der Vorschau
  (`getGedcomPlan`). **`POST`** (`mode` = `auto`, `new`, `existing`,
  `sourceTreeId`): Vorschau mit anderer Wahl des Quell-Baums neu berechnen.
  **`DELETE`**: nicht ausgeführte Vorschau verwerfen.
- **`GET /api/import/gedcom/[id]/items`**: Vorschau-Einträge seitenweise;
  Suchparameter `kind`, `group`, `offset`, `limit` (Standard 50), `q`.
- **`POST /api/import/gedcom/[id]/apply`** (Entscheidungen aus der
  Vorschau): Import im Hintergrund starten, 202; doppeltes Absenden
  startet keinen zweiten Lauf. **`GET`**: Stand des Laufs.
- **`POST /api/import/gedcom/[id]/reread`**: ausgeführten Import aus dem
  aufbewahrten Original erneut einlesen (neuer Lauf mit Vorschau).
- **`GET /api/import/batches`**: Importverlauf aller Formate, neueste
  zuerst; Suchparameter `limit` (Standard 50).
- **`GET /api/import/batches/[id]/file`**: aufbewahrte Originaldatei als
  Download (Dateiname bereinigt, `no-store`); fehlt → 404.
- **`POST /api/import/batches/prune`** (`batchId` optional): überholte
  Rohdaten eines Laufs bzw. aller Läufe entfernen.

### Importe verbinden

- **`GET /api/connect`**: Auswahl (Gruppen von Importen) und letzte Läufe.
  **`POST`** (`groups`, `withinGroup`): Abgleich im Hintergrund starten,
  202.
- **`GET /api/connect/[id]`**: Stand eines Laufs mit Paaren seitenweise;
  Suchparameter `confidence`, `bridges=1`, `sehrWahrscheinlich=1`,
  `offset`, `limit` (Standard 50).
- **`POST /api/connect/[id]`** (`action`): `decide` (mit `accept`,
  `reject`, `dismiss`), `preview` (202) oder `apply` (202, setzt auch nach
  Unterbrechung fort); andere Aktion → 400.

### Orte

- **`GET /api/places`**: `listPlaces`; Suchparameter `status`, `q`, `page`.
- **`PUT /api/places`** (geprüft mit `placeAssignSchema`): Ortstext von
  Hand zuordnen — aus dem Ortsverzeichnis (`directory` mit
  `gazetteerId`), mit eigenen Koordinaten (`coordinates`, Genauigkeit,
  Bezeichnung), oder `confirm`, `unresolvable`, `reset`. Antwort
  `{ assignment }`.
- **`POST /api/places/auto`**: alle nicht von Hand bestätigten Ortstexte
  automatisch aus dem Ortsverzeichnis zuordnen.
- **`GET /api/places/search`**: Suche im mitgelieferten Ortsverzeichnis,
  `q` höchstens 100 Zeichen.

## Tests

Die Routen haben überwiegend keine eigenen Unit-Tests; geprüft werden die
Dienste (`tests/*.db.test.ts`) und das Zusammenspiel im Browser
(Playwright unter `e2e/`). Direkt auf Routen zielen `tests/health.test.ts`
und `tests/mcp-http.db.test.ts`.

| Bereich | E2E-Tests |
|---|---|
| Anmeldung, Navigation, Rechte | `e2e/read/auth.spec.ts`, `navigation.spec.ts`, `permissions.spec.ts`, `mobile.spec.ts` |
| Baum | `e2e/read/tree-focus.spec.ts`, `tree-whole.spec.ts`, `reference.spec.ts`; `e2e/write/reference.spec.ts` |
| Karte, Orte | `e2e/read/map.spec.ts`; `e2e/write/places.spec.ts` |
| Personen | `e2e/read/people-list.spec.ts`, `person-families.spec.ts`, `dates.spec.ts`; `e2e/write/person-lifecycle.spec.ts`, `genealogy.spec.ts`, `dates.spec.ts` |
| Recherche, Dubletten, Zusammenführen | `e2e/read/research.spec.ts`, `quality.spec.ts`, `duplicate-banner.spec.ts`; `e2e/write/merge.spec.ts`, `duplicate-banner.spec.ts`, `connect.spec.ts` |
| Quellen, Bilder | `e2e/write/sources.spec.ts`, `import-sources.spec.ts`, `media.spec.ts`, `attached-media.spec.ts` |
| Export, Import | `e2e/read/export.spec.ts`, `gedcom-export-dialog.spec.ts`; `e2e/write/import.spec.ts`, `gedcom-import.spec.ts` |
| Verwaltung, KI-Zugang, Änderungen | `e2e/write/admin.spec.ts`, `ai-access.spec.ts`, `changelog.spec.ts`; `e2e/read/mcp-http.spec.ts` |
