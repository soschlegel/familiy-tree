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
`help/content`, `safe-fetch`, `email-login-mail` (SMTP bzw.
Test-Briefkasten).

Übersicht:

| Bereich | Module |
|---|---|
| Anmeldung, Rechte, Anfrage-Rahmen | `auth`, `dev-login`, `email-login`, `email-login-mail`, `authz`, `session`, `api`, `request-guard`, `csp`, `rate-limit`, `health-cache`, `scope`, `ai-tokens`, `prisma` |
| Protokoll | `audit`, `change-sets`, `change-time` |
| Daten und Regeln | `dates`, `date-fields`, `events`, `event-labels`, `validation`, `consistency`, `partner-labels`, `source-labels`, `source-classify` |
| Graph und Verwandtschaft | `graph`, `kinship`, `kinship-chain`, `reference`, `roots` |
| Auswertungen | `statistics`, `records`, `chart-slices`, `today` |
| Baumdarstellung | `tree-layout`, `layout-generations`, `focus-tree`, `ancestor-rings`, `descendant-rings`, `rings-segments`, `rings-print` |
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
  **E-Mail-Link** (Auth.js-Anbieter Nodemailer, Kennung `nodemailer`) nur,
  wenn `emailLoginMode()` (`lib/email-login.ts`) einen Zustellweg liefert:
  vollständige `SMTP_*`-Angaben plus `AUTH_URL`, in der Mock-Umgebung der
  Test-Briefkasten. Gültigkeit 15 Minuten, `normalizeIdentifier` =
  `normalizeEmail`, Zustellung über `deliverLoginMail`
  (`lib/email-login-mail.ts`) mit einem Link auf die Bestätigungsseite
  (`confirmationUrl`).
- Adapter: Prisma-Adapter (Tabellen `User`, `Account`, `VerificationToken`),
  umhüllt von `withTokenCleanup` — vor jedem neuen Anmeldelink werden ältere
  Links derselben Adresse und alle abgelaufenen gelöscht. Auth.js speichert
  das Token nur als SHA-256 über Token + `AUTH_SECRET` und löscht es beim
  Einlösen (`useVerificationToken`); abgelaufen, verbraucht oder ersetzt →
  Fehler `Verification` → `/login?error=Verification`.
- `signIn`-Callback: unbekannte oder gesperrte E-Mail → abgelehnt. Beim
  Anfordern eines E-Mail-Links (`email.verificationRequest`) nur diese
  Prüfung, sonst nichts; beim Einlösen läuft der Callback erneut wie bei
  OAuth. Bei Anmeldung: Status `ACTIVE`, `lastLoginAt`, Name/Bild werden nur
  ergänzt, nie überschrieben.
- **Kein neues Konto über den E-Mail-Weg:** Auth.js ruft den Callback, bevor
  es einen Benutzer sucht oder anlegt; abgelehnt wird jede Adresse außerhalb
  der Benutzerliste. Der E-Mail-Anbieter legt keine `Account`-Zeile an und
  findet den Benutzer nur über genau diese Adresse;
  `allowDangerousEmailAccountLinking` betrifft nur GitHub/Google.
- `pages`: Anmelden und Fehler → `/login`, „Mail ist unterwegs“ →
  `/login?link=gesendet` (die eingebauten Auth.js-Seiten unter `/api/auth`
  wären wegen der strengen CSP der API unbrauchbar).
- JWT-Sitzungen (der Credentials-Anbieter kann keine DB-Sitzungen). Der
  `jwt`-Callback lädt Rolle und Status **bei jeder Anfrage** neu — Rollen-
  wechsel und Sperren wirken sofort.
- Gesperrte Benutzer bekommen eine ungültige Sitzung **ohne** `user`, damit
  keine Weiterleitungsschleife zwischen Login und Baum entsteht.

**Benutzt von:** `app/api/auth/[...nextauth]/route.ts`, `app/layout.tsx`,
`app/login/page.tsx`, `app/login/actions.ts`, `app/login/email/page.tsx`,
`lib/api.ts`, `lib/session.ts`.

**Tests:** keine direkten Tests (Ablauf wird in Playwright über den
Dev-Login genutzt); die Freigaberegel prüft `tests/dev-login.test.ts`, den
E-Mail-Ablauf mit der eingebauten Auth.js-Version `tests/email-login.test.ts`
und `e2e/write/email-login.spec.ts`.

### lib/email-login.ts
**Zweck:** Regeln der Anmeldung per E-Mail-Link, rein (ohne next/*,
Datenbank, Versand) und damit direkt testbar. Betrieb:
[docs/betrieb/email-anmeldung.md](../betrieb/email-anmeldung.md).

**Wichtige Funktionen/Typen:**
- `smtpSettings` — SMTP-Zugang nur vollständig (`SMTP_HOST`, `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM`; `SMTP_PORT` Standard 587, `SMTP_SECURE`
  Standard „an bei 465“), sonst `null`.
- `mailTestOutboxAllowed` — Test-Briefkasten nur bei
  `MAIL_TEST_OUTBOX=mock-only` **und** Mock-Datenbank **und**
  Mock-Medienordner (Namensregeln aus `lib/dev-login.ts`), unabhängig von
  `NODE_ENV`.
- `emailLoginMode` — `"outbox"` (hat Vorrang), `"smtp"` oder `null` (aus);
  verlangt immer eine gültige `AUTH_URL` (`publicBaseUrl`).
- `normalizeEmail` — getrimmt, klein, genau ein „@“, keine Anführungszeichen,
  Leerzeichen oder Listen-Trenner; auch `normalizeIdentifier` des Anbieters.
- `requestEmailLink` — „Link zusenden“: Adresse prüfen → Drosselung
  (`checkMailRate`) → Benutzer suchen → nur bei eingeladenem, nicht
  gesperrtem Benutzer `sendLink`. Antwortet in jedem Fall frühestens nach
  `MIN_RESPONSE_MS` (800 ms) plus bis zu 200 ms Zufall; Fehler beim Versand
  werden nur protokolliert. Das Ergebnis dient Tests und Protokoll, der
  Aufrufer zeigt immer dieselbe Antwort.
- `checkMailRate` / `MAIL_RULES` — 3 Anforderungen je Adresse in 15
  Minuten, 10 je Absender in der Stunde (eigener `RateLimiter` im Speicher).
  **Immer aktiv**, auch bei `RATE_LIMIT=off`: Die Grenze schützt fremde
  Postfächer und das SMTP-Konto. Gezählt wird jede gültige Anforderung, auch
  für unbekannte Adressen.
- `clientAddressFromHeaders` — Absender = letzter Eintrag in
  X-Forwarded-For (wie `clientAddress` in `mcp/http.ts`).
- `confirmationUrl` — Link für die Mail: Token und Adresse aus der
  Auth.js-Adresse, aber Ziel `/login/email` unter `AUTH_URL` (nie der
  Host-Header).
- `plausibleLinkParams`, `callbackActionPath` — Form der Link-Angaben und
  Ziel des Knopfs „Jetzt anmelden“ (POST an `/api/auth/callback/nodemailer`).
- `authRouteDecision` — Vorprüfung der Auth.js-Route: `POST
  /api/auth/signin/nodemailer` von außen → 404 (angefordert wird nur über
  die Server-Aktion, sonst ginge die gleiche Antwort verloren); `GET
  …/callback/nodemailer` → 303 auf die Bestätigungsseite (löst nichts ein);
  `POST …/callback/nodemailer` von fremder Seite (`isCrossSiteWrite`) → 403.
- `withTokenCleanup` — Adapter-Hülle, siehe `lib/auth.ts`.
- `loginMail` — Betreff, Klartext und schlichtes HTML (deutsch, Gültigkeit,
  „Wenn du das nicht warst, ignoriere diese Mail.“, keine externen Inhalte,
  Link maskiert).

**Benutzt von:** `lib/auth.ts`, `lib/email-login-mail.ts`,
`app/login/actions.ts`, `app/login/page.tsx`, `app/login/email/page.tsx`,
`app/api/auth/[...nextauth]/route.ts`, `app/admin/users/page.tsx`.

**Tests:** `tests/email-login.test.ts` (Einrichtung, Test-Briefkasten nur
mit allen drei Bedingungen, nur Eingeladene bekommen Mail, gleiche
Mindestdauer, Drosselung je Adresse/Absender auch bei `RATE_LIMIT=off`,
Route, Mailtext; Auth.js-Ablauf: Token gehasht, einmalig, abgelaufen,
ersetzt, kein neues Konto, nachträglich gesperrt).

### lib/email-login-mail.ts
**Zweck:** Zustellung der Anmeldelinks (`deliverLoginMail`), aufgerufen aus
`sendVerificationRequest` in `lib/auth.ts`.

**Regeln:**
- SMTP über `nodemailer` mit den Angaben aus `smtpSettings`; ohne TLS von
  Anfang an wird STARTTLS verlangt (`requireTLS`), kein Passwort im
  Klartext. Der Versand läuft im Hintergrund — die Anmeldeseite wartet
  nicht auf den Mailserver, damit die Antwortzeit nichts verrät. Fehler und
  Ablehnungen nur ins Server-Protokoll, ohne Adresse.
- Test-Briefkasten (`emailLoginMode() === "outbox"`): die Mail als JSON
  (`to`, `subject`, `text`, `html`, `url`) unter
  `MEDIA_DIR/mail-outbox/`; nie ein echter Versand. Playwright liest dort
  den Link.

**Benutzt von:** `lib/auth.ts`.

**Tests:** `e2e/write/email-login.spec.ts` (Test-Briefkasten).

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

**Benutzt von:** `lib/auth.ts` (`authorize` des Dev-Logins);
`isMockDatabase`/`isMockMediaDir` auch `lib/email-login.ts`
(Test-Briefkasten).

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

### lib/csp.ts
**Zweck:** Content-Security-Policy als reine Funktionen (kein `next/*`,
keine Datenbank); Begründung je Direktive in
[docs/sicherheit.md](../sicherheit.md#content-security-policy).

- `pagePolicy({ nonce, dev, https, reportOnly })` — Richtlinie der Seiten:
  Skripte nur mit Nonce plus `'strict-dynamic'` (kein `'unsafe-inline'`,
  kein `'unsafe-eval'`), Stile mit `'unsafe-inline'` und bewusst ohne
  Nonce, alles andere nur `'self'` bzw. `'none'`, `form-action` mit
  `OAUTH_FORM_TARGETS`. Dev-Server zusätzlich `'unsafe-eval'` und
  `ws:`/`wss:`; `upgrade-insecure-requests` nur bei https-Adresse und nicht
  im Report-Only-Modus.
- `OAUTH_FORM_TARGETS` — `https://github.com`, `https://accounts.google.com`:
  Ziel der 303-Weiterleitung, wenn ein Anmelde-Formular ohne JavaScript
  abgeschickt wird (Chromium prüft Weiterleitungen gegen `form-action`).
  Kommt ein Anbieter dazu, hier ergänzen.
- `API_POLICY` — feste Richtlinie aller `/api`-Antworten (in
  `next.config.mjs` gleichlautend eingetragen; mit `sandbox`).
- `cspMode()` — Not-Schalter `CSP_MODE`: `enforce` (Standard, auch für
  unbekannte Werte), `report-only`, `off`; `cspHeaderName(mode)` liefert die
  passende Kopfzeile.
- `createNonce()` — 128 Bit aus Web-Crypto, base64. `isHttpsUrl()` —
  `AUTH_URL` beginnt mit `https://`.

**Benutzt von:** `middleware.ts` (Seiten), `next.config.mjs` (Wert von
`API_POLICY`). **Tests:** `tests/csp.test.ts`, `e2e/read/csp.spec.ts`.

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
`subjectFamiliesKnown`): `auditRefs` speichert zusätzlich die Familien der
Person(en), zu denen der Eintrag gehört, zum Zeitpunkt des Eintrags —
gelesen in der Transaktion des Dienstes, also nach der Änderung
(`subjectPersons`, `subjectFamilies`). Welche Personen zählen, folgt der
heutigen Leseregel des Datensatzes: Person (außer `CONNECT`; beim
Zusammenführen die bleibende Person samt übernommener Familien); Name →
Person; Ereignis und Beleg → Träger (Person oder beide Seiten der
Beziehung, Beleg an einem Ereignis über dessen Träger); Beziehung → beide
Seiten; Bild → alle Träger (Personen, Beziehungen, Träger der Ereignisse
und Belege). Bei mehreren Personen wird die **Vereinigung** gespeichert —
`canViewPerson` darauf ergibt genau „sichtbar, sobald eine Person sichtbar
ist“, wie bei vorhandenen Beziehungen, Paar-Ereignissen, Belegen und
Bildern. Ist der Datensatz schon gelöscht, gelten die Felder des Eintrags
(`personId`, `relationshipId`, `fromPersonId`/`toPersonId`, `eventId`).
**Nicht erfasst** (known = false, nie geraten) bleibt ein Eintrag, wenn
auch nur eine Person nicht mehr auffindbar ist, eine Beziehung nur eine
bekannte Seite hat, ein Bild an einer Quelle hängt (dort entscheiden
Ersteller und Belege, nicht Familien) oder an nichts hängt, sowie alle
übrigen Arten (Quelle, Familie, …). Ausdrücklich übergebenes
`subjectFamilyIds` hat Vorrang (Person löschen: Familien vor dem Löschen;
Bild löschen: vorher ermittelte `auditRefs`, samt `subjectFamiliesKnown:
false`). Der Sammel-Eintrag beim Import (`import-apply.ts`, schreibt
Personen-Zeilen selbst) setzt beide Felder ebenso; Namen, Ereignisse,
Belege und Beziehungen schreibt der Import nicht einzeln. Ausgewertet in
`lib/services/changes.ts` (Leserecht, wenn es die Person nicht mehr gibt).

**Benutzt von:** fast allen schreibenden Diensten, mehreren Admin- und
Medienrouten.

**Tests:** `tests/changelog.test.ts` (indirekt `changelog.db.test.ts`,
`changelog-subject.db.test.ts`, `changelog-untereintraege.db.test.ts`).

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
`partner-labels`, `tree-layout`, `validation`, `map/build`, `map/life-path`,
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

**Benutzt von:** `reference`, `kinship-chain`, Dienste `kinship`,
`kinship-view`, `map`, `index`.

**Tests:** `tests/kinship.test.ts`, `tests/genealogy.test.ts`,
`tests/reference.test.ts`.

**Bekannte Eigenheit:** Bei Adoption und Seite zugleich steht die Seite
hinter dem Zusatz („Cousine 2. Grades (über Adoption) väterlicherseits“).

### lib/kinship-chain.ts
**Zweck:** Verbindungen zweier Personen als Personenketten für die Seite
„Wie sind wir verwandt?“ — rein, ohne Datenbank und ohne Rechte
(`lib/services/kinship-view.ts` übergibt nur den sichtbaren Teilgraphen).

**Wichtige Funktionen/Typen:** `bloodConnections`, `lineUp`,
`connectionTerms`, `parentChildLabels`, Typen `BloodConnection`, `LineStep`.

**Regeln und Algorithmen:**
- Blutsverwandtschaft wie in `lib/kinship.ts` (leiblich und adoptiv,
  `ancestorDistances`). `bloodConnections` sucht **alle eigenständigen**
  gemeinsamen Vorfahren: Ein gemeinsamer Vorfahr fällt weg, wenn eines
  seiner Kinder ebenfalls gemeinsamer Vorfahr ist und auf beiden Seiten
  genau eine Generation näher liegt (die Eltern gemeinsamer Großeltern sind
  keine eigene Verbindung). Die nächste Verbindung ist damit immer dabei
  und hat dieselben Generationen wie `findBloodRelation`.
- Bündelung zu Verbindungen: gleiche Abstände und Paar (Partnerkante oder
  gemeinsames Kind) — so sind Großvater und Großmutter eine Verbindung, die
  beiden Großelternpaare doppelter Cousins zwei. Reihenfolge: Summe der
  Generationen, dann weniger Generationen auf Seiten von A, dann Kennung.
- Je Verbindung die beiden Linien von oben nach unten (`lineUp`:
  Breitensuche hinauf nur über leibliche/Adoptiv-Eltern, leiblich zuerst);
  der erste Vorfahr ist der, bei dem die Linie von A ankommt. Halb und
  Adoptiv wie in `findBloodRelation`, je Verbindung.
- `connectionTerms`: Bezeichnung in beide Richtungen, Seite aus dem
  Elternteil direkt über A bzw. B (nur bekanntes Geschlecht).
- **Grenze:** Eine zweite Verbindung, die über einen schon gefundenen
  gemeinsamen Vorfahren hinaus weiter hinaufführt, erscheint nicht eigens;
  Halbverwandtschaft wird wie in `findBloodRelation` nur erkannt, wenn
  unter dem einzigen Vorfahren auf beiden Seiten zwei Eltern erfasst sind.

**Benutzt von:** `lib/services/kinship-view.ts`.

**Tests:** `tests/kinship-chain.test.ts` (Cousins mit Großelternpaar,
Vorfahr/Nachfahr, doppelte Cousins, Ahnenschwund, Halbgeschwister,
Adoption, Abgleich mit `findBloodRelation` über die Mock-Daten, 12 000
Personen).

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

### lib/roots.ts
**Zweck:** Rechnung des Abschnitts **„Wurzeln“** der Personenseite: wie
sich eine Person rechnerisch auf die Herkunftsgebiete ihrer Vorfahren
verteilt (Vorbild: Herkunfts-Torte der Ahnenportale, aber ohne DNA). Rein,
auch im Browser nutzbar; Laden und Sichtbarkeit in `lib/services/roots.ts`.
Name bewusst „roots“ — „Herkunft“/`origin` meint in der App die
Import-Herkunft.

**Wichtige Funktionen/Typen:** `ancestorShares` (Anteile je Vorfahr aus
Eltern-Funktion und Sichtbarkeit; Ergebnis mit Plätzen 2^N, davon mit
sichtbaren Vorfahren besetzten und Zahl der Eltern der Ausgangsperson),
`rootsSlices` (Anteile → Stücke mit Bezeichnung, Prozent, Farbe),
`roundPercentages`, `clampRootsGeneration`, `generationName` („Großeltern“,
„Ururgroßeltern“, ab 5 „3× Urgroßeltern“), `ROOTS_LABELS`, `ROOTS_COLORS`,
Grenzen `ROOTS_MIN_GENERATION` (2), `ROOTS_MAX_GENERATION` (8),
`ROOTS_DEFAULT_GENERATION` (4), `ROOTS_MIN_SLICE` (2 %),
`ROOTS_MAX_PLACE_SLICES` (8).

**Regeln (Entscheidung des Eigentümers):**
- Betrachtet wird Generation N (Eltern = 1); jeder Platz dort zählt 1/2^N.
  Jeder Vorfahr gibt seinen Anteil zu gleichen Teilen an seine leiblichen
  Eltern weiter.
- **Linie endet vorher:** Der letzte bekannte Vorfahr steht für alle Plätze
  dahinter (Anteil 1/2^seiner Generation). Kennt ein Vorfahr nur einen
  Elternteil, geht die Hälfte an diesen, die andere bleibt beim Vorfahren.
- **Fehlender Elternteil der Ausgangsperson:** dessen Hälfte ist
  „Unbekannt“; ganz ohne Eltern alles (der Abschnitt entfällt dann).
- **Mehr als zwei leibliche Eltern** (die App verhindert das beim Anlegen,
  Altdaten könnten es haben): zu gleichen Teilen, kein „Unbekannt“.
  Doppelte Kanten zählen einmal.
- **Ahnenschwund:** derselbe Vorfahr über mehrere Linien zählt mehrfach
  (Tiefensuche je Weg, kein globales „schon besucht“).
- **Zyklen:** Ein Elternteil, der schon auf dem eigenen Weg zur
  Ausgangsperson liegt (auch die Person selbst), gilt als nicht vorhanden —
  die Rechnung endet immer.
- **Nicht sichtbarer Vorfahr:** ganzer Anteil „Nicht freigegeben“, seine
  Eltern werden nicht einmal abgefragt.
- **Stücke:** Gebiete absteigend nach Anteil (gleich: Name), dann
  „Sonstige“, „Ort nicht zugeordnet“, „Unbekannt“, „Nicht freigegeben“.
  Das Zusammenfassen, die Prozentrundung, Bezeichnungen und Farben liegen
  gemeinsam mit der Seite „Statistik“ in `lib/chart-slices.ts`
  (`groupAreaSlices` mit dem Ganzen 1); `rootsSlices` gibt die Stücke ohne
  den Zählwert zurück, die Antwort ist also wie zuvor. `ROOTS_LABELS`,
  `ROOTS_COLORS`, `ROOTS_MIN_SLICE`, `ROOTS_MAX_PLACE_SLICES` und
  `roundPercentages` sind Verweise darauf.
  Gebiete unter 2 % oder jenseits des achten werden „Sonstige“ (mit Liste
  der Gebiete) — aber nie ein einzelnes Gebiet allein: Das bleibt beim
  Namen bzw. nimmt, wenn schon acht Farben vergeben sind, das kleinste
  behaltene mit.
- **Prozent:** ganze Zahlen nach dem Verfahren der größten Reste, Summe
  genau 100 (gleich große Stücke können um 1 abweichen; Gleichstand:
  Reihenfolge der Stücke).
- **Farben:** CSS-Variablen `--chart-1` … `--chart-8` für Gebiete,
  `--chart-other`, `--chart-unassigned`, `--chart-unknown`,
  `--chart-restricted` (Grautöne) aus `app/globals.css`.

**Benutzt von:** `lib/services/roots.ts`, `components/PersonRoots.tsx`.

**Tests:** `tests/roots.test.ts`, `tests/roots.db.test.ts`.

### lib/biography.ts
**Zweck:** Text des Abschnitts **„Lebenslauf“** der Personenseite: aus den
erfassten Daten einer Person ein kurzer Text in ganzen Sätzen — nach festen
Regeln, ohne KI, ohne etwas zu erfinden. Rein; Eingabe aus
`lib/biography-input.ts`, Laden in `lib/services/biography.ts`.

**Wichtige Funktionen/Typen:** `buildBiography(input)` → `Biography`
(`paragraphs`: Absätze aus Textstücken, Namen anderer Personen mit
`personId` als Link; `text`: derselbe Text ohne Links zum Kopieren) oder
`null`; `BiographyInput` (Person, weitere Namen, sichtbare Eltern mit Art,
`siblingRank`, Partnerschaften mit Ereignissen und zugeordneten Kindern,
übrige Kinder, Lebensereignisse, heutiger Tag), `BioRef`, `BioEvent`,
`BioPartnership`; Hilfen `dateInText` (Datum als Satzglied), `inPlace` /
`toPlace` (Präposition beim Ort), `ageAtDeath`, `numberWord`, `isDeceased`,
`CHILD_NAMES_MAX` (4).

**Regeln:**
- **Was erzählt wird:** Name (Titel, Zusatz, „geb.“, „genannt …“),
  Geburt mit Ort und leiblichen Eltern (Mutter mit Geburtsname), Stellung
  unter den Geschwistern („als drittes von sieben Kindern“, „als älteres
  von zwei Kindern“, ohne sichere Reihenfolge „als eines von …“), Adoptiv-,
  Stief- und Pflegeeltern, weitere Namen (je Art ein Satz), Lebensereignisse
  (Taufe, Konfirmation, Abschluss, Ausbildung, Beruf, Wohnort, Volkszählung,
  Aus-/Einwanderung, Einbürgerung, Militär, Testament, sonstiges Ereignis,
  Merkmale wie Religion als „Als Religion ist „…“ erfasst.“), Partnerschaften
  (Verlobung, Aufgebot …, Heirat bzw. Beginn, Kinder daraus — bis vier mit
  Namen, sonst nur gezählt; „zwei Söhne und eine Tochter“ nur bei bekanntem
  Geschlecht aller —, Scheidung bzw. Ende), Tod des Partners („Ihr Mann
  starb 1899.“ — nur ohne Scheidung/Ende und wenn er sicher vorher starb),
  übrige Kinder, Tod mit erreichtem Alter, Beerdigung, Todesursache.
- **Was bewusst nicht:** Notizen, Quellen, Zweitangaben (`isAlternative`),
  Kennnummern, Beschreibungen, „Zahl der Kinder/Ehen“ (würde Nicht-Sichtbares
  verraten), Anschriften, Schlüsse und Wertungen, „einziges Kind“.
- **Unsicheres:** Daten in ihrer Genauigkeit und mit Zusatz („am 12. März
  1850“, „im März 1850“, „1850“, „um 1850“, „vor dem 3. Mai 1900“,
  „zwischen 1850 und 1855“, „von 1901 bis 1910“ nur bei Andauerndem, sonst
  „frühestens“/„spätestens“); nur ein Wortlaut → „(Datum: „…“)“. Alter:
  genau, „70 oder 71“ (nur Jahre), „etwa 71“ (bei „um“/geschätzt/
  errechnet), „68 bis 71“ (kleiner Spielraum), unter einem Jahr in Monaten
  bzw. Tagen; offene Angaben oder großer Spielraum → kein Alter. Die
  Geschwisterstellung nur, wenn jedes Geschwister sicher vor oder nach der
  Person geboren ist (`certainlyBefore`).
- **Lebend / verstorben:** verstorben bei Sterbedatum, -ort, -wortlaut,
  -ursache oder Beerdigung/Einäscherung/Testamentseröffnung. Lebend nur mit
  Geburtsdatum innerhalb `PRESUMED_LIFESPAN` (wie `isLiving` in
  `lib/today.ts`): dann Präsens („Sie ist mit … verheiratet; die Hochzeit
  war …“, „Er hat einen Sohn …“, „Als Beruf ist … erfasst.“), kein
  Sterbesatz. Sonst Vergangenheit, aber ohne erfundenen Tod.
- **Sprache:** Pronomen nach Geschlecht, bei unbekanntem bzw. anderem der
  Vorname; Zahlwörter bis zwölf; Länder und Landschaften mit Artikel („in
  der Schweiz“, „in die USA“, „im Elsass“) nach dem ersten Teil der
  Ortsangabe; derselbe Ort wie im vorigen Satz desselben Absatzes heißt
  „dort“ (Sterbeort nie). Datierte Sätze wechseln fest zwischen „Datum
  vorn“ und „Person vorn“ — gleiche Eingabe, gleicher Text.
- **Aufbau:** drei Absätze — Herkunft (Geburt, Eltern, frühe Ereignisse,
  Namen), Leben (undatierte Angaben, dann Ereignisse und Partnerschaften
  nach Datum, Partnertod an seiner Stelle, undatierte Partnerschaften,
  übrige Kinder), Lebensende. Ohne Satz über den Namen hinaus → `null`.

**Benutzt von:** `lib/services/biography.ts`, `components/PersonBiography.tsx` (Typen).

**Tests:** `tests/biography.test.ts`, `tests/biography.db.test.ts`.

### lib/biography-input.ts
**Zweck:** Eingabe des Lebenslaufs aus den Daten der Personenseite
(`PersonDetail`) und den Eltern-Kind-Kanten rund um Eltern und Kinder. Rein.

**Wichtige Funktionen/Typen:** `biographyInputOf(detail, edges, today)`,
`siblingRankOf(detail, edges)`, `ParentEdge`.

**Regeln (Datenschutz):** Platzhalter nicht sichtbarer Verwandter werden
verworfen — weder genannt noch gezählt, auch ihre Partnerschaftsereignisse
nicht. Ein Kind gehört zu einer Partnerschaft, wenn es leibliches Kind der
Person und des (sichtbaren) Partners ist; sonst steht es bei den übrigen
Kindern. Die Stellung unter den Geschwistern nur bei genau zwei leiblichen,
sichtbaren Eltern und nur, wenn jedes gemeinsame leibliche Kind sichtbar
ist (Adoptivkinder und Halbgeschwister zählen nicht mit). Die Kanten
liefern nur Kennungen.

**Benutzt von:** `lib/services/biography.ts`.

**Tests:** `tests/biography.test.ts`.
---

## Auswertungen

### lib/chart-slices.ts
**Zweck:** Stücke eines Rings nach Gebieten (Land bzw. Region) — gemeinsam
für „Wurzeln“ (`lib/roots.ts`) und die Seite „Statistik“
(`lib/statistics.ts`). Rein.

**Wichtige Funktionen/Typen:** `groupAreaSlices` (Gebietswerte plus graue
Restwerte „Ort nicht zugeordnet“, „Unbekannt“, „Nicht freigegeben“ →
Stücke mit Wert, Anteil, Prozent, Farbe und bei „Sonstige“ der Liste der
Gebiete; das Ganze ist die Summe aller Werte oder ein mitgegebener Wert),
`roundPercentages`, `chartColor`, `SLICE_LABELS`, `SLICE_COLORS`,
`CHART_MIN_SLICE` (2 %), `CHART_MAX_AREA_SLICES` (8), Typ `AreaSlice`.

**Regeln:** wie unter `lib/roots.ts` beschrieben — Gebiete absteigend (gleich:
Name), unter 2 % bzw. jenseits des achten nach „Sonstige“, nie ein einzelnes
Gebiet allein; Prozent nach größten Resten mit Summe 100; Farben
`--chart-1` … `--chart-8` und Grautöne aus `app/globals.css`.

**Benutzt von:** `lib/roots.ts`, `lib/statistics.ts`.

**Tests:** `tests/roots.test.ts` (über `rootsSlices`), `tests/statistics.test.ts`.

### lib/statistics.ts
**Zweck:** Rechnung der Seite **„Statistik“** (`/statistics`): Kennzahlen und
Verteilungen über die gezählten Personen, nach dem Vorbild der
Familienstatistik der Ahnenportale. Rein, alles in einem Durchgang über
Personen und Beziehungen; Laden, Rechte und Familienfilter in
`lib/services/statistics.ts`.

**Wichtige Funktionen/Typen:** `computeStatistics` (Eingabe: Personen mit
Namen, Geschlecht, ungenauem Geburts-/Sterbedatum, Ort und `visible`;
Beziehungen mit Art, Unterart und Beginn; Stichtag; Stufe; Ort → Gebiet),
Hilfen `usableYear`, `usableAge`, `centuryOf`, `cleanName`,
`surnameForCount`, `firstGivenName`; Grenzen `MIN_BASIS` (5),
`MAX_DATE_SPAN_YEARS` (10), `TOP_NAMES` (15), `MAX_DECADE_BARS` (30),
`MAX_CHILDREN_CLASS` (10); Ergebnis `StatisticsResult` mit Balken (`Bar`) und
Durchschnittszeilen (`AverageRow`).

**Regeln:**
- **Wer zählt:** nur Personen mit `visible` (die Funktion filtert selbst,
  auch wenn der Dienst schon nur sichtbare liefert). Beziehungen nur, wenn
  beide Seiten gezählt werden — Kinder, Partner und Ehen nicht sichtbarer
  Personen fließen nirgends ein. Das Ergebnis enthält keine Kennungen und
  keine einzelnen Personen, nur Summen, Namen und Gebiete.
- **Lebend/verstorben:** verstorben mit Sterbedatum oder Sterbeangabe ohne
  Datum (Ort, Wortlaut); ohne Sterbeangabe „vermutlich verstorben“, wenn der
  späteste mögliche Geburtstag über `PRESUMED_LIFESPAN` (100) Jahre zurückliegt
  (gleiche Regel wie `getStatistics`, dort aber nur gemeldet); lebend ist der
  Rest. Die Seite nennt die Zahl der vermutlich Verstorbenen eigens.
- **Ungenaue Daten (`lib/dates.ts`):** Ein Jahr gilt, wenn der mögliche
  Zeitraum (`dateBounds`, „um“ mit ±2 Jahren) endlich und höchstens zehn
  Jahre weit ist; gezählt wird die Mitte. „vor“, „nach“, „ab“, „bis“ und
  weitere Bereiche fallen heraus. Ein Alter gilt, wenn beide Angaben
  tagesgenau sind (vollendete Jahre nach dem Kalender) oder die mögliche
  Spanne (`yearsBetween`) endlich und höchstens zehn Jahre weit ist
  (vollendete Jahre zur Mitte); negative Alter und solche über
  `MAX_LIFESPAN` (110) gelten als Datenfehler und zählen nicht.
- **Kennzahlen:** Personen, lebend/verstorben, Partnerschaften,
  Eltern-Kind-Beziehungen, frühestes/spätestes verwertbares Geburtsjahr.
- **Geburtsorte:** Ort je Person (der Dienst wählt Geburtsort, sonst Taufort)
  → Gebiet; ohne Ort „Unbekannt“, Ort ohne Zuordnung „Ort nicht
  zugeordnet“; Stücke über `groupAreaSlices`.
- **Geschlecht:** feste Reihenfolge Weiblich, Männlich, Divers, Unbekannt
  (grau); Prozent nach größten Resten.
- **Namen:** Nachname = Geburtsname, sonst Nachname (`familyName` ist der
  heutige, ggf. Ehename; wie der GEDCOM-Export). Vorname = erstes Wort des
  Vornamensfelds. Platzhalter ohne Buchstaben bzw. „NN“, „N.N.“,
  „unbekannt“ zählen nicht. Gezählt ohne Groß-/Kleinschreibung, angezeigt
  die häufigste Schreibweise; die 15 häufigsten, Gleichstand nach Name.
- **Geburten:** je Jahrzehnt, bei mehr als 30 Jahrzehnten je Jahrhundert,
  lückenlos vom ersten bis zum letzten (leere Zeiträume mit 0).
- **Lebensalter:** Durchschnitt gesamt und je Geburtsjahrhundert
  („1800–1899“), Klassen 0–9 … 90–99, „100 und älter“.
- **Kinderzahl:** je Person die verschiedenen gezählten Kinder über
  leibliche und Adoptiv-Beziehungen (keine Stief-/Pflegekinder);
  Durchschnitt über Personen mit mindestens einem Kind, gesamt und je
  Geburtsjahrhundert der Eltern; Verteilung 1 … 9, „10 und mehr“.
- **Heiratsalter (Zusatz):** je Person die erste Ehe (Unterart verheiratet
  oder geschieden) mit Datum; Alter wie oben; Durchschnitt für Männer und
  Frauen, Klassen „unter 20“, 20–24 … 35–39, „40 und älter“.
- **Geburtsmonate (Zusatz):** nur Geburtsdaten mit Tag oder Monat ohne Zusatz
  („genau“).
- **Kleine Grundlagen:** Durchschnitte erst ab 5 Personen (`MIN_BASIS`),
  sonst `average: null` — die Seite zeigt „zu wenige“ und die Anzahl.

**Benutzt von:** `lib/services/statistics.ts`, `app/statistics/page.tsx`,
`components/StatisticsCharts.tsx` (Typen); `lib/records.ts` (Datums- und
Namensregeln: `usableYear`, `completedYears`, `presumedDead`, `centuryOf`,
`firstGivenName`).

**Tests:** `tests/statistics.test.ts`, `tests/statistics.db.test.ts`.

### lib/records.ts
**Zweck:** Rechnung der Seite **„Rekorde“** (`/records`): die Bestwerte des
sichtbaren Stammbaums mit den Personen beim Namen — die Ergänzung zur
Statistik, die nur Summen zeigt. Rein, wenige Durchgänge über Personen und
Beziehungen; Laden, Rechte und Familienfilter in `lib/services/records.ts`.

**Wichtige Funktionen/Typen:** `computeRecords` (Eingabe: Personen mit
Anzeigename, Lebensjahren, Vorname, Geschlecht, ungenauem Geburts-/Sterbedatum,
Sterbeangabe ohne Datum und `visible`; Beziehungen mit Art, Unterart, Beginn
und Ende; Stichtag) → `RecordsResult` (je Rekord eine `RecordCard` mit Plätzen
`RecordPlace` aus Einträgen `RecordEntry`, dazu die Vornamen je Jahrhundert);
Hilfen `recordYears`, `recordInstant`, `isLiving`, `rankPlaces`; Liste
`RECORD_KEYS`; Grenzen `TOP_PLACES` (5), `MAX_TIED` (5),
`RECORD_MAX_SPAN_YEARS` (5), `MIN_PARENT_AGE` (12), `MAX_MOTHER_AGE` (55),
`MAX_FATHER_AGE` (70), `MIN_MARRIAGE_AGE` (14), `MAX_PARTNERSHIP_YEARS` (90),
`MAX_PARTNER_AGE_GAP` (60), `MIN_NAME_COUNT` (2), `MAX_TIED_NAMES` (3).

**Rekorde:** höchstes erreichtes Alter (Verstorbene), ältestes lebendes
Mitglied, jüngstes Mitglied (zuletzt geboren, lebend oder verstorben),
frühester bekannter Vorfahr (frühestes Geburtsjahr), längste Ehe/Partnerschaft,
meiste Kinder, meiste Nachkommen, längste Abstammungslinie, größte
Geschwisterschar, jüngste und älteste Eltern bei der Geburt, größter
Altersunterschied eines Paares, jüngstes und ältestes Brautpaar; dazu der
häufigste erste Vorname je Geburtsjahrhundert für Mädchen und Jungen (nur
Summen). Keine zusätzlichen Rekorde über die Vorgabe hinaus.

**Regeln:**
- **Wer zählt:** nur Personen mit `visible` (die Funktion filtert selbst);
  Beziehungen nur zwischen gezählten Personen. Kinder, Nachkommen, Linien
  und Geschwister laufen über leibliche und Adoptiv-Elternschaften zwischen
  sichtbaren Personen — ein sichtbarer Enkel hinter einem nicht sichtbaren
  Kind zählt nicht (er verriete das Kind). Ehen nur, wenn beide Partner
  sichtbar sind.
- **Datumsregeln (enger als die Statistik):** Alter und Dauern
  (`recordYears`) tagesgenau in vollendeten Jahren; ungenau nur, wenn die
  mögliche Spanne (`yearsBetween`) höchstens fünf Jahre weit ist — dann die
  vollendeten Jahre zur Mitte und `about` („etwa“). Ein Jahr bzw. ein
  Zeitpunkt (`recordInstant`) gilt, wenn der mögliche Zeitraum höchstens fünf
  Jahre weit ist („um 1650“ ja, „vor 1700“ nein). Die Statistik lässt für
  Durchschnitte zehn Jahre zu; für einen einzelnen Bestwert wäre das zu weit.
- **Datenfehler (zählen nicht):** negative Werte; Alter über
  `MAX_LIFESPAN` (110); Eltern bei der Geburt unter 12, Mütter (und Personen
  ohne Geschlecht „männlich“) über 55, Väter über 70; ein Partner bei Beginn
  der Partnerschaft unter 14 oder über 110 (dann zählt auch die Dauer
  nicht); Dauer über 90 Jahre; Altersunterschied über 60 Jahre; Geburten
  nach dem Stichtag.
- **Lebend:** keine Sterbeangabe und nicht „vermutlich verstorben“
  (`presumedDead` aus `lib/statistics.ts`, über 100 Jahre).
- **Längste Partnerschaft:** Beginn bis zum erfassten Ende; Scheidung ohne
  Datum → offen; sonst bis zum Tod des zuerst Verstorbenen, wenn er
  feststeht (der andere lebt oder hat ein Sterbedatum); leben beide, bis
  heute (Zusatz „besteht noch“). Ist ein Partner verstorben ohne Datum oder
  vermutlich verstorben, bleibt die Dauer offen. Dasselbe Paar mehrfach
  erfasst: die früheste Partnerschaft.
- **Eltern bei der Geburt:** nur leibliche Elternschaften (ein Adoptivkind
  wird nicht „geboren“); je Elternteil nur sein jüngstes bzw. ältestes Alter.
- **Meiste Kinder:** verschiedene Kinder je Person (leiblich und adoptiert,
  keine Stief-/Pflegekinder wie in der Statistik); Personen mit genau
  derselben Kinderschar (ein Paar) bilden einen Eintrag.
- **Meiste Nachkommen:** verschiedene Nachkommen über alle Generationen, je
  Person einmal; Paare mit denselben Kindern ein Eintrag. Berechnet nur für
  Personen mit höchstens fünf Generationen über sich (jeder Vorfahr hat
  strikt mehr Nachkommen, tiefer kann niemand unter die ersten fünf kommen).
- **Längste Linie:** Generationen von einer Person ohne gezählte Eltern bis
  zum tiefsten Nachkommen (längster Weg, Reihenfolge nach Kahn — Kreise in
  den Daten fallen heraus, die Rechnung endet immer). Endpunkt: aus der
  tiefsten Generation eine lebende Person, sonst die zuletzt geborene, sonst
  nach Name. Stammeltern mit demselben Endpunkt (ein Paar) ein Eintrag.
- **Geschwisterschar:** Kinder mit genau denselben gezählten Eltern
  (mindestens zwei Kinder).
- **Brautpaare:** Ehen (verheiratet, geschieden) mit Heiratsdatum und beiden
  Geburtsdaten; gereiht nach der Summe beider Alter („39 Jahre zusammen“),
  je Eintrag beide Alter als `detail` („20 und 19 Jahre“).
- **Vornamen je Jahrhundert:** Jahr nach `usableYear` der Statistik, erster
  Vorname (`firstGivenName`), ohne Groß-/Kleinschreibung gezählt; genannt
  erst ab zwei Trägern, Gleichstand bis zu drei Namen; angezeigt die
  häufigste Schreibweise (bei Gleichstand die großgeschriebene).
- **Rangfolge (`rankPlaces`):** Platz = 1 + Zahl der besseren Einträge
  („1, 1, 3“); Plätze bis fünf, je Platz höchstens fünf Einträge plus
  Anzahl der übrigen; innerhalb eines Platzes genaue vor ungenauen, dann
  nach Name.

**Leistung:** Kahn-Reihenfolge für Generationen, Breitensuche nur für
Kandidaten der Nachkommen; 12 000 erzeugte Personen mit rund 40 000
Beziehungen in rund 0,4 s (`tests/records.test.ts`).

**Benutzt von:** `lib/services/records.ts`, `app/records/page.tsx` (Grenzen
für die Zählsätze), `components/RecordCards.tsx` (Typen).

**Tests:** `tests/records.test.ts`, `tests/records.db.test.ts`.

### lib/today.ts
**Zweck:** Rechnung der Startseite **„Heute in der Familie“** (`/`):
Jahrestage eines Tages, Geburtstage und runde Jahrestage der folgenden
Wochen, dazu die Sätze in Anwendersprache. Rein; Laden und Rechte in
`lib/services/today.ts`.

**Wichtige Funktionen/Typen:** `computeToday` (Eingabe: gewählter Tag,
wirklicher heutiger Tag, Personen mit Name, `visible`, Geburt, Tod,
Sterbeangabe ohne Datum; Partnerschaften mit Unterart, beiden Partnern und
Beginn; Lebensereignisse mit Art, Titel, Datum, `isAlternative`) →
`TodayResult` (`today`, `birthdays`, `upcoming`, `next`, `isRealToday`) aus
`Anniversary`-Einträgen (Art, Personen mit `living`, Jahre, `round`,
`birthday`, `jubilee`, Tag des Begehens, Abstand in Tagen).
Kalenderhilfen `calendarDayIn` (Tag in Europe/Berlin), `parseIsoDay`,
`formatIsoDay`, `formatDayMonth`, `formatLongDay`, `addDays`,
`daysBetween`, `observedDay`; Regeln `preciseDay`, `isLiving`; Sätze
`anniversarySentence` (Teile aus Text und Person, die Oberfläche verlinkt
die Personen), `sentenceText`, `whenText`, `roundLabel`. Grenzen
`UPCOMING_DAYS` (30), `SECTION_LIMIT` (10), `ROUND_ANNIVERSARY` (25),
`ROUND_BIRTHDAY` (10), `NEXT_SEARCH_DAYS` (366); Listen
`ANNIVERSARY_EVENT_TYPES`, `ANNIVERSARY_PARTNER_SUBTYPES`.

**Regeln:**
- **Nur sichere Tagesdaten:** Genauigkeit Tag, Zusatz „genau“, kein Bereich
  (`isPreciseDate` aus `lib/dates.ts`); „um“, „vor“, „nach“, Zeiträume,
  geschätzte und errechnete Angaben und Zweitangaben fallen heraus.
- **Was zählt:** Geburt und Tod sichtbarer Personen; Beginn von
  Partnerschaften der Unterarten verheiratet, unverheiratet und „Ehestand
  unbekannt“ (geschiedene Ehen nicht) — nur wenn **beide** Partner sichtbar
  sind; Lebensereignisse an einem Tag (Taufe, Konfirmation, Erstkommunion,
  Bar/Bat Mizwa, Segnung, Weihe, Abschluss, Ruhestand, Aus-/Einwanderung,
  Einbürgerung, Adoption, sonstiges Ereignis). Dauerzustände (Beruf,
  Wohnort …) und Beerdigung/Einäscherung zählen nicht.
- **Tag:** Kalendertag, „heute“ nach Europe/Berlin (`calendarDayIn`). Ein
  29. Februar wird in Nicht-Schaltjahren am 28. Februar begangen. Jahrestage
  erst ab dem ersten Jahr (kein „vor 0 Jahren“).
- **Lebend:** ohne Sterbedatum, ohne Sterbeangabe und nicht über
  `PRESUMED_LIFESPAN` (100) Jahre laut spätestem möglichem Geburtstag — wie
  `lib/statistics.ts`. Geburten Lebender sind Geburtstage („Anna Beispiel
  wird heute 34“), sonst „Heute vor 120 Jahren wurde … geboren“.
- **Rund:** Jahrestage bei Vielfachen von 25, Geburtstage Lebender bei
  Vielfachen von 10. Leben beide Partner, trägt die Hochzeit den Namen des
  Jubiläums (25 Silberne, 50 Goldene, 60 Diamantene, 65 Eiserne,
  70 Gnaden-, 75 Kronjuwelenhochzeit) und gilt als rund.
- **Abschnitte:** `today` = alles am gewählten Tag, runde zuerst, dann
  jüngere Jahrestage, Art, Name. `birthdays` = Geburtstage Lebender in den
  nächsten 30 Tagen (ohne den Tag selbst), nach Datum. `upcoming` = runde
  Jahrestage von Geburten Verstorbener, Todestagen und Partnerschaften in
  den nächsten 30 Tagen (keine Lebensereignisse), nach Datum. `next` nur
  bei leerem Tag: der nächste Jahrestag überhaupt bis ein Jahr voraus.
- **Sätze:** „Heute“/„Morgen“ nur, wenn der gewählte Tag der wirkliche
  heutige ist, sonst „Am 14. März“; Einträge des gewählten Tages selbst
  ohne Zeitangabe („Vor 75 Jahren starb …“, „… wird 50“), weil die
  Überschrift den Tag nennt. Geburtstage: „Anna Beispiel wird heute 34“,
  „Morgen wird … 36“, „Am 2. Januar wird … 40“. Verben für Geburt, Tod, Hochzeit,
  Partnerschaft, Taufe, Adoption, Einbürgerung, Aus- und Einwanderung,
  sonst „{Titel} von {Person}“.
- **Datenschutz:** Nur Personen mit `visible` gehen ein; die Funktion
  filtert selbst, auch wenn der Dienst schon nur sichtbare liefert.

**Benutzt von:** `lib/services/today.ts`, `app/page.tsx`,
`components/TodayList.tsx`.

**Tests:** `tests/today.test.ts`, `tests/today.db.test.ts`,
`e2e/read/today.spec.ts`.

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
`timeline`, `rings` — letztere ohne Fokus-Ausschnitt, siehe
`lib/ancestor-rings.ts`), `FOCUS_COOKIE` (`tree-focus`, auch Mitte der Ringe), `FOCUS_DEPTH` (1–4, Standard 2
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

### lib/ancestor-rings.ts
**Zweck:** Ansicht „Ringe“ — die Vorfahren einer Person als Vollkreis
(Ahnenfächer): Platzvergabe, Geometrie, Beschriftungsplan,
Verwandtschaftsstufe, Farbstufen. Rein, ohne Datenbank und ohne
Rechteprüfung, auch im Browser nutzbar; Laden und Sichtbarkeit in
`lib/services/ancestor-rings.ts`, Darstellung in
`components/AncestorRings.tsx`.

**Wichtige Funktionen/Typen:** Grenzen `RINGS_MIN_GENERATION` (3),
`RINGS_MAX_GENERATION` (7), `RINGS_DEFAULT_GENERATION` (5); Adressparameter
`RINGS_GENERATION_PARAM` (`generationen`), `RINGS_COLORING_PARAM` (`farbe`),
`RINGS_DIRECTION_PARAM` (`richtung`), `parseRingsGeneration` (mit
Standard je Richtung als zweitem Wert), `parseRingsColoring`,
`parseRingsDirection`, `ringsDefaultGeneration` (Vorfahren 5, Nachfahren
4), `RingsColoring` (`linie`, `wurzeln`), `RingsDirection` (`vorfahren`,
`nachfahren`); `ringSlotCount`; Platzvergabe `orderParents`, `assignRingSlots`
(→ `RingSlot`), `childSlot`, `slotSide`, `slotLine`, `ringRelationTerm`;
Geometrie `RINGS_VIEWBOX`, `ringGeometry`, `slotAngles`, `polar`,
`sectorPath`, `isLowerHalf`, `labelArcPath`, `radialRotation`; Beschriftung
`ringLabelPlan`, `arcLabelPlan` (eine Fläche mit beliebigem Anteil am
Vollkreis — auch für die Nachfahren; optional mit eigener Schriftgröße in
Bildpunkten, die nutzt der Druck), `centerLabelRows` (Mitte: Vorname,
Nachname, Lebensjahre, Mindestgröße wählbar), `truncate`, `fitName`, `fitYears`, `ringsSummary`; Farben
`lineTint`, `lineColorVar`.

**Regeln (Entscheidungen des Eigentümers):**
- **Plätze:** Generation g (Eltern = 1) hat 2^g Plätze. Die Eltern von
  (g, i) stehen auf (g+1, 2i) und (g+1, 2i+1) — der Bogen eines Kindes wird
  in zwei gleiche Hälften geteilt. Kein Platz verschiebt sich je; ein
  fehlender Elternteil lässt seinen Platz und alles dahinter leer.
- **Seitenregel:** im Uhrzeigersinn zuerst der Vater, dann die Mutter. Der
  Kreis beginnt links (9 Uhr), die Vaterseite liegt damit oben, die
  Mutterseite unten. Rang männlich vor unbekannt/anders vor weiblich,
  sonst stabile Reihenfolge der Eingabe; ein einzelner Elternteil kommt auf
  den Mutterplatz, wenn er weiblich ist, sonst auf den Vaterplatz. Doppelte
  zählen einmal; mehr als zwei Eltern: nur die ersten zwei nach dieser
  Regel.
- **Ahnenschwund:** derselbe Vorfahr steht auf jedem seiner Plätze (Suche je
  Weg). **Zyklen:** ein Elternteil, der schon auf dem eigenen Weg zur Mitte
  liegt, gilt als fehlend — nach der Seitenregel, damit sich nichts
  verschiebt. **Nicht sichtbar:** Platz `restricted` ohne Kennung; seine
  Eltern werden nicht gefragt.
- **Verwandtschaftsstufe:** `bloodRelationTerm` aus `lib/kinship.ts` mit
  `up` = Generation („Urgroßmutter“, ab 7: „Vorfahr in der 7. Generation“);
  die Seite gibt der Aufrufer nur, wenn sie belegt ist.
- **Geometrie:** viewBox 1000 × 1000, Mitte und Ringe bis knapp an den
  Rand. Relative Ringbreiten: innen gleich, Generation 3–4 etwas breiter
  (dort wird der Bogen eng), ab Generation 6 schmaler, aber noch zu treffen.
  Winkel in SVG-Koordinaten (im Uhrzeigersinn), Platz (g, i) beginnt bei
  180° + i · 360°/2^g.
- **Text nie kopfüber:** im Bogen läuft der Textpfad oben im Uhrzeigersinn,
  in der unteren Hälfte umgekehrt; entlang des Radius wird links um 180°
  gedreht.
- **Beschriftungsplan:** je Ring aus Breite und Bogenlänge und der
  gezeichneten Größe (Bildpunkte je viewBox-Einheit; Schrift 13 bzw. 12 px):
  Bogen, Radius oder nichts — was mehr Zeichen fasst; mindestens 4 Zeichen,
  höchstens 2 Zeilen (Name, Lebensjahre). Namen: voll, sonst „Vorname N.“,
  sonst Vorname, sonst gekürzt mit „…“.
- **Farbstufen:** `lineTint` nach außen abnehmend (50 % … 18 % Linienfarbe,
  Rest Kartenfläche).

**Benutzt von:** `lib/services/ancestor-rings.ts`,
`lib/services/descendant-rings.ts`, `components/AncestorRings.tsx`,
`components/tree-url.ts`, `app/tree/page.tsx`.

**Tests:** `tests/ancestor-rings.test.ts` (volle Belegung, Lücken,
Seitenregel, Ahnenschwund, Zyklus, nicht sichtbarer Vorfahr, Geometrie,
Textausrichtung, Beschriftung, Verwandtschaftsstufe, Adresse),
`tests/ancestor-rings.db.test.ts`; Richtung und `arcLabelPlan` auch in
`tests/descendant-rings.test.ts`.

### lib/descendant-rings.ts
**Zweck:** Ansicht „Ringe“, Richtung „Nachfahren“ — die Nachkommen einer
Person als Vollkreis: Aufteilung der Bögen, Partnerschaftsgruppen,
Obergrenze, Verwandtschaftsstufe, Zusammenfassung. Rein, ohne Datenbank und
ohne Rechteprüfung; Geometrie, Beschriftung und Farbstufen teilt es mit
`lib/ancestor-rings.ts`. Laden und Sichtbarkeit in
`lib/services/descendant-rings.ts`, Darstellung in
`components/AncestorRings.tsx`.

**Wichtige Funktionen/Typen:** `DESCENDANT_RINGS_DEFAULT_GENERATION` (4),
`DESCENDANT_RINGS_MAX_SEGMENTS` (400), `MIN_SPAN_DEG` (0,6°),
`GROUP_GAP_DEG` (1,6°); `layoutDescendants(graph)` → `DescendantLayout`
(Flächen `DescendantSegment` mit Schlüssel `Generation:Nummer`, Winkeln,
Linie, Elternfläche, Adoption, Art; gezeigte Tiefe, tiefste Generation,
`capped`); `splitArc`, `groupChildren`, `descendantRelationTerm`,
`descendantsSummary`, `descendantsCapNotice`; Eingabe `DescendantGraph`
(`childrenOf`, `visible`) mit `RingChild` (Kennung, adoptiert,
Partnerschaftsschlüssel).

**Regeln (Entscheidungen des Eigentümers):**
- **Keine festen Plätze:** Der Vollkreis (ab 9 Uhr im Uhrzeigersinn) wird
  unter den Kindern nach dem Gewicht ihres Teilbaums aufgeteilt — die
  Person selbst plus alle gezeigten Nachkommen; so zählt jede Person
  mindestens sich selbst, und kinderlose Kinder bleiben sichtbar. Jede
  Person gibt ihren Bogen vollständig an ihre Kinder weiter (die Kinder
  füllen ihn ganz, nach demselben Gewicht).
- **Mindestbreite:** jedem Kind zuerst `MIN_SPAN_DEG`, der Rest nach
  Gewicht; reicht der Bogen nicht einmal dafür, gleichmäßig.
- **Reihenfolge und Gruppen:** Eingabe nach Geburt (Dienst); Kinder
  derselben Partnerschaft (gleiche übrige Eltern) stehen beieinander,
  Gruppen in der Reihenfolge ihres ältesten Kindes. Zwischen zwei Gruppen
  eine Lücke von höchstens `GROUP_GAP_DEG`, zusammen höchstens ein
  Zehntel des Bogens.
- **Mehrfach-Nachkomme** (Ehe unter Verwandten): erscheint an jeder
  Stelle, mit seinem Teilbaum, und zählt im Gewicht je Stelle. **Zyklen:**
  ein Kind, das schon auf dem eigenen Weg zur Mitte liegt (oder die Mitte
  selbst ist), fällt weg; doppelte Einträge zählen einmal.
- **Nicht sichtbar:** Fläche `restricted` ohne Kennung; seine Kinder
  werden nicht gefragt; Gewicht 1.
- **Obergrenze:** Würde eine Generation mehr als
  `DESCENDANT_RINGS_MAX_SEGMENTS` Flächen ergeben, entfallen sie und alle
  tieferen ganz (lieber ganze Ringe als zufällig abgeschnittene Zweige);
  die Kinder der Mitte immer. Die Ansicht nennt es
  (`descendantsCapNotice`). 400 Flächen bleiben im Browser flüssig und
  im äußersten Ring noch antippbar.
- **Schlüssel:** je Ring fortlaufend im Uhrzeigersinn — die
  Tab-Reihenfolge läuft so von innen nach außen.
- **Begriffe:** `bloodRelationTerm` mit `down` = Generation („Tochter“,
  „Enkel“, „Urenkelin“, ab 7: „Nachfahre in der 7. Generation“),
  unbekanntes Geschlecht neutral („Kind“, „Enkelkind“).
- **Zusammenfassung:** „47 Nachkommen in 4 Generationen“ (Einzahl „1
  Nachkomme in 1 Generation“), „, davon 2 nicht freigegeben“, ohne
  Nachkommen „Keine Nachkommen erfasst“.

**Benutzt von:** `lib/services/descendant-rings.ts`,
`components/AncestorRings.tsx`, `lib/ancestor-rings.ts` (Standardtiefe).

**Tests:** `tests/descendant-rings.test.ts` (Gewichtung, kinderlose
Kinder, Reihenfolge, Gruppen und Lücken, Mindestbreite, Mehrfach-Nachkomme,
Zyklus, nicht sichtbarer Nachkomme, Obergrenze, Adoption, Begriffe,
Zusammenfassung, Adresse), `tests/descendant-rings.db.test.ts`.

### lib/rings-segments.ts
**Zweck:** Beide Richtungen der Ringe als dieselben Flächen
(`RingSegment`: Schlüssel, Generation, Winkel, Art, Person, Begriff,
Gebiet, Elternfläche, Adoption, Linienfarbe als CSS-Variable,
Liniennummer) — gemeinsam für Bildschirm (`components/AncestorRings.tsx`)
und Druck (`components/RingsPrintSheet.tsx`), damit beide genau dasselbe
zeichnen. Rein; was ankommt, hat der Dienst schon nach Rechten gefiltert.

**Wichtige Funktionen/Typen:** `ringSegments(data)`, `shownRingCount`
(Nachfahren: nur so viele Ringe, wie es Generationen gibt, mindestens 3),
`slotKey`, `personName`, `PARENT_COLORS` (Vater/Mutter in der Mischfarbe
ihrer Seite), Typ `RingsData`.

**Regeln:** Liniennummer der Vorfahren: Großeltern-Linie 0–3 (VV, VM, MV,
MM), Vater 0, Mutter 2; Nachfahren: Nummer des Kindes der Mitte. Der Druck
wählt danach sein Muster (Graustufen).

**Benutzt von:** `components/AncestorRings.tsx`,
`components/RingsPrintSheet.tsx`.

**Tests:** indirekt über `e2e/read/rings.spec.ts` und
`e2e/read/rings-print.spec.ts`.

### lib/rings-print.ts
**Zweck:** „Ahnentafel zum Drucken“ — die Ringe als Blatt vom A4-Ausdruck
bis zum Poster (Seite `app/tree/print`, Zeichnung
`components/RingsPrintSheet.tsx`). Rein: Adresse, Blattmaße,
`@page`-Regel, Aufteilung des Blatts, Schriftgrößen nach Blattmaß, feste
Druckfarben und Muster, Titelvorgabe, Dateiname. Die Pfad-Konstante steht
zusätzlich allein in `lib/rings-print-path.ts`, damit die Kopfzeile sie
kennt, ohne die Drucklogik in jede Seite zu laden.

**Wichtige Funktionen/Typen:** `PAPER_FORMATS` (A4–A0), `sheetSize`,
`pageRule`; `RingsPrintSettings`, `parseRingsPrintParams`, `ringsPrintUrl`
(Parameter der Ringe `focus`, `richtung`, `generationen`, `farbe` plus
`format`, `ausrichtung` `hoch|quer`, `titel`, `datum=0`, `namen=0`;
Vorgaben bleiben weg), `cleanPrintTitle` (ohne Steuerzeichen, höchstens 80
Zeichen); `defaultPrintTitle`, `printSubtitle`, `formatPrintDate`,
`printFileName`, `wrapText`; `sheetLayout` (→ `SheetLayout` in mm);
`printLabelFontPx`, `printLabelPlan`, `printPxPerUnit`,
`RINGS_PRINT_OUTER_GENERATION` (5); `PRINT_COLORS`, `printColor`,
`printTint`, `mixHex`, `luminance`, `contrast`, `printPattern`.

**Regeln:**
- **Ein SVG in Millimetern:** Das Blatt (viewBox = Blattmaß, `width`/`height`
  in mm) enthält Titel, Kreis, Legende und Fußzeile. Am Bildschirm wird es
  per CSS verkleinert, im Druck in Blattgröße gesetzt; die Seitenränder
  (10 mm · Maßstab + 2 mm) liegen im Blatt, `@page` hat Rand 0 — so ergibt
  der Druck genau eine Seite im gewählten Format. Dasselbe SVG ist der
  Download.
- **Aufteilung:** Maßstab = kurze Seite / 210 mm; alle Schriften und
  Abstände wachsen damit. Titel oben mittig (wird schmaler, statt
  überzulaufen), Kreis so groß wie möglich und mittig; Legende hochkant
  unter dem Kreis (ab vier Einträgen zweispaltig, Block mittig), quer
  links neben ihm; Einträge umbrechen auf bis zu drei Zeilen, was nicht
  passt, zählt „… und n weitere“. Fußzeile unten mittig.
- **Beschriftung nach Blattmaß:** dieselbe Regel wie am Bildschirm
  (`arcLabelPlan`, jetzt mit wählbarer Schriftgröße), mit den Bildpunkten je
  Einheit des gedruckten Kreises. Schrift auf A4 innen 3,4 mm, weiter außen
  3,1 mm; größeres Papier innen mit Maßstab^0,65, außen (ab Generation 5,
  bis 2,5 mm · √Maßstab hinunter) langsamer — so passen auf Postern mehr
  Namen. In den äußeren Ringen zuerst die größere Schrift, die kleinere
  nur, wenn sonst nicht einmal „Vorname N.“ passt. Schalter „Namen in den
  äußeren Ringen“ aus: dort keine Schrift.
- **Feste helle Farben:** Werte des hellen Schemas (Test gleicht sie mit
  `app/globals.css` ab), Mischungen mit Weiß schon gerechnet
  (`printTint`, Anteile wie am Bildschirm, `lineTint`), keine
  CSS-Variablen und kein `color-mix` — das Blatt bleibt im dunklen Schema
  hell, und die SVG-Datei zeigt außerhalb des Browsers dieselben Farben.
  `printTint` nimmt die Farbe zurück, bis die Schrift mindestens 4,5 : 1
  Kontrast hat.
- **Graustufen:** Muster je Linie bzw. Legendeneintrag (`printPattern`:
  ohne, Punkte, waagerechte Striche, Gitter, danach von vorn); „nicht
  freigegeben“ hat die Schrägschraffur — die anderen Muster haben bewusst
  keine Schrägen.

**Benutzt von:** `app/tree/print/page.tsx`, `components/RingsPrintSheet.tsx`,
`components/AncestorRings.tsx` (Knopf „Drucken“), `components/NavBar.tsx`
(nur `lib/rings-print-path.ts`).

**Tests:** `tests/rings-print.test.ts` (Blattmaße, `@page`, Adresse hin und
zurück, Titel, Dateiname, Umbruch, Aufteilung je Format und Ausrichtung,
Schrift nach Blattmaß, Druckfarben gleich `globals.css`, Kontrast,
Graustufen), `e2e/read/rings-print.spec.ts`.

---

## Dubletten und Zusammenführen

### lib/name-keys.ts
**Zweck:** Vergleichsformen für Namen und Orte — gemeinsam für
Dublettensuche, Zusammenführen und Importvorschläge.

**Wichtige Funktionen:** `nameKey` (klein, ohne Akzente, Umlaut → „e“-
Schreibung, ß → ss, ph → f, th → t, Doppelbuchstaben einfach, nur
Buchstaben), `firstGivenKey`, `placeCompareKey` (nur der Teil vor dem
ersten Komma), `samePlace`, `editDistance` (Levenshtein).

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
`/research/connect`. Derselbe Abgleich liefert die Vorschläge schon beim
GEDCOM-Import (`lib/services/import-suggestions.ts`).

**Wichtige Funktionen/Typen:** `LinkPerson`, `LinkPair` (Klasse, Punkte,
Gründe, Widersprüche, `viaRelative`, `bridge`, `veryLikely`),
`relaxedMatch` (gelockerte Prüfung für Verwandte; vergibt nie eine Klasse),
`LinkResult` (Paare, sichere Cluster, Teile vorher/nachher, Brücken je
Gruppenpaar, Dauer), `LinkOptions` (Gruppen, `withinGroup`, `dismissed`,
`lineage`, `focus`), `linkImports`, `evidenceSentence`.

**Option `focus`** (Menge von Personen-IDs): nur Paare, an denen eine dieser
Personen beteiligt ist — für die Importvorschau (neue Personen der Datei
gegen den Bestand). Bewertung, Klassen, Eindeutigkeit, Ausbreitung, Cluster
und Brücken bleiben dieselben; es entstehen nur keine Paare innerhalb des
Bestands (die sind Sache von „Importe verbinden“). Mit `focus` wird ein Paar
nie „sicherer“ als ohne (`tests/import-suggestions.test.ts`).

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

**Benutzt von:** `lib/services/import-linking.ts`,
`lib/services/import-suggestions.ts`, `lib/services/duplicates.ts`
und `lib/services/merge-followups.ts` (`evidenceSentence`, `relaxedMatch`),
`components/ConnectImports.tsx`, `tests/fixtures/linking-generator.ts`.

**Tests:** `tests/import-linking.test.ts` (erzeugte Testbäume),
`tests/import-linking.db.test.ts`, `tests/import-suggestions.test.ts`
(mit `focus`).

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

Vorschläge, welche Person der Datei eine schon vorhandene sein könnte, gibt
es keine eigene Heuristik mehr (früher `lib/gedcom-import/suggest.ts`, nur
gegen von Hand erfasste Personen): Sie kommen aus demselben Abgleich wie
„Importe verbinden“ — `lib/services/import-suggestions.ts` mit
`linkImports` aus `lib/import-linking.ts`.

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
Stationen als Jahr/Ortsindex-Paare; für die Zeitreise nur bei Bedarf
`b` Geburtsjahr fürs Alter, wenn ≠ Beginn, `ba` ungenau, `bt` aus der Taufe,
`nb` ohne Geburts- und Taufjahr), `MapPayload` (dazu `mar`: Hochzeiten als
flache Liste Jahr/Index/Partnerindex oder −1, nach Jahr sortiert),
`MapPersonInput` (mit `baptism`, früheste Taufe), `MapFactInput`,
`MapMarriageInput`, `pickMarriages`, `CoordsLookup`.

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
- **Taufe:** die früheste Taufe (auch ohne Ort) zählt wie ein datiertes
  Ereignis für den Beginn und ersetzt fürs Alter die fehlende Geburt.
- **Alter (Zeitreise):** Geburtsjahr, sonst Taufjahr; ungenau bei
  Qualifier ≠ EXACT der Geburt oder wenn nur die Taufe bekannt ist.
- **Hochzeiten** (`pickMarriages`): PARTNER_OF mit Untertyp MARRIED oder
  DIVORCED und Beginndatum, beide Partner sichtbar, mindestens einer in der
  Auswahl; Jahr wie `factYear`. Partner außerhalb der Auswahl → −1.
- **Datenmenge:** Zusatzfelder nur, wo nötig — bei genauer Geburt nichts;
  bei 12 000 erzeugten Personen mit 6 000 Ehen gut 1,5 MB JSON, davon rund
  90 KB Hochzeiten (`tests/map.test.ts`, „Leistung“).

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

Zeitreise (alles aus denselben, einmal geladenen Daten): `clampYear`
(Spanne des Reglers, gerundet), `parseYearInput`, `aliveByYear`
(Lebende je Jahr für den Zeitstrahl, ein Differenzfeld), `birthYearOf`,
`ageInYear`/`formatAge` (Jahr − Geburtsjahr; „34 Jahre“, „etwa 34 Jahre“,
„1 Jahr“, „unter 1 Jahr“, „Alter unbekannt“), `livedInYear` (genau die
Lebenden von `snapshot`, mit Ort und Alter), `placeLabelOf`, `sortLived`
(Name; Alter absteigend, ohne Alter am Ende), `groupLivedByPlace` (Orte der
Karte nach Zahl, dann „Ort nicht auf der Karte“, dann „ohne bekannten Ort“),
`eventsInYear` (Geburten = Geburts- bzw. Taufjahr, Todesfälle = Ende ohne
`est`, Hochzeiten aus `mar`). Gemessen bei 12 000 Personen: unter 1 ms je
Jahr für Liste und Ereignisse.

**Benutzt von:** `components/MapExplorer.tsx`.

**Tests:** `tests/map.test.ts`.

### lib/map/projection.ts
**Zweck:** Mercator-Projektion wie in `scripts/build-geodata.mjs`
(Ländergrenzen `public/geo/countries.json`), Welt 1000 Einheiten breit,
Breite auf ±84° begrenzt.

**Wichtige Funktionen/Typen:** `project`, `WORLD`, `MAX_LAT`, `ViewBox`,
`VIEWS` (Europa, Welt), `fitViewBox` (auf Seitenverhältnis bringen ohne
abzuschneiden), `zoomAt` (Zoom um einen Punkt mit Grenzen).

**Benutzt von:** `components/MapExplorer.tsx`, `components/LifePathMap.tsx`.

**Tests:** `tests/map.test.ts`.

### lib/map/countries.ts
**Zweck:** Ländergrenzen für die Karten im Browser laden
(`public/geo/countries.json`), einmal je Seite, im Modul zwischengespeichert;
nach einem Fehler beim nächsten Aufruf neu versucht.

**Wichtige Funktionen/Typen:** `loadCountries`, `Country`.

**Benutzt von:** `components/MapExplorer.tsx`, `components/LifePathMap.tsx`.

**Tests:** indirekt `e2e/read/map.spec.ts`, `e2e/read/lifepath.spec.ts`.

### lib/map/life-path.ts
**Zweck:** Reine Logik des „Lebenswegs“ auf der Karte: Stationen ordnen,
nummerieren, Orte auflösen, gleiche Orte zusammenfassen, Teilstücke
bilden; dazu die Wahl des nächsten Vorfahren einer Vater- bzw. Mutterlinie.

**Wichtige Funktionen/Typen:** `orderStations`, `buildLifePath`,
`pointNumbers` („3“, „1–3“, „2, 4“), `nextInLine`,
`walkLines`, `LINE_MAX_GENERATIONS` (12); `StationInput`, `PathStation`,
`PathPoint`, `PathSegment`, `LifePath`, `PlaceLookup`, `LineParent`,
`LineEnd` (`none`, `restricted`, `ambiguous`, `limit`).

**Regeln:**
- **Reihenfolge:** Rolle „start“ (Geburt) vorn, „end“ (Tod Rang 0, danach
  Rang 1) hinten — auch ohne Datum; „middle“ mit Datum dazwischen nach dem
  Anker (`date`), bei gleichem Anker genauere Angabe zuerst (Tag < Monat <
  Jahr, ohne Zusatz vor mit Zusatz), sonst Eingabereihenfolge. „middle“ ohne
  Datum → „ohne Datum“ (ohne Nummer, nicht auf dem Weg). Linien (`fixed`)
  behalten die gegebene Reihenfolge.
- **Ungenaue Daten** bekommen kein eigenes Kennzeichen: Die Unsicherheit
  steht im Datumstext selbst („um 1858“, „vor 1900“); reine Jahres- oder
  Monatsangaben erscheinen ohne Zusatz.
- **Karte:** nur Orte mit Koordinaten (`PlaceLookup` liefert Koordinaten,
  „unresolvable“ oder nichts → Status `map`, `unresolvable`, `unassigned`;
  ohne Ortstext `none`). Folgt eine Station auf der Karte mit gleichen
  Koordinaten (±0,0001°) auf den vorigen Punkt — auch über Stationen ohne
  Karte hinweg —, gehört sie zu diesem Punkt. Ein Teilstück ist
  `skipped`, wenn zwischen seinen Punkten eine Station ohne Ort auf der
  Karte liegt.
- **Linie:** `nextInLine` wählt unter den leiblichen Eltern den sichtbaren
  mit Geschlecht MALE (Vater) bzw. FEMALE (Mutter); mehrere → `ambiguous`;
  keiner, aber ein nicht sichtbarer Elternteil → `restricted`; keiner, aber
  ein sichtbarer mit anderem Geschlecht als dem des anderen Elternteils →
  `ambiguous`; sonst `none`. `walkLines` läuft beide Linien zugleich mit
  einem Ladeaufruf je Generation, Zyklen enden als `ambiguous`, nach
  `max` Generationen `limit` (eine Generation mehr wird nur gefragt, um
  `none` zu erkennen).

**Benutzt von:** `lib/services/life-path.ts`, `components/LifePathMap.tsx`.

**Tests:** `tests/life-path.test.ts`, `tests/life-path.db.test.ts`.

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

**Benutzt von:** `map/build`, `map/life-path`, `places/gazetteer`, `places/match`,
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

### lib/places/area.ts
**Zweck:** Ort → **Land** bzw. **Region** aus der vorhandenen
Ortszuordnung (Tabelle `Place`). Rein; das Ortsverzeichnis wird übergeben,
nicht geladen (Laden: `lib/services/place-areas.ts`). Für „Wurzeln“ und
künftige Auswertungen.

**Wichtige Funktionen/Typen:** `countryName` (ISO-Code → deutscher Name über
`Intl.DisplayNames`, unbekannte Codes bleiben stehen), `regionIndex(gaz,
ids)` (Verzeichniskennung → Regionscode `cc.a1` und Name), `placeArea(row,
level, regions)` → Gebiet (`key`, `label`, `countryCode`) oder
`unassigned`; `AreaLevel`, `PlaceAreaRow`, `RegionInfo`, `PlaceArea`.

**Regeln:**
- **Land:** `countryCode` der Zuordnung; Schlüssel ist der Code, angezeigt
  der deutsche Name.
- **Region:** Region erster Ebene (Bundesland, Kanton, Woiwodschaft,
  Provinz) über `gazetteerId` → Verzeichniseintrag (Ort oder Region) →
  `a1` → Regionseintrag; Name: deutscher Name des Verzeichnisses, sonst der
  heutige („Niederschlesien“ statt „Województwo dolnośląskie“). Bezeichnung
  „Region, Land“. **Nicht** aus dem Anzeigenamen `label` gelesen: der nennt
  die Region nur im deutschen Sprachraum, lässt sie bei Stadtstaaten weg
  („Bremen, Deutschland“) und ist bei von Hand bestätigten bzw. eigenen
  Orten frei formuliert.
- Ohne verlässliche Region (eigene Koordinaten ohne Kennung, Zuordnung nur
  auf ein Land, historische Landschaft, Kennung nicht mehr im Verzeichnis,
  Region in einem anderen Land als `countryCode`): Land mit Zusatz „(ohne
  Region)“, Schlüssel `cc.?`.
- **Nicht zugeordnet:** keine Zeile in `Place` („offen“), „nicht
  zuordenbar“ oder kein Ländercode. „Unsicher“ gesetzte Zuordnungen zählen
  wie sichere.

**Benutzt von:** `lib/services/place-areas.ts`.

**Tests:** `tests/roots.test.ts`.

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
**Zweck:** Ziele der Kontexthilfe (`HELP_LINKS`: Karte, Wurzeln, Orte zuordnen,
Linien, Ringe, Bezugsperson, Dubletten, Dubletten-Klassen, KI-Vorprüfung der
Dubletten, KI-Zugang, Einstellungen, Statistik, Verwandtschaft und deren
Abschnitt „Nicht freigegebene Personen“) an einer
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
