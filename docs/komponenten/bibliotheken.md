# Bibliotheken (`lib/`, ohne `lib/services/`)

Fachlich-technische Beschreibung aller Module unter `lib/` außer den
Diensten (die stehen in [dienste.md](dienste.md)). Datenbanktabellen:
[datenmodell.md](datenmodell.md). Code bleibt die Wahrheit — weicht er ab,
wird diese Beschreibung berichtigt (AGENTS.md, Abschnitt 1).

**Grundmuster:** Fast alle Module hier sind **rein** (keine Datenbank, kein
Netz, oft auch im Browser nutzbar), damit Oberfläche, Dienste, MCP-Server
und Tests dieselben Regeln verwenden. Datenbankzugriff haben nur `prisma`,
`auth`, `scope`, `audit`, `change-sets`, `media-scope`; Dateisystem bzw.
Netz nur `storage`, `media-processing`, `places/gazetteer-file`,
`help/content`, `safe-fetch`.

Übersicht:

| Bereich | Module |
|---|---|
| Anmeldung, Rechte, Anfrage-Rahmen | `auth`, `dev-login`, `authz`, `session`, `api`, `request-guard`, `rate-limit`, `health-cache`, `scope`, `ai-tokens`, `prisma` |
| Protokoll | `audit`, `change-sets`, `change-time` |
| Daten und Regeln | `dates`, `date-fields`, `events`, `event-labels`, `validation`, `consistency`, `partner-labels`, `source-labels`, `source-classify` |
| Graph und Verwandtschaft | `graph`, `kinship`, `reference` |
| Baumdarstellung | `tree-layout`, `layout-generations`, `focus-tree` |
| Dubletten und Zusammenführen | `name-keys`, `duplicates`, `merge-rules`, `import-linking` |
| Import/Export | `exchange`, `export-selection`, `import-fingerprint`, `gedcom/*`, `gedcom-import/*` |
| Medien | `storage`, `media-processing`, `media-scope`, `safe-fetch` |
| Karte und Orte | `map/*`, `places/*` |
| Anwender-Hilfe | `help/markdown`, `help/content`, `help/links` |
| Einstellungen | `settings/registry` |
| Sonstiges | `build-info`, `plural`, `release-notes`, `release-notes-data` |

---

## Anmeldung, Rechte, Anfrage-Rahmen

### lib/prisma.ts
**Zweck:** Einziger Prisma-Client der App.

**Wichtige Funktionen/Typen:** `prisma` — außerhalb der Produktion an
`globalThis` gemerkt, damit das Neuladen im Entwicklungsmodus nicht bei
jeder Änderung einen neuen Verbindungspool öffnet. Protokolliert im
Entwicklungsmodus Warnungen und Fehler, sonst nur Fehler.

**Benutzt von:** allen Diensten in `lib/services`, `auth`, `scope`,
`audit`, `change-sets`, `media-scope`, mehreren Server-Seiten unter `app/`
(Admin, Personen), einigen API-Routen, `mcp/server.ts`, allen
`*.db.test.ts`.

**Tests:** indirekt über alle Datenbanktests.

### lib/auth.ts
**Zweck:** Anmeldung über Auth.js (next-auth v5) mit **Allowlist**: Nur
E-Mails, die in der Tabelle `User` stehen, kommen hinein.

**Wichtige Funktionen/Typen:** `handlers`, `auth`, `signIn`, `signOut` (aus
`NextAuth`). Erweitert den Sitzungstyp um `user.id` und `user.role`.
Seiten holen die Sitzung über `lib/session.ts`, API-Routen über `route()` in
`lib/api.ts`.

**Regeln und Algorithmen:**
- Anbieter nur, wenn konfiguriert: GitHub (`AUTH_GITHUB_ID`), Google
  (`AUTH_GOOGLE_ID`), jeweils mit E-Mail-Kontoverknüpfung. **Dev-Login**
  (Credentials, nur E-Mail) bei `ENABLE_DEV_LOGIN=true`; zusätzlich
  fragt er bei jeder Anmeldung `devLoginAllowed()` (`lib/dev-login.ts`) und
  verweigert damit in `NODE_ENV=production` jede Anmeldung — außer im
  Produktions-Build der Mock-Umgebung für die E2E-Tests (siehe dort).
- `signIn`-Callback: unbekannte oder gesperrte E-Mail → abgelehnt; sonst
  Status `ACTIVE`, `lastLoginAt`, Name/Bild werden nur ergänzt, nie
  überschrieben.
- JWT-Sitzungen (der Credentials-Anbieter kann keine DB-Sitzungen). Der
  `jwt`-Callback lädt Rolle und Status **bei jeder Anfrage** neu — Rollen-
  wechsel und Sperren wirken sofort.
- Gesperrte Benutzer bekommen eine ungültige Sitzung **ohne** `user`, damit
  keine Weiterleitungsschleife zwischen Login und Baum entsteht.

**Benutzt von:** `app/api/auth/[...nextauth]/route.ts`, `app/layout.tsx`,
`app/login/page.tsx`, `lib/api.ts`, `lib/session.ts`.

**Tests:** keine direkten Tests (Ablauf wird in Playwright über den
Dev-Login genutzt); die Freigaberegel prüft `tests/dev-login.test.ts`.

### lib/dev-login.ts
**Zweck:** Entscheidet, ob der Dev-Login eine Anmeldung annehmen darf
(`devLoginAllowed`). Ausgelagert, damit die Regel ohne Next.js testbar ist.

**Regeln:**
- Außerhalb von `NODE_ENV=production` (Dev-Server, Vitest): ja.
- In Produktion grundsätzlich nein. Einzige Ausnahme ist der
  Produktions-Build der Mock-Umgebung, gegen den die E2E-Tests laufen
  (`scripts/mock.mjs start`). Dafür müssen **alle drei** Bedingungen
  zugleich gelten: `E2E_PRODUCTION_DEV_LOGIN=mock-only` (genau dieser
  Wert), der Datenbankname in `DATABASE_URL` endet auf `_mock`/`_test`, und
  der letzte Teil von `MEDIA_DIR` endet auf `-mock`/`-test` — dieselben
  Namensregeln, mit denen `scripts/mock.mjs` alles außer Mock-Daten
  verweigert.
- Sicherheitsbewertung: Der Anbieter existiert ohnehin nur bei
  `ENABLE_DEV_LOGIN=true`; der Produktivstack setzt `false`, kennt
  `E2E_PRODUCTION_DEV_LOGIN` nicht und nutzt Datenbank `familytree` und
  `/data/media`. Wer die Ausnahme auslösen wollte, müsste die Umgebung des
  Servers ändern können — und damit ohnehin alles. Die Variablen werden zur
  Laufzeit gelesen, nicht beim Build eingesetzt; ein E2E-Build in einem
  fremden Ordner schaltet also nichts frei.

**Benutzt von:** `lib/auth.ts` (`authorize` des Dev-Logins).

**Tests:** `tests/dev-login.test.ts` (Entwicklung erlaubt; Produktion ohne
oder mit falscher Freigabe gesperrt; nur mit Mock-Datenbank **und**
Mock-Medienordner erlaubt; echte Datenbank- und Ordnernamen trotz Freigabe
gesperrt).

### lib/authz.ts
**Zweck:** **Globale** Verwaltungsrechte. Inhaltliche Rechte (Personen,
Beziehungen, Bilder) werden bewusst nicht hier, sondern über die
Familienrollen in `lib/scope.ts` entschieden — eine globale Rolle `EDITOR`
wäre eine zweite, widersprüchliche Quelle.

**Wichtige Funktionen/Typen:** `Action` (`user:read`, `user:manage`,
`audit:read`, `data:import`, `family:manage`, `place:manage`,
`setting:manage`), `can`, `assertCan`, `ForbiddenError`.

**Regeln:** Alle Aktionen sind nur für `ADMIN`; `EDITOR` und `VIEWER`
haben keine globalen Rechte. Begründungen im Code: Import verändert den
ganzen Bestand, Familienverwaltung ist Rechtevergabe, Ortszuordnung zeigt
Ortstexte auch gesperrter Personen, Einstellungen gelten für die ganze
Installation.

**Benutzt von:** `lib/api.ts`, `lib/session.ts`, `app/layout.tsx`,
`app/admin/data/page.tsx`, `app/admin/settings/page.tsx`.

**Tests:** keine eigenen.

### lib/session.ts
**Zweck:** Anmeldeprüfung für Server-Components (bewusst ohne
`middleware.ts`, weil Auth.js dort eine Edge-Konfiguration ohne Prisma
bräuchte).

**Wichtige Funktionen:** `requirePage(action?)` — ohne Sitzung Umleitung
nach `/login`, ohne globales Recht nach `/tree?denied=1`; `requireScope()`
— Sitzung plus Familienrechte (`loadScope`) für inhaltliche Seiten.

**Benutzt von:** praktisch allen Seiten unter `app/` (Baum, Personen,
Quellen, Recherche, Karte, Admin, KI-Zugang).

**Tests:** keine eigenen.

### lib/api.ts
**Zweck:** Einheitlicher Rahmen für API-Route-Handler: Herkunftsprüfung,
Anmeldung, Größen- und Anfragegrenzen, globales Recht, Scope,
Changelog-Paket, Fehlerübersetzung, Kopfzeilen der Antwort.

**Wichtige Funktionen/Typen:**
- `route(action, handler)` — Reihenfolge: schreibende Anfrage fremder
  Herkunft → 403 (`isCrossSiteWrite`, noch vor der Anmeldung, damit eine
  fremde Seite nicht erfährt, ob jemand angemeldet ist); Sitzung (sonst
  401); Körpergröße laut `Content-Length` (413, ohne Länge 411,
  `bodyTooLarge`); Drosselung je Benutzer (429 mit `Retry-After`,
  `checkApiRate`); optional ein globales Recht; lädt den Scope und hängt
  **je Anfrage ein Paket** (`appChangeSet`) an; `action = null` bei
  inhaltlichen Routen, die selbst über den Scope prüfen. Jede Antwort
  (auch Fehler) bekommt `Cache-Control: private, no-store` — außer die
  Route setzt selbst einen Wert (Bilder) — und `X-Content-Type-Options:
  nosniff`.
- `errorResponse(err)` — `ServiceError` → 404/403/409/400 mit Meldung,
  Prüffehlern und Details; `ForbiddenError` → 403; ungültiges JSON → 400;
  Prisma P2025 → 404, P2002 → 409 „existiert bereits“, P2003 → 409; alles
  andere → 500 mit allgemeiner Meldung, Einzelheiten nur ins Server-Log
  (keine Tabellen- oder Pfadnamen nach außen).
- `badRequest`, `forbidden`, `notFound`; Typ `Ctx`.

**Benutzt von:** allen Routen unter `app/api/` außer Auth, Health und MCP.

**Tests:** `tests/api-guard.db.test.ts` (Herkunft, 413, 429, Kopfzeilen;
Baum ohne Familie; Bildauslieferung).

### lib/request-guard.ts
**Zweck:** Reine Prüfungen an einer Anfrage, bevor ein Route-Handler
arbeitet (kein `next/*`, keine Datenbank).

- `isCrossSiteWrite(req)` — schreibende Methoden (alles außer
  GET/HEAD/OPTIONS) mit `Sec-Fetch-Site: cross-site` oder einem `Origin`,
  der weder zur Adresse der Anfrage (`Host`, `X-Forwarded-Host`, auch als
  Liste) noch zu `AUTH_URL` passt, gelten als fremd. Verglichen wird
  Rechnername samt Port, nicht das Schema (TLS endet am Reverse-Proxy).
  `Origin: null` gilt als fremd. Ohne `Origin` und `Sec-Fetch-Site` (kein
  Browser: Skripte, Tests) erlaubt — ohne Browser gibt es kein CSRF. Zweite
  Sicherung neben dem Sitzungs-Cookie mit `SameSite=Lax`.
- `bodyTooLarge(req, pathname)` / `bodyLimitFor(pathname)` — Grenze laut
  `Content-Length` **vor** dem Lesen: JSON 2 MiB, `/api/media`
  `MAX_UPLOAD_BYTES` + 1 MiB, Importe 201 MiB. Ohne Längenangabe (chunked)
  oder mit unlesbarer Länge: „Länge verlangt“.

**Benutzt von:** `lib/api.ts`. **Tests:** `tests/request-guard.test.ts`.

### lib/rate-limit.ts
**Zweck:** Einfache Anfragebegrenzung im Speicher des Prozesses (festes
Zeitfenster je Schlüssel, Tabelle mit Obergrenze). Bewusst ohne Datenbank:
die App läuft als ein Container; nach einem Neustart ist sie leer. Schützt
vor Schleifen und einfachem Missbrauch durch angemeldete Benutzer bzw.
gültige KI-Schlüssel — Massenanfragen Unbekannter gehören in den
Reverse-Proxy.

- `checkApiRate(userId, method, pathname)` — Web-API je Benutzer und Regel
  (`apiBucket`): `export` 10/min, `heavy` 90/min (Baum, Karte, Dubletten
  einschließlich Dubletten einer Person und Folgedubletten, Importe
  verbinden, Zusammenführen, Orte automatisch, Herkunft), `upload` 120/min
  (Bilder, Importdateien), `write` 600/min, `read` 3000/min. Großzügig:
  normale Bedienung erreicht die Grenzen nicht.
- `checkMcpRate(key)` — KI-Zugang je Schlüssel, 300 Anfragen/min, gezählt
  nach erfolgreicher Anmeldung in `mcp/http.ts` (Fehlversuche begrenzt
  `mcp/http.ts` getrennt je Absender).
- `RATE_LIMIT=off` schaltet beides ab — gesetzt nur für den
  Produktions-Build der E2E-Tests (`scripts/mock.mjs`), weil viele
  parallele Testläufer sich wenige Testbenutzer teilen.

**Benutzt von:** `lib/api.ts`, `mcp/http.ts`. **Tests:**
`tests/rate-limit.test.ts`, `tests/api-guard.db.test.ts`.

### lib/health-cache.ts
**Zweck:** Ergebnis von `/api/health` 5 s zwischenspeichern; gleichzeitige
Aufrufe teilen sich die laufende Prüfung. Eigene Datei, weil eine
Route-Datei nur Handler und Routen-Einstellungen exportieren darf.
**Benutzt von:** `app/api/health/route.ts`. **Tests:** `tests/health.test.ts`.

### lib/scope.ts
**Zweck:** **Einzige Stelle** für familienbezogene Rechte („darf dieser
Benutzer diese Person sehen/ändern?“).

**Wichtige Funktionen/Typen:**
- `Scope` (Benutzer, `isAdmin`, Familien → Rolle, optional `via` für den
  MCP-Kanal mit Schlüssel und wirksamer Stufe, optional `changeSet`).
- `loadScope`, `viewableFamilyIds`, `editableFamilyIds`, `canViewPerson`,
  `canEditPerson`, `personVisibilityFilter` (Prisma-Filter),
  `familyIdsOf`, `familyIdsOfPerson`, `canEditRelationship`,
  `canEditRelationshipBetween`, `visibleFamilyIds`, `maskPerson`.

**Regeln:**
- ADMIN sieht und ändert alles, auch Personen ohne Familie.
- Sonst: sehen, sobald eine Familie geteilt wird; bearbeiten mit Rolle
  `EDITOR` in mindestens einer gemeinsamen Familie.
- Personen ohne Familie nur für ADMIN (sichere Grundeinstellung).
- Beziehung bearbeiten: Bearbeitungsrecht an **mindestens einer** Seite und
  Sichtbarkeit **beider** Seiten (Ehen über Familiengrenzen möglich, aber
  keine fremden Personen anhängen).
- Fremde Familien-IDs werden nicht verraten (`visibleFamilyIds`).
- Gesperrte Personen werden zu Platzhaltern „Nicht freigegeben“ ohne
  Angaben, nur mit ID, damit der Baum zusammenhängt.
- Kopien des Scopes teilen dasselbe Paket-Objekt (Verweis).

**Benutzt von:** `lib/api.ts`, `lib/session.ts`, `lib/audit.ts`,
`lib/change-sets.ts`, `lib/media-scope.ts`, allen Diensten, `mcp/tools.ts`,
mehreren Seiten und `components/ReferencePanel.tsx`.

**Tests:** `tests/scope.test.ts`; indirekt alle Dienst-Datenbanktests.

### lib/ai-tokens.ts
**Zweck:** Format, Erzeugung und Prüfung der KI-Zugangsschlüssel. Ohne
Prisma und ohne `next/*`, damit auch der Mock-Seed es nutzen kann.

**Wichtige Funktionen/Typen:** `generateToken` (liefert Geheimnis, Präfix,
Hash), `hashToken`, `tokenPrefixOf` (prüft das Format, liefert den
öffentlichen Anfang), `tokenMatches` (Vergleich in konstanter Zeit),
`TOKEN_PREFIX`.

**Regeln:** Format `ftk_` + 12 Hex-Zeichen (öffentliche Kennung, als
`ApiToken.prefix` gespeichert) + `_` + 32 Zufallsbytes base64url. `ftk_`
macht durchgesickerte Schlüssel per Secret-Scanner auffindbar. Gehasht wird
mit SHA-256 statt Passwort-KDF: bei 256 Bit Zufall gibt es kein Wörterbuch,
und ein KDF kostete bei jedem MCP-Aufruf Rechenzeit (Lastangriff).

**Benutzt von:** `lib/services/ai-access.ts`, `mcp/http.ts`,
`prisma/seed-mock.ts`.

**Tests:** `tests/ai-access.test.ts`, `tests/ai-access.db.test.ts`,
`tests/mcp-http.db.test.ts`.

---

## Protokoll

### lib/audit.ts
**Zweck:** Audit-Einträge schreiben — wer, was, über welchen Kanal, in
welchem Paket, welche Personen und Familien betroffen.

**Wichtige Funktionen/Typen:**
- `audit(input)` — schreibt einen Eintrag; **fehlertolerant**, ein
  kaputtes Audit rollt die eigentliche Änderung nicht zurück.
- `auditData(input, db)` — fertige Zeile für Dienste, die in ihrer eigenen
  Transaktion schreiben (`db` sieht deren Stand).
- `auditActor(scope)` — Benutzer, Kanal, Schlüssel-ID und Paket aus dem
  Scope, damit Dienste den Kanal nicht selbst kennen müssen.
- `fieldChanges(before, patch)` — nur wirklich geänderte Felder als
  `{ feld: { from, to } }`; die Spalten eines ungenauen Datums werden zu
  **einem** Feld in Anzeigeform zusammengefasst.
- `auditRefs` — Momentaufnahme der betroffenen Personen und Familien.
- `defaultChangeSetTitle` — Paket-Titel aus dem ersten Eintrag („Person
  geändert“, beim Zusammenführen „Personen zusammengeführt“).
- Typen `AuditInput`, `AuditEntityType` (inkl. `Place` und `Setting` —
  Einstellungen, `entityId` = Schlüssel, ohne Personen/Familien), `FieldChange`.

**Regeln:** Betroffene Personen werden je Art abgeleitet: Beziehung → beide
Personen; Ereignis/Name/Beleg → Träger; Bild → alle Träger (Personen,
Beziehungen, Ereignis- und Belegträger); Quelle → belegte Personen
(höchstens 1000; beim Anlegen keine); Person bei `CONNECT` keine (die ID
ist dann der Lauf). Ist der Datensatz schon gelöscht, wird aus den Feldern
des Eintrags gelesen; zusätzlich übergebene IDs werden ergänzt. Familien
sind die Familien dieser Personen plus ausdrücklich genannte (Familie
selbst, Benutzer mit `familyId`).

**Familien der Person im Eintrag** (`subjectFamilyIds`,
`subjectFamiliesKnown`): Bei Einträgen über eine Person (außer `CONNECT`)
speichert `auditRefs` zusätzlich genau deren Familien zum Zeitpunkt des
Eintrags — gelesen aus der Person (in der Transaktion des Dienstes, also
nach der Änderung; beim Zusammenführen die bleibende Person samt
übernommener Familien). Ist die Person beim Schreiben schon gelöscht, gilt
das ausdrücklich übergebene `subjectFamilyIds` (Person löschen: die
Familien vor dem Löschen); fehlt es, bleibt der Eintrag „nicht erfasst“ —
nie geraten. Der Sammel-Eintrag beim Import (`import-apply.ts`, schreibt
Zeilen selbst) setzt beide Felder ebenso. Ausgewertet in
`lib/services/changes.ts` (Leserecht, wenn es die Person nicht mehr gibt).

**Benutzt von:** fast allen schreibenden Diensten, mehreren Admin- und
Medienrouten.

**Tests:** `tests/changelog.test.ts` (indirekt `changelog.db.test.ts`,
`changelog-subject.db.test.ts`).

### lib/change-sets.ts
**Zweck:** Changelog-Pakete (`ChangeSet`) anlegen, benennen und für den
KI-Zugang bündeln.

**Wichtige Funktionen/Typen:** `appChangeSet` (Paket je Web-Anfrage),
`nameChangeSet` (Titel/Art setzen — der erste Aufruf gewinnt, z.B. benennt
das Sammel-Zusammenführen sein Paket vor den einzelnen Zusammenführungen),
`resolveChangeSetId` (legt das Paket beim ersten Eintrag an bzw. findet das
laufende; Fehler → `null`, die Änderung geht trotzdem durch),
`changeSetIdOf`, `mcpChangeSet` (prüft eine `change_set_id` vom KI-Client),
`beginMcpChangeSet` (Werkzeug `begin_change_set`). Konstanten:
`MCP_BUNDLE_WINDOW_MS` (30 Minuten), `MCP_CHANGE_SET_MAX_AGE_MS` (24
Stunden), `CHANGE_SET_TITLE_MAX` (200).

**Regeln:**
- Angelegt wird ein Paket erst mit dem ersten Audit-Eintrag; lesende
  Anfragen hinterlassen nichts.
- MCP ohne Kennung: Anhängen an das zuletzt aktive MCP-Paket desselben
  Benutzers **und** Schlüssels, wenn dessen letzte Änderung höchstens 30
  Minuten her ist und es nicht älter als 24 Stunden ist; sonst neues Paket
  „KI-Änderungen über „<Schlüsselname>““.
- MCP mit Kennung: muss ein MCP-Paket dieses Benutzers sein und darf nicht
  älter als 24 Stunden sein — sonst wird der Aufruf abgelehnt, bevor etwas
  geändert ist. Der Titel steht dann fest.

**Benutzt von:** `lib/api.ts`, `lib/audit.ts`, `mcp/tools.ts`, Dienste für
Import, Zusammenführen, Importe verbinden, Orte; `app/api/import/route.ts`.

**Tests:** `tests/changelog.test.ts`, `tests/changelog.db.test.ts`.

### lib/change-time.ts
**Zweck:** Zeitpunkt einer Änderung in deutscher Zeit, fest auf
`Europe/Berlin`, damit Server und Browser dasselbe zeigen.

**Wichtige Funktionen:** `formatChangeTime(iso)`.

**Benutzt von:** `app/admin/changes/page.tsx`,
`components/ChangeEntryList.tsx`.

**Tests:** keine.

---

## Daten und Regeln

### lib/dates.ts
**Zweck:** Ungenaue Daten — Eingabe, Anzeige, Normalisieren, Vergleich.
Rein und ohne Abhängigkeiten (Browser, Dienste, MCP, Tests).

**Wichtige Funktionen/Typen:**
- Typen `FuzzyDate` (Anker, Genauigkeit, Zusatz, optional Ende), `DateEnd`,
  `DatePrecision`, `DateQualifier`, `FuzzyKey`.
- Eingabe: `parseFuzzyDate` (deutsch, ISO, GEDCOM-Kürzel; Fehler mit
  Beispielen), `parseDateOrPhrase` (Unlesbares wird Wortlaut statt Fehler —
  für Import und KI).
- Normalisieren: `toFuzzyDate`, `asFuzzyDate`, `fuzzyField` (Datumsgruppe
  eines Objekts lesen), `fuzzyColumns` (Spalten für Prisma),
  `sameFuzzyDate`, `phraseAfterUpdate`, `isPreciseDate`, `fuzzyDateProblem`.
- Anzeige: `formatFuzzyDate`, `formatDateWithPhrase`, `formatFuzzyYear`
  (Kurzform für Lebensspannen), `toDateInput` (Formularform, rundlauf-
  sicher mit `parseFuzzyDate`), `toIsoPartial` (ISO in echter Genauigkeit).
- Vergleich: `dateBounds`, `certainlyBefore`, `yearsBetween`,
  `minYearDistance`.

**Regeln und Algorithmen:**
- Anker in UTC-Mitternacht, auf die Genauigkeit gekürzt (Monatserster bzw.
  1. Januar). Fehlende/unbekannte Genauigkeit = Tag, fehlender Zusatz =
  genau (Altbestand).
- Erkannte Formen: `1850`, `03.1850`, `3/1850`, `12.03.1850`, `März 1850`,
  `12. März 1850`, `12 MAR 1850`, `1850-03`, `1850-03-12`, volle
  ISO-Zeitstempel; Zusätze `um/ca./circa/~/ABT`, `vor/BEF/<`,
  `nach/AFT/>`, `geschätzt/EST`, `errechnet/CAL`; Bereiche `zwischen … und
  …`, `BET … AND …`, `1850–1855`, `von … bis …`, `FROM … TO …`,
  `ab/seit …`, `bis …`. Nach einem Zusatz darf kein Buchstabe folgen
  („ca“ frisst nicht „CAL“). Jahr 1–9999; Tag und Monat werden geprüft;
  Ende vor Anfang wird abgelehnt.
- Ende (`to`) nur bei `BETWEEN` und `PERIOD`; `BETWEEN` braucht ein Ende,
  `PERIOD` ohne Ende heißt „ab“.
- **Wortlaut nach Änderung** (`phraseAfterUpdate`): Wer das Datum ändert,
  ohne neuen Wortlaut mitzugeben, löscht den alten; bleibt das Datum gleich,
  bleibt der Wortlaut.
- **Zeitraum einer Angabe** (`dateBounds`, halboffen): genaue Angabe = Tag,
  Monat oder Jahr; „um/geschätzt/errechnet“ zusätzlich ±2 Jahre
  (`ABOUT_TOLERANCE_YEARS`, abschaltbar); „vor“ = alles vor dem Anker;
  „nach“ = alles nach dem Zeitraum; Bereiche vom Anfang bis zum Ende des
  Endes, ohne Ende nach hinten offen; „bis“ = alles bis zum Ende des
  Zeitraums.
- Ein Widerspruch gilt nur, wenn er **für jede mögliche Lesart** besteht
  (`certainlyBefore`). `yearsBetween` liefert Minimum/Maximum (exakt nur bei
  zwei tagesgenauen Angaben).
- „vor 12.03.1850“ wird in der Jahreskurzform nicht auf ein Jahr gekürzt.

**Benutzt von:** sehr breit — Formulare (`DateInput`, `PersonForm`,
`EventSection`, `RelationshipEditor`), Bearbeitungsseiten, `audit`,
`consistency`, `duplicates`, `merge-rules`, `import-linking`,
`partner-labels`, `tree-layout`, `validation`, `map/build`,
`gedcom-import/*`, die meisten Dienste, `mcp/format.ts`, `mcp/tools.ts`.

**Tests:** `tests/dates.test.ts`; indirekt `duplicates`, `merge-rules`,
`map`, `genealogy`, `changelog`.

### lib/date-fields.ts
**Zweck:** Formular-Hilfen für Datumsfelder mit Wortlaut-Häkchen
(`components/DateInput`), außerhalb der Client-Komponente, damit auch
Server-Komponenten den Anfangszustand bauen können.

**Wichtige Funktionen:** `dateInputError` (leer erlaubt; Unlesbares nur mit
Häkchen „Wortlaut“), `dateFieldFrom` (Anfangszustand: Datumstext, sonst
Wortlaut mit gesetztem Häkchen), `datePayload` (API-Felder: leer → Datum
und Wortlaut löschen; lesbar → nur Datum, der Server behält einen
vorhandenen Wortlaut bei gleichem Datum; unlesbar mit Häkchen → nur
Wortlaut).

**Benutzt von:** `components/DateInput.tsx`, Bearbeitungsseiten für
Personen und Quellen.

**Tests:** keine eigenen.

### lib/events.ts
**Zweck:** Lebensereignisse und Namensvarianten — Arten, deutsche
Bezeichnungen, Regeln „wo steht welche Angabe“.

**Wichtige Funktionen/Typen:** `EVENT_TYPES`, `EVENT_TYPE_LABEL`,
`ALTERNATIVE_ONLY_TYPES`,
`PARTNERSHIP_EVENT_TYPES`, `POSTHUMOUS_EVENT_TYPES` (Beerdigung,
Einäscherung, Testamentseröffnung), `EventOwner`,
`eventTypeAllowed`, `eventTypesFor`, `eventIssues`, `eventTitle`,
`PERSON_NAME_TYPES`, `PERSON_NAME_TYPE_LABEL`.

**Regeln:**
- Genau ein Ort je Tatsache: Geburt/Tod in `Person`, Heirat/Scheidung in
  `Relationship` (PARTNER_OF), Beginn eines Adoptiv-/Stief-/
  Pflegeverhältnisses an PARENT_OF, Name in `Person`, weitere Namen in
  `PersonName`, alles andere als `Event`.
- `BIRTH`, `DEATH`, `MARRIAGE`, `DIVORCE` nur als abweichende Zweitangabe
  (`isAlternative`); andere Arten dürfen auch Alternative sein.
  Alternativen erscheinen nicht in Zeitleisten und Plausibilitätsprüfung.
- Partnerschaftsarten nur an PARTNER_OF; Volkszählung, Wohnort und
  `CUSTOM` an Person und Beziehung; an PARENT_OF sonst nichts.
- `CUSTOM` braucht eine Bezeichnung.
- Adoption: Ereignis `ADOPTION` an der Person; die Elternbeziehung ist
  PARENT_OF/ADOPTIVE, deren Beginn bleibt leer, wenn das Datum schon im
  Ereignis steht.

**Benutzt von:** `consistency`, `event-labels`, `exchange`,
`gedcom-import/mapping`, `validation`, Dienste für Ereignisse, Namen,
Personen, Quellen, Import, Export, Zusammenführen, Zeitleiste;
`mcp/tools.ts`; Personenseite, `EventSection`, `NameVariants`.

**Tests:** `tests/genealogy.test.ts`.

### lib/event-labels.ts
**Zweck:** Oberflächentexte zu Ereignissen: Reihenfolge der Auswahlliste
und Beschriftung des Wertfelds.

**Wichtige Funktionen:** `valueCaption` („Beruf“ statt „Wert“),
`eventTypeGroups` (häufige Arten zuerst, Rest alphabetisch unter
„Weitere“, Hauptangaben getrennt als „nur Zweitangabe“; `CUSTOM` für sich).

**Benutzt von:** `components/EventSection.tsx`.

**Tests:** keine.

### lib/validation.ts
**Zweck:** Fachregeln als reine Funktionen und Zod-Eingabeschemata für API,
Dienste und MCP.

**Wichtige Funktionen/Typen:**
- Konstanten: `MIN_YEAR` (1000), `PARENT_SUBTYPES`, `PARTNER_SUBTYPES`,
  `ALL_SUBTYPES`, `MAX_BIOLOGICAL_PARENTS` (2), `SOURCE_KINDS`,
  `CITATION_FACTS`, `CITATION_CONFIDENCES`, `PERSON_FACTS`,
  `AI_ACCESS_LEVELS`, `API_TOKEN_LEVELS`, `MAX_ACTIVE_API_TOKENS` (10),
  `API_TOKEN_DEFAULT_DAYS` (90), `API_TOKEN_MAX_DAYS` (365).
- Regeln: `subtypesFor`, `subtypeMatchesType`, `defaultSubtype`,
  `personDateIssues`, `relationshipIssues`, `relationshipFacts`,
  `eventDateIssues`.
- Schemata: `fuzzyDateInput`, `datePhraseInput`, `personInput`,
  `personPatch`, `personCreateInput`, `relationshipInput`,
  `relationshipPatch`, `userInput`, `userPatch`, `sourceInput`,
  `sourcePatch`, `citationInput`, `citationPatch`, `aiAccessInput`,
  `apiTokenCreateInput`, `eventInput`, `eventPatch`, `personNameInput`,
  `personNamePatch`.

**Regeln:**
- Jahr vor 1000 gilt als Tippfehler. „Zukunft“ bemisst sich am
  frühestmöglichen Zeitpunkt („2026“ ist im laufenden Jahr erlaubt, „nach
  2026“ nicht); Beziehungsdaten dürfen bis rund ein Jahr in der Zukunft
  liegen (geplante Hochzeit).
- Tod vor Geburt bzw. Ende vor Beginn wird nur abgelehnt, wenn es für jede
  Lesart gilt. Die Prüfung läuft auch nach dem Zusammenführen eines
  Teil-Updates mit dem gespeicherten Stand (sonst ginge es in zwei
  Schritten).
- Teil-Updates lassen Fehlendes `undefined` (= unverändert).
- Bei Beziehungen sind die verknüpften Personen nicht änderbar.
- Belege: genau eines von Person, Beziehung, Ereignis; Adressen nur
  http/https ohne Zugangsdaten (`safeHttpUrl`).

**Benutzt von:** API-Routen (Import, Quellen, Benutzer), Formulare
(`PersonForm`, `SourceForm`, `CitationSection`), Dienste, `mcp/tools.ts`,
`gedcom-import/*`, `source-labels`.

**Tests:** `tests/validation.test.ts`, `tests/genealogy.test.ts`,
`tests/ai-access*.test.ts`.

### lib/consistency.ts
**Zweck:** Plausibilitätsprüfung (Widersprüche zwischen vorhandenen
Angaben) — ergänzt die Suche nach Lücken. Rein.

**Wichtige Funktionen/Typen:** `findConsistencyIssues(persons, events,
edges)`, `ConsistencyKind`, `CONSISTENCY_KINDS`, `ConsistencyIssue`,
Grenzwerte `MIN_PARENT_AGE` (12), `MAX_FATHER_AGE` (70), `MAX_MOTHER_AGE`
(50), `MAX_LIFESPAN` (110, Prüfgrenze: darüber ist es ein Widerspruch),
`MIN_PARTNERSHIP_AGE` (14). Dazu `PRESUMED_LIFESPAN` (100): die Annahme
bei unbekanntem Lebensende — nach 100 Jahren gilt jemand als verstorben.
Genutzt von der Karte (geschätztes Lebensende), der Statistik „vermutlich
verstorben“ (`lib/services/research.ts`) und `recentWithoutDeath` im
GEDCOM-Import. Bewusst zwei Werte: eine Schätzung ist keine Prüfgrenze.

**Regeln:** Fehlt ein Datum, gibt es keine Meldung; ungenaue Daten zählen
mit ihrem ganzen Zeitraum. Arten: Tod vor Geburt (Fehler); Lebensdauer
über 110 (Fehler mit Todesdatum, sonst Warnung); Beerdigung vor Tod;
Ereignis vor Geburt (Fehler); Ereignis nach Tod (Warnung, außer
Beerdigung/Einäscherung/Testamentseröffnung); Elternteil zu jung (nur
leibliche Eltern; Fehler, wenn sicher negativ) bzw. zu alt (Warnung);
Geburt nach Tod des Elternteils (Mutter: ab Tod; Vater bzw. unbekanntes
Geschlecht: Toleranz 300 Tage); Partnerschaft zu jung bzw. nach dem Tod;
überschneidende **Ehen** (nur MARRIED/DIVORCED; Ende = Scheidung bzw. Tod
eines Partners; Scheidung ohne Datum wird nicht gemeldet). Alternativen
werden ignoriert. Sortiert nach Schwere.

**Benutzt von:** `lib/services/consistency.ts`, `app/research/page.tsx`,
`mcp/tools.ts`.

**Tests:** `tests/consistency.test.ts`, `tests/genealogy.test.ts`.

### lib/partner-labels.ts
**Zweck:** Deutsche Wortwahl rund um Partnerschaften. „Hochzeit“ und „Ehe“
nur bei MARRIED/DIVORCED; sonst neutral „Partnerschaft“.

**Wichtige Funktionen:** `PARTNER_SUBTYPE_LABEL`, `isMarriage`,
`partnershipNoun`, `PARTNER_SYMBOL`, `partnerLineStyle` (durchgezogen rosé, geschieden grau
gestrichelt, Ehestand unbekannt gepunktet), `partnerMarkerLabel`,
`shortYear` (kurze Jahresangabe, Bereiche im selben Jahrhundert verkürzt),
`since`, `partnerCardDescription`, `partnerPlaces`.

**Benutzt von:** Personen- und Quellenseite, `MarriageEdge`,
`MarriageNode`, `PersonNode`, `RelationshipEditor`,
`lib/services/changes.ts`.

**Tests:** keine.

### lib/source-labels.ts
**Zweck:** Deutsche Bezeichnungen für Quellenarten, Beleg-Fakten und
Verlässlichkeit.

**Wichtige Funktionen/Typen:** `SOURCE_KIND_LABEL`,
`DERIVED_SOURCE_KINDS` (Online-Stammbäume — keine unabhängige Quelle),
`SOURCE_KIND_HINT`, `CITATION_FACT_LABEL`, `CONFIDENCE_LABEL`.

**Benutzt von:** Quellenseiten, `CitationSection`, `SourceForm`,
`lib/services/changes.ts`, `mcp/tools.ts`.

**Tests:** keine.

### lib/source-classify.ts
**Zweck:** Quellen aus Importen einordnen (Art, Anbieter, Adresse) und
HTML in Text umwandeln. Rein, ohne fest verdrahteten Anbieter.

**Wichtige Funktionen/Typen:** `PROVIDERS` (bekannte Anbieter mit
Host- und Textmuster), `findUrls`, `detectProvider`, `plainText`,
`classifySource`, `splitCitationPage`, `safeHttpUrl`, `MAX_URL_LENGTH`
(2000), `urlHost`, `displayCitation`, `displaySourceKind`.

**Regeln:**
- Einordnung in dieser Reihenfolge: (1) was die Quelle **ist**
  (Kirchenbuch, Standesamt, Volkszählung, Grab, mündlich, Familienpapiere —
  auch wenn ein Anbieter sie bereitstellt); (2) Stammbäume anderer Nutzer →
  `ONLINE_TREE`, `derived` (Verlässlichkeit der Datei wird nicht
  übernommen); (3) Anbieter plus Sammlungs-Hinweis oder Adresse →
  `ONLINE_COLLECTION`; (4) Web-Hinweis oder eigene Adresse → `WEBSITE`;
  sonst `OTHER`.
- Fundstelle eines Belegs: eine enthaltene Adresse wird zur Beleg-URL, der
  Rest bleibt Fundstelle.
- Gespeicherte Adressen nur http/https, ohne Zugangsdaten, höchstens 2000
  Zeichen. Die App ruft sie nie ab und leitet nie darauf um — nur Link.
- Anzeige: ältere Importe werden beim Anzeigen nachträglich eingeordnet
  (`displayCitation`, `displaySourceKind`), ohne gespeicherte Daten zu
  ändern; nur Arten `OTHER`/`WEBSITE` werden umgedeutet.

**Benutzt von:** `gedcom-import/mapping`, `validation`, Dienste für Quellen
und Import, `app/api/import/route.ts`, `components/CitationLink.tsx`.

**Tests:** `tests/source-classify.test.ts`.

---

## Graph und Verwandtschaft

### lib/graph.ts
**Zweck:** Reine Graph-Algorithmen über Eltern- und Partnerkanten, ohne
Datenbank und Rechteprüfung (Dienste laden und maskieren).

**Wichtige Funktionen/Typen:** `GraphEdge`, `GraphIndex`,
`buildGraphIndex` (Eltern-, Kinder-, Partnerlisten je Person),
`ancestorsOf`/`descendantsOf` (Breitensuche bis Tiefe N mit Generation,
„über wen“, Untertyp), `shortestPath` (ungewichtete Breitensuche über
Eltern, Kinder, Partner, Tiefe ≤ 50, bei gleich langen Wegen stabil nach
Kantenreihenfolge), `wouldCreateCycle` (wäre der Elternteil schon
Nachfahre des Kindes?), `siblingsOf` (voll = alle Eltern gemeinsam und
mindestens zwei, sonst halb).

**Regeln:** Alle Durchläufe iterativ mit „besucht“-Menge — Zyklen in
fehlerhaften Daten führen nicht zu Endlosschleifen.

**Benutzt von:** `focus-tree`, `kinship`, `reference`, Dienste
`graph-data`, `persons`, `reference`, `research`.

**Tests:** `tests/graph.test.ts`, `tests/kinship.test.ts`,
`tests/reference.test.ts`.

### lib/kinship.ts
**Zweck:** Verwandtschaftsbezeichnungen auf Deutsch, aus Sicht der
Ausgangsperson („B ist der Onkel von A“).

**Wichtige Funktionen/Typen:** `bloodRelationTerm`, `ancestorDistances`,
`findBloodRelation`, `stepTerm`, `describePath`, Typen `Sex`, `Side`,
`KinshipStep`, `BloodRelation`.

**Regeln und Algorithmen:**
- **Blutsverwandtschaft** über die nächsten gemeinsamen Vorfahren; es
  zählen leibliche und Adoptiv-Elternschaften, Stief- und Pflege nicht.
  `ancestorDistances` sucht je Vorfahr den kürzesten Abstand und merkt, ob
  ein rein leiblicher Weg existiert. Bei gleicher Summe der Abstände
  (Ahnenschwund) gewinnt die nähere Linie zur Ausgangsperson.
- Begriffe aus (hinauf, hinab): Vater/Mutter, Großeltern, „Ur“-Vorsilben
  bis vier, darüber „in der n. Generation“; Kinder/Enkel entsprechend;
  Geschwister; Onkel/Großonkel; Neffe/Großneffe; Cousin n. Grades mit „eine
  Generation darüber/darunter“. Geschlechtsneutrale Formen bei
  unbekanntem Geschlecht.
- **Halb**: genau ein gemeinsamer Vorfahr, obwohl auf beiden Seiten zwei
  Elternteile bekannt sind (fehlt einer, keine Aussage).
- **Adoptiv**: keine rein leibliche Linie → „Adoptiv…“ bzw. „(über
  Adoption)“.
- **Seite** (väterlicher-/mütterlicherseits) ab Großeltern bzw. Onkel, nur
  wenn eindeutig ein Elternteil die Linie trägt.
- **Verbindungsweg** (`describePath`) für Schwägerschaft und Stief-
  verhältnisse: Schwiegersohn/-tochter, Schwager/Schwägerin,
  Stiefvater/-mutter (nur bei bestehendem Paar), Stiefgroßeltern,
  angeheiratete Verwandte, Schwiegereltern, Stiefkind/-enkel,
  Schwippschwager, „Vater/Mutter eines gemeinsamen Kindes“; geschiedene
  Ehe zählt nicht als Paar, `PARTNER_UNKNOWN` wie unverheiratet. Passt
  nichts, bleibt `term` leer und nur die Kette („Mutter → Bruder →
  Ehefrau“).

**Benutzt von:** `reference`, Dienste `kinship`, `map`, `index`.

**Tests:** `tests/kinship.test.ts`, `tests/genealogy.test.ts`,
`tests/reference.test.ts`.

### lib/origin.ts
**Zweck:** Reine Regeln der **Herkunft** (Paket „Herkunft sichtbar
machen“) ohne Datenbank, für Server und Browser: Buchstabe und Farbe je
Import, „von Hand erfasst“, Texte und Typen. Den Dienst dazu beschreibt
[dienste.md](dienste.md) unter `lib/services/origin.ts`.

**Wichtige Funktionen/Typen:** `importLetter` (A, B, C … ohne „H“, nach Z
zweistellig), `originColor`/`ORIGIN_COLORS` (Okabe-Ito ohne Schwarz, mit
passender Schriftfarbe), `MANUAL_KEY`/`MANUAL_ORIGIN` („H“, „von Hand
erfasst“), `UNKNOWN_KEY` („?“ für Vermerke ohne Quell-Baum-Kennung),
`ORIGIN_PARAM` (`herkunft`), `ORIGIN_CHIP_LIMIT`/`limitChips` (höchstens
drei Chips, dann „+n“), `originText`, Typen `OriginEntry`, `TreeOrigin`,
`OriginChipMap`; `luminance`/`contrast` für den Kontrast-Test.

**Regeln:** Farbe steht nie allein (Buchstabe und Text immer dabei); ab dem
achten Import wiederholen sich die Farben, der Buchstabe bleibt eindeutig.

**Tests:** `tests/origin.test.ts`.

### lib/reference.ts
**Zweck:** **Bezugsperson**: Verwandtschaft aller Personen zu einer Person
und Zuordnung der Vorfahren zu den vier Großeltern-Linien. Rein, auch im
Browser nutzbar.

**Wichtige Funktionen/Typen:** `LineKey` (`FF`, `FM`, `MF`, `MM`),
`LINE_KEYS`, `LINE_CODE` (Kurzzeichen VV/VM/MV/MM, damit die Linie nie nur
an der Farbe hängt), `LINE_LABEL`, Cookie-Namen `REFERENCE_COOKIE`
(`tree-bezug`) und `LINES_COOKIE` (`tree-lines`), `REFERENCE_SELF`
(`ich`), `REFERENCE_ID_PATTERN`, `RelativeInfo`, `ReferenceView`,
`edgeLine`, `bloodRelationsFrom`, `parentSlots`, `relationsFromReference`.

**Regeln und Algorithmen:**
- Statt paarweiser Aufrufe **eine** Suche von der Bezugsperson: (1)
  Vorfahren mit kürzestem Abstand; (2) von allen Vorfahren gleichzeitig
  abwärts in Eimern nach Gesamtabstand, darin nach Abstand hinauf sortiert
  — dieselbe Reihenfolge, nach der `findBloodRelation` wählt; gleich gute
  Wege werden zusammengeführt; (3) übrige Personen über die kürzeste
  Breitensuche wie `shortestPath` und `describePath`. Ergebnis gleich
  `kinshipInGraph` (geprüft für alle Paare der Mock-Daten).
- Der Graph muss bereits auf sichtbare Personen beschränkt sein — Wege über
  gesperrte Personen gibt es dann nicht.
- Vater/Mutter (`parentSlots`): je Geschlecht leiblich vor adoptiv; bei
  genau zwei Elternteilen mit einem ohne Geschlecht nimmt dieser den freien
  Platz, sonst wird nicht geraten.
- Linien: alle Vorfahren eines Großelternteils bekommen dessen Linie,
  Vater bzw. Mutter je beide Linien ihrer Seite; die Bezugsperson selbst nie.
- `edgeLine`: eine Eltern-Kind-Verbindung wird nur gefärbt, wenn Eltern-
  und Kindseite **genau eine** Linie teilen.

**Benutzt von:** Baum, Karte, `ReferencePanel`, `ReferenceChip`,
`ReferenceLines`, `ParentEdge`, `FamilyTree`, `MapExplorer`,
`map/build`, `map/year`, Dienste `reference`, `map`, `index`,
`app/api/map/route.ts`.

**Tests:** `tests/reference.test.ts`, `tests/reference.db.test.ts`,
`tests/map.test.ts`.

---

## Baumdarstellung

### lib/tree-layout.ts
**Zweck:** Gemeinsame Typen und Formatierung der Baumansichten.

**Wichtige Funktionen/Typen:** `TreePerson`, `TreeRelationship`,
`TreeData`, `LayoutNode`, `LayoutEdge` (u.a. Spur der Elternlinie,
Ansatzpunkt an Doppelkarten, Korridorpunkte), `MarriageInfo`,
`MarriageEvent`, `ParentJunction` (Treffpunkt zweier Elternteile),
`NODE_WIDTH` (180), `NODE_HEIGHT` (76), `indexTree`, `formatDate`,
`formatDateOf` (vollständige Datumsgruppe samt Ende und Wortlaut),
`displayName`, `lifeSpan` („1850 – 1912“, „* um 1850“, „† 1912“; Wortlaut
auf 24 Zeichen gekürzt).

**Benutzt von:** Personen-, Quellen- und Rechercheseiten, `FamilyTree`,
`PersonNode`, `MarriageNode`, `MarriageEdge`, `ParentEdge`, `PersonPicker`,
`DuplicateBanner`, `DuplicateList`, `RelationshipEditor`,
`layout-generations`, `focus-tree`, `lib/services/tree.ts`.

**Tests:** `tests/layout.test.ts`, `tests/focus.test.ts`,
`tests/dates.test.ts`.

### lib/layout-generations.ts
**Zweck:** Layout der Generationenansicht und des Zeitstrahls.

**Wichtige Funktionen/Typen:** `layoutGenerations(data, options)` (Knoten,
Kanten, Treffpunkte; Optionen: Paare zusammenfassen, feste Ebenen,
Zeilenabstand), `layoutTimeline(data)`, `EVENT_BOX`, `MAX_COLUMN_GAP`.
Jahre werden überall in UTC gelesen (`getUTCFullYear`) — Daten liegen als
Mitternacht UTC vor; lokal gelesen säße eine Karte westlich von Greenwich
ein Jahr zu früh.

**Regeln und Algorithmen:**
- **Ebenen:** Ausgangspunkt ist der längste Weg von einer elternlosen
  Person; wo Geburtsjahre vorliegen, schlagen sie die Ahnenzahl (rund 28
  Jahre je Generation), Personen ohne Jahr werden aus Nachbarn abgeleitet.
  Danach drei Regeln im Ausgleich bis zum Stillstand (mit Obergrenze gegen
  widersprüchliche Daten): Ehepartner gleiche Ebene, Geschwister gleiche
  Ebene, Kind mindestens eine Ebene unter jedem Elternteil. Leere Ebenen
  werden entfernt. Zyklen werden abgefangen.
- **Doppelkarten:** Ehepaare werden zu einem Kasten zusammengefasst, auch
  wenn beide eigene Eltern haben (nicht im Zeitstrahl).
- **Platzhalter** belegen in übersprungenen Ebenen einen schmalen Korridor
  für Linien über mehr als eine Generation.
- **Reihenfolge:** Baryzentrum-Verfahren, abwechselnd abwärts und aufwärts,
  bis sich die Kreuzungszahl nicht mehr verbessert.
- **Waagerecht:** Kästen zur Mitte ihrer Nachbarn ziehen, Überlappungen
  auflösen, Reihenfolge bleibt; leere Spalten über `MAX_COLUMN_GAP` werden
  zusammengezogen.
- **Treffpunkte** für Elternpaare auf getrennten Karten (eine Gabelung
  statt vier Linien).
- **Zeitstrahl:** Höhe aus dem Geburtsjahr (30 px je Jahr), waagerecht aus
  der Generationenansicht; Personen ohne Geburtsdatum in einem eigenen Band
  darunter; Hochzeiten als eigene Knoten an ihrem Datum.

**Benutzt von:** `components/FamilyTree.tsx`, `lib/focus-tree.ts`.

**Tests:** `tests/layout.test.ts`.

### lib/focus-tree.ts
**Zweck:** Fokus-Ansicht — eine Person in der Mitte, darüber N
Generationen Vorfahren, darunter N Generationen Nachkommen. Arbeitet auf
bereits maskierten Baumdaten.

**Wichtige Funktionen/Typen:** `TreeView` (`focus`, `generations`,
`timeline`), `FOCUS_COOKIE` (`tree-focus`), `FOCUS_DEPTH` (1–4, Standard 2
je Richtung), `parseDepth`, `FocusRole`, `FocusMember` (Rolle, relative
Generation, verdeckte Eltern/Kinder), `focusSubgraph`, `defaultFocusId`,
`FOCUS_ROW_GAP`, `layoutFocus`.

**Regeln:** Mitglieder: Fokus, Vorfahren (alle Elternarten), Geschwister
(nur wenn Eltern gezeigt werden), Nachkommen, Partner der Fokusperson und
der Nachkommen sowie weitere Elternteile von Nachkommen. Die erste
Zuordnung gewinnt. Bei Ahnenschwund werden Ebenen nachgeschoben, bis jede
Linie abwärts zeigt. Gesperrte Personen können nicht Fokus werden.
Startperson ohne Vorgabe: die sichtbare Person, deren Ausschnitt die
meisten Ebenen und darin die meisten sichtbaren Verwandten zeigt (stabil
bei Gleichstand). Layout mit festen Ebenen; ohne „Ehen zeigen“ fallen
Partner ohne gemeinsames Kind im Ausschnitt weg.

**Benutzt von:** `app/tree/page.tsx`, `components/FamilyTree.tsx`,
`lib/services/tree.ts`.

**Tests:** `tests/focus.test.ts`, `tests/focus.db.test.ts`.

---

## Dubletten und Zusammenführen

### lib/name-keys.ts
**Zweck:** Vergleichsformen für Namen und Orte — gemeinsam für
Dublettensuche, Zusammenführen und Importvorschläge.

**Wichtige Funktionen:** `nameKey` (klein, ohne Akzente, Umlaut → „e“-
Schreibung, ß → ss, ph → f, th → t, Doppelbuchstaben einfach, nur
Buchstaben), `firstGivenKey`, `placeCompareKey` (nur der Teil vor dem
ersten Komma), `samePlace`, `editDistance` (Levenshtein, auch von
`lib/gedcom-import/suggest.ts` genutzt).

**Achtung:** `placeCompareKey` ist **nicht** `placeKey` aus
`lib/places/normalize.ts` (vollständiger Schlüssel der Tabelle `Place`);
die Namen sind deshalb verschieden.

**Benutzt von:** `duplicates`, `import-linking`, `merge-rules`,
`lib/services/duplicates.ts`.

**Tests:** keine eigenen (indirekt über Dubletten- und
Zusammenführungstests).

### lib/duplicates.ts
**Zweck:** Erkennung möglicher Dubletten — rein, gemeinsam für die
Dublettenliste, Importvorschläge, „Importe verbinden“ und das Banner auf
der Personenseite.

**Wichtige Funktionen/Typen:** `DupPerson`, `Confidence` (`high`,
`medium`, `low`), `CONFIDENCE_LABEL` („sicher“, „wahrscheinlich“, „unklar —
bitte prüfen“), `scoreDuplicate`, `findDuplicatePairs`,
`lineageFromParents`, `lineageOf`, `blockKeys`, `relativeNameKey`.

**Regeln — Punkte (am Ende auf 0…1 begrenzt):**
- **Vorname** (Pflicht: gemeinsamer erster Vorname, auch aus
  Namensvarianten): ganz gleich +0,2; einer hat einen Vornamen mehr +0,15;
  nur der erste gleich +0,05 und höchstens „unklar“.
- **Nachname:** gleicher Nachname +0,35; Nachname der einen =
  Geburtsname/Variante der anderen +0,3; ähnliche Schreibweise +0,25;
  sonst kein Kandidat (außer beide ohne Nachnamen).
- **Geburt:** gleiches tagesgenaues Datum +0,3; vereinbar (eine Angabe
  verfeinert die andere) +0,25; Jahre höchstens 2 auseinander +0,2 (gleich)
  bzw. +0,15; weiter → kein Kandidat; nur bei einer bekannt +0,03.
- **Tod:** gleich tagesgenau +0,15; vereinbar oder ≤ 1 Jahr +0,1; sicher
  mehr als 2 Jahre auseinander −0,4 und Widerspruch.
- **Geburtsort** gleich +0,1.
- **Verwandte:** gemeinsame eingetragene Eltern +0,3; sonst Eltern gleichen
  Namens +0,1 je (höchstens 0,2); zwei vollständige, verschiedene
  Elternpaare ohne gemeinsamen Namen −0,2 und Widerspruch; derselbe Partner
  +0,3, Partner gleichen Namens +0,1; dasselbe Kind +0,2.
- **Ausschlüsse:** verschiedenes bekanntes Geschlecht; direkt verbunden
  (Eltern/Kind/Partner); eingetragene Vorfahren/Nachkommen über beliebig
  viele Generationen (alle Elternarten) — „der gleichnamige Urgroßvater ist
  nicht sein Urenkel“. Geprüft wird die Abstammung nur über die
  übergebenen (sichtbaren) Personen, damit nichts Verborgenes durchsickert.

**Klassen:**
- `high` („sicher“): gleicher ganzer Vor- und Nachname (auch über
  Geburtsname/Variante), gleiches tagesgenaues Geburtsdatum, beim Tod
  gleiches tagesgenaues Datum oder bei beiden keines — dann aber
  übereinstimmende Verwandte —, kein Widerspruch. Nur diese Klasse ist für
  das Zusammenführen in einem Rutsch vorgesehen.
- `medium` („wahrscheinlich“): ab 0,75, ohne Widerspruch, nicht nur der
  erste Vorname gleich.
- `low` („unklar“): ab der Schwelle (Standard 0,5).

**Algorithmus:** Blockbildung nach erstem Vornamen, darin nach Nachnamen
(gleich oder ähnlich; ohne Nachnamen mit allen) — kein Vergleich aller
Paare. Vorfahrenmengen werden nur für echte Kandidaten gebildet und
gemerkt. Ergebnis sortiert nach Klasse, Punkten, IDs.

**Benutzt von:** `import-linking`, Dienste `duplicates`, `import-linking`,
`merge`, `merge-bulk`, `research`, `index`; `components/DuplicateBanner.tsx`
(nur Typen/Bezeichnungen).

**Tests:** `tests/duplicates.test.ts`; Datenbank:
`tests/person-duplicates.db.test.ts`.

### lib/duplicate-verdicts.ts
**Zweck:** Urteile der KI-Vorprüfung möglicher Dubletten
(`DUPLICATE_VERDICTS`: `MERGE`, `DISPUTED`, `NOT_DUPLICATE`), ihre
Bezeichnungen in der Oberfläche (`VERDICT_LABEL`: „zusammenführen“,
„strittig“, „kein Duplikat“) und die Grenzen der Begründung (10 bis 2000
Zeichen). Rein, ohne Datenbank — auch für Client-Komponenten.

**Benutzt von:** `lib/services/duplicate-reviews.ts`,
`lib/services/duplicates.ts`, `lib/services/changes.ts`, `mcp/tools.ts`,
`components/DuplicateList.tsx`, `components/DuplicateBanner.tsx`.

**Tests:** indirekt `tests/duplicate-review.db.test.ts`.

### lib/merge-rules.ts
**Zweck:** Regeln für das Zusammenführen zweier Personen — rein, gemeinsam
für Vorschau, Zusammenführen, Sammel-Zusammenführen und Tests. Dienst:
`lib/services/merge.ts`.

**Wichtige Funktionen/Typen:** `MERGE_FIELDS`, `MERGE_FIELD_LABEL`,
`fieldColumns`, `MERGE_COLUMNS`, `fieldEmpty`, `fieldEqual`, `fieldText`,
`refinesDate`, `datesCompatible`, `compareFields`, `resolvePersonMerge`,
`PARTNER_SUBTYPE_RANK`, `moreSpecificSubtype`, `SUBTYPE_TEXT`,
`resolveRelationshipMerge`, `eventKey`, `citationKey`, `personNameKey`,
`mergeNotes`, `NOTES_SEPARATOR`.

**Regeln:**
- Je Feld wählt der Benutzer „bleibend“ oder „andere“ (Notizen auch
  „beide“). Vorgabe: gleich oder nur einseitig vorhanden → dieser Wert;
  Datum: die genauere, **vereinbare** Angabe (`refinesDate`: Zeitraum der
  genaueren liegt ganz im großzügig gelesenen Zeitraum der ungenaueren und
  ist echt kleiner); Nachname/Geburtsname: „Geburtsname als Nachname“ und
  „Ehename geb. Geburtsname“ ergeben Ehename als Nachname plus
  Geburtsname; sonst bleibende Person; Notizen: beide.
- **Nichts geht verloren:** Nicht gewählte, abweichende Geburts- bzw.
  Todesangaben werden Ereignisse BIRTH/DEATH mit `isAlternative`; nicht
  gewählte Namen werden Namensvarianten (`VARIANT` bei ähnlicher
  Schreibweise, sonst `ALIAS`; abweichender Geburtsname als `BIRTH`) —
  außer, sie stecken schon im Ergebnis oder einer vorhandenen Variante.
  Nur ein abweichendes Geschlecht lässt sich nicht ablegen und steht unter
  „verworfen“.
- **Beziehungen:** Zwei gleiche Beziehungen werden eine; genauere Art
  gewinnt (Partner: geschieden > verheiratet > unverheiratet > unbekannt;
  Eltern: Adoptiv/Stief/Pflege vor leiblich); fehlende Daten/Orte ergänzt,
  genauere vereinbare Daten übernommen; abweichende Heirat/Scheidung als
  MARRIAGE/DIVORCE-Zweitangabe, bei Eltern-Kind als Notiz.
- **Gleiche Untereinträge** (Ereignisse, Belege, Namen) werden über
  Schlüssel ohne Träger, Notizen und Reihenfolge erkannt; Notizen werden
  zusammengeführt.

**Benutzt von:** `duplicates`, `import-linking`, `lib/services/merge.ts`.

**Tests:** `tests/merge-rules.test.ts`, `tests/merge.db.test.ts`.

### lib/import-linking.ts
**Zweck:** „Importe verbinden“ — Abgleich über mehrere Importe (Gruppen =
`ImportLink.sourceTreeId`, von Hand erfasste Personen = Gruppe
`manual`). Rein. Dienst und Oberfläche: `lib/services/import-linking.ts`,
`/research/connect`.

**Wichtige Funktionen/Typen:** `LinkPerson`, `LinkPair` (Klasse, Punkte,
Gründe, Widersprüche, `viaRelative`, `bridge`, `veryLikely`),
`relaxedMatch` (gelockerte Prüfung für Verwandte; vergibt nie eine Klasse),
`LinkResult` (Paare, sichere Cluster, Teile vorher/nachher, Brücken je
Gruppenpaar, Dauer), `LinkOptions`, `linkImports`, `evidenceSentence`.

**Regeln und Algorithmen:**
1. **Anker** aus `findDuplicatePairs` über Gruppengrenzen (oder innerhalb
   einer Gruppe), ohne „kein Duplikat“-Paare. „wahrscheinlich“ bleibt nur
   mit einem Beleg über Name und ungefähres Jahr hinaus (tagesgenaue
   Geburt, Tod, Verwandte) — sonst „unklar“.
2. **Ausbreitung:** Ist ein Paar angenommen, werden Eltern×Eltern,
   Partner×Partner, Kinder×Kinder geprüft (gelockert: gleicher ganzer
   Vorname oder einer mehr, gleiches Geschlecht, vereinbare Daten; keine
   Abstammung). „sicher“ nur, wenn das tragende Paar sicher ist, der ganze
   Vorname gleich und beide ein vereinbares Geburtsdatum haben; sonst
   höchstens „wahrscheinlich“. Gleich gut passende Geschwister → „unklar“.
3. **Eindeutigkeit:** je Person und anderer Gruppe höchstens ein Partner;
   ähnlich gute Konkurrenz (Punkteabstand < 0,15) → „unklar“.
4. **Cluster:** je Gruppe höchstens ein Mitglied, alle paarweise ohne
   Widerspruch — sonst wird die schwächste Kante gelöst und neu geprüft.
5. **Brücken:** Eine einzige Verbindung zwischen zwei sonst getrennten
   Teilen ohne gestützten Verwandten wird nie „sicher“ (Herabstufung auf
   „wahrscheinlich“).
- **„sehr wahrscheinlich“** (Teilklasse von „wahrscheinlich“): zwei
  übereinstimmende Verwandte, oder tagesgenaue Geburt plus ein Verwandter;
  nie eine einzige Brücke, nie mit einseitig fehlendem Geburtsdatum; nie
  vorausgewählt.
- `evidenceSentence` macht aus den Gründen einen Satz („Gleicher Name,
  gleiches Geburtsdatum …; aus verschiedenen Importen.“).

**Benutzt von:** `lib/services/import-linking.ts`, `lib/services/duplicates.ts`
und `lib/services/merge-followups.ts` (`evidenceSentence`, `relaxedMatch`),
`components/ConnectImports.tsx`, `tests/fixtures/linking-generator.ts`.

**Tests:** `tests/import-linking.test.ts` (erzeugte Testbäume),
`tests/import-linking.db.test.ts`.

---

## Import und Export

### lib/exchange.ts
**Zweck:** Austauschformat (JSON/ZIP) für Export **und** Import in einer
Datei, damit beide Richtungen nicht auseinanderlaufen.

**Wichtige Funktionen/Typen:** `EXCHANGE_VERSION` (5), `placeSchema`, Zod-Schemata für
Medien, Personen, Beziehungen, Quellen, Belege, Ereignisse, Namen,
Fremdkennungen, Rohdaten und die ganze Datei (`exchangeSchema`), Typen
`Exchange…`, `exchangeDateColumns` (Datumsspalten aus der Datei; ältere
Dateien = tagesgenau, genau, ohne Ende), `exportDateFields` (Gegenstück),
`mediaFileName` (eindeutiger Dateiname im ZIP, Endung immer `.webp`, bei
Kollision mit ID-Endung).

**Regeln:** Versionen: 2 Genauigkeit/Zusatz, Quellen/Belege; 3 Bereiche,
Wortlaut, Namensteile, Ereignisse, Namen, Fremdkennungen, Rohdaten; 4
Bilder an Quellen, Ereignissen und Belegen; 5 Ortszuordnungen (`places`:
je Ortstext Herkunft, Koordinaten, Bezeichnung, Verzeichniskennung; der
Freitext an Personen, Beziehungen und Ereignissen bleibt). Neue Felder sind optional —
ältere Dateien bleiben importierbar. Importläufe und Herkunftsangaben
(`ImportLink`) gehören zur Instanz und werden nicht exportiert.

**Benutzt von:** `app/api/import/route.ts`,
`lib/services/exchange-export.ts`.

**Tests:** `tests/genealogy.test.ts`.

### lib/export-selection.ts
**Zweck:** Familienauswahl für den GEDCOM-Export — rein, auch im Browser.

**Wichtige Funktionen/Typen:** `ExportSelection`, `ExportFamilyOverview`
(Personenzahlen je Kombination sichtbarer Familien, ohne Personen-IDs und
ohne fremde Familien; „ohne Familie“ nur für Admins), `countSelection`,
`selectionQuery`, `selectionFileSuffix` (nur Anzahlen, keine
Familiennamen).

**Regeln:** Eine Person gehört zum Export, sobald sie in einer gewählten
Familie ist; die Sichtbarkeitsgrenze gilt zusätzlich — eine Auswahl
schränkt nur ein.

**Benutzt von:** `components/DataTransfer.tsx`,
`components/GedcomExportDialog.tsx`, Dienste `export-selection`,
`exchange-export`, `gedcom-export`.

**Tests:** `tests/gedcom-export-selection.db.test.ts`.

### lib/import-fingerprint.ts
**Zweck:** Fingerabdruck importierter Werte (`ImportLink.importHash`) — zu
erkennen, ob ein Datensatz seit dem letzten Import in der App geändert
wurde.

**Wichtige Funktionen/Typen:** `IMPORT_ENTITIES`, `FINGERPRINT_FIELDS` (je
Art genau die Spalten, die ein Import schreibt), `OPTIONAL_FINGERPRINT_FIELDS`
(später hinzugekommen: `Source.provider`, `Citation.url`),
`importFingerprint`.

**Regeln:** SHA-256 über Versionsnummer, Art und Werte in fester
Reihenfolge und kanonischer Form (Datum als ISO, fehlend = `null`).
Optionale Felder gehen nur ein, wenn gesetzt — so bleiben ältere
Fingerabdrücke gültig, und ein neuer Wert aus der Datei gilt als „in der
Datei geändert“. Ändert sich die Feldliste, gelten alle älteren Importe
als geändert (sicher: nichts wird überschrieben).

**Benutzt von:** Dienste `gedcom-import`, `gedcom-photos`, `import-apply`,
`imports`, `merge`.

**Tests:** `tests/genealogy.test.ts`, `tests/import-sources.db.test.ts`.

### lib/gedcom/ (GEDCOM-Bibliothek)
Reine TypeScript-Bibliothek ohne Datenbank und App-Abhängigkeiten: GEDCOM
5.5/5.5.1/7.0 nachsichtig lesen, Zwischenmodell, Prüfungen, Vergleich
zweier Exporte, Schreiben als 5.5.1 UTF-8. Ausführliche Entscheidungen,
Dialekt-Belege und Leistungsmessungen: `lib/gedcom/README.md`.

#### lib/gedcom/index.ts
**Zweck:** Öffentliche Schnittstelle (`@/lib/gedcom`): exportiert Typen,
`parseGedcom`, `readGedcomTree`, `writeGedcom`, Datumsfunktionen,
Beziehungsableitung, Status, Diagnosen, Vergleich, Verlustfreiheit, HTML,
ANSEL, `encodeUtf8`, `childKindFromLabel`, `detectDialect`.
**Benutzt von:** `lib/services/gedcom-import.ts`,
`lib/services/gedcom-export.ts`, `components/GedcomImport.tsx`.
**Tests:** über die Gedcom-Tests.

#### lib/gedcom/types.ts
**Zweck:** Neutrales, serialisierbares Zwischenmodell (keine `Date`, keine
Prisma-Typen): Rohknoten `GedcomNode`, `GedcomExtension` (nicht
Verstandenes mit Pfad relativ zum Element), Datum (`GedcomDate` mit Art,
Kalender, Punkten, `original`), Ort, Adresse, Privatsphäre, Notiz, Beleg,
Medien, Ereignisse (`GEDCOM_EVENT_TYPES`), Namen, Person, Familie mit
Partnerstatus und Kindern samt Art, Quelle, Archiv, Einsender, Dialekt,
Kopf, Dokument, Warnungscodes.
**Benutzt von:** allen `lib/gedcom/*`, `lib/gedcom-import/*`.
**Tests:** Gedcom-Tests.

#### lib/gedcom/encoding.ts
**Zweck:** Zeichensatz erkennen und Bytes dekodieren.
**Regeln:** BOM → UTF-16 ohne BOM (Nullbytes) → `HEAD.CHAR` → Gegenprobe
gegen die Bytes (behauptet ANSEL/ANSI, ist aber gültiges UTF-8 → UTF-8;
behauptet UTF-8, ist ungültig → Windows-1252) → Rückfall. ASCII/ANSI/IBM-
Varianten werden als Windows-1252 gelesen. `encodeUtf8` (optional BOM) für
den Writer.
**Benutzt von:** `parse`, `writer`, `index`.
**Tests:** indirekt `tests/gedcom-parser.test.ts`.

#### lib/gedcom/ansel.ts
**Zweck:** ANSEL ohne Paket: `decodeAnsel`, `encodeAnsel`. Kombinierende
Zeichen stehen in ANSEL **vor** dem Buchstaben und werden umgestellt und
NFC-normalisiert.
**Benutzt von:** `encoding`, `index`.
**Tests:** `tests/gedcom-parser.test.ts`.

#### lib/gedcom/tokenizer.ts
**Zweck:** Zeilen → Datensatzbäume als Generator (Datensatz für Datensatz,
kein Zeilen-Array). Nachsichtig mit Warnung statt Ausnahme: Zeilen ohne
Ebene, Tabs/Mehrfachleerzeichen, fehlende Trenner, überlange Zeilen,
Ebenensprünge, Zeiger mit Kommentar, CONC in 7.0, fehlender HEAD/TRLR.
**Wichtige Funktionen:** `createTokenizerState`, `readRecords`.
**Benutzt von:** `parse`.
**Tests:** indirekt Parser-Tests.

#### lib/gedcom/warnings.ts
**Zweck:** `WarningSink` — je Warnungsart höchstens `cap` Einträge mit
Zeilennummer, Rest gezählt und als Sammelmeldung ausgegeben.
**Benutzt von:** `tokenizer`, `parse`, `interpret`.
**Tests:** indirekt.

#### lib/gedcom/parse.ts
**Zweck:** Einstieg Lesen: `parseGedcom(input, options)` → Dokument,
Warnungen, unbekannte Tags, Kodierung, Statistik; optional Rohbaum und
Menge der verstandenen Knoten (für Tests). `readGedcomTree` nur
Tokenizer.
**Benutzt von:** `cli`, `lossless`, `index`, Tests und Messskript.
**Tests:** `tests/gedcom-parser.test.ts`, `tests/gedcom-interpret.test.ts`,
`tests/gedcom-writer.test.ts`, `tests/gedcom-diagnostics.test.ts`,
`tests/gedcom-performance.test.ts`.

#### lib/gedcom/interpret.ts
**Zweck:** Rohbaum → Zwischenmodell (`Interpreter`). Jeder Knoten wird
verstanden oder unverändert als Erweiterung am nächsten Element abgelegt.
**Wichtige Funktionen/Typen:** `INDIVIDUAL_EVENT_TAGS`,
`FAMILY_EVENT_TAGS`, `childKindFromLabel` (birth/adopted/foster/step auch
deutsch), `detectDialect` (MyHeritage, Ancestry, FamilySearch, Gramps,
Ahnenblatt, FTM, Legacy, RootsMagic, PAF, webtrees, Heredis, Family
Historian, Stammbaum), `emptyPrivacy`.
**Regeln:** Privatsphäre (RESN, `_PRIV`/`_LIVING`, Platzhalternamen) wird
nur markiert. Eltern-Kind-Art aus PEDI, ADOP und `_FREL`/`_MREL`.
**Benutzt von:** `parse`, `writer`, `index`.
**Tests:** `tests/gedcom-interpret.test.ts`.

#### lib/gedcom/status.ts
**Zweck:** Familienstand eines Paares: `MARRIED` (MARR), `DIVORCED`
(DIV/ANUL), `UNMARRIED` nur bei ausdrücklicher Angabe (`NO MARR`,
`_STAT`, `_MSTAT`, `_UST`, `TYPE`, MARR.TYPE „not married“ u.ä.), sonst
`UNKNOWN`. ENGA/MARB/MARC/MARL/MARS allein ändern nichts.
**Wichtige Funktionen:** `FAMILY_STATUS_TAGS`, `partnerStatusFromLabel`,
`isNonMaritalMarriageEvent`, `computeFamilyStatus`.
**Benutzt von:** `interpret`, `relationships`, `index`.
**Tests:** indirekt `tests/gedcom-interpret.test.ts`.

#### lib/gedcom/relationships.ts
**Zweck:** Familien ↔ App-Beziehungen. `deriveRelationships` (Familien →
Partnerschaften mit Beginn/Ende/Ereignissen und Eltern-Kind je Elternteil
mit Art), `familiesFromRelationships` (Export: die App kennt keine
Familien), `assignRoles` (Mann → HUSB, Frau → WIFE, sonst nach
Reihenfolge), `UNMARRIED_MARKER` (`_STAT Unmarried`).
**Benutzt von:** `diagnostics`, `writer`, `index`,
`gedcom-import/mapping`, Dienste `gedcom-import`, `index`.
**Tests:** `tests/gedcom-interpret.test.ts`, `tests/gedcom-writer.test.ts`.

#### lib/gedcom/dates.ts
**Zweck:** GEDCOM-Datumsgrammatik eigenständig (ohne `lib/dates.ts`):
`parseGedcomDate` (exakt, teilweise, ABT/CAL/EST, BEF/AFT, BET…AND,
FROM…TO, INT, Phrase, Doppeljahre, v. Chr., Kalender; julianisch immer,
französisch-republikanisch bei vollem Datum umgerechnet, hebräisch
unverändert; nachsichtig auch deutsche Formen), `formatGedcomDate`
(englische Monatskürzel, 5 oder 7), `sameDate`, `toAppDate` (vereinfachte
App-Form mit nur vier Zusätzen und `lossy`), `fromAppDate`.
**Hinweis:** Der App-Import nutzt nicht `toAppDate`, sondern die
vollständige Umsetzung in `lib/gedcom-import/dates.ts`; `toAppDate` dient
nur noch den Diagnosen. `fromAppDate` wird außerhalb der Bibliothek nicht
verwendet.
**Benutzt von:** `diagnostics`, `interpret`, `writer`, `index`.
**Tests:** `tests/gedcom-dates.test.ts`.

#### lib/gedcom/html.ts
**Zweck:** HTML-Fragmente in Notizen sicher in Text umwandeln (nichts wird
ausgeführt): `looksLikeHtml`, `decodeEntities`, `htmlToText`,
`noteContent` (Original bleibt erhalten). Die Texte stammen aus Importen
und Eingaben, deshalb läuft die Umwandlung in **einem** Durchlauf über die
Zeichenkette (Suche nach `<`/`>` und schließenden Tags) statt über
verschachtelte reguläre Ausdrücke — die liefen bei vielen offenen Tags
quadratisch bis kubisch und konnten den Server minutenlang blockieren
(ReDoS). Auch `looksLikeHtml` prüft in zwei linearen Schritten.
**Benutzt von:** `interpret`, `index`, `lib/source-classify.ts`.
**Tests:** `tests/gedcom-interpret.test.ts`, `tests/gedcom-html.test.ts`
(Verhalten und Laufzeit bei bösartigen Eingaben).

#### lib/gedcom/diagnostics.ts
**Zweck:** Strukturprüfungen für die Importvorschau, ändern nichts;
Meldungen deutsch, nur mit Kennungen statt Namen.
**Wichtige Funktionen/Typen:** `diagnoseGedcom`, `dateRange`,
`DiagnosticCode` (fehlender Datensatz, eigener Vorfahr, Kind vor Elternteil
bzw. nach dessen Tod geboren, Tod vor Geburt, leere Familie, zu viele
leibliche Eltern, Selbstbezug, doppelte UID, Person ohne Namen,
Privatsphäre markiert), Schwere `error`/`warning`/`info`.
**Benutzt von:** `cli`, `index`, Messskript.
**Tests:** `tests/gedcom-diagnostics.test.ts`,
`tests/gedcom-performance.test.ts`.

#### lib/gedcom/diff.ts
**Zweck:** Zwei Dokumente auf Datensatzebene vergleichen. Zuordnung über
den stabilsten Schlüssel `_UID`/`UID` → `RIN` → Xref (`identityKey`);
Verweise werden vorher übersetzt (Umnummerierung ist keine Änderung);
Änderungsstempel (CHAN, `_UPD`) zählen getrennt („nur Stempel“).
**Wichtige Funktionen:** `diffDocuments`, `identityKey`.
**Benutzt von:** `cli`, `index`.
**Tests:** `tests/gedcom-diagnostics.test.ts`.

#### lib/gedcom/lossless.ts
**Zweck:** Nachweis der Verlustfreiheit (`verifyLossless`): jeder Knoten
verstanden oder erhalten, Zeilenbilanz (Zeilen = Knoten + CONC/CONT +
Leerzeilen + reparierte + verworfene) geht auf.
**Benutzt von:** `cli`, `index`.
**Tests:** `tests/gedcom-parser.test.ts`, `tests/gedcom-writer.test.ts`,
`tests/gedcom-performance.test.ts`.

#### lib/gedcom/writer.ts
**Zweck:** Zwischenmodell → GEDCOM 5.5.1 (UTF-8, optional BOM).
**Regeln:** Kopf mit dieser App als Quelle, Pflicht-SUBM, Zeilen höchstens
255 Bytes mit CONC/CONT an Code-Point-Grenzen und nie an einem Leerzeichen
(`splitForConc`), `@` als `@@` (`escapeValue`), Daten aus der Struktur,
Kennungen höchstens 20 Zeichen, Zeilenende Standard CRLF. Nicht
Verstandenes (`extensions`) wird an derselben Stelle zurückgeschrieben;
`UNKNOWN` ohne MARR, `UNMARRIED` als `_STAT`; Eltern-Kind-Art als PEDI,
bei unterschiedlicher Art je Elternteil zusätzlich `_FREL`/`_MREL`.
**Wichtige Funktionen:** `writeGedcom`, `escapeValue`, `splitForConc`.
**Benutzt von:** `cli`, `index` (darüber `lib/services/gedcom-export.ts`).
**Tests:** `tests/gedcom-writer.test.ts`, `tests/gedcom-performance.test.ts`.

#### lib/gedcom/cli.ts
**Zweck:** Prüfprogramm `npm run gedcom:check -- <datei> [--show-names]
[--json] [--compare <älter>]`. Gibt standardmäßig nur Zählungen,
Tag-Pfade und Kennungen aus — keine Namen, Daten, Orte, Texte.
**Wichtige Funktionen:** `checkGedcom`, `formatReport`.
**Tests:** `tests/gedcom-diagnostics.test.ts`,
`tests/gedcom-export-selection.db.test.ts`.

### lib/gedcom-import/ (GEDCOM → App)

#### lib/gedcom-import/dates.ts
**Zweck:** GEDCOM-Datum → Datumsform des Massenimports (`BulkDateValue`).
**Wichtige Funktionen:** `convertGedcomDate`, `convertEventDate`,
`convertLifeDates`, `bulkToFuzzy`.
**Regeln:** Alle App-Zusätze werden genutzt (um, vor, nach, geschätzt,
errechnet, zwischen, von–bis, ab, bis). Was die Struktur nicht vollständig
sagt (anderer Kalender, Doppeljahr, INT-Erläuterung, reine Phrase,
ungültig, v. Chr.), behält den Originaltext als Wortlaut. Was die App
ablehnen würde (Jahr vor 1000, Zukunft, Ende vor Anfang, Tod vor Geburt),
wird nur als Wortlaut übernommen (`rejected`) — sonst fiele die ganze
Person heraus. Bei Geburt und Tod gemeinsam wird zuerst die Geburt, dann
der Tod herabgestuft, bis die Regeln aus `lib/validation.ts` erfüllt sind.
**Benutzt von:** `gedcom-import/mapping`.
**Tests:** `tests/gedcom-mapping.test.ts`.

#### lib/gedcom-import/mapping.ts
**Zweck:** Zwischenmodell → Eingabe für `applyGenealogyImport`
(`lib/services/import-apply.ts`). Rein; Abgleich mit dem Bestand, Vorschau
und Schreiben macht `lib/services/gedcom-import.ts`.
**Wichtige Funktionen/Typen:** `mapGedcomDocument` (liefert Personen,
Namen, Beziehungen, Ereignisse, Quellen, Belege, Fremdkennungen, Rohdaten,
Personen-/Quellen-Metadaten, Fotos, Hinweise, Eigentümer), `resolveNames`,
`pickMain`, `pickPrimaryName`, `sourceKind`, `personKey`, `pairKey`,
`parentKey`, `eventKeys`, `recentWithoutDeath`, `indexOriginalPerson`,
`indexOriginalFamily`, `UNKNOWN_GIVEN_NAME` („N.N.“), `RAW_TYPES`,
`RAW_FORMAT`, `jsonClean`, `originalPlaceText`.
**Regeln:**
- Ortstexte: Steht unter einem PLAC eine NOTE „Originaltext: …“ (so schreibt
  der eigene GEDCOM-Export zugeordnete Orte, `lib/services/place-export.ts`),
  gilt dieser Text statt des PLAC — die Rundreise Export → Import lässt den
  Freitext unverändert, nichts wird als geändert gemeldet.
- Schlüssel (`externalKey`): Person `UID:` → `RIN:` → `XREF:`; Paar
  `PAIR:a|b`; Eltern-Kind `PARENT:a>b`; Ereignis eigene `_UID`, sonst
  `<Träger>/<Art>#<n>`; Belege `…/SOUR#n`.
- Hauptangabe je Art: bevorzugte (`_PRIM Y`), sonst die erste; weitere
  Geburts-/Todes-/Heiratsangaben werden Zweitangaben.
- Namen: `familyName` = heutiger Name (`_MARNM` bzw. NAME TYPE married),
  `birthName` nur bei Abweichung.
- Art passt nicht zum Träger → frei benanntes Ereignis (Hinweis
  `EVENT_TYPE_ADJUSTED`); dasselbe Paar in zweiter Familie → Ereignisse an
  derselben Partnerschaft; Ende vor Beginn → Ende nur als Wortlaut.
- Belege an Online-Stammbäumen übernehmen keine Verlässlichkeit; doppelte
  Belege am selben Träger einmal; allgemeine Belege mit EVEN werden dem
  Fakt zugeordnet.
- Lokale Medienpfade werden nie gelesen (nur Rohdaten, Hinweis), URL-Fotos
  als `PhotoRef`.
- `indexOriginal…` erschließt für den Export den Originaldatensatz nach
  denselben Schlüsseln.
**Hinweis:** Welche Ereignisart an Person bzw. Partnerschaft passt, prüft
`eventTypeAllowed` aus `lib/events.ts` (dieselbe Regel wie in der App);
Quellenarten ohne unabhängigen Beweiswert kommen aus
`DERIVED_SOURCE_KINDS` (`lib/source-labels.ts`).
**Benutzt von:** Dienste `gedcom-import`, `gedcom-export`,
`gedcom-photos`.
**Tests:** `tests/gedcom-mapping.test.ts`, `tests/gedcom-import.db.test.ts`.

#### lib/gedcom-import/suggest.ts
**Zweck:** Vorschläge, welche Person der Datei eine schon in der App
erfasste sein könnte. Nur Vorschläge, nie automatisch zusammengeführt.
**Wichtige Funktionen:** `scorePair`, `suggestMatches`
(Schwelle 0,6, höchstens 3 je Person, gruppiert nach erstem Vornamen).
**Regeln (Punkte):** gleiches Geschlecht (wenn bekannt) und gleicher erster
Vorname Pflicht; Nachname/Geburtsname gleich +0,4, Abstand 1 +0,3, sonst
kein Kandidat; Vorname ganz gleich +0,2, sonst +0,1; Geburtsjahr gleich
+0,3, höchstens 2 Jahre +0,2, weiter → kein Kandidat, einseitig +0,05;
Geburtsort +0,1; gemeinsame Elternnamen +0,15 je (höchstens 2).
**Hinweis:** Eigenes, einfacheres Punkteschema — nicht `lib/duplicates.ts`.
Den Abstand rechnet `editDistance` aus `lib/name-keys.ts`; die
Vergleichsform (`suggestKey`, intern) bleibt bewusst eigen: `nameKey`
faltet Umlaute zu „ue“, ph/th und Doppelbuchstaben — ein Umstieg würde die
Vorschläge ändern (z.B. „Müller“ = „Muller“ nur hier).
**Benutzt von:** `lib/services/gedcom-import.ts`.
**Tests:** `tests/gedcom-mapping.test.ts`.

---

## Medien

### lib/storage.ts
**Zweck:** Ablage der Bilddateien im Dateisystem unter `MEDIA_DIR` (zur
Laufzeit gelesen, Standard `data/media`). Ausgeliefert nur über die App.

**Wichtige Funktionen/Typen:** `MEDIA_SUBDIRS` (`originals`, `thumbs` —
die einzigen Schreibordner), `mediaDir`, `resolveKey`,
`InvalidStorageKeyError`, `renameWithRetry`, `putObject`, `openObject`
(Stream mit Größe/ETag vom geöffneten Handle), `getObjectBuffer`,
`deleteObject` (fehlende Datei ist kein Fehler), `checkMediaDir`,
`MediaDirError`.

**Regeln:** Schlüssel nur als relative, „/“-getrennte normale Segmente
(kein absoluter Pfad, kein „..“, kein Backslash, kein Laufwerk, kein NUL,
höchstens 512 Zeichen), aufgelöster Pfad wird nochmals gegen den Ordner
geprüft. Schreiben atomar (temporäre Datei + rename); unter Windows wird
ein kurzzeitig scheiterndes rename begrenzt wiederholt. `checkMediaDir`
prüft Wurzel **und** jeden Schreibordner per Probedatei (nach einer
Wiederherstellung als root kann nur ein Unterordner unbeschreibbar sein).

**Benutzt von:** `media-processing`, Dienste für Medien, Import, Export,
GEDCOM-Fotos, Importe verbinden; Routen Export, Health, Medien.

**Tests:** `tests/storage.test.ts`, `tests/import-linking.db.test.ts`.

### lib/media-processing.ts
**Zweck:** Bild prüfen und als WebP ablegen — gleiche Verarbeitung für
Upload, Import und Mock-Daten.

**Wichtige Funktionen/Typen:** `ALLOWED_IMAGE_FORMATS` (jpeg, png, webp,
gif, avif, tiff), `detectImageFormat` (anhand der Bytes über sharp, nicht
anhand einer Angabe), `IMAGE_MIME_FORMAT`, `processAndStoreImage`,
`ImageFormatError`, `StoredImage`.

**Regeln:** Original höchstens 2000 px (WebP Qualität 88), Vorschau
320 px quadratisch beschnitten (Qualität 75). EXIF-Ausrichtung wird vor dem
Entfernen der Metadaten angewendet; das Entfernen der übrigen EXIF-Daten
(u.a. GPS) ist beabsichtigt.

**Benutzt von:** `app/api/import/route.ts`, Dienste `gedcom-photos`,
`media-links`; `prisma/seed-mock.ts` (dynamischer Import).

**Tests:** keine direkten.

### lib/media-scope.ts
**Zweck:** Rechte an einem Bild aus dem, woran es hängt.

**Wichtige Funktionen/Typen:** `sourceRights`, `eventRights`,
`citationRights`, `mediaOwners` (alle Zuordnungen mit Rechten),
`canViewMedia`, `canDeleteMedia`, `canUploadForPerson`,
`canUploadForRelationship`.

**Regeln:** Person → über ihre Familien; Beziehung → sichtbar, sobald eine
Seite sichtbar ist, änderbar nach `canEditRelationshipBetween`;
Ereignis/Beleg → wie der Träger; Quelle (Hauptscan oder `SourceMedia`) →
sichtbar für Admin, Ersteller und jeden, der einen ihrer Belege sieht,
änderbar entsprechend. Verwaiste Bilder nur für Admins (sonst wäre ein
Upload ohne Zuordnung ein Weg an der Rechteprüfung vorbei). Ganz löschen:
an Ereignissen/Belegen/Quellen muss **jede** Zuordnung änderbar sein, an
Personen/Beziehungen genügt eine. Für den Scan einer Quelle gilt zusätzlich
deren Löschregel (`sourceRights(...).deletable`, wie „Quelle löschen“): der
Benutzer muss **jeden** Beleg der Quelle ändern dürfen — ein eigener Beleg
an einer gemeinsam genutzten Quelle genügt zum Bearbeiten, nicht zum
endgültigen Löschen ihrer Scans. `unlinkMedia` wendet `canDeleteMedia` an,
sobald das Lösen ein Bild endgültig entfernen würde.

**Benutzt von:** Medienrouten, Dienste `exchange-export`, `media-links`,
`sources`.

**Tests:** `tests/media-links.db.test.ts`, `tests/sicherheit.db.test.ts`.

### lib/safe-fetch.ts
**Zweck:** Bilder von Adressen aus einer hochgeladenen Datei (bzw. über
MCP) serverseitig holen, ohne **SSRF** ins eigene Netz.

**Wichtige Funktionen/Typen:** `safeFetch(url, options)`,
`isPublicAddress`, `SafeFetchError` (Codes URL, PROTOCOL, PORT,
CREDENTIALS, DNS, BLOCKED_ADDRESS, REDIRECT_LIMIT, STATUS, CONTENT_TYPE,
TOO_LARGE, TIMEOUT, NETWORK), `defaultResolver`, `httpsTransport`,
`withConcurrency` (begrenzt parallele Aufgaben, Reihenfolge bleibt).

**Regeln (SSRF-Schutz):**
- Nur `https`, nur Port 443, keine Zugangsdaten in der Adresse.
- Der Name wird **einmal** aufgelöst, **alle** Adressen müssen öffentlich
  sein: gesperrt sind u.a. 0/8, 10/8, 100.64/10 (CGNAT), 127/8,
  169.254/16 (inkl. Cloud-Metadaten), 172.16/12, 192.168/16,
  Dokumentations- und Benchmark-Netze, Multicast, reserviert; IPv6 `::`,
  `::1`, ULA, link-/site-local, Multicast, Dokumentation, Discard, Teredo;
  auf IPv4 abgebildete, NAT64- und 6to4-Adressen werden auf die
  eingebettete IPv4 geprüft.
- Die Verbindung geht genau an die geprüfte Adresse (eigener `lookup`), die
  Gegenstelle des Sockets wird nachgeprüft — DNS-Rebinding greift nicht;
  TLS prüft weiter das Zertifikat des Namens.
- Weiterleitungen manuell, höchstens 3, jede neu geprüft.
- Inhaltsart nur `image/` oder `application/octet-stream`; Größe (Standard
  15 MB, beim Lesen gezählt) und Gesamtzeit (Standard 20 s) begrenzt.
- Die eigentliche Bildprüfung macht danach sharp (`media-processing`).

**Benutzt von:** Dienste `gedcom-import`, `gedcom-photos`, `media-links`;
`mcp/tools.ts`.

**Tests:** `tests/safe-fetch.test.ts`, `tests/media-links.test.ts`,
`tests/media-links.db.test.ts`.

---

## Karte und Orte

### lib/map/build.ts
**Zweck:** Daten der Karte „Wurzeln nach Jahr“ aus Personen, Ortsangaben
und Koordinaten — einmal je Ausgangsperson auf dem Server gerechnet.

**Wichtige Funktionen/Typen:** `buildMapData`, `factYear` (geschätztes
Lebensende mit `PRESUMED_LIFESPAN` aus `lib/consistency.ts`), `LINE_BIT`, `linesFromBits`, `MapPlace`, `MapPerson` (kurze
Schlüssel: Name, Lebensdaten, Beginn, Ende, geschätzt, Linien-Bits,
Stationen als Jahr/Ortsindex-Paare), `MapPayload`, `MapPersonInput`,
`MapFactInput`, `CoordsLookup`.

**Regeln (Lebend-Regel der Karte):**
- **Jahr einer Angabe:** Jahr des Ankers; „zwischen 1850 und 1854“ zählt
  mit der Mitte, ein Zeitraum mit seinem Beginn; um/vor/nach mit dem Jahr.
- **Lebend im Jahr J:** Beginn ≤ J ≤ Ende. Beginn = Geburtsjahr, sonst das
  früheste datierte Ereignis bzw. Todesjahr. Ende = Todesjahr, sonst
  frühestes Beerdigungs-/Einäscherungsjahr, sonst geschätzt: Beginn + 100
  Jahre, mindestens das letzte datierte Ereignis, höchstens das laufende
  Jahr (`est`). Personen ganz ohne Datum zählen nur als „ohne Lebensdaten“.
- **Ort im Jahr J:** zuletzt bekannter Ort bis einschließlich J — Geburt
  (ohne Datum ab Beginn), datierte Ereignisse/Heirat/Scheidung mit Ort
  (auf Beginn…Ende geklemmt), Tod. Im selben Jahr zählt die letzte Angabe
  (Rang: Geburt < Ereignis < Tod). Ein Ortstext ohne Koordinaten ist
  Ortsindex −1 („Ort nicht auf der Karte“) und verdrängt einen früheren
  Ort. Undatierte Angaben (außer Geburtsort) zählen nicht; Alternativen
  filtert der Dienst.
- **Startjahr:** Jahr mit den meisten Personen an einem Ort der Karte
  (Differenzfeld über alle Stationen).

**Benutzt von:** `lib/services/map.ts`, `lib/map/year.ts`,
`components/MapExplorer.tsx`.

**Tests:** `tests/map.test.ts`, `tests/map.db.test.ts`.

### lib/map/year.ts
**Zweck:** Ein Jahr der Karte im Browser rechnen — ohne Neuladen, ein
Durchgang über alle Personen mit binärer Suche in den Stationen.

**Wichtige Funktionen/Typen:** `placeInYear` (Ortsindex, −1, `null` ohne
Ort, `undefined` lebt nicht), `snapshot` (Gruppen je Ort mit Personen,
Anteilen je Linie für das Tortendiagramm — eine Person in zwei Linien zählt
je halb — und Personen je Linie; Zähler lebend, ohne Ort, Ort nicht auf der
Karte), `PlaceGroup`, `YearSnapshot`.

**Benutzt von:** `components/MapExplorer.tsx`.

**Tests:** `tests/map.test.ts`.

### lib/map/projection.ts
**Zweck:** Mercator-Projektion wie in `scripts/build-geodata.mjs`
(Ländergrenzen `public/geo/countries.json`), Welt 1000 Einheiten breit,
Breite auf ±84° begrenzt.

**Wichtige Funktionen/Typen:** `project`, `WORLD`, `MAX_LAT`, `ViewBox`,
`VIEWS` (Europa, Welt), `fitViewBox` (auf Seitenverhältnis bringen ohne
abzuschneiden), `zoomAt` (Zoom um einen Punkt mit Grenzen).

**Benutzt von:** `components/MapExplorer.tsx`.

**Tests:** `tests/map.test.ts`.

### lib/places/normalize.ts
**Zweck:** Ortstexte normalisieren und zerlegen; rein, auch im Browser.

**Wichtige Funktionen/Typen:** `placeKey` (Schlüssel der Tabelle `Place`:
nur NFC, Kleinschreibung, Leerzeichen und Kommaabstände vereinheitlicht —
zusammengesetzte Namen bleiben verschieden, das entscheidet ein Mensch),
`normalizeForLookup` (Vergleich mit dem Ortsverzeichnis ohne Diakritika
und Satzzeichen; muss mit `norm` in `scripts/build-geodata.mjs`
übereinstimmen), `splitPlaceText`, `PlacePart`.

**Regeln (Ortszerlegung):** Teilung an Komma/Semikolon vom spezifischen zum
allgemeinen Teil. Je Teil Suchformen: Verwaltungsvorsätze („Lk“,
„Kreis“, „Amt“, „County“ …) entfernt, reine Beschreibungen („Kreisstadt“,
„unbekannt“) verworfen, Varianten von „Sankt/St./Saint“, Postleitzahl vorn
entfernt, Klammerzusatz erst mit, dann ohne; als Rückfall der erste Teil
vor „/“ und beide Hälften eines Bindestrich-Namens (hintere zuerst).
Teile mit Ziffern gelten als Anschrift (werden nicht als Ort gesucht).

**Benutzt von:** `map/build`, `places/gazetteer`, `places/match`,
`lib/services/places.ts`, `prisma/seed-mock.ts`.

**Tests:** `tests/places.test.ts`, `tests/map.test.ts`,
`tests/map.db.test.ts`.

### lib/places/gazetteer.ts
**Zweck:** Mitgeliefertes Ortsverzeichnis (`geo/gazetteer.tsv.gz`, aus
GeoNames CC BY 4.0 und Natural Earth) als Datenstruktur und Suche — kein
Dienst im Netz, Ortsnamen verlassen den Server nie.

**Wichtige Funktionen/Typen:** `GeoKind` (Ort, Region erster Ebene,
historische Landschaft, Land), `GeoEntry` (mit `de` — deutscher bzw.
früherer Name — und `alt`, den weiteren Namen für die Ortsseite), `Gazetteer` (Einträge, Namen →
Einträge inkl. weiterer Namen, Regionen, Länder, sortierte Liste für
Präfixsuche), `parseGazetteer`, `entryLabel` und `labelForText`
(Anzeigename, siehe unten), `searchGazetteer` (Präfixsuche; genaue Treffer
zuerst, dann Länder/Regionen, dann Einwohnerzahl), `distanceKm` (Großkreis),
`nameKindOf` und `NameKind` (welcher Name eines Eintrags in einem Teil des
Ortstexts steht: `official` — heutiger Name, auch in bloßer Umschrift wie
„Wroclaw“/„Timişoara“ —, `historic` — der deutsche bzw. frühere Name aus dem
Verzeichnis, „Breslau“ — oder `alternate`, ein weiterer Name; für den
Vorschlag am Eingabefeld und `suggest_place`).

**Regel Anzeigename** (Entscheidung des Eigentümers, 22.11.): heutiger
offizieller Name in der Landessprache vorn, in Klammern der alte Name — der
Name aus dem Ortstext der Daten, sonst der deutsche bzw. historische Name aus
dem Verzeichnis —, nur wenn er sich vom heutigen unterscheidet; danach Region
und Land: „Wrocław (Breslau), Polen“, „Timișoara (Temeswar), Rumänien“. Orte in
Deutschland, Österreich und der Schweiz bekommen nie eine Klammer, sondern
Bundesland bzw. Kanton (Schweiz: deutscher Name als Hauptname). Bloße
Umschriften („Wroclaw“, „Muenchen“) gelten nicht als alter Name. Von Hand
bestätigte Zuordnungen behalten ihre gespeicherte Bezeichnung; automatische
bekommen die neue Form beim nächsten „Automatisch zuordnen“.

**Benutzt von:** `places/gazetteer-file`, `places/match`,
`lib/services/places.ts`.

**Tests:** `tests/places.test.ts`.

### lib/places/gazetteer-file.ts
**Zweck:** Ortsverzeichnis von der Platte laden (nur Server). Erst beim
ersten Bedarf (rund 1–2 s, gut 100 MB Speicher), nach 10 Minuten ohne
Benutzung wieder freigegeben; paralleles Laden wird zusammengefasst. Die
Datei ist in `next.config.mjs` für den Standalone-Build eingetragen.

**Wichtige Funktionen:** `getGazetteer`, `loadGazetteerSync`,
`GAZETTEER_FILE`.

Gebraucht wird es jetzt auch außerhalb der Admin-Seite: Vorschlag am
Eingabefeld (`/api/places/suggest`, das erste Ortsfeld einer Seite lädt es
vorab), automatische Zuordnung nach dem Speichern und nach Importen, MCP
(`suggest_place`, `assign_place`). Gemessen (Mock, Entwicklungsrechner):
Laden rund 0,9 s, danach ein Vorschlag unter 2 ms.

**Benutzt von:** `lib/services/places.ts`, `prisma/seed-mock.ts`.

**Tests:** `tests/places.test.ts`.

### lib/places/match.ts
**Zweck:** Automatische Zuordnung eines Ortstexts zu einem Eintrag des
Ortsverzeichnisses.

**Wichtige Funktionen/Typen:** `matchPlace`, `PlaceMatch` (Eintrag,
Genauigkeit, Anzeigename, getroffener Teil, Zahl mehrdeutiger
Kandidaten, `others` — die übrigen Kandidaten desselben Teils in
Rangfolge, höchstens `MAX_OTHERS` = 9, für „A, B oder C“ in
`suggest_place`), `ANCHOR_KM` (50), `AMBIGUOUS_KM` (25), `HISTORIC_KM` (300).

**Regeln:**
1. Letzter Teil ein Land → Länderhinweis; heutige Länder schränken ein,
   historische („Preußen“, „Österreich-Ungarn“ …) und Land zusammen mit
   historischer Landschaft geben nur Vorzug. Nur ein Teil, der ein Land
   ist: eine große gleichnamige Stadt (ab 50 000 Einwohnern) geht vor.
2. Teile, die eine Region nennen, sind Regionshinweis (Ort muss darin
   liegen); ein Regionsname hinter dem ersten Teil, der auch eine größere
   Stadt ist (ab 10 000), gilt als Ort. Historische Landschaften vor
   gleichnamiger Verwaltungseinheit; Kandidaten in deren Nähe (300 km)
   bevorzugt.
3. Von vorn nach hinten wird jeder Teil als Ort gesucht; nennt ein
   späterer Teil ebenfalls einen Ort, muss der Kandidat höchstens 50 km
   davon entfernt sein (Anker).
4. Kein Ort: Region (Genauigkeit „Region“), sonst Land, sonst keine
   Zuordnung.
- Rangfolge gleichnamiger Kandidaten: im Hinweisland, dann Heimatvorzug
  (Deutschland > Österreich/Schweiz > Europa) und Größe zusammen.
  „Mehrdeutig“ zählt entfernte (> 25 km) Kandidaten, die mindestens ein
  Zehntel so groß sind.

**Benutzt von:** `lib/services/places.ts`, `prisma/seed-mock.ts`.

**Tests:** `tests/places.test.ts`.

---

## Anwender-Hilfe

Hilfe für Anwender unter `/hilfe`; Texte in `docs/anwender/NN-thema.md`
(Pflege: `docs/anwender/README.md`).

### lib/help/markdown.ts
**Zweck:** Schlanker, eigener Markdown-Leser für genau das Subset der
Hilfetexte — bewusst keine Bibliothek (keine neue Abhängigkeit, kein
HTML-Durchreichen, das sich mit einem Sanitizer absichern müsste).

**Verhalten:** `parseHelpMarkdown` liefert Titel (erste `#`-Überschrift),
Kurzbeschreibung (erster Absatz als Klartext) und einen Syntaxbaum aus
Blöcken (Überschriften `#`–`####` mit Anker, Absätze, Listen einer Ebene
mit eingerückten Folgezeilen, `>`-Hinweiskästen, Tabellen, Codeblöcke,
Trennlinien) und Inline-Knoten (fett, kursiv, Code, Link, Text). **Kein
rohes HTML:** Es bleibt Text. `resolveHref` lässt als Link nur zu:
andere Themen als `NN-thema.md#anker` (→ `/hilfe/thema#anker`, funktioniert
so auch auf GitHub), eigene Pfade `/…` (nicht `//`, kein Backslash),
`#anker` und `https://`; alles andere (javascript:, data:, http:, mailto:)
wird Text. `slugify` bildet Anker aus Überschriften (Umlaute ausgeschrieben,
doppelte mit `-2`). `headingIds` und `collectLinks` dienen den Tests.

### lib/help/content.ts
**Zweck:** Themen aus `docs/anwender/` lesen (`HELP_DIR` relativ zu
`process.cwd()`): nur Dateien `NN-thema.md`, sortiert nach Name; Nummer =
Reihenfolge, Rest = Adresse. `listHelpTopics`, `getHelpTopic` (optional mit
anderem Ordner für Tests). Im Betrieb einmal gelesen und behalten, in der
Entwicklung bei jedem Aufruf. Ins Standalone-Image kommen die Dateien über
`outputFileTracingIncludes` in `next.config.mjs`.

### lib/help/links.ts
**Zweck:** Ziele der Kontexthilfe (`HELP_LINKS`: Karte, Orte zuordnen,
Linien, Bezugsperson, Dubletten, Dubletten-Klassen, KI-Vorprüfung der
Dubletten, KI-Zugang, Einstellungen) an einer
Stelle, damit der Test prüfen kann, dass Thema und Anker existieren.

**Benutzt von:** `components/HelpLink.tsx`, `components/DuplicateBanner.tsx`.

**Tests:** `tests/help.test.ts` (Leser, Sicherheit der Links und gegen
rohes HTML, alle Querverweise und Kontexthilfe-Ziele gegen die echten
Dateien).

---

## Einstellungen

### lib/settings/registry.ts
**Zweck:** Zentrales Verzeichnis der Einstellungen, die Administratoren auf
`/admin/settings` pflegen. Ein neuer Schlüssel braucht nur einen Eintrag in
`SETTINGS` — keine Migration (die Tabelle `AppSetting` speichert Schlüssel →
Text) und keine Änderung an Seite oder API, die Auswahl, Beschriftung,
Erklärung und Prüfung von hier nehmen. Rein (keine Datenbank, kein
`next/*`), auch im Browser nutzbar.

**Wichtige Funktionen/Typen:**
- `SETTINGS` — je Eintrag `key` (feste Kennung, so gespeichert; nie
  umbenennen), `label`, `description`, `kind` (Art des Werts, heute nur
  `httpUrl`), optional `envVar` (Umgebungsvariable als Rückfall) und
  `placeholder` (erfundenes Beispiel). Erster Eintrag: `mcpConnectorUrl`
  („Adresse des KI-Connectors“, Rückfall `MCP_CONNECTOR_URL`).
- `SettingKey`, `SettingDefinition`, `settingDefinition(key)` (unbekannt →
  `null`), `isSettingKey`.
- `checkSettingValue(def, raw)` — Prüfung nach Art: Text, getrimmt, nicht
  leer, höchstens `MAX_SETTING_LENGTH` (2000) Zeichen; `httpUrl`: nur
  `http:`/`https:`, kein Benutzername/Passwort in der Adresse, Ergebnis in
  der von `URL` vereinheitlichten Form. Liefert den Wert oder eine deutsche
  Fehlermeldung.
- `settingFromEnv(def, env)` — Wert der Umgebungsvariablen nach derselben
  Prüfung; leer oder ungültig → `null`.

**Regeln:** **Nur Werte, die keine Geheimnisse sind.** Die Seite zeigt jeden
Wert im Klartext, das Protokoll hält vorher → nachher fest; Zugangsdaten,
Schlüssel, Passwörter bleiben Umgebungsvariablen (im Code-Kommentar
festgehalten, `tests/settings.test.ts` wacht über verdächtige Namen). Eine
neue Art (`kind`) braucht einen Zweig in `checkSettingValue` und ggf. ein
passendes Eingabefeld in `components/SettingsAdmin.tsx`.

**Benutzt von:** `lib/services/settings.ts`.

**Tests:** `tests/settings.test.ts`.

---

## Sonstiges

### lib/plural.ts
**Zweck:** `plural(n, eins, mehrere)` — Zahl mit passender Einzahl/Mehrzahl
(„1 Eintrag“, „3 Einträge“). Ersetzt frühere Kopien in mehreren Dateien.

**Benutzt von:** `GedcomImport`, `ImportHistory`, `PersonNode`,
`lib/services/merge.ts`, `lib/services/changes.ts`.

### lib/build-info.ts
**Zweck:** Version des laufenden Builds für die Fußzeile.

**Wichtige Funktionen/Typen:** `buildInfo` (liest
`NEXT_PUBLIC_BUILD_DATE`/`NEXT_PUBLIC_BUILD_SHA`, die beim Docker-Build
fest eingesetzt werden; ungültige Werte werden verworfen, SHA auf 7
Zeichen gekürzt), `buildLabel` („Build lokal“ ohne Datum; angemeldet mit
Commit, sonst nur Datum — der genaue Stand geht Fremde nichts an).
Die Schreibweise `process.env.NEXT_PUBLIC_…` muss so bleiben, sonst
ersetzt Next.js sie nicht.

**Benutzt von:** `app/layout.tsx`.

**Tests:** `tests/build-info.test.ts`.

### lib/release-notes.ts
**Zweck:** Neuigkeiten — der Versions-Changelog für Anwender aus
`CHANGELOG.md` (`docs/entwicklung/neuigkeiten.md`). Nicht zu verwechseln mit der
Änderungsgeschichte der Daten (`change-sets`, `/admin/changes`). Rein, ohne
Datei- und Datenbankzugriff (auch im Browser, in `prisma/seed-mock.ts` und
in den E2E-Tests benutzt).

**Format der Datei:** je Release eine Überschrift `## JJJJ-MM-TT.N — Kurztitel`
(Gedankenstrich, Halbgeviertstrich oder Bindestrich), darunter Stichpunkte
`- …` bzw. `* …`; eingerückte Folgezeilen setzen den Stichpunkt fort.
Alles vor der ersten Überschrift und HTML-Kommentare werden übergangen.
Kennung = Tag des Ausrollens plus laufende Nummer am Tag, bewusst keine
Commit-Kennung (die Git-Historie kann sich ändern).

**Wichtige Funktionen/Typen:**
- `Release` (`id`, `date`, `seq`, `title`, `items`).
- `parseReleaseNotes(text)` → `{ releases, errors }`: Fehler mit Zeilennummer
  (falsche Überschrift, Freitext statt Stichpunkt, Release ohne Stichpunkte,
  doppelte Kennung, falsche Reihenfolge). Fehlerhafte Releases fallen weg,
  der Rest wird absteigend sortiert — die App bricht an einer kaputten Datei
  nie ab; der Test der echten Datei verlangt eine leere Fehlerliste.
- `parseReleaseId`, `compareReleaseIds` (Datum, dann Nummer numerisch:
  `.10` nach `.9`).
- `releasesSince(releases, lastSeenId, limit = WHATS_NEW_LIMIT (3))` →
  `{ show, more }`: leer/unlesbar → nur das neueste; sonst alle neueren als
  die gesehene Kennung (auch wenn es diese nicht mehr gibt — eingeordnet nach
  Datum), höchstens `limit`, Rest als Zahl `more`; nichts Neues → leer.
- `formatReleaseDate` („22. November 2026“).

**Benutzt von:** `app/layout.tsx`, `lib/release-notes-data.ts`,
`lib/services/release-notes.ts` (Typ), `components/ReleaseNoteList.tsx`,
`prisma/seed-mock.ts`, E2E-Tests.

**Tests:** `tests/release-notes.test.ts` (Parser, Auswahl, echte Datei: fehlerfrei,
keine Commit-Kennungen und Technikbegriffe).

### lib/release-notes-data.ts
**Zweck:** Der Inhalt von `CHANGELOG.md` für Seiten und Route-Handler.
Die Datei wird per `import … from "../CHANGELOG.md?raw"` **zur Build-Zeit**
als Text eingebaut (Webpack-Regel `resourceQuery: /raw/` → `asset/source`
in `next.config.mjs`; Vitest/Vite kann `?raw` von sich aus; Typ in
`types/raw.d.ts`). Das Standalone-Image braucht die Datei deshalb zur
Laufzeit nicht; im Docker-Build muss sie im Kontext liegen
(`!CHANGELOG.md` in `.dockerignore`).

**Wichtige Funktionen:** `releaseNotes()` (einmal gelesen, zwischengespeichert;
Fehler der Datei als Warnung ins Server-Log), `latestReleaseId()`.

**Grenze:** Nicht aus `lib/services` importieren — die Dienste laufen auch in
einfachen Node-Prozessen (MCP über stdio, Skripte), die `?raw` nicht kennen.

**Benutzt von:** `app/layout.tsx`, `app/neuigkeiten/page.tsx`,
`app/api/me/release-seen/route.ts`, `app/api/users/route.ts` (Einladung).
