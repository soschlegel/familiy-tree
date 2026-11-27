# Seiten und API-Routen (`app/`)

Alles unter `app/` (Next.js 15, App Router): die Seiten der Weboberfläche
und die Route-Handler unter `app/api`. Die Fachlogik liegt nicht hier,
sondern in der Dienstschicht (`lib/services`); Seiten und Routen laden den
Benutzer, bilden den `Scope` (Familienrechte) und rufen die Dienste auf.
Der MCP-Endpunkt `/api/mcp` ist in [mcp.md](mcp.md) beschrieben.

## Grundregeln für alle Seiten und Routen

**Anmeldung.** Die Middleware (`middleware.ts`) prüft keine Anmeldung —
sie setzt nur die Content-Security-Policy der Seiten (siehe unten);
geprüft wird in jeder Seite bzw. Route selbst (`lib/session.ts`,
`lib/api.ts`). Die Sitzung ist
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
- Vor Anmeldung und Handler prüft `route()` außerdem (Reihenfolge):
  schreibende Anfrage von fremder Herkunft → **403** (noch vor der
  Anmeldeprüfung, `lib/request-guard.ts`); nach der Anmeldung zu großer
  Körper laut `Content-Length` → **413**, Körper ohne Längenangabe → **411**;
  Anfragegrenze je Benutzer überschritten → **429** mit `Retry-After`
  (`lib/rate-limit.ts`). Jede Antwort bekommt `Cache-Control: private,
  no-store` (außer die Route setzt selbst etwas, z.B. Bilder) und
  `X-Content-Type-Options: nosniff`.

**Content-Security-Policy.** Jede Seite bekommt aus `middleware.ts` eine
Richtlinie mit neuer Nonce (`lib/csp.ts`); Next.js hängt die Nonce selbst an
seine Skripte. Folgen für Seiten und Komponenten: keine eigenen
Inline-Skripte, keine `on…`-Attribute als Text, kein `eval`; Bilder,
Schriften und `fetch` nur von der eigenen Adresse (externe Kacheln, CDNs
oder `data:`-Bilder bräuchten eine Änderung der Richtlinie). `style`-Attribute
sind erlaubt. Alle Antworten unter `/api` tragen die feste `API_POLICY`
(`next.config.mjs`). Begründung je Direktive und Not-Schalter `CSP_MODE`:
[docs/sicherheit.md](../sicherheit.md#content-security-policy).

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

**Ladezustände.** Nur `/research` hat eine `loading.tsx` (gemeinsame
Komponente `PageLoading`). Bewusst nur auf Seiten ohne `notFound()` und
ohne Umleitung mit Status: Eine Ladeanzeige streamt die Antwort, danach
ließe sich kein 404 oder 308 mehr setzen. `/tree` zeigt dieselbe
Ladeanzeige über ein `Suspense` in der Seite selbst — erst nach der Prüfung
auf eine alte Kennung.

Alle Seiten außer `/login`, `/login/email` und der Weiterleitung `/` sind
`force-dynamic` (kein Zwischenspeichern). Seitentitel nach dem Muster
„Titel · Stammbaum“.

## Übersicht: Seiten

| Adresse | Zweck | Rechte |
|---|---|---|
| `/` | Startseite „Heute in der Familie“: Jahrestage, Geburtstage, Einstieg | angemeldet |
| `/login` | Anmeldung (GitHub, Google, E-Mail-Link, Dev-Login) | öffentlich; angemeldet → `/` |
| `/login/email` | Bestätigung eines E-Mail-Links („Jetzt anmelden“) | öffentlich; angemeldet → `/` |
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
| `/statistics` | Statistik: Diagramme über den sichtbaren Teil des Stammbaums | angemeldet |
| `/records` | Rekorde: Bestwerte des sichtbaren Stammbaums mit Namen | angemeldet |
| `/progress` | Forschungs-Fortschritt: Vollständigkeit der Vorfahren je Generation und Linie, Vorschläge zum Weitersuchen | angemeldet; Ausgangsperson muss sichtbar sein |
| `/kinship` | „Wie sind wir verwandt?“: Verwandtschaft zweier Personen in Worten und als Zeichnung | angemeldet; gewählte Personen müssen sichtbar sein |
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
| `/admin/settings` | Einstellungen der Installation (Schlüssel → Wert) | `setting:manage` (Admin) |
| `/admin/history` | Zeitgeschichte: eigene Ereignisse, mitgelieferte aus-/einblenden | `history:manage` (Admin) |
| `/neuigkeiten` | Neuigkeiten: alle Releases aus `CHANGELOG.md` | angemeldet |
| `/hilfe` | Anwender-Hilfe: Themenliste | angemeldet |
| `/hilfe/[thema]` | Ein Hilfethema aus `docs/anwender/` | angemeldet; unbekanntes Thema 404 |

## Übersicht: API-Routen

„angemeldet“ heißt: `route(null, …)`, die inhaltliche Prüfung macht der
Dienst über den `Scope`.

| Methode und Pfad | Zweck | Rechte |
|---|---|---|
| `GET, POST /api/auth/[...nextauth]` | Auth.js (Anmeldung, Rückruf, Abmeldung); E-Mail-Link nur über Anmeldeseite und Bestätigung | öffentlich |
| `GET /api/health` | Lebenszeichen | öffentlich |
| `POST /api/mcp` (übrige Methoden 405) | MCP-Endpunkt für KI-Assistenten | eigener Schlüssel, siehe [mcp.md](mcp.md) |
| `GET /api/tree` | Ganzer Graph mit Platzhaltern | angemeldet |
| `GET /api/map` | Kartendaten | angemeldet |
| `GET, POST /api/persons` | Personen suchen / anlegen | angemeldet (Anlegen: Dienst) |
| `GET, PATCH, DELETE /api/persons/[id]` | Person lesen / ändern / löschen; alte Kennung: `GET` 308 auf die bleibende Person, `PATCH`/`DELETE` 409 mit `mergedInto` — beides nur, wenn die bleibende Person sichtbar ist, sonst 404 | Dienst |
| `GET /api/persons/[id]/duplicates` | Mögliche Dubletten einer Person für den Dialog „Zusammenführen …“ (alle Klassen, Begründungssatz) | Bearbeiter beider Einträge (Dienst), sonst leer |
| `GET /api/persons/[id]/changes` | Änderungsverlauf einer Person | Bearbeiter der Person (Dienst) |
| `GET /api/persons/[id]/roots` | „Wurzeln“: Anteile der Länder/Regionen der Vorfahren | Person sichtbar (Dienst), sonst 404 |
| `GET, POST /api/persons/[id]/events` | Ereignisse einer Person | Dienst |
| `PUT /api/persons/[id]/families` | Familienzuordnung setzen | Dienst |
| `GET, POST /api/persons/[id]/names` | Weitere Namen | Dienst |
| `POST /api/persons/merge/preview` | Vorschau Zusammenführen | Dienst |
| `POST /api/persons/merge` | Zusammenführen; mit `parentsFirst` erst die doppelt erfassten Eltern, dann das Paar | Dienst |
| `GET /api/persons/merge/followups?ids=…` | Folgedubletten der bleibenden Person(en) | Dienst (nur bearbeitbare Paare) |
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
| `PUT /api/me/release-seen` | Neuigkeiten: Release als gesehen merken | angemeldet (nur sich selbst) |
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
| `GET, PATCH /api/import/sources` | Importe mit Buchstabe/Farbe/Name / Import benennen | `data:import` (Dienst: nur Admin) |
| `GET /api/origin/overview` | Herkunft: Personen je Import, Verbindungspersonen je Paar | angemeldet; Dienst: Bearbeiter oder Admin, sonst 403 |
| `GET, POST /api/connect` | Importe verbinden: Auswahl / Lauf starten | `data:import` |
| `GET, POST /api/connect/[id]` | Lauf: Stand / Entscheiden, Vorschau, Ausführen | `data:import` |
| `GET, PUT /api/places` | Ortstexte / von Hand zuordnen | `place:manage` |
| `POST /api/places/auto` | Automatisch zuordnen | `place:manage` |
| `GET /api/places/search` | Suche im Ortsverzeichnis | `place:manage` |
| `GET /api/places/suggest` | Vorschlag am Ortsfeld | angemeldet, Admin oder Bearbeiter |
| `POST /api/places/choose` | Ort im Ortsfeld auswählen | wer den Eintrag bearbeiten darf |
| `GET, POST /api/settings` | Einstellungen mit Zustand / Eintrag anlegen | `setting:manage` |
| `PATCH, DELETE /api/settings/[key]` | Wert ändern / entfernen (Rückfall auf die Umgebung) | `setting:manage` |
| `GET, POST /api/history-events` | Zeitgeschichte: Zustand der Verwaltung / eigenes Ereignis anlegen | `history:manage` |
| `PATCH, DELETE /api/history-events/[id]` | Eigenes Ereignis ändern / löschen | `history:manage` |
| `PATCH /api/history-events/builtin/[id]` | Mitgelieferten Eintrag aus- bzw. einblenden | `history:manage` |
| `POST /api/history-events/confirm` | Einträge der KI bestätigen (einzeln oder alle sichtbaren) | `history:manage` |

---

## Seiten im Einzelnen

### Rahmen: `app/layout.tsx`

- Lädt die Sitzung. Für angemeldete Benutzer: Navigationsleiste
  (`NavBar`, `MainContainer` aus `components/NavBar.tsx`) mit Baum, Karte,
  Personen, Recherche, Statistik, Quellen, Daten; im Untermenü „Verwaltung“:
  KI-Zugang (nur bei KI-Recht oder noch nicht widerrufenen Schlüsseln —
  dafür eine kleine Abfrage am Benutzer), Familien, Benutzer, Änderungen,
  Einstellungen (je nach globalem Recht) und für alle zuletzt „Hilfe“ (`/hilfe`) — damit
  hat jeder Angemeldete das Untermenü. Dazu Benutzername mit Rolle und
  Abmelde-Knopf (Server-Aktion `signOut`, danach `/login`).
- Ohne Anmeldung keine Navigation.
- Sprungmarke „Zum Inhalt springen“, Schriften (Fraunces, Source Sans 3
  über `next/font`), Farbe der Browserleiste je Farbschema, Fußzeile mit
  Build-Angabe (`buildInfo`/`buildLabel` aus `lib/build-info.ts`; ohne
  Anmeldung nur das Datum) und — nur angemeldet — den Links „Neuigkeiten“
  (`/neuigkeiten`) und „Hilfe“ (`FooterHelpLink` aus
  `components/HelpLink.tsx`; einzeilig, die Fußzeile hat eine feste Höhe).
- **Neuigkeiten:** Die Benutzerabfrage liest auch `lastSeenReleaseId`;
  `releasesSince` (`lib/release-notes.ts`) wählt aus `releaseNotes()` die
  Releases seit dem zuletzt gesehenen. Gibt es welche, rendert das Layout
  `WhatsNewDialog` („Was ist neu?“) mit höchstens drei Releases, der Zahl der
  übrigen und der neuesten Kennung. Ohne Anmeldung nie; auf `/login`
  unterdrückt es die Komponente selbst.

### Fehler und „nicht gefunden“

- `app/error.tsx` (Client-Komponente): unerwarteter Fehler beim Aufbau
  einer Seite. Freundlicher Hinweis, Fehlerkennung (`digest`) falls
  vorhanden, Knöpfe „Erneut versuchen“ und „Zum Stammbaum“. Die Details
  gehen in die Konsole bzw. das Server-Log.
- `app/not-found.tsx`: „Seite nicht gefunden“ — bewusst ohne
  Unterscheidung zwischen „gibt es nicht“ und „darfst du nicht sehen“.
  Links zur Personenliste und zum Stammbaum.

### `/` — `app/page.tsx`

Startseite **„Heute in der Familie“** — Ziel nach der Anmeldung und des
Logos in der Kopfzeile (`components/NavBar.tsx`). Früher leitete `/` nur
nach `/tree` weiter; der Baum ist jetzt einen Klick entfernt (Menüpunkt
„Baum“, Kachel „Stammbaum“). Einen eigenen Menüpunkt „Start“ gibt es
bewusst nicht (die Kopfzeile ist voll; das Logo genügt).

- **Rechte:** angemeldet (`requireScope`, sonst `/login`). Inhalt nur über
  sichtbare Personen (`getToday`, `lib/services/today.ts`); ohne Familie
  (kein Admin, keine Familie im Scope) statt der Listen der Hinweis „Noch
  keine Familie freigegeben“ — ohne Zahlen.
- **Parameter:** `datum=JJJJ-MM-TT` wählt einen anderen Tag (`parseIsoDay`;
  ungültig → heute). Ohne Parameter gilt der heutige Tag nach
  Europe/Berlin (`calendarDayIn`).
- **Anzeige:** Kopf mit Datum (`formatLongDay`), Überschrift („Heute in der
  Familie“ bzw. „Der 14. März in der Familie“) und Kontexthilfe
  (`HelpLink` → `/hilfe/startseite#wie-wird-gezaehlt`). Karte **Heute** mit
  „‹ Vortag“, „Heute“ (nur an anderen Tagen), „Folgetag ›“ (der heutige Tag
  immer als `/`) und der Liste der Jahrestage (`AnniversaryList` aus
  `components/TodayList.tsx`, höchstens zehn, der Rest hinter „Weitere …
  anzeigen“); leer: freundlicher Hinweis und der nächste Jahrestag mit
  „Diesen Tag ansehen“. Karte **Demnächst** (30 Tage) mit „Geburtstage“ und
  „Runde Jahrestage“. Daneben (Telefon: darunter) **Einstieg** mit sechs
  Kacheln: Stammbaum, Karte, Personen, Statistik, Rekorde,
  Forschungs-Fortschritt (`start-progress`).
- **Daten:** `getToday` (`lib/services/today.ts`), Regeln in `lib/today.ts`.
- **Tests:** `e2e/read/today.spec.ts`; `tests/today.test.ts`,
  `tests/today.db.test.ts`.

### `/login` — `app/login/page.tsx`

- Öffentlich. Wer schon angemeldet ist, wird nach `/` (Startseite) geleitet.
- Zeigt je nach Konfiguration „Mit GitHub anmelden“ (`AUTH_GITHUB_ID`),
  „Mit Google anmelden“ (`AUTH_GOOGLE_ID`) und den Dev-Login mit
  Feld „Dev-Login: E-Mail-Adresse“ ohne Passwort (`ENABLE_DEV_LOGIN=true`,
  nur lokal); ohne jedes Verfahren eine Warnung.
- **E-Mail-Link** (nur wenn `emailLoginMode()` ihn erlaubt, siehe
  `lib/email-login.ts`): unter den OAuth-Knöpfen „oder ohne Konto“, Feld
  „E-Mail-Adresse“ (`#link-email`) und Knopf „Link zusenden“. Die
  Server-Aktion `requestLoginLink` (`app/login/actions.ts`) ruft
  `requestEmailLink` (nur Eingeladene bekommen Mail, Drosselung,
  Mindestdauer) und leitet **immer** auf `/login?link=gesendet` — dort die
  neutrale Bestätigung „Wenn diese Adresse freigeschaltet ist, kommt gleich
  eine E-Mail …“ (`role="status"`). Den Link fordert sie über `signIn(…,
  { redirect: false })` direkt bei Auth.js an, nicht über die HTTP-Route.
- Anmeldung über Server-Aktionen; Ziel nach Erfolg `/` (Startseite). Lehnt Auth.js
  ab (E-Mail nicht eingeladen oder gesperrt), geht es zurück nach
  `/login?error=<Typ>` mit dem Hinweis, die Adresse sei nicht
  freigeschaltet. Bei `error=Verification` (E-Mail-Link abgelaufen,
  benutzt oder ersetzt) stattdessen „Dieser Anmeldelink gilt nicht mehr …“
  mit dem Link „Neuen Link anfordern“ zum Feld.
- Suchparameter: `error`, `link`.

### `/login/email` — `app/login/email/page.tsx`

- Öffentlich; angemeldet → `/`. Ziel des Links aus der Anmelde-Mail
  (`?token=…&email=…`, aufgebaut von `confirmationUrl`).
- Löst beim Aufruf **nichts** ein (Mail-Vorschauen und Virenscanner rufen
  Links vorab ab). Zeigt die Adresse und ein Formular mit „Jetzt anmelden“,
  das per POST an `/api/auth/callback/nodemailer?token=…&email=…&callbackUrl=/`
  schickt (`callbackActionPath`); Auth.js prüft und löscht das Token, setzt
  die Sitzung und leitet nach `/` (Startseite) — oder bei ungültigem Link nach
  `/login?error=Verification`.
- Unplausible Angaben (`plausibleLinkParams`) oder E-Mail-Anmeldung aus:
  Hinweis als `alert` und Link „Neuen Link anfordern“ (bzw. „Zur Anmeldung“).

### `/tree` — `app/tree/page.tsx`

Der Stammbaum in vier Ansichten (Fokus, Generationen, Zeitstrahl, Ringe). Bedienung: [fokus-ansicht.md](../fachlich/fokus-ansicht.md) und
[bezugsperson.md](../fachlich/bezugsperson.md).

- **Aufbau:** Die äußere Seite prüft nur, ob `focus` die alte Kennung
  einer aufgegangenen Person ist — dann 308 auf dieselbe Adresse mit der
  bleibenden Person (`resolvePersonRedirect`; ein Schlüsselzugriff, die
  Anmeldung wird nur bei einem Treffer geladen; nur bei sichtbarer
  Zielperson, sonst bleibt es bei „Person nicht gefunden“). Danach zeigt sie
  sofort `PageLoading`, während `TreeContent` den Baum lädt.
- **Rechte:** angemeldet. Ohne freigegebene Familie (und nicht Admin)
  wird nichts geladen; Hinweis „Noch keine Familie freigegeben“.
- **Suchparameter:**
  - `view` — `generations` oder `timeline` für den ganzen Baum, `rings`
    für die Ringe (`AncestorRings`); sonst Fokus-Ansicht.
  - `focus` — Person im Mittelpunkt (nur Zeichen `[A-Za-z0-9_-]`, höchstens
    64). Im ganzen Baum zentriert die Ansicht darauf.
  - `up`, `down` — Tiefe der Fokus-Ansicht (`parseDepth`, Grenzen und
    Standard aus `FOCUS_DEPTH` in `lib/focus-tree.ts`).
  - `bezug` — vorübergehende Bezugsperson; `bezug=ich` zurück zur eigenen.
  - `herkunft=1` — Schalter „Herkunft“ (Chips je Import an den Karten).
    Wirkt nur für Bearbeiter und Administratoren (`canSeeOrigin`); für
    Betrachter gibt es weder Schalter noch Daten.
  - `vollbild=1` — Baumfläche bildschirmfüllend (für alle Rollen). Nur im
    Browser ausgewertet (`useTreeFullscreen`); der Server lädt dafür nichts
    anders.
  - `richtung=nachfahren`, `generationen` (3–7, Standard 5, bei den
    Nachfahren 4) und `farbe=wurzeln` — nur Ringe (`parseRingsDirection`,
    `parseRingsGeneration`, `ringsDefaultGeneration`, `parseRingsColoring`
    in `lib/ancestor-rings.ts`). Ohne `richtung` die Vorfahren wie bisher.
    Die Färbung schaltet der Browser um; der Server liefert beides.
  - `denied` — Hinweis nach einer Umleitung wegen fehlender Rechte.
- **Cookies:** `tree-focus` (zuletzt fokussierte Person), `tree-bezug`
  (Bezugsperson), `tree-lines` (Großeltern-Linien an/aus), `zeitgeschichte`
  (`0` = Zeitgeschichte aus; gilt auch für Karte und Lebenslauf).
- **Daten:** `loadGraph` (ein Graph für Baum und Bezugsperson),
  `resolveReference` (Vorrang Adresse vor Cookie vor eigener Person; nur
  sichtbare Personen), `listFamilies`. Fokus-Ansicht: `loadFocusTree` mit
  Mittelpunkt aus `focus`, sonst `bezug`, sonst Cookie, sonst
  Bezugsperson; eine angefragte, aber unbekannte oder gesperrte Person
  ergibt den Hinweis „Person nicht gefunden“ (gemerkte Personen dürfen
  fehlen, dann Ersatzperson). Ringe: weder `loadGraph` noch `listFamilies`
  noch `referenceView` — `loadAncestorRings` lädt nur die Vorfahren der
  Mitte generationsweise, mit `richtung=nachfahren` stattdessen
  `loadDescendantRings` nur die Nachkommen; Mitte in derselben Reihenfolge
  wie die Fokus-Ansicht, zuletzt `defaultRingsRootId` bzw.
  `defaultDescendantRingsRootId` (gemeinsam mit der Druckansicht in
  `loadRingsView`, `lib/services/rings-view.ts`); eine angefragte, aber fehlende oder
  gesperrte Person ergibt „Person nicht gefunden“ (Link „Ringe öffnen“, in
  derselben Richtung). Ganzer Baum: `loadTree` und `listHistoryEvents`
  (Zeitgeschichte für den Zeitstrahl — auch in „Generationen“ geladen, weil
  der Wechsel zum Zeitstrahl ohne Neuladen geschieht). Verwandtschaftsgrade
  und Linien über `referenceView` — in der Fokus-Ansicht nur für die
  Personen im Ausschnitt. Nur mit `herkunft=1` (und Recht):
  `loadTreeOrigin`, ebenfalls auf den Ausschnitt begrenzt; sonst wird keine
  Herkunft geladen.
- **Anzeige:** Überschrift mit Zählung („n Personen (m weitere nicht
  freigegeben) · k Beziehungen“), `ReferenceChip` („Sicht von: …“),
  „Person anlegen“ (nur mit Bearbeitungsrecht), `FamilyTree` mit Ansicht,
  Daten, Familienauswahl, Bezugsperson und Linienstatus. Leerer Bestand →
  Hinweiskarte. Ringe: ohne Zählzeile, statt `FamilyTree` `AncestorRings`
  mit Daten und Färbung.
- Die Seite füllt genau die Bildschirmhöhe zwischen Kopf- und Fußzeile.

### `/tree/print` — `app/tree/print/page.tsx`

„Ahnentafel zum Drucken“: die Ringe als Blatt bzw. Poster
(`RingsPrintSheet`, Regeln in `lib/rings-print.ts`). Erreichbar über den
Knopf „Drucken“ der Ringe-Ansicht.

- **Rechte:** angemeldet (`requireScope`). Daten über dieselben Dienste und
  dieselbe Wahl der Mitte wie die Ringe (`loadRingsView`): angefragte
  Person (muss sichtbar sein), sonst gemerkte Person (`tree-focus`), sonst
  Bezugsperson, sonst Startperson. Gesperrte Vorfahren bzw. Nachkommen nur
  als „nicht freigegeben“ ohne Angaben; eine angefragte gesperrte oder
  unbekannte Person ergibt „Person nicht gefunden“ (`print-missing`), ohne
  freigegebene Familie „Nichts zu drucken“. Mehr als die Ringe-Ansicht ist
  über diese Seite nicht zu sehen.
- **Suchparameter:** wie die Ringe `focus`, `richtung`, `generationen`,
  `farbe`; dazu `format` (`a4`…`a0`, Standard A4), `ausrichtung`
  (`hoch`/`quer`, Standard hoch), `titel` (frei, höchstens 80 Zeichen),
  `datum=0` (ohne Untertitel und Datum), `namen=0` (äußere Ringe ohne
  Namen). Alte Kennung einer aufgegangenen Person in `focus`: 308 auf die
  bleibende (`resolvePersonRedirect`).
- **Anzeige:** ohne Kopf- und Fußzeile der App (`NavBar`/`MainContainer`
  erkennen den Pfad, `app/globals.css` blendet die Fußzeile aus). Papier
  und Ausrichtung setzt die Seite per `@page` in einem Inline-`<style>` —
  ohne Skript, mit der vorhandenen CSP verträglich. Im Druck erscheint nur
  das Blatt, genau eine Seite im gewählten Format.
- **SVG-Download:** im Browser (Blob, `<a download>`), keine eigene
  Route.

### `/map` — `app/map/page.tsx`

Karte „Wurzeln nach Jahr“ ([karte-und-orte.md](../fachlich/karte-und-orte.md)).

- **Rechte:** angemeldet; gezählt werden nur sichtbare Personen.
- **Suchparameter:** `person` (Ausgangsperson; ändert die Bezugsperson des
  Baums nicht), `mode` = `vorfahren` (Standard), `alle` oder `lebensweg`,
  `jahr` (Startjahr; sonst das Jahr mit den meisten Personen), beim
  Lebensweg `art` = `person` (Standard), `vaterlinie` oder `mutterlinie`.
- **Daten:** `loadMapView` (aus `lib/services/map.ts`) mit Person, Cookie
  der Bezugsperson und Modus; beim Lebensweg stattdessen nur
  `loadLifePathView` (`lib/services/life-path.ts`) — die Kartendaten der
  anderen Betriebsarten werden dann nicht geladen. Außer beim Lebensweg
  zusätzlich `listHistoryEvents` (Zeitgeschichte) und das Cookie
  `zeitgeschichte`.
- **Anzeige:** Ausgangsperson mit Link („ich“ bzw. „Bezugsperson“),
  `MapPersonChooser`, Umschalter Vorfahren/alle/Lebensweg (`ModeSwitch`,
  auf beiden Ansichten), `MapExplorer` (Karte, Zeitstrahl-Regler mit
  Abspielen, Liste „Wer lebte …?“, Zeile „In diesem Jahr“, Zeile
  „Zeitgeschichte <Jahr>“ mit Marken am Zeitstrahl; Linien nur mit
  Ausgangsperson). Ohne Ausgangsperson im Modus Vorfahren ein Hinweis statt
  Karte. Für Administratoren ein Hinweis auf Ortstexte ohne Koordinaten mit
  Link nach `/admin/places`. Aufklappbare Zählregeln (auch Alter und „In
  diesem Jahr“), Quellenangabe der Geodaten, Rechenzeit.
- **Lebensweg** (`LifePathPage` in derselben Datei): Überschrift
  „Lebensweg“, Person mit „Andere Person …“, Umschalter
  Person/Vaterlinie/Mutterlinie (Links, `aria-current`), `LifePathMap`;
  ohne sichtbare Person ein Hinweis. Aufklappbar „Wie entsteht der Weg?“
  mit Kontexthilfe (`lebensweg`).

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

- **Rechte:** Person sichtbar, sonst `notFound()` — außer die Kennung ist
  die alte Kennung einer aufgegangenen Person und die bleibende ist
  sichtbar: dann 308 auf deren Seite. Bearbeitungsteile nur
  bei `canEdit` (aus `getPersonDetail`). Auch der Seitentitel (Name)
  entsteht erst nach der Rechteprüfung.
- **Suchparameter:** `rel` (eine Beziehungs-ID: deren Bilderbereich ist
  geöffnet — so verlinken Baum und Recherche), `bezug` (an
  `ReferencePanel` weitergereicht).
- **Daten:** `getPersonDetail` (einmal je Anfrage, auch für den Titel),
  Porträts der sichtbaren Verwandten (Platzhalter bekommen keines). Nur für
  Bearbeiter: `listPickablePersons` (nur sichtbare), `listFamilies`,
  `listSourceOptions`, `listDuplicatesOfPerson`, `getPersonOrigin` (Block
  „Herkunft“ und Chips an Ereignissen, weiteren Namen, Beziehungen und
  Belegen). Für alle: `getPersonRoots` (Standard 4. Generation, nach Land;
  parallel zu `getPersonOrigin`), `lifePathEntry` (lohnt sich ein
  Lebensweg? parallel dazu) und `getPersonBiography` (Text „Lebenslauf“
  aus den schon geladenen Daten, dazu höchstens eine Abfrage der
  Eltern-Kind-Kanten; parallel dazu) und `getLifetimeHistory`
  (Zeitgeschichte der Lebenszeit; parallel dazu), dazu das Cookie
  `zeitgeschichte`.
- **Anzeige (Komponenten):** `DuplicateBanner` (nur Bearbeiter), Kopf mit
  `Avatar`, Lebensdaten samt abweichender Zweitangaben, Knöpfe
  „Bearbeiten“, „Im Stammbaum zeigen“ (`/tree?focus=…`), „Lebensweg auf der
  Karte“ (nur wenn der eigene Weg oder sonst die Vater- bzw. Mutterlinie
  mindestens zwei Punkte auf der Karte hat; führt zu
  `/map?person=…&mode=lebensweg` samt passender `art`) und — nur
  Bearbeiter — „Zusammenführen …“ (`MergeDialog`);
  `PersonBiography` („Lebenslauf“ direkt nach dem Kopf, entfällt ohne
  genug Daten; darunter abgesetzt „In diese Lebenszeit fielen: …“); `ReferencePanel` (Verwandtschaft zur Bezugsperson, „Das bin ich“, „Baum
  aus dieser Sicht“, „Wie sind wir verwandt?“); Notizen; `EventSection` (Ereignisse der Person und
  ihrer Partnerschaften in einer Liste); `NameVariants`; Familie in
  Gruppen Eltern, Geschwister, Partner (mit Heirats-/Scheidungsorten,
  abweichenden Angaben und aufklappbaren Hochzeitsbildern über
  `MediaGallery`), Kinder — gesperrte Verwandte als Platzhalter;
  `PersonRoots` („Wurzeln“, nur mit mindestens einem leiblichen Elternteil);
  `CitationSection` (Belege); Belegbilder (Scans an Ereignissen, Belegen,
  zitierten Quellen, Vorschaubild über `/api/media/<id>?variant=thumb`);
  `MediaGallery` (eigene Bilder). Nur Bearbeiter: `PersonOrigin`
  (Herkunft), `PersonChanges` (Änderungsverlauf) und der Bereich „Verwaltung“ mit
  `RelationshipEditor`, `PersonFamilies`,
  `DeletePersonButton`.

### `/people/[id]/edit` — `app/people/[id]/edit/page.tsx`

- **Rechte:** sichtbar, sonst 404 (alte Kennung einer aufgegangenen Person
  mit sichtbarer bleibender Person: 308 auf deren Bearbeiten-Seite); nicht bearbeitbar → zurück zur
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
- **Anzeige:** hervorgehobene Karte „Forschungs-Fortschritt“ mit Knopf
  „Fortschritt ansehen“ (`/progress`, `research-progress`,
  `research-progress-link`); Zeile mit Knopf „Wie sind wir verwandt?“
  (`/kinship`, `research-kinship`); Kennzahlen (Personen, Beziehungen, Zeitraum, Bilder),
  Personen je Familie (Link `/people?family=…`), Datenlücken je Art
  aufklappbar (Beziehungslücken mit Link `/people/<id>?rel=<Beziehung>`),
  mögliche Dubletten (`DuplicateList`, Link „alle prüfen“), Widersprüche
  je Art. Für Administratoren zusätzlich der Hinweis auf „Importe
  verbinden“.

### `/statistics` — `app/statistics/page.tsx`

- **Rechte:** angemeldet, kein Admin-Recht nötig (Menüpunkt „Statistik“ für
  alle); gezählt werden nur sichtbare Personen, Beziehungen nur zwischen
  ihnen. Die Seite nennt keine einzelnen Personen.
- **Parameter:** `family` (Kennung einer Familie aus `listFamilies`; fremde
  oder unbekannte gelten als „Alle“), `level=region` (sonst nach Land). Die
  Adresse ist damit teilbar; der Empfänger sieht dieselbe Auswahl mit
  seinen eigenen Rechten.
- **Daten:** `getFamilyStatistics` (`lib/services/statistics.ts`).
- **Anzeige:** Kopf mit Kontexthilfe (`HelpLink` → `/hilfe/statistik`) und
  Verweis „Mit Namen: Rekorde“ (`stats-to-records`, nimmt die Familie mit);
  Filter „Familie“ (`AutoSubmitSelect`, GET-Formular mit Knopf „Anzeigen“,
  `level` als verstecktes Feld) nur bei mehr als einer Familie; Kennzahlen
  (Personen mit lebend/verstorben, Partnerschaften mit
  Eltern-Kind-Beziehungen, frühestes/spätestes Geburtsjahr, Hinweis auf
  vermutlich Verstorbene); je Auswertung eine Karte (`StatsCard`) mit
  Überschrift und Grundlage („aus 812 von 1.240 Personen mit …“):
  Geburtsorte (Ring mit Legende, Umschalter „nach Land“/„nach Region“ als
  Links mit `aria-current`, Familie bleibt erhalten), Geschlecht (Ring),
  häufigste Nachnamen und Vornamen (je 15 Balken), Geburten je Jahrzehnt
  bzw. Jahrhundert, erreichtes Lebensalter (Durchschnitt, Tabelle je
  Geburtsjahrhundert, Altersklassen), Kinderzahl (Durchschnitt, Tabelle je
  Geburtsjahrhundert der Eltern, Verteilung), Heiratsalter (Männer/Frauen,
  Klassen), Geburtsmonate. Leere Auswertungen zeigen einen Hinweis statt
  eines Diagramms, zu kleine Grundlagen „zu wenige“. Ohne sichtbare
  Personen nur „Noch nichts auszuwerten.“
- **Bewusst ohne `loading.tsx`:** Mit einer Ladeanzeige bleibt in diesem
  Aufbau eine Navigation auf dieselbe Seite mit anderen Suchparametern
  hängen (Adresse und Inhalt ändern sich nicht) — so hier der Umschalter
  Land/Region. Die Seite rechnet ohnehin in wenigen Millisekunden.
- **Darstellung:** ohne Skript außer dem Familienfilter, ohne
  Diagramm-Bibliothek (Ring `DonutChart`, Balken und Tabellen aus
  `components/StatisticsCharts.tsx`); bei 390 px ohne waagerechtes Scrollen.

### `/records` — `app/records/page.tsx`

- **Rechte:** angemeldet, kein Admin-Recht nötig. Genannt werden nur
  sichtbare Personen (auch lebende), Beziehungen nur zwischen ihnen.
- **Einbindung:** kein Menüpunkt (die Hauptnavigation ist voll); erreichbar
  über „Mit Namen: Rekorde“ auf `/statistics` und die Kachel „Rekorde“ auf
  der Startseite (`start-records`); zurück über „Zahlen und Diagramme:
  Statistik“ (`records-to-statistics`). Beide Verweise nehmen die Familie mit.
- **Parameter:** `family` wie `/statistics` (fremde oder unbekannte = „Alle“).
- **Daten:** `getFamilyRecords` (`lib/services/records.ts`), Regeln in
  `lib/records.ts`.
- **Anzeige:** Kopf mit Kontexthilfe (`HelpLink` → `/hilfe/statistik#rekorde`);
  Filter „Familie“ wie die Statistik (`records-filter`, `#records-family`)
  nur bei mehr als einer Familie; je Rekord eine Karte (`StatsCard`,
  `records-<schlüssel>`) mit Überschrift, einem Satz zur Zählweise samt
  Grenzen aus `lib/records.ts` und „Grundlage: …“; darin `RecordPlaces`
  (`components/RecordCards.tsx`). Zuletzt „Häufigster Vorname je
  Jahrhundert“ (`NamesByCentury`). Ohne sichtbare Personen nur „Noch keine
  Rekorde.“ (`records-nothing`).
- **Bewusst ohne `loading.tsx`** (wie `/statistics`: ein Wechsel nur der
  Suchparameter bliebe hängen).
- **Darstellung:** ohne Skript außer dem Familienfilter; zwei Spalten ab
  `lg`, bei 390 px eine Spalte ohne waagerechtes Scrollen; Namen mit 44 px
  Tippfläche auf dem Telefon.

### `/progress` — `app/progress/page.tsx`

- **Rechte:** angemeldet, kein Admin-Recht nötig. Gezählt und genannt
  werden nur sichtbare Personen; nicht sichtbare Vorfahren erscheinen nur
  als Zahl „nicht freigegeben“. Die Seite verlinkt nur auf Personenseiten,
  bearbeitet wird dort.
- **Einbindung:** kein Menüpunkt; erreichbar über die hervorgehobene Karte
  auf `/research` (`research-progress-link`) und die Kachel
  „Forschungs-Fortschritt“ der Startseite (`start-progress`); zurück über
  „← Recherche“ (`progress-to-research`).
- **Parameter:** `person` (Ausgangsperson; ohne Angabe die Bezugsperson:
  Cookie „Baum aus dieser Sicht“, sonst „Das bin ich“ — `resolveReference`;
  `ich` übergeht das Cookie), `generationen` (4…10, Standard 6). Die
  Adresse ist teilbar; der Empfänger sieht dieselbe Auswahl mit seinen
  Rechten. Eine unbekannte oder nicht sichtbare Person meldet „nicht
  gefunden“ (`progress-notfound`) und fällt auf die Bezugsperson zurück.
- **Daten:** `getResearchProgress` (`lib/services/research-progress.ts`),
  Regeln in `lib/research-progress.ts`.
- **Anzeige:** Kopf mit Kontexthilfe (`HelpLink` →
  `/hilfe/statistik#forschungs-fortschritt`); Bedienzeile
  (`progress-controls`) mit Ausgangsperson (Link, „ich“ bzw.
  „Bezugsperson“), „Andere Person …“ (`MapPersonChooser` mit `target`,
  `progress-choose-person`), „zurück zur Bezugsperson“ (`progress-back`,
  nur bei gewählter Person) und den Tiefen 4…10 als Links mit
  `aria-current` (`progress-depth-<n>`). Ohne Ausgangsperson nur ein
  freundlicher Hinweis (`progress-no-root`) mit „Person wählen …“. Sonst:
  vier Kennzahlen (`KeyFigure`: Vorfahren gefunden, Daten vollständig, Mit
  Beleg, Nicht freigegeben), Karte „Vollständigkeit je Generation“
  (`progress-generation-row`: „X von 2^n“, Balken gefunden/nicht
  freigegeben, fehlend und Ahnenschwund als Text, Qualität), Karte „Die vier
  Großeltern-Linien“ (`progress-line-row`, Kurzzeichen `LineCode` und Farbe
  wie im Baum, Großelternteil verlinkt), „Hier lohnt sich die Suche“
  (`progress-suggestion`: 20 sichtbar, der Rest in `<details>`
  `progress-more`) und „Wie wird gezählt?“ (`progress-rules`, Punkte-Tabelle
  aus `QUALITY_POINTS`).
- **Route und `loading.tsx`:** bewusst eine eigene Route oben und nicht
  unter `/research` — dort liegt `loading.tsx`, und mit einer Ladeanzeige
  bliebe der Wechsel der Tiefe oder Person (nur andere Suchparameter)
  hängen (wie bei `/statistics`).
- **Darstellung:** ohne Skript außer der Personensuche; Balken nur Zierde
  (`aria-hidden`, Breite als `style`-Attribut, CSP-konform), jede Zahl als
  Text; bei 390 px eine Spalte ohne waagerechtes Scrollen, Tiefen-Knöpfe und
  Vorschläge mit 44 px Tippfläche.

### `/kinship` — `app/kinship/page.tsx`

Titel „Wie sind wir verwandt?“. Bedienung: Anwender-Hilfe
`docs/anwender/15-verwandtschaft.md` (`/hilfe/verwandtschaft`).

- **Rechte:** angemeldet. Beide gewählten Personen müssen sichtbar sein,
  sonst zeigt das Feld „Diese Person wurde nicht gefunden“ (ohne
  Unterscheidung unbekannt/gesperrt) und es gibt kein Ergebnis. Gerechnet
  wird streng wie im Stammbaum nur über sichtbare Personen — Seite,
  Baumkarte und Personenseite sagen für dasselbe Paar dasselbe; Regel und
  Begründung bei
  [`lib/services/kinship-view.ts`](dienste.md#libserviceskinship-viewts).
- **Suchparameter:** `a` (erste Person), `b` (zweite Person) — die Adresse
  ist teilbar, der Empfänger sieht sie mit seinen eigenen Rechten. Adressen
  baut `kinshipHref` (`components/kinship-url.ts`).
- **Einstiege:** „Wie sind wir verwandt?“ im Abschnitt Bezugsperson der
  Personenseite (`ReferencePanel`, `a` = diese Person, `b` = wirksame
  Bezugsperson, falls gesetzt und nicht dieselbe) und eine Zeile mit Knopf
  oben auf `/research` (`research-kinship`). Kein eigener Menüpunkt (die
  Hauptnavigation ist voll); „Recherche“ wird auf `/kinship` nicht als
  aktiv markiert.
- **Daten:** `loadKinshipPage` (ein `loadGraph`, eigene Person).
- **Anzeige:** Kopf mit Kontexthilfe (`HelpLink` → `/hilfe/verwandtschaft`);
  zwei `KinshipPersonField` mit „Tauschen“ dazwischen (Link mit vertauschten
  Parametern, funktioniert ohne Skript); ohne zwei Personen ein Hinweis.
  Ergebnis: dieselbe Person (`kinship-same`, `alert-info`), keine
  Verbindung über sichtbare Personen (`kinship-none`: „A und B: keine
  Verwandtschaft über freigegebene Personen bekannt.“ — wortgleich mit der
  Personenseite, ohne Zeichnung, nie „nicht verwandt“; dazu Kontexthilfe
  „Warum?“ → `#nicht-freigegebene-personen`; ob es eine Verbindung über
  gesperrte Personen gibt, bleibt offen) oder die Ergebniskarte mit Art („Blutsverwandt“,
  „Angeheiratet“, „Über Stief- oder Pflegeeltern verbunden“), zwei Sätzen
  „A ist <Begriff> von B.“ in beide Richtungen, bei fehlendem Begriff der
  Schrittkette, gemeinsamen Vorfahren und Generationen (Zählung wie in den
  Begriffen: „Cousin n. Grades“, „eine Generation darüber“), ggf. dem
  Begriff des kürzeren Wegs. Darunter „So seid ihr verbunden“ mit
  `KinshipBloodDiagram` (nächste Blutsverwandtschaft) bzw.
  `KinshipPathDiagram` und Zeichenerklärung; „Weitere Verbindungen“ (bis zu drei,
  je aufklappbar mit eigener Zeichnung).
- **Bewusst ohne `loading.tsx`** und nicht unter `/research` (dessen
  `loading.tsx` gälte sonst auch hier): Wechsel, die nur Suchparameter
  ändern (Auswahl, Tauschen), blieben mit einer Ladeanzeige hängen.
- **Darstellung:** ohne Diagramm-Bibliothek, Zeichnung als HTML/CSS; bei
  390 px eine Spalte ohne waagerechtes Scrollen.

### `/research/duplicates` — `app/research/duplicates/page.tsx`

- **Rechte:** angemeldet (Dienst filtert auf Sichtbares).
- **Suchparameter:** `klasse` (`high`, `medium`, `low`), `ki`
  (`vorgeprueft`, `zusammenfuehren`, `strittig`, `kein-duplikat`, `offen` =
  noch nicht vorgeprüft), `seite` (25 je Seite).
- **Daten:** `listDuplicateCandidates`. **Anzeige:** Klassenwahl mit
  Zahlen, Filter „Von der KI vorgeprüft:“ mit Zahlen innerhalb der Klasse
  (nur, wenn es Einschätzungen gibt oder der Filter gesetzt ist; mit
  Kontexthilfe `dublettenKi`), `DuplicateList`, Zahl der als „kein
  Duplikat“ markierten Paare. Der Filter grenzt nur ein — Klasse und
  Reihenfolge bleiben.

### `/research/connect` — `app/research/connect/page.tsx`

- **Rechte:** nur Administratoren; alle anderen bekommen 404.
- **Anzeige:** `OriginOverview` (Übersicht der Importe und ihrer
  Verbindungen, über `/api/origin/overview`), darunter `ConnectImports`
  (arbeitet über `/api/connect…`).

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
  `GedcomImport`, `ImportHistory` (darin `ImportSources`: Importe
  benennen).

### `/ai-access` — `app/ai-access/page.tsx`

- **Rechte:** jeder angemeldete Benutzer (nur eigene Schlüssel). Ohne
  KI-Recht erklärt die Seite die Lage; vorhandene Schlüssel lassen sich
  trotzdem widerrufen.
- **Daten:** `getAiAccessInfo`, `listApiTokens`, Adresse des Connectors
  über `getSetting("mcpConnectorUrl")` (Wert aus `/admin/settings`, sonst
  Umgebungsvariable `MCP_CONNECTOR_URL`; dienste.md, „Einstellungen“).
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
- **Anzeige:** `UserAdmin` (nutzt `/api/users…`, `/api/ai-tokens`). Ist
  der E-Mail-Link eingerichtet (`emailLoginMode()`), ein Hinweis unter der
  Einleitung: Eingeladene ohne Google-/GitHub-Konto melden sich mit „Link
  zusenden“ an; beim Einladen selbst geht keine Mail hinaus.

### `/admin/changes` — `app/admin/changes/page.tsx`

- **Rechte:** `audit:read`, sonst `/tree?denied=1`.
- **Suchparameter:** `family`, `user`, `channel` (`APP` oder `MCP`), `from`,
  `to` (Datum `JJJJ-MM-TT`), `page`. Ohne `from` die letzten 30 Tage; ein
  bewusst leeres `from=` zeigt alles.
- **Daten:** `changeFilterFrom`, `changeFilterOptions`, `listChangeSets`.
- **Anzeige:** Filterformular, `ChangeSetList` (eine Zeile je Paket,
  aufklappbar über `GET /api/changes/[key]`), Seitennavigation.

### `/neuigkeiten` — `app/neuigkeiten/page.tsx`

- **Rechte:** angemeldet (`requirePage`), sonst `/login` — wie die genaue
  Build-Angabe geht der Stand der App Fremde nichts an.
- **Daten:** `releaseNotes()` (`lib/release-notes-data.ts`, zur Build-Zeit
  eingebaute `CHANGELOG.md`). Keine Datenbank; die Lesemarke ändert die
  Seite nicht.
- **Anzeige:** Überschrift „Neuigkeiten“, alle Releases über
  `ReleaseNoteList`, neueste zuerst. Nicht zu verwechseln mit
  `/admin/changes` (Änderungen an den Daten).

### `/places/[ref]` — `app/places/[ref]/page.tsx`

- **Rechte:** angemeldet; Daten über `getPlacePage` (nur Angaben sichtbarer
  Personen; ohne sichtbare Angabe 404 für Nicht-Admins).
- **Parameter:** `ref` (`g-<gazetteerId>` bzw. `c-<Breite>_<Länge>`),
  `?page=` für die Personenliste (50 je Seite).
- **Anzeige:** Anzeigename, früherer/deutscher Name, Lage und Zuordnung
  (heutiger Name, Region, Land, Koordinaten, Einwohner, Herkunft;
  Begründungen nur für Admins), kleine Lagekarte (`PlaceMiniMap`), Link zur
  Karte und (Admin) zu „Orte zuordnen“, Schreibweisen (Freitexte mit Anzahl,
  weitere Namen aus dem Verzeichnis), Personen mit Art und Jahr der Angabe.
- **Verlinkt von:** Personenseite (jeder zugeordnete Ort), MCP `get_place`.

### `/admin/places` — `app/admin/places/page.tsx`

- **Rechte:** `place:manage`, sonst `/tree?denied=1`.
- **Suchparameter:** `status` (`all`, `open`, `auto`, `ai` — „von KI“,
  `manual`, `unresolvable`), `q`, `page`.
- **Daten:** `listPlaces`. **Anzeige:** Zähler je Status als Filter,
  `PlaceAutoAssign`, Suchfeld, `PlaceTable`, Seitennavigation. KI-Zuordnungen
  stehen als „von KI“ mit eigenem Filter, Begründung und „Bestätigen“. Link
  zur Anwender-Hilfe „Orte zuordnen“ (`HelpLink`).

### `/admin/settings` — `app/admin/settings/page.tsx`

- **Zweck:** Einstellungen der Installation in der App pflegen statt in der
  Server-Konfiguration (Schlüssel → Wert). Welche Schlüssel es gibt, legt
  allein das Verzeichnis `lib/settings/registry.ts` fest; ein neuer Schlüssel
  braucht dort einen Eintrag, keine Änderung an dieser Seite.
- **Rechte:** `setting:manage` (Admin), sonst `/tree?denied=1`.
- **Daten:** `listSettings` — je Schlüssel des Verzeichnisses Bezeichnung,
  Erklärung, in der App gesetzter Wert, gültiger Wert der Umgebungsvariablen,
  wirksamer Wert und Herkunft.
- **Anzeige:** `SettingsAdmin` (nutzt `/api/settings…`), Link zur
  Anwender-Hilfe „Einstellungen“ (`HelpLink`, Ziel `einstellungen`).

### `/admin/history` — `app/admin/history/page.tsx`

- **Zweck:** Zeitgeschichte pflegen: eigene Ereignisse anlegen, ändern,
  löschen; mitgelieferte Einträge (`lib/history/builtin.ts`) einzeln aus-
  und wieder einblenden. Angezeigt werden die Ereignisse im Zeitstrahl des
  Baums, in der Zeitreise der Karte und im Lebenslauf.
- **Rechte:** `history:manage` (Admin), sonst `/tree?denied=1`; Menüpunkt
  „Zeitgeschichte“ im Untermenü „Verwaltung“ nur mit diesem Recht.
- **Daten:** `historyAdminState` — mitgelieferte Einträge mit `hidden`,
  alle eigenen samt Herkunft, Begründung/Quelle der KI und Bestätigung.
- **Anzeige:** `HistoryAdmin` (nutzt `/api/history-events…`), Link zur
  Anwender-Hilfe (`HelpLink`, Ziel `zeitgeschichteVerwalten`). Einträge der
  KI („von KI“, „ungeprüft“, Begründung, Quelle) lassen sich filtern („Nur
  unbestätigte“) und bestätigen — einzeln oder „Alle sichtbaren bestätigen“
  mit Rückfrage.

### `/hilfe` und `/hilfe/[thema]` — `app/hilfe/page.tsx`, `app/hilfe/[thema]/page.tsx`

- **Zweck:** Anwender-Hilfe für Familienmitglieder; Inhalt ausschließlich
  aus `docs/anwender/NN-thema.md` (Pflege: `docs/anwender/README.md`,
  AGENTS.md „Anwender-Hilfe fortschreiben“).
- **Rechte:** angemeldet (`requirePage()`), sonst `/login`. Die Texte
  enthalten keine Stammbaumdaten; bewusst trotzdem nicht öffentlich.
- **Daten:** `listHelpTopics` bzw. `getHelpTopic` aus `lib/help/content.ts`
  (Dateien von der Platte, im Betrieb einmal gelesen). Das Thema muss dem
  Muster `a-z0-9-` entsprechen und als Datei existieren, sonst 404.
- **Anzeige:** Themenliste als Karten (Titel + erster Absatz); ein Thema
  mit Brotkrumen „← Alle Hilfethemen“, Text über `renderHelpBlocks`
  (`components/help-render.ts`, kein rohes HTML), unten Links zum vorigen
  und nächsten Thema. Seitentitel „Thema · Hilfe · Stammbaum“.
- **Build:** `next.config.mjs` nimmt `docs/anwender/*.md` per
  `outputFileTracingIncludes` ins Standalone-Image mit; `.dockerignore`
  lässt die Dateien ausdrücklich im Build-Kontext.
- **Kontexthilfe** in anderen Seiten: `HelpLink` (siehe
  oberflaeche-komponenten.md) auf `/map` („Wie wird gezählt?“ und
  Admin-Hinweis „Orte zuordnen“), `/admin/data` (Orte zuordnen),
  `/research/duplicates`, `/ai-access`, `/admin/settings`, `/admin/history`,
  Personenseite (Bezugsperson, Dubletten-Hinweis, Zeitgeschichte im
  Lebenslauf), Zeile „Zeitgeschichte“ der Karte und Legende der Baumlinien
  bzw. der Zeitgeschichte im Zeitstrahl.

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
  aktualisiert. Davor die Vorprüfung `authRouteDecision`
  (`lib/email-login.ts`) für den E-Mail-Anbieter: `POST
  /api/auth/signin/nodemailer` → 404 (anfordern nur über die
  Anmeldeseite), `GET /api/auth/callback/nodemailer` → 303 auf
  `/login/email` (löst nichts ein), `POST …/callback/nodemailer` von fremder
  Seite → 403.
- **`GET /api/health`**: bewusst ohne Anmeldung und ohne Inhalt. Prüft die
  Datenbank (`SELECT 1`) und ob der Medienordner samt Unterordnern
  beschreibbar ist (`checkMediaDir`), je mit 3 s Zeitgrenze. Antwort
  `{ status: "ok" }` (200) oder `{ status: "error" }` (503), immer
  `no-store`; Fehler nur als eine Zeile im Server-Log. Das Ergebnis gilt
  5 s (`lib/health-cache.ts`): viele Aufrufe von außen lösen höchstens eine
  Prüfung je Zeitfenster aus. Test: `tests/health.test.ts`.
- **`/api/mcp`**: siehe [mcp.md](mcp.md).

### Baum und Karte

- **`GET /api/tree`**: der ganze Graph über `loadTree` — sichtbare
  Personen mit Angaben, alle übrigen als anonyme Platzhalter. Wer keiner
  Familie angehört (und nicht Admin ist), bekommt eine leere Antwort — auch
  keine Platzhalter, deren Zahl und Verknüpfung ihn nichts angehen.
- **`GET /api/map`**: Kartendaten wie `/map` über `loadMapView`; mit
  `mode=lifepath&kind=person|father|mother` (und `person`) der Lebensweg
  über `loadLifePathView`.
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
  Einträge über Personen, die es nicht mehr gibt, zeigen Feldwerte nach den
  im Eintrag gespeicherten Familien ([dienste.md](dienste.md),
  `lib/services/changes.ts`); dasselbe gilt für `GET /api/changes/[key]`.
  Enthält auch die Einträge der Personen, die in dieser aufgegangen sind
  (`fromMerged: true`, nach derselben Regel).
- **`GET /api/persons/[id]/roots`**: `getPersonRoots` — Abschnitt „Wurzeln“
  der Personenseite; Suchparameter `generations` (2…8, Standard 4) und
  `level` (`country`/`region`, Standard `country`). Ungültige Angaben 400,
  Person nicht sichtbar bzw. nicht vorhanden 404. Antwort nur mit
  Gebietsnamen, Anteilen und Zählungen (keine Personen, keine Ortstexte).
  Anfragegrenze `read`.
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
  `offset`, `limit` (Standard 25), `confidence`, `review` (`any`,
  `none`, `open`, `MERGE`, `DISPUTED`, `NOT_DUPLICATE`); je Paar ggf.
  `review` (nur bei Bearbeitungsrecht an beiden), dazu `reviewCounts`.
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
  mit passendem `If-None-Match` → 304. `Content-Type` nur aus einer festen
  Liste von Bildarten (WebP, JPEG, PNG, GIF, AVIF, TIFF) — alles andere,
  auch SVG oder HTML in einem Datensatz, geht als
  `application/octet-stream` hinaus; dazu `nosniff`, `Content-Disposition:
  inline` und eine Content-Security-Policy mit `default-src 'none'` und
  `sandbox`, damit ein Browser die Antwort nie als Seite ausführt. Die
  Route setzt `default-src 'none'; sandbox` selbst; ausgeliefert wird die
  `API_POLICY` aus `next.config.mjs`, die sie ersetzt und beides enthält.
- **`DELETE /api/media/[id]`**: unsichtbar 404, ohne Löschrecht
  (`canDeleteMedia`) 403. Löscht den Datensatz, danach die Dateien (eine
  verwaiste Datei wird hingenommen); Audit direkt in der Route mit den
  betroffenen Personen.
- **`POST /api/media/[id]/links`** (Einzel- oder Listenfelder für
  Personen, Beziehungen, Ereignisse, Belege, Quellen; je höchstens 50):
  `linkMedia` — Bild sichtbar, jedes Ziel bearbeitbar.
- **`DELETE /api/media/[id]/links`** (Ziele als Suchparameter, z.B.
  `?eventId=…`): `unlinkMedia` **mit** Löschen eines danach verwaisten
  Bildes (die Oberfläche fragt vorher). Würde das Bild dabei endgültig
  gelöscht, gilt das Löschrecht (`canDeleteMedia`, sonst 403) — der Scan
  einer gemeinsam genutzten Quelle lässt sich so nicht am Löschverbot
  vorbei entfernen. Anders als `link_media` über MCP, das nie löscht.
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
  E-Mail → 409. 201. Die Lesemarke der Neuigkeiten steht gleich auf dem
  neuesten Release: „Was ist neu?“ beginnt für neue Benutzer erst mit dem
  nächsten.
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
- **`PUT /api/me/release-seen`** (`releaseId`, sonst nichts — weitere Felder
  → 400): `markReleaseSeen` für den angemeldeten Benutzer; nur Kennungen aus
  `CHANGELOG.md`, sonst 400; ohne Anmeldung 401. Antwort
  `{ lastSeenReleaseId }`. Kein Audit-Eintrag.

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
  Suchparameter `kind`, `group`, `offset`, `limit` (Standard 50), `q`;
  `suggest` (`high`, `veryLikely`, `medium`, `low`) liefert die neuen
  Personen, deren bester Vorschlag in dieser Klasse liegt (Abschnitt
  „Zusammenhang mit vorhandenen Daten“).
- **`POST /api/import/gedcom/[id]/apply`** (Entscheidungen aus der
  Vorschau, Verknüpfungen als `suggestions: { ref: { personId } }`): prüft
  gewählte Verknüpfungen nach — bei einer Abweichung **409** mit
  `linkIssues` (je Eintrag `ref`, `personId`, `file`, `existing`,
  `reason`), nichts wird geschrieben; sonst Import im Hintergrund starten,
  202; doppeltes Absenden startet keinen zweiten Lauf. **`GET`**: Stand des
  Laufs (`error` ggf. mit `linkIssues`).
- **`POST /api/import/gedcom/[id]/reread`**: ausgeführten Import aus dem
  aufbewahrten Original erneut einlesen (neuer Lauf mit Vorschau).
- **`GET /api/import/batches`**: Importverlauf aller Formate, neueste
  zuerst; Suchparameter `limit` (Standard 50).
- **`GET /api/import/batches/[id]/file`**: aufbewahrte Originaldatei als
  Download (Dateiname bereinigt, `no-store`); fehlt → 404.
- **`POST /api/import/batches/prune`** (`batchId` optional): überholte
  Rohdaten eines Laufs bzw. aller Läufe entfernen.
- **`GET /api/import/sources`**: alle Importe (Quell-Bäume) mit Buchstabe,
  Farbe, Anzeige- und Standardname, Datei, Zahl der Personen und Läufe.
  **`PATCH`** (`sourceTreeId`, `displayName`): Anzeigenamen setzen; leer
  entfernt ihn. Name schon vergeben oder länger als 60 Zeichen → 400,
  unbekannter Import → 404. Beides nur für Administratoren (Dienst prüft
  zusätzlich; Bearbeiter → 403).

### Herkunft

- **`GET /api/origin/overview`**: Personen je Import (und „von Hand
  erfasst“), Verbindungspersonen je Import-Paar, Gesamtzahlen — gezählt nur
  Personen, die der Benutzer bearbeiten darf. Wer nirgends Bearbeiter ist,
  bekommt 403.

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
- **`POST /api/places/auto`**: alle Ortstexte, die weder von Hand bestätigt
  noch von der KI gesetzt sind, automatisch aus dem Ortsverzeichnis zuordnen
  (Altbestand; neue Texte ordnet das Speichern selbst zu).
- **`GET /api/places/suggest?q=`** (`route(null)`, Prüfung im Dienst
  `placeHint`): welcher Ort zu einem eingegebenen Text erkannt wird — Status
  `found`/`ambiguous`/`none`, `label`, `precision`, `matchedPart`,
  `formerName`, `otherName`, `own`, `ambiguous`. Nur für Admins und
  Bearbeiter (sonst 403), `q` höchstens 500 Zeichen, `Cache-Control:
  private, no-store`. Ohne `q`: lädt das Ortsverzeichnis vorab
  (`{ warming: true }`). Liefert nur Verzeichnisdaten bzw. eigene Orte, nichts
  über Personen. Mit `candidates=1` zusätzlich bis zu 10 Kandidaten zum
  Auswählen (Verzeichnis und eigene Orte: Bezeichnung, Art, Koordinaten,
  Einwohnerzahl, `own`, `recommended`).
- **`POST /api/places/choose`** (`route(null)`, Dienst `choosePlaceForEntry`):
  `{ text, personId | eventId | relationshipId, gazetteerId |
  latitude+longitude+label(+precision) }` — Zuordnung „von Hand“ für genau
  diesen Freitext; 403 ohne Bearbeitungsrecht, 400 wenn der Text nicht am
  Eintrag steht, 409 bei abweichender, von Hand bestätigter Zuordnung
  (außer Admin). Antwort `{ assignment }`.
- **`GET /api/places/search`**: Suche im mitgelieferten Ortsverzeichnis,
  `q` höchstens 100 Zeichen.

### Einstellungen

Alle mit `route("setting:manage", …)` (nur Administratoren, Herkunftsprüfung
für schreibende Anfragen, Anfragegrenzen wie üblich); Prüfung und Protokoll
im Dienst (dienste.md, „Einstellungen“). Antwort jeweils der Zustand des
Schlüssels (`SettingStateDto`: Bezeichnung, Erklärung, `appValue`,
`envValue`, `effective`, `source` = `app`/`env`/`none`).

- **`GET /api/settings`**: `listSettings` — alle Schlüssel des Verzeichnisses.
- **`POST /api/settings`** (`key`, `value`): Eintrag anlegen → 201;
  unbekannter Schlüssel oder ungültiger Wert 400 (`issues` mit Pfad
  `value` bzw. `key`), schon gesetzt 409.
- **`PATCH /api/settings/[key]`** (`value`): Wert ändern; nicht gesetzt 404,
  ungültig 400.
- **`DELETE /api/settings/[key]`**: in der App gesetzten Wert entfernen —
  danach gilt wieder die Umgebungsvariable; nicht gesetzt 404.

### Zeitgeschichte

Alle mit `route("history:manage", …)` (nur Administratoren,
Herkunftsprüfung für schreibende Anfragen, Anfragegrenzen wie üblich);
grobe Form per zod (`lib/history/input.ts`), Prüfung je Feld und Protokoll
im Dienst (dienste.md, „Zeitgeschichte“). Die Anzeige der Ereignisse
braucht keine Route — die Seiten laden sie serverseitig.

- **`GET /api/history-events`**: `historyAdminState` — mitgelieferte
  Einträge mit `hidden`, eigene Ereignisse.
- **`POST /api/history-events`** (`title`, `yearFrom`, `yearTo`, `kind`,
  `description`, `region`; Jahre als Zahl oder Text): eigenes Ereignis
  anlegen → 201; ungültig 400 (`issues` mit Pfad je Feld).
- **`PATCH /api/history-events/[id]`** (dieselben Felder): ändern;
  unbekannt 404, ungültig 400. **`DELETE`**: löschen → `{ ok: true }`;
  unbekannt 404.
- **`PATCH /api/history-events/builtin/[id]`** (`hidden`: boolean):
  mitgelieferten Eintrag aus- bzw. einblenden; unbekannte Kennung 404.
- **`POST /api/history-events/confirm`** (`ids`: 1 bis 500 Kennungen, mit
  oder ohne `c:`): Einträge der KI bestätigen (`confirmHistoryEvents`) →
  `{ confirmed: n }` (nur unbestätigte KI-Einträge zählen); eine unbekannte
  Kennung 404, leere Liste 400. Für die KI gibt es dafür kein MCP-Werkzeug.
- Ein `PATCH` auf einen unbestätigten KI-Eintrag bestätigt ihn zugleich
  (der Administrator hat ihn von Hand gespeichert).

## Tests

Die Routen haben überwiegend keine eigenen Unit-Tests; geprüft werden die
Dienste (`tests/*.db.test.ts`) und das Zusammenspiel im Browser
(Playwright unter `e2e/`). Direkt auf Routen zielen `tests/health.test.ts`,
`tests/mcp-http.db.test.ts`, `tests/settings.db.test.ts`,
`tests/history.db.test.ts` und `tests/history-ai.db.test.ts` (Route
`confirm`).

| Bereich | E2E-Tests |
|---|---|
| Anmeldung, Navigation, Rechte | `e2e/read/auth.spec.ts`, `navigation.spec.ts`, `permissions.spec.ts`, `mobile.spec.ts` |
| Baum | `e2e/read/tree-focus.spec.ts`, `tree-whole.spec.ts`, `reference.spec.ts`; `e2e/write/reference.spec.ts` |
| Karte, Orte | `e2e/read/map.spec.ts`; `e2e/write/places.spec.ts` |
| Lebensweg | `e2e/read/lifepath.spec.ts`; Unit: `tests/life-path.test.ts`, `tests/life-path.db.test.ts` |
| Personen | `e2e/read/people-list.spec.ts`, `person-families.spec.ts`, `dates.spec.ts`; `e2e/write/person-lifecycle.spec.ts`, `genealogy.spec.ts`, `dates.spec.ts` |
| Statistik | `e2e/read/statistics.spec.ts`; Unit: `tests/statistics.test.ts`, `tests/statistics.db.test.ts` |
| Rekorde | `e2e/read/records.spec.ts`; Unit: `tests/records.test.ts`, `tests/records.db.test.ts` |
| Forschungs-Fortschritt | `e2e/read/progress.spec.ts`; Unit: `tests/research-progress.test.ts`, `tests/research-progress.db.test.ts` |
| Startseite | `e2e/read/today.spec.ts`; Unit: `tests/today.test.ts`, `tests/today.db.test.ts` |
| Wie sind wir verwandt? | `e2e/read/kinship.spec.ts`; Unit: `tests/kinship-chain.test.ts`, `tests/kinship-view.db.test.ts` |
| Recherche, Dubletten, Zusammenführen | `e2e/read/research.spec.ts`, `quality.spec.ts`, `duplicate-banner.spec.ts`; `e2e/write/merge.spec.ts`, `duplicate-banner.spec.ts`, `connect.spec.ts` |
| Quellen, Bilder | `e2e/write/sources.spec.ts`, `import-sources.spec.ts`, `media.spec.ts`, `attached-media.spec.ts` |
| Export, Import | `e2e/read/export.spec.ts`, `gedcom-export-dialog.spec.ts`; `e2e/write/import.spec.ts`, `gedcom-import.spec.ts` |
| Verwaltung, KI-Zugang, Änderungen, Einstellungen | `e2e/write/admin.spec.ts`, `ai-access.spec.ts`, `changelog.spec.ts`, `settings.spec.ts`; `e2e/read/mcp-http.spec.ts` |
| Anwender-Hilfe, Kontexthilfe | `e2e/read/help.spec.ts`; Unit: `tests/help.test.ts` |
| Zeitgeschichte (Zeitstrahl, Karte, Lebenslauf, Verwaltung) | `e2e/read/history.spec.ts`; `e2e/write/history.spec.ts` (auch KI-Einträge, Vermerk, Bestätigen); Unit: `tests/history.test.ts`, `tests/history-origin.test.ts`, `tests/history.db.test.ts`, `tests/history-ai.db.test.ts` |
